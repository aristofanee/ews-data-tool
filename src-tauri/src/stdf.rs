use crate::dataset::Imported;
use crate::model::{WaferGeom, NAN};
use memmap2::Mmap;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

struct Cur<'a> {
    b: &'a [u8],
    p: usize,
    be: bool,
}

impl<'a> Cur<'a> {
    fn new(b: &'a [u8], be: bool) -> Self {
        Self { b, p: 0, be }
    }

    fn take(&mut self, n: usize) -> &'a [u8] {
        let start = self.p.min(self.b.len());
        let end = self.p.saturating_add(n).min(self.b.len());
        self.p = self.p.saturating_add(n);
        &self.b[start..end]
    }

    fn u8(&mut self) -> u8 {
        self.take(1).first().copied().unwrap_or(0)
    }

    fn i8(&mut self) -> i8 {
        self.u8() as i8
    }

    fn u16(&mut self) -> u16 {
        let s = self.take(2);
        if s.len() < 2 {
            return 0;
        }
        if self.be {
            u16::from_be_bytes([s[0], s[1]])
        } else {
            u16::from_le_bytes([s[0], s[1]])
        }
    }

    fn i16(&mut self) -> i16 {
        self.u16() as i16
    }

    fn u32(&mut self) -> u32 {
        let s = self.take(4);
        if s.len() < 4 {
            return 0;
        }
        if self.be {
            u32::from_be_bytes([s[0], s[1], s[2], s[3]])
        } else {
            u32::from_le_bytes([s[0], s[1], s[2], s[3]])
        }
    }

    fn remaining(&self) -> usize {
        self.b.len().saturating_sub(self.p)
    }

    fn f32(&mut self) -> f32 {
        // Missing trailing fields (some older writers omit LO_SPEC/HI_SPEC)
        // must not silently become 0.0.
        if self.remaining() < 4 {
            self.p = self.b.len();
            return NAN;
        }
        f32::from_bits(self.u32())
    }

    fn cn(&mut self) -> String {
        let n = self.u8() as usize;
        let raw = self.take(n);
        let s: String = raw
            .iter()
            .take_while(|b| **b != 0)
            .map(|b| if (0x20..0x7f).contains(b) { *b as char } else { ' ' })
            .collect();
        s.trim().to_string()
    }
}

fn read_u16(d: &[u8], off: usize, be: bool) -> u16 {
    if off + 2 > d.len() {
        return 0;
    }
    if be {
        u16::from_be_bytes([d[off], d[off + 1]])
    } else {
        u16::from_le_bytes([d[off], d[off + 1]])
    }
}

pub fn import_stdf(path: &Path, progress: &mut dyn FnMut(f32, &str)) -> Result<Imported, String> {
    let mut file = File::open(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    let mut magic = [0u8; 3];
    let n = file
        .read(&mut magic)
        .map_err(|e| format!("Cannot read {}: {e}", path.display()))?;

    // Unix compress (.Z / LZC) is a common wrapper for STDF files on older
    // test floors. It is not gzip/zip; decode it before parsing the records.
    if n >= 2 && magic[0] == 0x1f && magic[1] == 0x9d {
        file.seek(SeekFrom::Start(0))
            .map_err(|e| format!("Cannot rewind {}: {e}", path.display()))?;
        let mut compressed = Vec::new();
        file.read_to_end(&mut compressed)
            .map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
        progress(1.0, "Decompressing .Z...");
        let data = lzw_z::decompress_slice(&compressed)
            .map_err(|e| format!("Cannot decompress {}: {e}", path.display()))?;
        progress(10.0, "Parsing STDF...");
        let mut cb = |pct: f32, msg: &str| progress(10.0 + pct * 0.9, msg);
        return parse_stdf_bytes(&data, &mut cb);
    }

    let mmap = unsafe { Mmap::map(&file) }.map_err(|e| format!("Cannot map file: {e}"))?;
    parse_stdf_bytes(&mmap, progress)
}

fn parse_stdf_bytes(d: &[u8], progress: &mut dyn FnMut(f32, &str)) -> Result<Imported, String> {
    if d.len() < 6 {
        return Err("File is too small to be an STDF file".into());
    }

    // Endianness: FAR (0,10) has length 2 and STDF_VER == 4.
    let le_len = u16::from_le_bytes([d[0], d[1]]);
    let be_len = u16::from_be_bytes([d[0], d[1]]);
    let be = if be_len == 2 && d[2] == 0 && d[3] == 10 && d[5] == 4 {
        true
    } else if le_len == 2 && d[2] == 0 && d[3] == 10 && d[5] == 4 {
        false
    } else {
        d.get(4).copied().unwrap_or(2) != 2
    };

    let mut out = Imported::new();
    let mut off = 0usize;
    let mut cur_lot: u16 = 0;
    let mut cur_wafer: u16 = 0;
    let mut have_lot = false;
    let mut have_wafer = false;
    let mut row: Option<usize> = None;
    let mut last_report = 0.0f32;
    let mut cur_geom = WaferGeom::default();
    // Unit strings are not guaranteed to be identical on every PTR/MPR
    // record. Count them across the file and use the most common non-empty
    // value instead of trusting the first die.
    let mut unit_votes: HashMap<usize, HashMap<String, usize>> = HashMap::new();

    while off + 4 <= d.len() {
        let len = read_u16(d, off, be) as usize;
        let typ = d[off + 2];
        let sub = d[off + 3];
        let body_start = off + 4;
        let body_end = body_start + len;
        if body_end > d.len() {
            break;
        }
        let body = &d[body_start..body_end];
        off = body_end;
        out.records += 1;

        if out.records % 100_000 == 0 {
            let pct = (off as f32 / d.len() as f32) * 100.0;
            if pct - last_report > 1.0 {
                last_report = pct;
                progress(pct, "Parsing STDF...");
            }
        }

        match (typ, sub) {
            // MIR - master information record
            (1, 10) => {
                let mut c = Cur::new(body, be);
                // SETUP_T, START_T, STAT_NUM, MODE_COD, RTST_COD, PROT_COD,
                // BURN_TIM, CMOD_COD = 15 bytes before LOT_ID.
                c.take(15);
                let lot = c.cn();
                let lot = if lot.is_empty() { "LOT".to_string() } else { lot };
                cur_lot = out.lot_index(&lot);
                have_lot = true;
                have_wafer = false;
                // WCR geometry belongs to the current lot. Do not leak it into
                // a following lot that has no WCR of its own.
                cur_geom = WaferGeom::default();
                row = None;
            }
            // WIR - wafer information record
            (2, 10) => {
                let mut c = Cur::new(body, be);
                c.take(6);
                let name = c.cn();
                let name = if name.is_empty() {
                    format!("W{}", out.wafers.len() + 1)
                } else {
                    name
                };
                cur_wafer = out.wafer_index(cur_lot, &name);
                have_wafer = true;
                if (cur_wafer as usize) < out.wafer_geom.len() {
                    out.wafer_geom[cur_wafer as usize] = cur_geom;
                }
            }
            // WRR - wafer results record
            (2, 20) => {
                let mut c = Cur::new(body, be);
                c.take(26);
                let name = c.cn();
                if !have_wafer && !name.is_empty() {
                    cur_wafer = out.wafer_index(cur_lot, &name);
                    have_wafer = true;
                    if (cur_wafer as usize) < out.wafer_geom.len() {
                        out.wafer_geom[cur_wafer as usize] = cur_geom;
                    }
                }
            }
            // WCR - wafer configuration record. This is the actual source of
            // wafer/die dimensions; PCR (1,30) has no WAFR_SIZ fields.
            (2, 30) => {
                let mut c = Cur::new(body, be);
                let wafr_siz = c.f32();
                let die_h = c.f32();
                let die_w = c.f32();
                let units = c.u8();
                let flat = c.u8() as char;
                let center_x = c.i16();
                let center_y = c.i16();
                // POS_X / POS_Y are not needed for rendering, but consuming
                // them keeps this parser aligned with the record layout.
                let _pos_x = c.u8();
                let _pos_y = c.u8();
                let scale = wafer_unit_scale(units);
                let mut geom = WaferGeom {
                    diameter_mm: scale.and_then(|s| (wafr_siz > 0.0).then_some(wafr_siz * s)),
                    die_h_mm: scale.and_then(|s| (die_h > 0.0).then_some(die_h * s)),
                    die_w_mm: scale.and_then(|s| (die_w > 0.0).then_some(die_w * s)),
                    center_x: (center_x != -32768).then_some(center_x),
                    center_y: (center_y != -32768).then_some(center_y),
                    flat: matches!(flat, 'U' | 'D' | 'L' | 'R').then_some(flat),
                };
                // Keep a WCR without a valid unit scale useful for centre/flat.
                if scale.is_none() {
                    geom.diameter_mm = None;
                    geom.die_h_mm = None;
                    geom.die_w_mm = None;
                }
                cur_geom = geom;
                if have_wafer && (cur_wafer as usize) < out.wafer_geom.len() {
                    out.wafer_geom[cur_wafer as usize] = cur_geom;
                }
            }
            // HBR - hard bin record
            (1, 40) => {
                let mut c = Cur::new(body, be);
                c.take(2);
                let num = c.u16();
                c.take(4);
                let pf = c.u8() as char;
                let name = c.cn();
                // Some older writers store 0x00 instead of 'P'/'F'. Fall back
                // to the usual bin-1-is-pass convention when the flag is not
                // one of the two documented values.
                let pass = pf == 'P' || (pf != 'F' && num == 1);
                out.hbin_names.insert(num, (name, pass));
            }
            // SBR - soft bin record
            (1, 50) => {
                let mut c = Cur::new(body, be);
                c.take(2);
                let num = c.u16();
                c.take(4);
                let pf = c.u8() as char;
                let name = c.cn();
                let pass = pf == 'P' || (pf != 'F' && num == 1);
                out.sbin_names.insert(num, (name, pass));
            }
            // PIR - part information record
            (5, 10) => {
                if !have_lot {
                    cur_lot = out.lot_index("LOT");
                    have_lot = true;
                }
                if !have_wafer {
                    cur_wafer = out.wafer_index(cur_lot, "W1");
                    have_wafer = true;
                }
                row = Some(out.new_row(cur_lot, cur_wafer));
            }
            // PRR - part results record
            (5, 20) => {
                let r = match row {
                    Some(r) => r,
                    None => {
                        if !have_lot {
                            cur_lot = out.lot_index("LOT");
                            have_lot = true;
                        }
                        if !have_wafer {
                            cur_wafer = out.wafer_index(cur_lot, "W1");
                            have_wafer = true;
                        }
                        out.new_row(cur_lot, cur_wafer)
                    }
                };
                let mut c = Cur::new(body, be);
                c.take(5);
                let hard = c.u16();
                let soft = c.u16();
                let x = c.i16();
                let y = c.i16();
                out.hbin[r] = hard;
                out.sbin[r] = soft;
                out.x[r] = x;
                out.y[r] = y;
                row = None;
            }
            // PTR - parametric test record
            (15, 10) => {
                if let Some(r) = row {
                    let mut c = Cur::new(body, be);
                    let test_num = c.u32();
                    c.take(2);
                    let flg = c.u8();
                    c.take(1);
                    let mut result = c.f32();
                    let txt = c.cn();
                    let _alarm = c.cn();
                    let opt = c.u8();
                    let res_scal = c.i8();
                    let llm_scal = c.i8();
                    let hlm_scal = c.i8();
                    let lo_limit = c.f32();
                    let hi_limit = c.f32();
                    let units = c.cn();
                    let _resfmt = c.cn();
                    let _llmfmt = c.cn();
                    let _hlmfmt = c.cn();
                    let lo_spec = c.f32();
                    let hi_spec = c.f32();

                    if flg & 0b0011_1100 != 0 {
                        result = NAN;
                    } else if res_scal != 0 {
                        result *= 10f32.powi(res_scal as i32);
                    }

                    let idx = out.column((test_num, 0), r, result);
                    let t = &mut out.tests[idx];
                    if t.number.is_none() {
                        t.number = Some(test_num);
                    }
                    if t.name.is_empty() || is_provisional(&t.name) {
                        t.name = if txt.is_empty() {
                            format!("T{test_num}")
                        } else {
                            txt
                        };
                    }
                    if t.units.is_empty() && !units.is_empty() {
                        t.units = units.clone();
                    }
                    let new_lo = scale_opt(lo_limit, llm_scal, opt, 4);
                    let new_hi = scale_opt(hi_limit, hlm_scal, opt, 5);
                    let new_lo_spec = lo_spec.is_finite().then_some(lo_spec);
                    let new_hi_spec = hi_spec.is_finite().then_some(hi_spec);
                    if limits_differ(t.lo_limit, new_lo)
                        || limits_differ(t.hi_limit, new_hi)
                        || limits_differ(t.lo_spec, new_lo_spec)
                        || limits_differ(t.hi_spec, new_hi_spec)
                    {
                        t.limit_conflict = true;
                    }
                    if t.lo_limit.is_none() {
                        t.lo_limit = new_lo;
                    }
                    if t.hi_limit.is_none() {
                        t.hi_limit = new_hi;
                    }
                    if t.lo_spec.is_none() {
                        t.lo_spec = new_lo_spec;
                    }
                    if t.hi_spec.is_none() {
                        t.hi_spec = new_hi_spec;
                    }
                    if !units.is_empty() {
                        *unit_votes
                            .entry(idx)
                            .or_default()
                            .entry(units)
                            .or_insert(0) += 1;
                    }
                }
            }
            // MPR - multiple result parametric record
            (15, 15) => {
                if let Some(r) = row {
                    let mut c = Cur::new(body, be);
                    let test_num = c.u32();
                    c.take(2);
                    let flg = c.u8();
                    c.take(1);
                    let rtn_icnt = c.u16() as usize;
                    let rsl_cnt = c.u16() as usize;
                    let nbytes = (rtn_icnt + 1) / 2;
                    c.take(nbytes);
                    if nbytes % 2 == 1 {
                        c.take(1);
                    }
                    let mut results = Vec::with_capacity(rsl_cnt.min(4096));
                    for _ in 0..rsl_cnt {
                        results.push(c.f32());
                    }
                    let txt = c.cn();
                    let _alarm = c.cn();
                    let opt = c.u8();
                    let res_scal = c.i8();
                    let llm_scal = c.i8();
                    let hlm_scal = c.i8();
                    let lo_limit = c.f32();
                    let hi_limit = c.f32();
                    let _start_in = c.f32();
                    let _incr_in = c.f32();
                    c.take(rtn_icnt * 2);
                    let units = c.cn();
                    let _units_in = c.cn();
                    let _rf = c.cn();
                    let _lf = c.cn();
                    let _hf = c.cn();
                    let lo_spec = c.f32();
                    let hi_spec = c.f32();

                    for (i, mut v) in results.into_iter().enumerate() {
                        if flg & 0b0011_1100 != 0 {
                            v = NAN;
                        } else if res_scal != 0 {
                            v *= 10f32.powi(res_scal as i32);
                        }
                        let key = (test_num, i as u16);
                        let idx = out.column(key, r, v);
                        let t = &mut out.tests[idx];
                        if t.number.is_none() {
                            t.number = Some(test_num);
                        }
                        if t.name.is_empty() {
                            let base = if txt.is_empty() {
                                format!("T{test_num}")
                            } else {
                                txt.clone()
                            };
                            t.name = format!("{base}[{i}]");
                        }
                        if t.units.is_empty() && !units.is_empty() {
                            t.units = units.clone();
                        }
                        let new_lo = scale_opt(lo_limit, llm_scal, opt, 4);
                        let new_hi = scale_opt(hi_limit, hlm_scal, opt, 5);
                        let new_lo_spec = lo_spec.is_finite().then_some(lo_spec);
                        let new_hi_spec = hi_spec.is_finite().then_some(hi_spec);
                        if limits_differ(t.lo_limit, new_lo)
                            || limits_differ(t.hi_limit, new_hi)
                            || limits_differ(t.lo_spec, new_lo_spec)
                            || limits_differ(t.hi_spec, new_hi_spec)
                        {
                            t.limit_conflict = true;
                        }
                        if t.lo_limit.is_none() {
                            t.lo_limit = new_lo;
                        }
                        if t.hi_limit.is_none() {
                            t.hi_limit = new_hi;
                        }
                        if t.lo_spec.is_none() {
                            t.lo_spec = new_lo_spec;
                        }
                        if t.hi_spec.is_none() {
                            t.hi_spec = new_hi_spec;
                        }
                        if !units.is_empty() {
                            *unit_votes
                                .entry(idx)
                                .or_default()
                                .entry(units.clone())
                                .or_insert(0) += 1;
                        }
                    }
                }
            }
            // TSR - test synopsis record
            (20, 10) => {
                if body.len() < 7 {
                    continue;
                }
                let mut c = Cur::new(body, be);
                c.take(2);
                let ttyp = c.u8() as char;
                if ttyp != 'P' && ttyp != 'F' {
                    continue;
                }
                let test_num = c.u32();
                c.take(12);
                let name = c.cn();
                let name = if name.is_empty() {
                    format!("T{test_num}")
                } else {
                    name
                };
                let key = (test_num, 0);
                if let Some(&idx) = out.col_index.get(&key) {
                    if out.tests[idx].number.is_none() {
                        out.tests[idx].number = Some(test_num);
                    }
                    if out.tests[idx].name.is_empty() || is_provisional(&out.tests[idx].name) {
                        out.tests[idx].name = name;
                    }
                } else {
                    // A test that is defined but never produced a result. Keep it in the list
                    // without allocating a data column.
                    let idx = out.tests.len();
                    let mut test = crate::model::TestInfo::new(name);
                    test.number = Some(test_num);
                    out.tests.push(test);
                    out.cols.push(Vec::new());
                    out.col_index.insert(key, idx);
                }
            }
            _ => {}
        }
    }

    // Resolve the unit vote after the whole file has been seen. Ties are
    // broken deterministically by the unit string, but every non-empty unit
    // beats a blank one.
    for (idx, votes) in unit_votes {
        if idx >= out.tests.len() {
            continue;
        }
        if let Some((unit, _)) = votes
            .into_iter()
            .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
        {
            if !unit.is_empty() {
                out.tests[idx].units = unit;
            }
        }
    }

    Ok(out.finish())
}

fn wafer_unit_scale(units: u8) -> Option<f32> {
    match units {
        1 => Some(25.4),  // inches
        2 => Some(10.0),  // 10 mm
        3 => Some(1.0),   // mm
        4 => Some(0.0254),// mils
        _ => None,
    }
}

fn is_provisional(name: &str) -> bool {
    name.len() > 1
        && name.starts_with('T')
        && name[1..].chars().all(|c| c.is_ascii_digit())
}

fn scale_opt(value: f32, scal: i8, opt: u8, bit: u8) -> Option<f32> {
    if !value.is_finite() {
        return None;
    }
    if opt & (1 << bit) != 0 || opt & (1 << (bit + 2)) != 0 {
        return None;
    }
    Some(if scal == 0 {
        value
    } else {
        value * 10f32.powi(scal as i32)
    })
}

/// True when two populated limit values disagree beyond float noise.
fn limits_differ(a: Option<f32>, b: Option<f32>) -> bool {
    match (a, b) {
        (Some(x), Some(y)) => {
            let tol = 1e-6 * (1.0 + x.abs().max(y.abs()));
            (x - y).abs() > tol
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_z_stream() {
        // Hand-crafted non-block .Z stream from the decoder crate's tests:
        // header (max bits 16, block mode off), then literal 'A' and 'B'.
        let bytes = [0x1f, 0x9d, 0x10, 0x41, 0x84, 0x00];
        assert_eq!(lzw_z::decompress_slice(&bytes).expect("decode .Z"), b"AB");
    }

    #[test]
    fn parses_compressed_reference_file() {
        let p = match std::env::var("STDF_DEMO_Z") {
            Ok(p) if !p.is_empty() => p,
            _ => return,
        };
        let mut cb = |_: f32, _: &str| {};
        let imp = import_stdf(std::path::Path::new(&p), &mut cb).expect("parse .Z");
        assert!(imp.row_lot.len() > 0, "dice from .Z");
        assert!(!imp.tests.is_empty(), "tests from .Z");
    }

    #[test]
    fn parses_reference_file() {
        let p = match std::env::var("STDF_DEMO") {
            Ok(p) if !p.is_empty() => p,
            _ => return,
        };
        let mut cb = |_: f32, _: &str| {};
        let imp = import_stdf(std::path::Path::new(&p), &mut cb).expect("parse");
        assert_eq!(imp.row_lot.len(), 1619, "dice");
        assert_eq!(imp.tests.len(), 74, "tests");
        assert_eq!(imp.hbin.iter().filter(|b| **b == 1).count(), 1378, "bin 1");
        assert_eq!(imp.lots, vec!["W118892"]);
        assert_eq!(imp.wafers.len(), 1);
        let t = &imp.tests[0];
        assert!(!t.name.is_empty());
        assert!(t.name.contains("glxy_SS_IH"), "name {}", t.name);
        assert_eq!(t.units, "v");
        assert!(
            (t.lo_limit.expect("lo limit") + 0.9).abs() < 1e-4,
            "lo {:?}",
            t.lo_limit
        );
        assert!(
            (t.hi_limit.expect("hi limit") + 0.4).abs() < 1e-4,
            "hi {:?}",
            t.hi_limit
        );
        // This old writer omits the trailing LO_SPEC/HI_SPEC fields.
        assert_eq!(t.lo_spec, None);
        assert_eq!(t.hi_spec, None);
        assert!(t.count > 0);
        // ...and writes 0x00 rather than 'P' for the pass bin.
        assert!(imp.hbin_names.get(&1).expect("hbin 1").1);
        assert!(!imp.hbin_names.get(&2).expect("hbin 2").1);
    }
}
