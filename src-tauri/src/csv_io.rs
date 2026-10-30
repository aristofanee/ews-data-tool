use crate::dataset::Imported;
use crate::model::{CustomColumn, TestInfo, NAN};
use memmap2::Mmap;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
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

fn count_delim(line: &str, delim: char) -> usize {
    let mut count = 0usize;
    let mut in_quotes = false;
    for ch in line.chars() {
        if ch == '"' {
            in_quotes = !in_quotes;
        } else if !in_quotes && ch == delim {
            count += 1;
        }
    }
    count
}

/// Pick the delimiter that gives the most consistent non-trivial row shape.
/// Looking at several lines (rather than just the first preamble line) is
/// important for CSV exports that start with a report title.
fn detect_delimiter(text: &str) -> u8 {
    let lines: Vec<&str> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .take(40)
        .collect();
    let candidates = [b',', b';', b'\t', b'|'];
    let mut best = (0usize, b',');
    for delim in candidates {
        let d = delim as char;
        let counts: Vec<usize> = lines.iter().map(|l| count_delim(l, d)).collect();
        let max = counts.iter().copied().max().unwrap_or(0);
        if max == 0 {
            continue;
        }
        let consistent = counts.iter().filter(|c| **c == max).count();
        let total: usize = counts.iter().sum();
        let score = consistent * 10_000 + max * 100 + total;
        if score > best.0 {
            best = (score, delim);
        }
    }
    best.1
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
    0
}

fn parse_u16(s: &str) -> u16 {
    let t = s.trim();
    if let Ok(v) = t.parse::<u16>() {
        return v;
    }
    if let Ok(v) = t.parse::<f64>() {
        return v.max(0.0) as u16;
    }
    1
}

fn parse_u32(s: &str) -> Option<u32> {
    let t = s.trim();
    t.parse::<u32>().ok().or_else(|| {
        t.parse::<f64>()
            .ok()
            .filter(|v| *v >= 0.0)
            .map(|v| v as u32)
    })
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

fn is_meta_header(norm: &str) -> bool {
    matches!(
        norm,
        "split" | "group" | "grouping" | "label" | "category" | "class" | "segment" | "subgroup"
    )
}

/// A text CSV column that can be used as a wafer-level grouping/colour key.
/// Excel-added columns such as `Split` are imported this way.
struct MetaColumn {
    name: String,
    by_wafer: HashMap<u16, String>,
    conflict: bool,
}

impl MetaColumn {
    fn new(name: String) -> Self {
        Self {
            name,
            by_wafer: HashMap::new(),
            conflict: false,
        }
    }

    fn observe(&mut self, wafer: u16, raw: &str) {
        let label = raw.trim();
        if label.is_empty() {
            return;
        }
        match self.by_wafer.get(&wafer) {
            None => {
                self.by_wafer.insert(wafer, label.to_string());
            }
            Some(existing) if existing != label => self.conflict = true,
            _ => {}
        }
    }

    fn finish(self, wafer_count: usize) -> Option<CustomColumn> {
        // A wafer can only carry one category. If the CSV has several labels
        // for the same wafer, this column is not a wafer-level grouping key.
        if self.conflict || self.by_wafer.is_empty() {
            return None;
        }
        let mut labels: Vec<String> = self.by_wafer.values().cloned().collect();
        labels.sort();
        labels.dedup();
        if labels.len() > 512 {
            return None;
        }
        let mut categories = vec![String::new()];
        categories.extend(labels.iter().cloned());
        let codes: HashMap<&str, u16> = categories
            .iter()
            .enumerate()
            .skip(1)
            .map(|(i, label)| (label.as_str(), i as u16))
            .collect();
        let mut wafer_values = vec![0u16; wafer_count];
        for (wafer, label) in self.by_wafer {
            if let Some(&code) = codes.get(label.as_str()) {
                if let Some(slot) = wafer_values.get_mut(wafer as usize) {
                    *slot = code;
                }
            }
        }
        Some(CustomColumn {
            name: self.name,
            categories,
            wafer_values,
        })
    }
}

fn push_meta_columns(imp: &mut Imported, collectors: Vec<MetaColumn>) {
    let mut seen = HashSet::new();
    for collector in collectors {
        if let Some(column) = collector.finish(imp.wafers.len()) {
            if seen.insert(column.name.clone()) {
                imp.custom_cols.push(column);
            }
        }
    }
}

fn meta_name(header: &str) -> String {
    split_units(header).0
}

/// Manual column mapping for CSVs whose headers are not recognised.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvMapping {
    pub lot: Option<usize>,
    pub wafer: Option<usize>,
    pub x: Option<usize>,
    pub y: Option<usize>,
    pub hbin: Option<usize>,
    pub sbin: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvInspection {
    pub headers: Vec<String>,
    pub header_line: usize,
    pub delimiter: String,
    pub mapping: CsvMapping,
    pub missing: Vec<String>,
    pub long_format: bool,
}

#[derive(Default)]
struct Layout {
    site: Option<usize>,
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

fn layout_from_headers(headers: &[String]) -> Layout {
    let mut lay = Layout::default();
    for (i, h) in headers.iter().enumerate() {
        let n = norm(h);
        let slot = match n.as_str() {
            "lot" | "lotid" | "lotname" | "sblot" | "sblotid" | "lotnumber" => {
                Some(&mut lay.lot)
            }
            "wafer" | "waferid" | "wafername" | "wafernumber" | "wf" | "wfr" | "slot"
            | "ocr" | "ocrnumber" | "waferocr" => Some(&mut lay.wafer),
            "x" | "xcoord" | "xcoordinate" | "diex" | "xdie" | "col" | "column" | "sitex" => {
                Some(&mut lay.x)
            }
            "y" | "ycoord" | "ycoordinate" | "diey" | "ydie" | "row" | "rowindex" => {
                Some(&mut lay.y)
            }
            "site" | "sitenum" | "sitenumber" | "testsite" => Some(&mut lay.site),
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
    lay
}

fn apply_mapping(mut lay: Layout, mapping: Option<&CsvMapping>, n: usize) -> Result<Layout, String> {
    let Some(m) = mapping else {
        return Ok(lay);
    };
    let check = |v: Option<usize>, name: &str| -> Result<Option<usize>, String> {
        match v {
            Some(i) if i >= n => Err(format!(
                "CSV mapping column for {name} is out of range (column {i}, only {n} columns)"
            )),
            other => Ok(other),
        }
    };
    if let Some(v) = check(m.lot, "lot")? {
        lay.lot = Some(v);
    }
    if let Some(v) = check(m.wafer, "wafer")? {
        lay.wafer = Some(v);
    }
    if let Some(v) = check(m.x, "x")? {
        lay.x = Some(v);
    }
    if let Some(v) = check(m.y, "y")? {
        lay.y = Some(v);
    }
    if let Some(v) = check(m.hbin, "hbin")? {
        lay.hbin = Some(v);
    }
    if let Some(v) = check(m.sbin, "sbin")? {
        lay.sbin = Some(v);
    }
    Ok(lay)
}

fn mapping_from_layout(lay: &Layout) -> CsvMapping {
    CsvMapping {
        lot: lay.lot,
        wafer: lay.wafer,
        x: lay.x,
        y: lay.y,
        hbin: lay.hbin,
        sbin: lay.sbin,
    }
}

fn missing_keys(lay: &Layout) -> Vec<String> {
    let mut out = Vec::new();
    if lay.lot.is_none() {
        out.push("lot".to_string());
    }
    if lay.wafer.is_none() {
        out.push("wafer".to_string());
    }
    if lay.x.is_none() {
        out.push("x".to_string());
    }
    if lay.y.is_none() {
        out.push("y".to_string());
    }
    out
}

fn header_score(headers: &[String]) -> usize {
    let lay = layout_from_headers(headers);
    let mut keys = 0usize;
    for v in [lay.lot, lay.wafer, lay.x, lay.y, lay.hbin, lay.sbin] {
        if v.is_some() {
            keys += 1;
        }
    }
    let long = (lay.test.is_some() && lay.value.is_some()) as usize;
    keys * 10 + long * 20
}

fn is_header_record(rec: &csv::StringRecord) -> bool {
    let headers: Vec<String> = rec.iter().map(|s| s.to_string()).collect();
    let nonempty = headers.iter().filter(|h| !h.trim().is_empty()).count();
    if nonempty < 2 {
        return false;
    }
    let lay = layout_from_headers(&headers);
    let keys = [lay.lot, lay.wafer, lay.x, lay.y, lay.hbin, lay.sbin]
        .iter()
        .filter(|v| v.is_some())
        .count();
    keys >= 2 || (lay.test.is_some() && lay.value.is_some())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MetadataKind {
    TestNumber,
    Unit,
    LowLimit,
    HighLimit,
}

fn metadata_kind(rec: &csv::StringRecord) -> Option<(MetadataKind, usize)> {
    // Metadata labels belong in the leading column. Restricting the check to
    // that cell avoids treating a data row whose test is literally named
    // "Unit" as a metadata row.
    let (i, cell) = rec
        .iter()
        .enumerate()
        .find(|(_, cell)| !cell.trim().is_empty())?;
    let n = norm(cell);
    let kind = match n.as_str() {
        "tests" | "testnumber" | "testnum" | "testno" | "testid" | "testindex" => {
            Some(MetadataKind::TestNumber)
        }
        "unit" | "units" | "uom" | "unitofmeasure" => Some(MetadataKind::Unit),
        "lowl" | "lowlimit" | "lowlimits" | "lsl" | "lcl" | "lolimit" | "lolim"
        | "lowerlimit" | "lowerlimits" | "min" | "low" => Some(MetadataKind::LowLimit),
        "highl" | "highlimit" | "highlimits" | "usl" | "ucl" | "hilimit" | "hilim"
        | "upperlimit" | "upperlimits" | "max" | "high" => Some(MetadataKind::HighLimit),
        _ => None,
    };
    kind.map(|k| (k, i))
}

#[derive(Default, Clone)]
struct ColumnMeta {
    number: Option<u32>,
    unit: Option<String>,
    low: Option<f32>,
    high: Option<f32>,
}

fn collect_metadata(
    rows: &[csv::StringRecord],
    headers: &[String],
) -> HashMap<usize, ColumnMeta> {
    let mut out: HashMap<usize, ColumnMeta> = HashMap::new();
    for rec in rows {
        let Some((kind, label_index)) = metadata_kind(rec) else {
            continue;
        };
        for i in 0..headers.len() {
            if i == label_index {
                continue;
            }
            let raw = rec.get(i).unwrap_or("").trim();
            if raw.is_empty() {
                continue;
            }
            let m = out.entry(i).or_default();
            match kind {
                MetadataKind::TestNumber => {
                    if let Some(v) = parse_u32(raw) {
                        m.number = Some(v);
                    }
                }
                MetadataKind::Unit => {
                    m.unit = Some(raw.to_string());
                }
                MetadataKind::LowLimit => {
                    let v = parse_f32(raw);
                    if v.is_finite() {
                        m.low = Some(v);
                    }
                }
                MetadataKind::HighLimit => {
                    let v = parse_f32(raw);
                    if v.is_finite() {
                        m.high = Some(v);
                    }
                }
            }
        }
    }
    out
}

fn read_text(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    let mmap = unsafe { Mmap::map(&file) }.map_err(|e| format!("Cannot map file: {e}"))?;
    let text = decode(&mmap).into_owned();
    if text.trim().is_empty() {
        return Err("File is empty".into());
    }
    Ok(text)
}

fn reader_for<'a>(text: &'a str, delim: u8) -> csv::Reader<&'a [u8]> {
    csv::ReaderBuilder::new()
        .delimiter(delim)
        .has_headers(false)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(text.as_bytes())
}

/// A row that looks like column names even though none of the usual key names
/// matched. This lets the mapping dialog rescue files with fully custom headers
/// such as `LOTX, WAFERX, COLX, ROWX`. Metadata rows (`Tests#`, `Unit`, ...) and
/// numeric data rows are rejected.
fn looks_like_unlabelled_header(headers: &[String]) -> bool {
    let cells: Vec<&str> = headers
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if cells.len() < 2 {
        return false;
    }
    let rec = csv::StringRecord::from(headers.to_vec());
    if metadata_kind(&rec).is_some() {
        return false;
    }
    let numeric = cells.iter().filter(|s| parse_f32(s).is_finite()).count();
    let textual = cells
        .iter()
        .filter(|s| s.chars().any(|c| c.is_alphabetic()))
        .count();
    // Column names are mostly text. Requiring at least two text cells keeps
    // title lines such as "Report generated, 2026-10-25" from being picked.
    textual >= 2 && numeric * 3 <= cells.len() * 2
}

/// Find the best header row. Preamble lines from report exports are skipped,
/// including title rows and blank rows. If no conventional key names are found,
/// fall back to the widest header-looking row so the manual mapping dialog can
/// still be used.
fn find_header(
    text: &str,
    delim: u8,
) -> Result<(Vec<String>, usize, usize), String> {
    let mut rdr = reader_for(text, delim);
    let mut rec = csv::StringRecord::new();
    let mut best: Option<(usize, usize, Vec<String>, usize)> = None; // idx, line, headers, score
    let mut fallback: Option<(usize, usize, Vec<String>, usize)> = None;
    for i in 0..200 {
        if !rdr.read_record(&mut rec).unwrap_or(false) {
            break;
        }
        if rec.iter().all(|s| s.trim().is_empty()) {
            continue;
        }
        let headers: Vec<String> = rec.iter().map(|s| s.to_string()).collect();
        let line = rec
            .position()
            .map(|p| p.line() as usize)
            .unwrap_or(i + 1)
            .max(1);
        if is_header_record(&rec) {
            let score = header_score(&headers);
            if score > 0 && best.as_ref().map_or(true, |b| score > b.3) {
                best = Some((i, line, headers, score));
            }
            continue;
        }
        if looks_like_unlabelled_header(&headers) {
            let width = headers.iter().filter(|h| !h.trim().is_empty()).count();
            if fallback
                .as_ref()
                .map_or(true, |b| width > b.3 || (width == b.3 && i > b.0))
            {
                fallback = Some((i, line, headers, width));
            }
        }
    }
    if let Some((idx, line, headers, _)) = best {
        return Ok((headers, line, idx));
    }
    if let Some((idx, line, headers, _)) = fallback {
        return Ok((headers, line, idx));
    }
    Err("CSV header not found. Expected a row with columns such as Lot, Wafer, OCR, X, Y, and test names.".into())
}

fn read_metadata_and_probe(
    rdr: &mut csv::Reader<&[u8]>,
    headers: &[String],
) -> (Vec<csv::StringRecord>, Vec<csv::StringRecord>) {
    let mut metadata = Vec::new();
    let mut probe = Vec::new();
    let mut rec = csv::StringRecord::new();
    let mut data_started = false;
    while probe.len() < 200 {
        if !rdr.read_record(&mut rec).unwrap_or(false) {
            break;
        }
        if rec.iter().all(|s| s.trim().is_empty()) {
            continue;
        }
        if !data_started {
            if let Some(_) = metadata_kind(&rec) {
                metadata.push(rec.clone());
                continue;
            }
            data_started = true;
        }
        probe.push(rec.clone());
    }
    // Keep the compiler/lint aware that headers participates in the caller's
    // contract; metadata rows are interpreted after numeric columns are known.
    let _ = headers;
    (metadata, probe)
}

pub fn inspect_csv(path: &Path) -> Result<CsvInspection, String> {
    let text = read_text(path)?;
    let delim = detect_delimiter(&text);
    let (headers, header_line, _header_idx) = find_header(&text, delim)?;
    let lay = layout_from_headers(&headers);
    let mapping = mapping_from_layout(&lay);
    let missing = missing_keys(&lay);
    Ok(CsvInspection {
        headers,
        header_line,
        delimiter: (delim as char).to_string(),
        mapping,
        missing,
        long_format: lay.test.is_some() && lay.value.is_some(),
    })
}

pub fn import_csv(path: &Path, progress: &mut dyn FnMut(f32, &str)) -> Result<Imported, String> {
    import_csv_with_mapping(path, progress, None)
}

pub fn import_csv_with_mapping(
    path: &Path,
    progress: &mut dyn FnMut(f32, &str),
    mapping: Option<&CsvMapping>,
) -> Result<Imported, String> {
    let text = read_text(path)?;
    let delim = detect_delimiter(&text);
    let (headers, _header_line, header_idx) = find_header(&text, delim)?;
    if headers.is_empty() {
        return Err("CSV has no columns".into());
    }
    let lay = apply_mapping(layout_from_headers(&headers), mapping, headers.len())?;
    let mut rdr = reader_for(&text, delim);
    let mut header_rec = csv::StringRecord::new();
    for _ in 0..=header_idx {
        if !rdr.read_record(&mut header_rec).unwrap_or(false) {
            return Err("CSV ended before the header row".into());
        }
    }
    let (metadata_rows, probe) = read_metadata_and_probe(&mut rdr, &headers);
    let col_meta = collect_metadata(&metadata_rows, &headers);

    let long_format = lay.test.is_some() && lay.value.is_some();
    let mut imp = Imported::new();

    if long_format {
        let ti = lay.test.unwrap();
        let vi = lay.value.unwrap();
        let mut test_ids: HashMap<String, u32> = HashMap::new();
        let mut row_keys: HashMap<(u32, u32, i16, i16, u32), usize> = HashMap::new();
        let mut measured = std::collections::HashSet::new();
        let mut seq = 0i16;
        let meta_indices: Vec<usize> = (0..headers.len())
            .filter(|&i| {
                Some(i) != lay.lot
                    && Some(i) != lay.wafer
                    && Some(i) != lay.x
                    && Some(i) != lay.y
                    && Some(i) != lay.hbin
                    && Some(i) != lay.sbin
                    && Some(i) != lay.site
                    && Some(i) != lay.part
                    && Some(i) != lay.test
                    && Some(i) != lay.value
            })
            .filter(|&i| !meta_name(&headers[i]).is_empty())
            .collect();
        let mut meta: Vec<MetaColumn> = meta_indices
            .iter()
            .map(|&i| MetaColumn::new(meta_name(&headers[i])))
            .collect();

        let mut push = |rec: &csv::StringRecord, imp: &mut Imported| {
            let lot_name = lay.lot.and_then(|i| rec.get(i)).unwrap_or("LOT");
            let wafer_name = lay.wafer.and_then(|i| rec.get(i)).unwrap_or("W1");
            let lot = imp.lot_index(if lot_name.is_empty() { "LOT" } else { lot_name });
            let wafer = imp.wafer_index(lot, if wafer_name.is_empty() { "W1" } else { wafer_name });
            for (m, &ci) in meta_indices.iter().enumerate() {
                meta[m].observe(wafer, rec.get(ci).unwrap_or(""));
            }
            let part = lay.part.and_then(|i| rec.get(i)).map(parse_u32).flatten().unwrap_or(0);
            let x = lay.x.and_then(|i| rec.get(i)).map(parse_i16).unwrap_or(0);
            let y = lay.y
                .and_then(|i| rec.get(i))
                .map(parse_i16)
                .unwrap_or_else(|| {
                    seq = seq.wrapping_add(1);
                    seq
                });
            let key = (lot as u32, wafer as u32, x, y, part);
            let mut row = *row_keys.entry(key).or_insert_with(|| {
                let r = imp.new_row(lot, wafer);
                imp.x[r] = x;
                imp.y[r] = y;
                imp.hbin[r] = lay.hbin.and_then(|i| rec.get(i)).map(parse_u16).unwrap_or(1);
                imp.sbin[r] = lay.sbin.and_then(|i| rec.get(i)).map(parse_u16).unwrap_or(1);
                r
            });
            let tname = rec.get(ti).unwrap_or("").trim();
            if tname.is_empty() {
                return;
            }
            let id = if let Some(id) = test_ids.get(tname) {
                *id
            } else {
                let id = test_ids.len() as u32;
                test_ids.insert(tname.to_string(), id);
                id
            };
            // In long CSV a repeated parameter for this die starts another
            // attempt. A new row prevents a partial retest from inheriting
            // measurements or bins from the preceding attempt.
            if measured.contains(&(row, id)) {
                row = imp.new_row(lot, wafer);
                imp.x[row] = x;
                imp.y[row] = y;
                imp.hbin[row] = lay.hbin.and_then(|i| rec.get(i)).map(parse_u16).unwrap_or(1);
                imp.sbin[row] = lay.sbin.and_then(|i| rec.get(i)).map(parse_u16).unwrap_or(1);
                row_keys.insert(key, row);
            }
            measured.insert((row, id));
            let idx = imp.column((id, 0), row, parse_f32(rec.get(vi).unwrap_or("")));
            if imp.tests[idx].name.is_empty() {
                imp.tests[idx].name = tname.to_string();
            }
            imp.site[row] = lay.site.and_then(|i| rec.get(i)).and_then(parse_u32).and_then(|v| u8::try_from(v).ok());
            imp.records += 1;
            if imp.records % 200_000 == 0 {
                progress(0.0, "Reading CSV...");
            }
        };

        for rec in probe.iter() {
            push(rec, &mut imp);
        }
        let mut rec = csv::StringRecord::new();
        while rdr.read_record(&mut rec).unwrap_or(false) {
            push(&rec, &mut imp);
        }
        // Give tests a stable order matching their ids.
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
        push_meta_columns(&mut imp, meta);
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
            || Some(i) == lay.site
            || Some(i) == lay.part
            || Some(i) == lay.test
            || Some(i) == lay.value
        {
            continue;
        }
        sample.push(i);
    }

    let mut numeric: Vec<usize> = Vec::new();
    let mut meta_indices: Vec<usize> = Vec::new();
    for &i in sample.iter() {
        let n = norm(&headers[i]);
        if is_meta_header(&n) {
            if !meta_name(&headers[i]).is_empty() {
                meta_indices.push(i);
            }
            continue;
        }
        let total = probe.len().max(1);
        let ok = probe
            .iter()
            .filter(|r| looks_numeric(r.get(i).unwrap_or("")))
            .count();
        if ok * 10 >= total * 8 {
            numeric.push(i);
        } else if !meta_name(&headers[i]).is_empty() {
            // Text columns are grouping/colour metadata, not measurements.
            meta_indices.push(i);
        }
    }
    if numeric.is_empty() {
        return Err("No numeric columns found. Expected a wide table (one column per test) or a long table with 'test' and 'value' columns.".into());
    }

    for &i in numeric.iter() {
        let (name, unit) = split_units(&headers[i]);
        let mut t = TestInfo::new(name);
        t.units = unit;
        if let Some(m) = col_meta.get(&i) {
            t.number = m.number;
            if let Some(u) = &m.unit {
                if !u.is_empty() {
                    t.units = u.clone();
                }
            }
            // The exported metadata rows are control limits; expose them as
            // both control and spec limits so they can be drawn immediately.
            t.lo_limit = m.low;
            t.hi_limit = m.high;
            t.lo_spec = m.low;
            t.hi_spec = m.high;
        }
        imp.tests.push(t);
        imp.cols.push(Vec::with_capacity(probe.len() + 1024));
    }
    imp.col_index.clear();
    let mut meta: Vec<MetaColumn> = meta_indices
        .iter()
        .map(|&i| MetaColumn::new(meta_name(&headers[i])))
        .collect();

    let push_row = |imp: &mut Imported,
                    rec: &csv::StringRecord,
                    meta: &mut Vec<MetaColumn>| {
        let lot_name = lay.lot.and_then(|i| rec.get(i)).unwrap_or("LOT");
        let wafer_name = lay.wafer.and_then(|i| rec.get(i)).unwrap_or("W1");
        let lot = imp.lot_index(if lot_name.is_empty() { "LOT" } else { lot_name });
        let wafer = imp.wafer_index(lot, if wafer_name.is_empty() { "W1" } else { wafer_name });
        for (m, &ci) in meta_indices.iter().enumerate() {
            meta[m].observe(wafer, rec.get(ci).unwrap_or(""));
        }
        let r = imp.new_row(lot, wafer);
        imp.site[r] = lay.site.and_then(|i| rec.get(i)).and_then(parse_u32).and_then(|v| u8::try_from(v).ok());
        imp.x[r] = lay.x.and_then(|i| rec.get(i)).map(parse_i16).unwrap_or(0);
        imp.y[r] = lay.y.and_then(|i| rec.get(i)).map(parse_i16).unwrap_or(0);
        imp.hbin[r] = lay.hbin
            .and_then(|i| rec.get(i))
            .map(parse_u16)
            .unwrap_or(1);
        imp.sbin[r] = lay.sbin
            .and_then(|i| rec.get(i))
            .map(parse_u16)
            .unwrap_or(1);
        for (k, &ci) in numeric.iter().enumerate() {
            let v = parse_f32(rec.get(ci).unwrap_or(""));
            imp.cols[k].push(v);
        }
        imp.records += 1;
    };

    for r in probe.iter() {
        push_row(&mut imp, r, &mut meta);
    }
    let mut rec = csv::StringRecord::new();
    while rdr.read_record(&mut rec).unwrap_or(false) {
        push_row(&mut imp, &rec, &mut meta);
        if imp.records % 200_000 == 0 {
            progress(0.0, "Reading CSV...");
        }
    }

    push_meta_columns(&mut imp, meta);
    Ok(imp.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_csv_partial_retest_keeps_latest_bins_without_old_measurements() {
        let p = write_temp("long-retest", "Lot,Wafer,X,Y,HBIN,Test,Value\nL,W,1,2,2,A,10\nL,W,1,2,2,B,20\nL,W,1,2,1,A,30\n");
        let imp = import_csv(&p, &mut |_, _| {}).unwrap();
        let mut ds = crate::model::Dataset::new();
        ds.merge(imp);
        ds.resolve_retests();
        assert_eq!(ds.rows, 1);
        assert_eq!(ds.retest_count, 1);
        assert_eq!(ds.hbin, vec![1]);
        assert_eq!(ds.cols[0], vec![30.0]);
        assert!(ds.cols[1][0].is_nan());
        let _ = std::fs::remove_file(p);
    }

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
    fn wide_csv_imports_text_split_column() {
        let p = write_temp(
            "wide-split",
            "Lot,Wafer,X,Y,HBIN,Vt [V],Split\n\
             L1,01,0,0,1,0.41,A\n\
             L1,01,1,0,1,0.42,A\n\
             L1,02,0,0,1,0.43,B\n",
        );
        let imp = import_csv(&p, &mut |_, _| {}).unwrap();
        assert_eq!(imp.tests.len(), 1);
        assert_eq!(imp.custom_cols.len(), 1);
        let split = &imp.custom_cols[0];
        assert_eq!(split.name, "Split");
        assert_eq!(split.categories, vec!["", "A", "B"]);
        assert_eq!(split.wafer_values, vec![1, 2]);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn long_csv_imports_text_split_column() {
        let p = write_temp(
            "long-split",
            "Lot,Wafer,X,Y,HBIN,Test,Value,Split\n\
             L1,01,0,0,1,Vt,0.41,A\n\
             L1,01,0,0,1,Idsat,100,A\n\
             L1,02,0,0,1,Vt,0.43,B\n\
             L1,02,0,0,1,Idsat,101,B\n",
        );
        let imp = import_csv(&p, &mut |_, _| {}).unwrap();
        assert_eq!(imp.tests.len(), 2);
        assert_eq!(imp.custom_cols.len(), 1);
        let split = &imp.custom_cols[0];
        assert_eq!(split.name, "Split");
        assert_eq!(split.categories, vec!["", "A", "B"]);
        assert_eq!(split.wafer_values, vec![1, 2]);
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

    #[test]
    fn csv_with_preamble_and_metadata_rows() {
        let p = write_temp(
            "preamble",
            "EWS Data Tool report\n\
             Generated 2026-10-25\n\
             \n\
             Lot,Wafer,X,Y,HBIN,Vt [V],Leakage\n\
             Tests#, , , , ,101,202\n\
             Unit, , , , ,V,A\n\
             LowL, , , , ,0.35,0.01\n\
             HighL, , , , ,0.55,0.10\n\
             L1,01,0,0,1,0.41,0.02\n\
             L1,01,1,0,1,0.42,0.03\n",
        );
        let imp = import_csv(&p, &mut |_, _| {}).unwrap();
        assert_eq!(imp.tests.len(), 2);
        assert_eq!(imp.tests[0].number, Some(101));
        assert_eq!(imp.tests[0].units, "V");
        assert_eq!(imp.tests[0].lo_limit, Some(0.35));
        assert_eq!(imp.tests[0].hi_limit, Some(0.55));
        assert_eq!(imp.tests[1].number, Some(202));
        assert_eq!(imp.tests[1].units, "A");
        assert_eq!(imp.row_lot.len(), 2);
        assert!((imp.cols[0][0] - 0.41).abs() < 1e-6);
        assert!((imp.cols[1][1] - 0.03).abs() < 1e-6);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn manual_mapping_finds_key_columns() {
        let p = write_temp(
            "mapping",
            "LotID,OCR,DieX,DieY,Vt [V]\n\
             L1,01,0,0,0.41\n\
             L1,01,1,0,0.42\n",
        );
        let inspection = inspect_csv(&p).unwrap();
        assert!(inspection.missing.is_empty());
        let imp = import_csv(&p, &mut |_, _| {}).unwrap();
        assert_eq!(imp.wafers.len(), 1);
        assert_eq!(imp.x, vec![0, 1]);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn custom_headers_offer_manual_mapping() {
        let p = write_temp(
            "custom-headers",
            "LOTX,WAFERX,COLX,ROWX,H1,S1,T1\n\
             L1,01,0,0,1,1,0.41\n\
             L1,01,1,0,1,1,0.42\n",
        );
        let inspection = inspect_csv(&p).unwrap();
        assert_eq!(inspection.header_line, 1);
        assert!(inspection.missing.contains(&"lot".to_string()));
        assert!(inspection.missing.contains(&"x".to_string()));
        let mapping = CsvMapping {
            lot: Some(0),
            wafer: Some(1),
            x: Some(2),
            y: Some(3),
            hbin: Some(4),
            sbin: Some(5),
        };
        let imp = import_csv_with_mapping(&p, &mut |_, _| {}, Some(&mapping)).unwrap();
        assert_eq!(imp.lots, vec!["L1"]);
        assert_eq!(imp.wafers.len(), 1);
        assert_eq!(imp.x, vec![0, 1]);
        assert_eq!(imp.tests.len(), 1);
        assert!((imp.cols[0][1] - 0.42).abs() < 1e-6);
        let _ = std::fs::remove_file(&p);
    }
}
