use crate::dataset::Imported;
use crate::model::{TestInfo, NAN};
use memmap2::Mmap;
use std::borrow::Cow;
use std::collections::HashMap;
use std::fs::File;
use std::path::Path;

fn norm(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

fn split_units(header: &str) -> (String, String) {
    let h = header.trim();
    for (open, close) in [('[', ']'), ('(', ')')] {
        if h.ends_with(close) {
            if let Some(i) = h.rfind(open) {
                let name = h[..i].trim().to_string();
                let unit = h[i + 1..h.len() - 1].trim().to_string();
                if !name.is_empty() {
                    return (name, unit);
                }
            }
        }
    }
    (h.to_string(), String::new())
}

fn decode(bytes: &[u8]) -> Cow<'_, str> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        Cow::Borrowed(std::str::from_utf8(&bytes[3..]).unwrap_or(""))
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        Cow::Owned(encoding_rs::UTF_16LE.decode(&bytes[2..]).0.into_owned())
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        Cow::Owned(encoding_rs::UTF_16BE.decode(&bytes[2..]).0.into_owned())
    } else {
        String::from_utf8_lossy(bytes)
    }
}

fn detect_delim(line: &str) -> u8 {
    let mut counts = [0usize; 4];
    let mut in_quotes = false;
    for ch in line.chars() {
        if ch == '"' {
            in_quotes = !in_quotes;
            continue;
        }
        if in_quotes {
            continue;
        }
        match ch {
            ',' => counts[0] += 1,
            ';' => counts[1] += 1,
            '\t' => counts[2] += 1,
            '|' => counts[3] += 1,
            _ => {}
        }
    }
    let mut best = 0;
    for i in 1..4 {
        if counts[i] > counts[best] {
            best = i;
        }
    }
    match best {
        0 => b',',
        1 => b';',
        2 => b'\t',
        _ => b'|',
    }
}

fn parse_f32(s: &str) -> f32 {
    let t = s.trim();
    if t.is_empty() {
        return NAN;
    }
    let lower = t.to_ascii_lowercase();
    if lower == "nan" || lower == "n/a" || lower == "na" || lower == "-" || lower == "null" {
        return NAN;
    }
    if let Ok(v) = t.parse::<f32>() {
        return v;
    }
    // European decimal comma
    if t.contains(',') && !t.contains('.') {
        if let Ok(v) = t.replace(',', ".").parse::<f32>() {
            return v;
        }
    }
    NAN
}

fn parse_i16(s: &str) -> i16 {
    let t = s.trim();
    if let Ok(v) = t.parse::<i16>() {
        return v;
    }
    if let Ok(v) = t.parse::<f64>() {
        return v as i16;
    }
    NAN as i16
}

fn parse_u16(s: &str) -> u16 {
    let t = s.trim();
    if let Ok(v) = t.parse::<u16>() {
        return v;
    }
    if let Ok(v) = t.parse::<f64>() {
        return v.max(0.0) as u16;
    }
    0
}

fn looks_numeric(s: &str) -> bool {
    let t = s.trim();
    if t.is_empty() {
        return true;
    }
    if t.parse::<f32>().is_ok() {
        return true;
    }
    if t.contains(',') && !t.contains('.') {
        return t.replace(',', ".").parse::<f32>().is_ok();
    }
    false
}

#[derive(Default)]
struct Layout {
    lot: Option<usize>,
    wafer: Option<usize>,
    x: Option<usize>,
    y: Option<usize>,
    hbin: Option<usize>,
    sbin: Option<usize>,
    test: Option<usize>,
    value: Option<usize>,
    part: Option<usize>,
}

pub fn import_csv(path: &Path, progress: &mut dyn FnMut(f32, &str)) -> Result<Imported, String> {
    let file = File::open(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    let mmap = unsafe { Mmap::map(&file) }.map_err(|e| format!("Cannot map file: {e}"))?;
    let text = decode(&mmap);
    if text.trim().is_empty() {
        return Err("File is empty".into());
    }

    let first_line = text.lines().next().unwrap_or("");
    let delim = detect_delim(first_line);

    let mut rdr = csv::ReaderBuilder::new()
        .delimiter(delim)
        .has_headers(true)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(text.as_bytes());

    let headers: Vec<String> = rdr
        .headers()
        .map_err(|e| format!("Cannot read CSV header: {e}"))?
        .iter()
        .map(|s| s.to_string())
        .collect();
    if headers.is_empty() {
        return Err("CSV has no columns".into());
    }

    let mut lay = Layout::default();
    for (i, h) in headers.iter().enumerate() {
        let n = norm(h);
        let slot = match n.as_str() {
            "lot" | "lotid" | "lotname" | "sblot" | "sblotid" | "lotnumber" => Some(&mut lay.lot),
            "wafer" | "waferid" | "wafername" | "wafernumber" | "wf" | "wfr" | "slot" => {
                Some(&mut lay.wafer)
            }
            "x" | "xcoord" | "xcoordinate" | "diex" | "xdie" | "col" | "column" | "sitex" => {
                Some(&mut lay.x)
            }
            "y" | "ycoord" | "ycoordinate" | "diey" | "ydie" | "row" | "rowindex" => {
                Some(&mut lay.y)
            }
            "hbin" | "hardbin" | "hardbinno" | "hardbinnumber" => Some(&mut lay.hbin),
            "sbin" | "softbin" | "softbinno" | "bin" | "binnumber" | "binno" => {
                Some(&mut lay.sbin)
            }
            "test" | "testname" | "testnumber" | "testnum" | "param" | "parameter"
            | "parametername" | "item" | "measurementname" => Some(&mut lay.test),
            "value" | "result" | "meas" | "measurement" | "reading" | "data"
            | "measuredvalue" => Some(&mut lay.value),
            "partid" | "part" | "dieid" | "unitid" | "serial" => Some(&mut lay.part),
            _ => None,
        };
        if let Some(s) = slot {
            if s.is_none() {
                *s = Some(i);
            }
        }
    }

    let long_format = lay.test.is_some() && lay.value.is_some();
    let mut imp = Imported::new();
    let mut rec = csv::StringRecord::new();

    if long_format {
        let ti = lay.test.unwrap();
        let vi = lay.value.unwrap();
        let mut test_ids: HashMap<String, u32> = HashMap::new();
        let mut row_keys: HashMap<(u32, u32, i16, i16), usize> = HashMap::new();
        let mut seq = 0i16;

        while rdr.read_record(&mut rec).unwrap_or(false) {
            let lot_name = lay.lot.and_then(|i| rec.get(i)).unwrap_or("LOT");
            let wafer_name = lay.wafer.and_then(|i| rec.get(i)).unwrap_or("W1");
            let lot = imp.lot_index(if lot_name.is_empty() { "LOT" } else { lot_name });
            let wafer = imp.wafer_index(lot, if wafer_name.is_empty() { "W1" } else { wafer_name });
            let x = lay.x.and_then(|i| rec.get(i)).map(parse_i16).unwrap_or(0);
            let y = lay.y
                .and_then(|i| rec.get(i))
                .map(parse_i16)
                .unwrap_or_else(|| {
                    seq = seq.wrapping_add(1);
                    seq
                });
            let row = if lay.x.is_none() || lay.y.is_none() {
                let r = imp.new_row(lot, wafer);
                imp.x[r] = x;
                imp.y[r] = y;
                if let Some(i) = lay.hbin {
                    imp.hbin[r] = rec.get(i).map(parse_u16).unwrap_or(0);
                }
                if let Some(i) = lay.sbin {
                    imp.sbin[r] = rec.get(i).map(parse_u16).unwrap_or(0);
                }
                r
            } else {
                *row_keys.entry((lot as u32, wafer as u32, x, y)).or_insert_with(|| {
                    let r = imp.new_row(lot, wafer);
                    imp.x[r] = x;
                    imp.y[r] = y;
                    if let Some(i) = lay.hbin {
                        imp.hbin[r] = rec.get(i).map(parse_u16).unwrap_or(0);
                    }
                    if let Some(i) = lay.sbin {
                        imp.sbin[r] = rec.get(i).map(parse_u16).unwrap_or(0);
                    }
                    r
                })
            };
            let tname = rec.get(ti).unwrap_or("").trim();
            if tname.is_empty() {
                continue;
            }
            let id = if let Some(id) = test_ids.get(tname) {
                *id
            } else {
                let id = test_ids.len() as u32;
                test_ids.insert(tname.to_string(), id);
                id
            };
            let idx = imp.column((id, 0), row, parse_f32(rec.get(vi).unwrap_or("")));
            if imp.tests[idx].name.is_empty() {
                imp.tests[idx].name = tname.to_string();
            }
            imp.records += 1;
            if imp.records % 200_000 == 0 {
                progress(0.0, "Reading CSV...");
            }
        }
        // give tests a stable order matching their ids
        let mut order: Vec<(u32, usize)> = test_ids
            .iter()
            .map(|(name, id)| (*id, imp.tests.iter().position(|t| &t.name == name).unwrap_or(0)))
            .collect();
        order.sort_by_key(|(id, _)| *id);
        let mut tests = Vec::with_capacity(order.len());
        let mut cols = Vec::with_capacity(order.len());
        for (_, idx) in order {
            tests.push(imp.tests[idx].clone());
            cols.push(std::mem::take(&mut imp.cols[idx]));
        }
        imp.tests = tests;
        imp.cols = cols;
        imp.col_index.clear();
        return Ok(imp.finish());
    }

    // Wide format: every numeric, non-key column is a test.
    let mut sample: Vec<usize> = Vec::new();
    for (i, _) in headers.iter().enumerate() {
        if Some(i) == lay.lot
            || Some(i) == lay.wafer
            || Some(i) == lay.x
            || Some(i) == lay.y
            || Some(i) == lay.hbin
            || Some(i) == lay.sbin
            || Some(i) == lay.part
        {
            continue;
        }
        sample.push(i);
    }

    // probe the first 200 records to decide which columns are numeric
    let mut probe: Vec<csv::StringRecord> = Vec::new();
    while probe.len() < 200 && rdr.read_record(&mut rec).unwrap_or(false) {
        probe.push(rec.clone());
    }
    let mut numeric: Vec<usize> = Vec::new();
    for &i in sample.iter() {
        let total = probe.len().max(1);
        let ok = probe
            .iter()
            .filter(|r| looks_numeric(r.get(i).unwrap_or("")))
            .count();
        if ok * 10 >= total * 8 {
            numeric.push(i);
        }
    }
    if numeric.is_empty() {
        return Err("No numeric columns found. Expected a wide table (one column per test) or a long table with 'test' and 'value' columns.".into());
    }

    for &i in numeric.iter() {
        let (name, unit) = split_units(&headers[i]);
        let mut t = TestInfo::new(name);
        t.units = unit;
        imp.tests.push(t);
        imp.cols.push(Vec::with_capacity(probe.len() + 1024));
    }
    imp.col_index.clear();

    let push_row = |imp: &mut Imported, rec: &csv::StringRecord| {
        let lot_name = lay.lot.and_then(|i| rec.get(i)).unwrap_or("LOT");
        let wafer_name = lay.wafer.and_then(|i| rec.get(i)).unwrap_or("W1");
        let lot = imp.lot_index(if lot_name.is_empty() { "LOT" } else { lot_name });
        let wafer = imp.wafer_index(lot, if wafer_name.is_empty() { "W1" } else { wafer_name });
        let r = imp.new_row(lot, wafer);
        imp.x[r] = lay.x.and_then(|i| rec.get(i)).map(parse_i16).unwrap_or(0);
        imp.y[r] = lay.y.and_then(|i| rec.get(i)).map(parse_i16).unwrap_or(0);
        imp.hbin[r] = lay.hbin.and_then(|i| rec.get(i)).map(parse_u16).unwrap_or(0);
        imp.sbin[r] = lay.sbin.and_then(|i| rec.get(i)).map(parse_u16).unwrap_or(0);
        for (k, &ci) in numeric.iter().enumerate() {
            let v = parse_f32(rec.get(ci).unwrap_or(""));
            imp.cols[k].push(v);
        }
        imp.records += 1;
    };

    for r in probe.iter() {
        push_row(&mut imp, r);
    }
    while rdr.read_record(&mut rec).unwrap_or(false) {
        push_row(&mut imp, &rec);
        if imp.records % 200_000 == 0 {
            progress(0.0, "Reading CSV...");
        }
    }

    Ok(imp.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_temp(name: &str, body: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("ews-csv-{}-{name}.csv", std::process::id()));
        std::fs::write(&p, body).unwrap();
        p
    }

    #[test]
    fn wide_csv_reads_units_bins_and_values() {
        let p = write_temp(
            "wide",
            "Lot,Wafer,X,Y,HBIN,SBIN,Vt_nch [V],Idsat (uA/um)\n\
             L1,01,0,0,1,1,0.41,100\n\
             L1,01,1,0,1,1,0.42,101\n\
             L1,01,0,1,20,20,0.50,90\n\
             L2,01,0,0,1,1,0.43,102\n",
        );
        let imp = import_csv(&p, &mut |_, _| {}).unwrap();
        assert_eq!(imp.lots, vec!["L1", "L2"]);
        assert_eq!(imp.wafers.len(), 2);
        assert_eq!(imp.row_lot.len(), 4);
        assert_eq!(imp.tests.len(), 2);
        assert_eq!(imp.tests[0].name, "Vt_nch");
        assert_eq!(imp.tests[0].units, "V");
        assert_eq!(imp.tests[1].name, "Idsat");
        assert_eq!(imp.tests[1].units, "uA/um");
        assert_eq!(imp.hbin, vec![1, 1, 20, 1]);
        assert!((imp.cols[0][0] - 0.41).abs() < 1e-6);
        assert!((imp.cols[1][3] - 102.0).abs() < 1e-6);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn long_csv_pivots_tests_into_columns() {
        let p = write_temp(
            "long",
            "Lot,Wafer,X,Y,HBIN,Test,Value\n\
             L1,01,0,0,1,Vt_nch,0.41\n\
             L1,01,0,0,1,Idsat,100\n\
             L1,01,1,0,1,Vt_nch,0.42\n\
             L1,01,1,0,1,Idsat,101\n",
        );
        let imp = import_csv(&p, &mut |_, _| {}).unwrap();
        assert_eq!(imp.row_lot.len(), 2);
        assert_eq!(imp.tests.len(), 2);
        assert_eq!(imp.tests[0].name, "Vt_nch");
        assert_eq!(imp.tests[1].name, "Idsat");
        assert!((imp.cols[0][1] - 0.42).abs() < 1e-6);
        assert!((imp.cols[1][0] - 100.0).abs() < 1e-6);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn semicolon_csv_with_decimal_comma() {
        let p = write_temp(
            "euro",
            "Lot;Wafer;X;Y;HBIN;Vt_nch [V]\n\
             L1;01;0;0;1;0,41\n\
             L1;01;1;0;1;0,42\n",
        );
        let imp = import_csv(&p, &mut |_, _| {}).unwrap();
        assert_eq!(imp.tests.len(), 1);
        assert!((imp.cols[0][0] - 0.41).abs() < 1e-5);
        let _ = std::fs::remove_file(&p);
    }
}
