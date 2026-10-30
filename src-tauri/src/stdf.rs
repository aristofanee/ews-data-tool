use crate::dataset::Imported;
use crate::model::{WaferGeom, NAN};
use memmap2::Mmap;
use std::collections::HashMap;
use std::fs::File;
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

    /// Optional fields are omitted from the tail of PTR/MPR records when the
    /// first record for a test has already supplied the defaults. These
    /// helpers distinguish a missing field from a real zero/empty value.
    fn i8_opt(&mut self) -> Option<i8> {
        (self.remaining() >= 1).then(|| self.i8())
    }

    fn f32_opt(&mut self) -> Option<f32> {
        if self.remaining() < 4 {
            self.p = self.b.len();
            return None;
        }
        Some(self.f32())
    }

    fn cn_opt(&mut self) -> Option<String> {
        (self.remaining() >= 1).then(|| self.cn())
    }

    fn skip_cn(&mut self) {
        if self.remaining() > 0 {
            let n = self.u8() as usize;
            self.take(n);
        }
    }

    fn cn(&mut self) -> String {
        let n = self.u8() as usize;
        let raw = self.take(n);
        let raw = &raw[..raw.iter().position(|b| *b == 0).unwrap_or(raw.len())];
        if raw.iter().all(|b| (0x20..0x7f).contains(b)) {
            // Common tester strings are printable ASCII. Allocate only the
            // trimmed result rather than a temporary String and another copy.
            return std::str::from_utf8(raw).unwrap().trim().to_owned();
        }
        let s: String = raw
            .iter()
            .take_while(|b| **b != 0)
            .map(|b| {
                if (0x20..0x7f).contains(b) {
                    *b as char
                } else {
                    ' '
                }
            })
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

/// Semi-static PTR/MPR information. STDF says the first record for a test
/// establishes these defaults; later records may omit or invalidate the
/// corresponding fields and inherit the defaults.
#[derive(Default, Clone)]
struct TestDefaults {
    name: String,
    units: String,
    resfmt: String,
    res_scal: Option<i8>,
    lo_limit: Option<f32>,
    hi_limit: Option<f32>,
    lo_spec: Option<f32>,
    hi_spec: Option<f32>,
}

/// Per-test aggregation state used after the whole file has been parsed.
#[derive(Default)]
struct LimitChoice {
    chosen: Option<f32>,
    conflict: bool,
}

#[derive(Default)]
struct ScaleState {
    /// Explicit RES_SCAL values, used to pick the test's display scale.
    votes: HashMap<i8, usize>,
    first: Option<i8>,
    /// Base unit strings, used to pick the test's display unit.
    units: HashMap<String, usize>,
    lo: LimitChoice,
    hi: LimitChoice,
    lo_spec: LimitChoice,
    hi_spec: LimitChoice,
}

fn note_limit(choice: &mut LimitChoice, value: Option<f32>) {
    let Some(v) = value else {
        return;
    };
    match choice.chosen {
        None => choice.chosen = Some(v),
        Some(prev) => {
            if limits_differ(Some(prev), Some(v)) {
                choice.conflict = true;
            }
        }
    }
}

fn choose_scale(state: &ScaleState, fallback: i8) -> i8 {
    state
        .votes
        .iter()
        .max_by(|a, b| {
            a.1.cmp(b.1)
                .then_with(|| (Some(*a.0) == state.first).cmp(&(Some(*b.0) == state.first)))
                .then_with(|| b.0.cmp(a.0))
        })
        .map(|(scale, _)| *scale)
        .unwrap_or(fallback)
}

fn choose_unit(state: &ScaleState, fallback: &str) -> String {
    state
        .units
        .iter()
        .max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0)))
        .map(|(unit, _)| unit.clone())
        .unwrap_or_else(|| fallback.to_string())
}

fn si_prefix(exponent: i8) -> Option<&'static str> {
    match exponent {
        -15 => Some("f"),
        -12 => Some("p"),
        -9 => Some("n"),
        -6 => Some("u"),
        -3 => Some("m"),
        0 => Some(""),
        3 => Some("k"),
        6 => Some("M"),
        9 => Some("G"),
        12 => Some("T"),
        _ => None,
    }
}

/// True when UNITS plus RES_SCAL maps to a standard SI-prefixed unit.
fn can_prefix_unit(base: &str, exponent: i8) -> bool {
    if base.is_empty() || exponent == 0 {
        return false;
    }
    // These are not SI-prefixable units.
    if base == "%"
        || base.eq_ignore_ascii_case("db")
        || base.contains('/')
        || base.contains('\u{00b0}')
    {
        return false;
    }
    if si_prefix(-exponent).is_none() {
        return false;
    }
    // Some writers already put the prefix in UNITS (for example "uA" with
    // RES_SCAL=0). Do not produce "uuA".
    let first = base.chars().next().unwrap_or(' ');
    !(base.chars().count() > 1
        && matches!(first, 'p' | 'n' | 'u' | 'm' | 'k' | 'M' | 'G' | 'T'))
}

/// Build a display unit from STDF's base UNITS plus the RES_SCAL exponent.
/// UNITS='a' + RES_SCAL=6 is microamps, UNITS='hz' + RES_SCAL=-3 is kHz.
fn scaled_unit(base: &str, exponent: i8) -> String {
    if !can_prefix_unit(base, exponent) {
        return base.to_string();
    }
    // RES_SCAL multiplies the raw value by 10^exponent, so the display unit
    // is 10^-exponent * UNITS (RES_SCAL=6 -> micro, -3 -> kilo).
    let prefix = si_prefix(-exponent).unwrap_or("");
    if prefix.is_empty() {
        return base.to_string();
    }
    format!("{prefix}{base}")
}

/// Extract the unit suffix from an ANSI C format string such as "%5.0f ua"
/// or "%5.2f %%". Returns None when the format has no unit text.
fn unit_from_format(fmt: &str) -> Option<String> {
    let b = fmt.as_bytes();
    let mut i = 0usize;
    let mut last_end = None;
    while i < b.len() {
        if b[i] != b'%' {
            i += 1;
            continue;
        }
        if i + 1 < b.len() && b[i + 1] == b'%' {
            i += 2;
            continue;
        }
        let start = i;
        i += 1;
        while i < b.len() && matches!(b[i], b'-' | b'+' | b' ' | b'0' | b'#') {
            i += 1;
        }
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i < b.len() && b[i] == b'.' {
            i += 1;
            while i < b.len() && b[i].is_ascii_digit() {
                i += 1;
            }
        }
        while i < b.len() && matches!(b[i], b'h' | b'l' | b'L' | b'j' | b'z' | b't') {
            i += 1;
        }
        if i < b.len() && b"diouxXeEfFgGaAcspn".contains(&b[i]) {
            i += 1;
            last_end = Some(i);
        } else {
            i = start + 1;
        }
    }
    let suffix = fmt.get(last_end?..)?.trim();
    if suffix.is_empty() {
        return None;
    }
    let suffix = suffix.replace("%%", "%");
    let suffix = suffix.trim();
    if suffix.is_empty() {
        return None;
    }
    if suffix
        .chars()
        .any(|c| c.is_alphabetic() || c == '%' || c == '\u{00b0}' || c == '/')
    {
        Some(suffix.to_string())
    } else {
        None
    }
}

fn display_unit(base: &str, exponent: i8, resfmt: &str) -> String {
    let derived = scaled_unit(base, exponent);
    let Some(hint) = unit_from_format(resfmt) else {
        return derived;
    };
    let norm = |s: &str| s.replace('\u{00b5}', "u").to_ascii_lowercase();
    if derived.is_empty() || norm(&hint) == norm(&derived) {
        return hint;
    }
    // If UNITS+RES_SCAL cannot produce a standard prefixed unit, the C format
    // string is the best description of what the tester displayed.
    if !can_prefix_unit(base, exponent) {
        return hint;
    }
    derived
}

pub fn import_stdf(path: &Path, progress: &mut dyn FnMut(f32, &str)) -> Result<Imported, String> {
    let file = File::open(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    if file.metadata().map_err(|e| e.to_string())?.len() == 0 {
        return Err(format!("{} is empty", path.display()));
    }
    let mmap = unsafe { Mmap::map(&file) }.map_err(|e| format!("Cannot map file: {e}"))?;
    import_stdf_bytes(&mmap, &path.display().to_string(), progress)
}

/// Shared by standalone files and ZIP members; no temporary extraction or
/// Read-adapter copies are needed for either plain STDF or Unix compress.
pub fn import_stdf_bytes(bytes: &[u8], source: &str, progress: &mut dyn FnMut(f32, &str)) -> Result<Imported, String> {
    if bytes.starts_with(&[0x1f, 0x9d]) {
        progress(1.0, &format!("Decompressing .Z: {source}"));
        let data = crate::z_decode::decompress(bytes)
            .map_err(|e| format!("Cannot decompress {source}: {e}"))?;
        progress(10.0, &format!("Parsing STDF: {source}"));
        let mut cb = |pct: f32, msg: &str| progress(10.0 + pct * 0.9, msg);
        return parse_stdf_bytes(&data, &mut cb).map_err(|e| format!("{source}: {e}"));
    }
    parse_stdf_bytes(bytes, progress).map_err(|e| format!("{source}: {e}"))
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
        return Err("Expected an STDF V4 FAR header".into());
    };

    let mut out = Imported::new();
    let mut off = 0usize;
    let mut cur_lot: u16 = 0;
    let mut cur_wafer: u16 = 0;
    let mut have_lot = false;
    let mut have_wafer = false;
    // Several sites may have a part in flight at once. Never share a row
    // between their interleaved PIR/PTR/MPR/PRR records.
    let mut active_rows: HashMap<(u8, u8), usize> = HashMap::new();
    let mut last_report = 0.0f32;
    let mut cur_geom = WaferGeom::default();
    // STDF's first PTR/MPR for a test supplies defaults for RES_SCAL, limits
    // and units. It may appear outside a PIR/PRR, so keep defaults separate
    // from the per-die test slots.
    let mut test_defaults: HashMap<u32, TestDefaults> = HashMap::new();
    let mut scale_states: Vec<Option<ScaleState>> = Vec::new();

    while off + 4 <= d.len() {
        let len = read_u16(d, off, be) as usize;
        let typ = d[off + 2];
        let sub = d[off + 3];
        let body_start = off + 4;
        let body_end = body_start + len;
        if body_end > d.len() {
            return Err(format!("Truncated STDF record ({typ},{sub}) at byte {off}"));
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
                let lot = if lot.is_empty() {
                    "LOT".to_string()
                } else {
                    lot
                };
                cur_lot = out.lot_index(&lot);
                have_lot = true;
                have_wafer = false;
                // WCR geometry belongs to the current lot. Do not leak it into
                // a following lot that has no WCR of its own.
                cur_geom = WaferGeom::default();
                active_rows.clear();
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
                let mut c = Cur::new(body, be);
                let site = (c.u8(), c.u8());
                if active_rows.contains_key(&site) {
                    return Err(format!("PIR before previous PRR for head {} site {}", site.0, site.1));
                }
                if !have_lot {
                    cur_lot = out.lot_index("LOT");
                    have_lot = true;
                }
                if !have_wafer {
                    cur_wafer = out.wafer_index(cur_lot, "W1");
                    have_wafer = true;
                }
                let r = out.new_row(cur_lot, cur_wafer);
                out.site[r] = Some(site.1);
                active_rows.insert(site, r);
            }
            // PRR - part results record
            (5, 20) => {
                let mut c = Cur::new(body, be);
                let site = (c.u8(), c.u8());
                let r = match active_rows.remove(&site) {
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
                c.take(3);
                let hard = c.u16();
                let soft = c.u16();
                let x = c.i16();
                let y = c.i16();
                out.hbin[r] = hard;
                out.site[r] = Some(site.1);
                out.sbin[r] = soft;
                out.x[r] = x;
                out.y[r] = y;
            }
            // PTR - parametric test record
            (15, 10) => {
                let mut c = Cur::new(body, be);
                let test_num = c.u32();
                let site = (c.u8(), c.u8());
                let flg = c.u8();
                c.take(1);
                let raw_result = c.f32();
                let txt = c.cn();
                c.skip_cn();
                let opt = c.u8();
                let res_scal = c.i8_opt();
                let _llm_scal = c.i8_opt();
                let _hlm_scal = c.i8_opt();
                let lo_limit = c.f32_opt();
                let hi_limit = c.f32_opt();
                let units = c.cn_opt().unwrap_or_default();
                let resfmt = c.cn_opt().unwrap_or_default();
                c.skip_cn();
                c.skip_cn();
                let lo_spec = c.f32_opt();
                let hi_spec = c.f32_opt();

                // The first PTR for a test establishes semi-static defaults.
                // It is allowed outside a PIR/PRR, so update defaults before
                // checking whether this record belongs to a die.
                let defaults = test_defaults.entry(test_num).or_default();
                if defaults.name.is_empty() && !txt.is_empty() {
                    defaults.name = txt.clone();
                }
                if defaults.units.is_empty() && !units.is_empty() {
                    defaults.units = units.clone();
                }
                if defaults.resfmt.is_empty() && !resfmt.is_empty() {
                    defaults.resfmt = resfmt.clone();
                }
                if defaults.res_scal.is_none() && opt & 1 == 0 {
                    if let Some(scale) = res_scal {
                        defaults.res_scal = Some(scale);
                    }
                }

                let low_valid = opt & (1 << 4) == 0 && opt & (1 << 6) == 0;
                let high_valid = opt & (1 << 5) == 0 && opt & (1 << 7) == 0;
                let record_lo = if low_valid {
                    lo_limit.filter(|v| v.is_finite())
                } else {
                    None
                };
                let record_hi = if high_valid {
                    hi_limit.filter(|v| v.is_finite())
                } else {
                    None
                };
                let record_lo_spec = if opt & (1 << 2) == 0 {
                    lo_spec.filter(|v| v.is_finite())
                } else {
                    None
                };
                let record_hi_spec = if opt & (1 << 3) == 0 {
                    hi_spec.filter(|v| v.is_finite())
                } else {
                    None
                };
                if defaults.lo_limit.is_none() {
                    defaults.lo_limit = record_lo;
                }
                if defaults.hi_limit.is_none() {
                    defaults.hi_limit = record_hi;
                }
                if defaults.lo_spec.is_none() {
                    defaults.lo_spec = record_lo_spec;
                }
                if defaults.hi_spec.is_none() {
                    defaults.hi_spec = record_hi_spec;
                }
                let effective_lo = record_lo.or(defaults.lo_limit);
                let effective_hi = record_hi.or(defaults.hi_limit);
                let effective_lo_spec = record_lo_spec.or(defaults.lo_spec);
                let effective_hi_spec = record_hi_spec.or(defaults.hi_spec);
                let effective_units = if units.is_empty() {
                    defaults.units.as_str()
                } else {
                    units.as_str()
                };
                let effective_name = if txt.is_empty() {
                    defaults.name.as_str()
                } else {
                    txt.as_str()
                };

                if let Some(r) = active_rows.get(&site).copied() {
                    let key = (test_num, 0);
                    let idx = out.test_slot(key);
                    {
                        let t = &mut out.tests[idx];
                        if t.number.is_none() {
                            t.number = Some(test_num);
                        }
                        if t.name.is_empty() || is_provisional(&t.name) {
                            t.name = if effective_name.is_empty() {
                                format!("T{test_num}")
                            } else {
                                effective_name.to_owned()
                            };
                        }
                    }
                    if scale_states.len() <= idx { scale_states.resize_with(idx + 1, || None); }
                    let state = scale_states[idx].get_or_insert_with(ScaleState::default);
                    if opt & 1 == 0 {
                        if let Some(scale) = res_scal {
                            *state.votes.entry(scale).or_insert(0) += 1;
                            if state.first.is_none() {
                                state.first = Some(scale);
                            }
                        }
                    }
                    if !effective_units.is_empty() {
                        if let Some(count) = state.units.get_mut(effective_units) { *count += 1; }
                        else { state.units.insert(effective_units.to_owned(), 1); }
                    }
                    note_limit(&mut state.lo, effective_lo);
                    note_limit(&mut state.hi, effective_hi);
                    note_limit(&mut state.lo_spec, effective_lo_spec);
                    note_limit(&mut state.hi_spec, effective_hi_spec);

                    // Keep the raw base-unit result. The final pass applies the
                    // test's chosen RES_SCAL to every die, including the first.
                    let mut result = raw_result;
                    if flg & 0b0011_1100 != 0 {
                        result = NAN;
                    }
                    out.write_column(idx, r, result);
                }
            }
            // MPR - multiple result parametric record
            (15, 15) => {
                let mut c = Cur::new(body, be);
                let test_num = c.u32();
                let site = (c.u8(), c.u8());
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
                c.skip_cn();
                let opt = c.u8();
                let res_scal = c.i8_opt();
                let _llm_scal = c.i8_opt();
                let _hlm_scal = c.i8_opt();
                let lo_limit = c.f32_opt();
                let hi_limit = c.f32_opt();
                let _start_in = c.f32_opt();
                let _incr_in = c.f32_opt();
                if rtn_icnt > 0 && c.remaining() >= rtn_icnt * 2 {
                    c.take(rtn_icnt * 2);
                }
                let units = c.cn_opt().unwrap_or_default();
                c.skip_cn();
                let resfmt = c.cn_opt().unwrap_or_default();
                c.skip_cn();
                c.skip_cn();
                let lo_spec = c.f32_opt();
                let hi_spec = c.f32_opt();

                let defaults = test_defaults.entry(test_num).or_default();
                if defaults.name.is_empty() && !txt.is_empty() {
                    defaults.name = txt.clone();
                }
                if defaults.units.is_empty() && !units.is_empty() {
                    defaults.units = units.clone();
                }
                if defaults.resfmt.is_empty() && !resfmt.is_empty() {
                    defaults.resfmt = resfmt.clone();
                }
                if defaults.res_scal.is_none() && opt & 1 == 0 {
                    if let Some(scale) = res_scal {
                        defaults.res_scal = Some(scale);
                    }
                }

                let low_valid = opt & (1 << 4) == 0 && opt & (1 << 6) == 0;
                let high_valid = opt & (1 << 5) == 0 && opt & (1 << 7) == 0;
                let record_lo = if low_valid {
                    lo_limit.filter(|v| v.is_finite())
                } else {
                    None
                };
                let record_hi = if high_valid {
                    hi_limit.filter(|v| v.is_finite())
                } else {
                    None
                };
                let record_lo_spec = if opt & (1 << 2) == 0 {
                    lo_spec.filter(|v| v.is_finite())
                } else {
                    None
                };
                let record_hi_spec = if opt & (1 << 3) == 0 {
                    hi_spec.filter(|v| v.is_finite())
                } else {
                    None
                };
                if defaults.lo_limit.is_none() {
                    defaults.lo_limit = record_lo;
                }
                if defaults.hi_limit.is_none() {
                    defaults.hi_limit = record_hi;
                }
                if defaults.lo_spec.is_none() {
                    defaults.lo_spec = record_lo_spec;
                }
                if defaults.hi_spec.is_none() {
                    defaults.hi_spec = record_hi_spec;
                }
                let effective_lo = record_lo.or(defaults.lo_limit);
                let effective_hi = record_hi.or(defaults.hi_limit);
                let effective_lo_spec = record_lo_spec.or(defaults.lo_spec);
                let effective_hi_spec = record_hi_spec.or(defaults.hi_spec);
                let effective_units = if units.is_empty() {
                    defaults.units.as_str()
                } else {
                    units.as_str()
                };
                let effective_name = if txt.is_empty() {
                    defaults.name.as_str()
                } else {
                    txt.as_str()
                };

                if let Some(r) = active_rows.get(&site).copied() {
                    for (i, raw) in results.into_iter().enumerate() {
                        let key = (test_num, i as u16);
                        let idx = out.test_slot(key);
                        {
                            let t = &mut out.tests[idx];
                            if t.number.is_none() {
                                t.number = Some(test_num);
                            }
                            if t.name.is_empty() {
                                let base = if effective_name.is_empty() {
                                    format!("T{test_num}")
                                } else {
                                    effective_name.to_owned()
                                };
                                t.name = format!("{base}[{i}]");
                            }
                        }
                        if scale_states.len() <= idx { scale_states.resize_with(idx + 1, || None); }
                    let state = scale_states[idx].get_or_insert_with(ScaleState::default);
                        if opt & 1 == 0 {
                            if let Some(scale) = res_scal {
                                *state.votes.entry(scale).or_insert(0) += 1;
                                if state.first.is_none() {
                                    state.first = Some(scale);
                                }
                            }
                        }
                        if !effective_units.is_empty() {
                            if let Some(count) = state.units.get_mut(effective_units) { *count += 1; }
                            else { state.units.insert(effective_units.to_owned(), 1); }
                        }
                        note_limit(&mut state.lo, effective_lo);
                        note_limit(&mut state.hi, effective_hi);
                        note_limit(&mut state.lo_spec, effective_lo_spec);
                        note_limit(&mut state.hi_spec, effective_hi_spec);

                        let mut value = raw;
                        if flg & 0b0011_1100 != 0 {
                            value = NAN;
                        }
                        out.write_column(idx, r, value);
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

    if off != d.len() {
        return Err(format!("Incomplete STDF record header at byte {off}"));
    }
    if !active_rows.is_empty() {
        return Err("STDF ended with unfinished die records (missing PRR)".into());
    }

    // Apply one display scale to every die of a test. STDF stores RESULT and
    // limits in base UNITS; RES_SCAL only selects the display exponent. A
    // record that omitted RES_SCAL must therefore inherit the test default
    // instead of being left in base units while the rest of the file is
    // scaled.
    for (idx, state) in scale_states.into_iter().enumerate().filter_map(|(idx, state)| state.map(|state| (idx, state))) {
        if idx >= out.tests.len() {
            continue;
        }
        let number = out.tests[idx].number;
        let defaults = number.and_then(|n| test_defaults.get(&n));
        let fallback_scale = defaults.and_then(|d| d.res_scal).unwrap_or(0);
        let target = choose_scale(&state, fallback_scale).clamp(-30, 30);
        let base_unit = choose_unit(&state, defaults.map(|d| d.units.as_str()).unwrap_or(""));
        let resfmt = defaults.map(|d| d.resfmt.as_str()).unwrap_or("");
        out.tests[idx].units = display_unit(&base_unit, target, resfmt);

        let factor = 10f32.powi(target as i32);
        if factor.is_finite() && factor != 0.0 {
            for value in out.cols[idx].iter_mut() {
                if value.is_finite() {
                    *value *= factor;
                }
            }
            out.tests[idx].lo_limit = state.lo.chosen.map(|v| v * factor);
            out.tests[idx].hi_limit = state.hi.chosen.map(|v| v * factor);
            out.tests[idx].lo_spec = state.lo_spec.chosen.map(|v| v * factor);
            out.tests[idx].hi_spec = state.hi_spec.chosen.map(|v| v * factor);
        } else {
            out.tests[idx].lo_limit = state.lo.chosen;
            out.tests[idx].hi_limit = state.hi.chosen;
            out.tests[idx].lo_spec = state.lo_spec.chosen;
            out.tests[idx].hi_spec = state.hi_spec.chosen;
        }
        out.tests[idx].limit_conflict = state.lo.conflict
            || state.hi.conflict
            || state.lo_spec.conflict
            || state.hi_spec.conflict;
    }

    Ok(out.finish())
}

fn wafer_unit_scale(units: u8) -> Option<f32> {
    match units {
        1 => Some(25.4),   // inches
        2 => Some(10.0),   // 10 mm
        3 => Some(1.0),    // mm
        4 => Some(0.0254), // mils
        _ => None,
    }
}

fn is_provisional(name: &str) -> bool {
    name.len() > 1 && name.starts_with('T') && name[1..].chars().all(|c| c.is_ascii_digit())
}

/// True when two populated limit values disagree beyond float noise.
///
/// STDF limits are compared in raw base units here, so the tolerance must be
/// relative. An absolute floor would hide real conflicts in the pico/nano
/// range and would then become a large difference after RES_SCAL is applied.
fn limits_differ(a: Option<f32>, b: Option<f32>) -> bool {
    match (a, b) {
        (Some(x), Some(y)) => {
            let scale = x.abs().max(y.abs());
            let tol = 1e-6 * scale.max(f32::MIN_POSITIVE);
            (x - y).abs() > tol
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(typ: u8, sub: u8, body: &[u8]) -> Vec<u8> {
        let mut v = Vec::with_capacity(4 + body.len());
        v.extend_from_slice(&(body.len() as u16).to_le_bytes());
        v.push(typ);
        v.push(sub);
        v.extend_from_slice(body);
        v
    }

    fn cn(s: &str) -> Vec<u8> {
        let mut v = vec![s.len() as u8];
        v.extend_from_slice(s.as_bytes());
        v
    }

    fn ptr_body(
        test_num: u32,
        result: f32,
        opt: u8,
        res_scal: Option<i8>,
        lo: Option<f32>,
        hi: Option<f32>,
        units: Option<&str>,
        resfmt: Option<&str>,
    ) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(&test_num.to_le_bytes());
        b.push(1); // HEAD_NUM
        b.push(0); // SITE_NUM
        b.push(0); // TEST_FLG
        b.push(0); // PARM_FLG
        b.extend_from_slice(&result.to_le_bytes());
        b.extend_from_slice(&cn("Leak test"));
        b.extend_from_slice(&cn(""));
        b.push(opt);
        if let Some(v) = res_scal {
            b.push(v as u8);
            b.push(v as u8);
            b.push(v as u8);
        }
        if let Some(v) = lo {
            b.extend_from_slice(&v.to_le_bytes());
        }
        if let Some(v) = hi {
            b.extend_from_slice(&v.to_le_bytes());
        }
        if let Some(v) = units {
            b.extend_from_slice(&cn(v));
        }
        if let Some(v) = resfmt {
            b.extend_from_slice(&cn(v));
            b.extend_from_slice(&cn(v));
            b.extend_from_slice(&cn(v));
        }
        b
    }

    fn prr_body(x: i16, y: i16) -> Vec<u8> {
        let mut b = Vec::new();
        b.push(1); // HEAD_NUM
        b.push(0); // SITE_NUM
        b.push(0); // PART_FLG
        b.extend_from_slice(&1u16.to_le_bytes()); // NUM_TEST
        b.extend_from_slice(&1u16.to_le_bytes()); // HARD_BIN
        b.extend_from_slice(&1u16.to_le_bytes()); // SOFT_BIN
        b.extend_from_slice(&x.to_le_bytes());
        b.extend_from_slice(&y.to_le_bytes());
        b
    }

    fn minimal_stdf(ptrs: &[(i16, i16, Vec<u8>)], default_ptr: Option<Vec<u8>>) -> Vec<u8> {
        let mut d = Vec::new();
        d.extend(rec(0, 10, &[2, 4])); // FAR: little-endian PC, STDF V4
        let mut mir = vec![0u8; 15];
        mir.extend(cn("L1"));
        d.extend(rec(1, 10, &mir));
        let mut wir = vec![0u8; 6];
        wir.extend(cn("W1"));
        d.extend(rec(2, 10, &wir));
        if let Some(p) = default_ptr {
            d.extend(rec(15, 10, &p));
        }
        for (x, y, ptr) in ptrs {
            d.extend(rec(5, 10, &[1, 0])); // PIR
            d.extend(rec(15, 10, ptr));
            d.extend(rec(5, 20, &prr_body(*x, *y)));
        }
        d
    }

    fn import_bytes(name: &str, bytes: &[u8]) -> Imported {
        let p = std::env::temp_dir().join(format!("ews-stdf-{}-{name}.stdf", std::process::id()));
        std::fs::write(&p, bytes).unwrap();
        let mut cb = |_: f32, _: &str| {};
        let imp = import_stdf(&p, &mut cb).expect("parse synthetic STDF");
        let _ = std::fs::remove_file(&p);
        imp
    }

    #[test]
    #[ignore = "synthetic STDF import benchmark; run explicitly with --ignored --nocapture"]
    fn stdf_import_benchmark() {
        let mut d = minimal_stdf(&[], None);
        let templates: Vec<_> = (0..32).map(|t| ptr_body(100 + t, t as f32, 0,
            Some(0), Some(-1.0), Some(100.0), Some("V"), Some("%g"))).collect();
        for die in 0..10_000 {
            d.extend(rec(5, 10, &[1, 0]));
            for template in &templates { d.extend(rec(15, 10, template)); }
            d.extend(rec(5, 20, &prr_body((die % 100) as i16, (die / 100) as i16)));
        }
        let p = std::env::temp_dir().join(format!("ews-import-benchmark-{}.stdf", std::process::id()));
        std::fs::write(&p, &d).unwrap();
        for run in 1..=3 {
            let start = std::time::Instant::now();
            let imp = import_stdf(&p, &mut |_, _| {}).unwrap();
            let parse_ms = start.elapsed().as_millis();
            assert_eq!(imp.row_lot.len(), 10_000);
            assert_eq!(imp.tests.len(), 32);
            assert!(imp.tests.iter().all(|t| t.count == 10_000));
            assert!(imp.cols.iter().enumerate().all(|(t, col)| col.iter().all(|v| *v == t as f32)));
            eprintln!("STDF import run {run}: {} bytes, 320000 PTR measurements, {parse_ms}ms", d.len());
        }
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn interleaved_sites_keep_their_measurements_and_coordinates() {
        let mut d = minimal_stdf(&[], None);
        d.extend(rec(5, 10, &[1, 0]));
        d.extend(rec(5, 10, &[1, 1]));
        let p0 = ptr_body(100, 10.0, 0xff, None, None, None, None, None);
        let mut p1 = ptr_body(100, 20.0, 0xff, None, None, None, None, None);
        p1[5] = 1;
        d.extend(rec(15, 10, &p1));
        d.extend(rec(15, 10, &p0));
        let mut r1 = prr_body(8, 9);
        r1[1] = 1;
        d.extend(rec(5, 20, &r1));
        d.extend(rec(5, 20, &prr_body(2, 3)));
        let imp = import_bytes("multisite", &d);
        assert_eq!(imp.x, vec![2, 8]);
        assert_eq!(imp.y, vec![3, 9]);
        assert_eq!(imp.cols[0], vec![10.0, 20.0]);
        assert_eq!(imp.site, vec![Some(0), Some(1)]);
    }

    #[test]
    fn string_fast_path_and_skips_preserve_cursor_and_sanitization() {
        for (bytes, expected) in [
            (&[5u8, b' ', b'A', b'B', b' ', b' ', 9][..], "AB"),
            (&[4u8, b'A', 0, b'B', b' ', 9][..], "A"),
            (&[3u8, b'A', 255, b'B', 9][..], "A B"),
        ] {
            let mut read = Cur::new(bytes, false);
            let mut skip = Cur::new(bytes, false);
            assert_eq!(read.cn(), expected);
            skip.skip_cn();
            assert_eq!(read.remaining(), skip.remaining());
            assert_eq!(read.u8(), 9);
            assert_eq!(skip.u8(), 9);
        }
    }

    #[test]
    fn mpr_import_preserves_result_columns_and_limits() {
        let mut d = minimal_stdf(&[], None);
        d.extend(rec(5, 10, &[1, 0]));
        let mut body = Vec::new();
        body.extend(100u32.to_le_bytes());
        body.extend([1, 0, 0, 0]);
        body.extend(0u16.to_le_bytes());
        body.extend(2u16.to_le_bytes());
        body.extend(1.25f32.to_le_bytes()); body.extend(2.5f32.to_le_bytes());
        body.extend(cn("Multi")); body.extend(cn("ignored alarm"));
        body.extend([0, 0, 0, 0]);
        body.extend((-1.0f32).to_le_bytes()); body.extend(100f32.to_le_bytes());
        body.extend(0f32.to_le_bytes()); body.extend(1f32.to_le_bytes());
        for text in ["V", "ignored input units", "%g", "ignored low format", "ignored high format"] { body.extend(cn(text)); }
        d.extend(rec(15, 15, &body));
        d.extend(rec(5, 20, &prr_body(2, 3)));
        let imp = import_bytes("mpr-optimized", &d);
        assert_eq!(imp.cols, vec![vec![1.25], vec![2.5]]);
        assert_eq!(imp.tests[0].name, "Multi[0]");
        assert_eq!(imp.tests[1].name, "Multi[1]");
        for t in &imp.tests {
            assert_eq!(t.units, "V");
            assert_eq!(t.lo_limit, Some(-1.0)); assert_eq!(t.hi_limit, Some(100.0));
        }
    }

    #[test]
    fn rejects_truncated_records_instead_of_importing_a_partial_dataset() {
        let mut d = minimal_stdf(&[(0, 0, ptr_body(100, 1.0, 0xff, None, None, None, None, None))], None);
        d.extend_from_slice(&[20, 0, 15, 10, 0]);
        let result = parse_stdf_bytes(&d, &mut |_, _| {});
        assert!(result.err().unwrap().contains("Truncated STDF"));
    }

    #[test]
    fn applies_first_test_defaults_to_die_with_omitted_fields() {
        // STDF allows the first PTR for a test to be a default-only record
        // outside a PIR/PRR. Later PTRs may omit RES_SCAL, limits and UNITS.
        // The first die must still use the default scaling, not raw values.
        let default = ptr_body(
            1100,
            f32::NAN,
            0x0e,
            Some(6),
            Some(-0.00055),
            Some(0.00001),
            Some("a"),
            Some("%5.0f ua"),
        );
        let first_die = ptr_body(
            1100,
            -0.000268125,
            0x0f, // RES_SCAL and both limits invalid; defaults apply
            None,
            None,
            None,
            None,
            None,
        );
        let second_die = ptr_body(
            1100,
            -0.000271875,
            0x0e,
            Some(6),
            Some(-0.00055),
            Some(0.00001),
            Some("a"),
            Some("%5.0f ua"),
        );
        let bytes = minimal_stdf(&[(0, 0, first_die), (1, 0, second_die)], Some(default));
        let imp = import_bytes("defaults", &bytes);
        assert_eq!(imp.tests.len(), 1);
        let t = &imp.tests[0];
        assert_eq!(t.units, "ua");
        assert!(
            (imp.cols[0][0] - -268.125).abs() < 1e-3,
            "{:?}",
            imp.cols[0]
        );
        assert!(
            (imp.cols[0][1] - -271.875).abs() < 1e-3,
            "{:?}",
            imp.cols[0]
        );
        assert!((t.lo_limit.expect("lo") - -550.0).abs() < 1e-3);
        assert!((t.hi_limit.expect("hi") - 10.0).abs() < 1e-3);
        assert_eq!(t.count, 2);
    }

    #[test]
    fn builds_prefixed_units_from_res_scal() {
        assert_eq!(scaled_unit("a", 6), "ua");
        assert_eq!(scaled_unit("a", 3), "ma");
        assert_eq!(scaled_unit("hz", -3), "khz");
        assert_eq!(scaled_unit("%", 2), "%");
        assert_eq!(scaled_unit("v", 0), "v");
        assert_eq!(unit_from_format("%5.0f ua").as_deref(), Some("ua"));
        assert_eq!(unit_from_format("%5.2f %%").as_deref(), Some("%"));
        assert_eq!(unit_from_format("%6.3f ohm").as_deref(), Some("ohm"));
        assert_eq!(unit_from_format("%5.2f").as_deref(), None);
        assert_eq!(display_unit("a", 6, "%5.0f ua"), "ua");
        assert_eq!(display_unit("hz", -3, "%5.1f Khz"), "Khz");
        assert_eq!(display_unit("%", 2, "%5.2f %%"), "%");
        assert_eq!(display_unit("", 3, "%5.2f m"), "m");
    }

    #[test]
    fn normalizes_first_die_to_majority_scale() {
        // The first die is recorded in base amps while later dice use microamps.
        // All three must be shown in the same unit, including the first die.
        let first = ptr_body(
            1100,
            -0.000268125,
            0x0e,
            Some(0),
            Some(-0.00055),
            Some(0.00001),
            Some("a"),
            Some("%5.0f ua"),
        );
        let second = ptr_body(
            1100,
            -0.000271875,
            0x0e,
            Some(6),
            Some(-0.00055),
            Some(0.00001),
            Some("a"),
            Some("%5.0f ua"),
        );
        let third = ptr_body(
            1100,
            -0.000273125,
            0x0e,
            Some(6),
            Some(-0.00055),
            Some(0.00001),
            Some("a"),
            Some("%5.0f ua"),
        );
        let bytes = minimal_stdf(
            &[(0, 0, first), (1, 0, second), (2, 0, third)],
            None,
        );
        let imp = import_bytes("majority", &bytes);
        assert_eq!(imp.tests[0].units, "ua");
        assert!((imp.cols[0][0] - -268.125).abs() < 1e-3, "{:?}", imp.cols[0]);
        assert!((imp.cols[0][1] - -271.875).abs() < 1e-3, "{:?}", imp.cols[0]);
        assert!((imp.cols[0][2] - -273.125).abs() < 1e-3, "{:?}", imp.cols[0]);
    }

    #[test]
    fn detects_tiny_limit_conflicts_after_scaling() {
        // A raw limit of 1e-12 A is 1 pA. The conflict check must not use an
        // absolute tolerance that hides the 1 pA difference between dice.
        let first = ptr_body(
            1100,
            1.5e-12,
            0x0e,
            Some(12),
            Some(1e-12),
            Some(3e-12),
            Some("a"),
            Some("%5.2f pa"),
        );
        let second = ptr_body(
            1100,
            2.5e-12,
            0x0e,
            Some(12),
            Some(2e-12),
            Some(4e-12),
            Some("a"),
            Some("%5.2f pa"),
        );
        let bytes = minimal_stdf(&[(0, 0, first), (1, 0, second)], None);
        let imp = import_bytes("tiny-limits", &bytes);
        let t = &imp.tests[0];
        assert_eq!(t.units, "pa");
        assert!(t.limit_conflict, "expected a limit conflict");
        assert!((t.lo_limit.expect("lo") - 1.0).abs() < 1e-6);
        assert!((t.hi_limit.expect("hi") - 3.0).abs() < 1e-6);
    }

    #[test]
    fn decodes_z_stream() {
        // Hand-crafted non-block .Z stream from the decoder crate's tests:
        // header (max bits 16, block mode off), then literal 'A' and 'B'.
        let bytes = [0x1f, 0x9d, 0x10, 0x41, 0x84, 0x00];
        assert_eq!(lzw_z::decompress_slice(&bytes).expect("decode .Z"), b"AB");
    }

    #[test]
    #[ignore = "requires STDF_DEMO_Z fixture; run explicitly with --ignored"]
    fn parses_compressed_reference_file() {
        let p = match std::env::var("STDF_DEMO_Z") {
            Ok(p) if !p.is_empty() => p,
            _ => panic!("Set STDF_DEMO_Z to the compressed reference file"),
        };
        let mut cb = |_: f32, _: &str| {};
        let imp = import_stdf(std::path::Path::new(&p), &mut cb).expect("parse .Z");
        assert!(imp.row_lot.len() > 0, "dice from .Z");
        assert!(!imp.tests.is_empty(), "tests from .Z");
    }

    #[test]
    #[ignore = "requires STDF_DEMO fixture; run explicitly with --ignored"]
    fn parses_reference_file() {
        let p = match std::env::var("STDF_DEMO") {
            Ok(p) if !p.is_empty() => p,
            _ => panic!("Set STDF_DEMO to the reference file"),
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

        // RES_SCAL is a display exponent: the stored values are in the
        // prefixed unit (uA, kHz), not the base UNITS string.
        let idx1100 = imp
            .tests
            .iter()
            .position(|t| t.number == Some(1100))
            .expect("test 1100");
        assert_eq!(imp.tests[idx1100].units, "ua");
        let first_1100 = imp.cols[idx1100]
            .iter()
            .copied()
            .find(|v| v.is_finite())
            .expect("1100 value");
        assert!(
            (first_1100 + 268.125).abs() < 0.01,
            "first 1100 value {first_1100}"
        );

        let idx1270 = imp
            .tests
            .iter()
            .position(|t| t.number == Some(1270))
            .expect("test 1270");
        assert_eq!(imp.tests[idx1270].units, "Khz");
        let first_1270 = imp.cols[idx1270]
            .iter()
            .copied()
            .find(|v| v.is_finite())
            .expect("1270 value");
        assert!(
            (first_1270 - 95.60611).abs() < 0.01,
            "first 1270 value {first_1270}"
        );
    }
}
