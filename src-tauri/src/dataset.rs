use crate::model::*;
use std::collections::HashMap;

fn limits_differ(a: Option<f32>, b: Option<f32>) -> bool {
    match (a, b) {
        (Some(x), Some(y)) => {
            let tol = 1e-6 * (1.0 + x.abs().max(y.abs()));
            (x - y).abs() > tol
        }
        _ => false,
    }
}

/// Data parsed from one file, keyed by local indices. Merged into `Dataset` afterwards.
pub struct Imported {
    pub lots: Vec<String>,
    pub wafers: Vec<(u16, String)>,
    pub row_lot: Vec<u16>,
    pub row_wafer: Vec<u16>,
    pub x: Vec<i16>,
    pub y: Vec<i16>,
    pub hbin: Vec<u16>,
    pub sbin: Vec<u16>,
    pub site: Vec<Option<u8>>,
    pub tests: Vec<TestInfo>,
    pub cols: Vec<Vec<f32>>,
    pub hbin_names: HashMap<u16, (String, bool)>,
    pub sbin_names: HashMap<u16, (String, bool)>,
    pub wafer_geom: Vec<WaferGeom>,
    pub records: u64,
    pub col_index: HashMap<(u32, u16), usize>,
    /// Text metadata imported from a CSV (for example an Excel-added Split
    /// column). Codes are local to this file and are remapped by `merge`.
    pub custom_cols: Vec<CustomColumn>,
}

impl Imported {
    pub fn new() -> Self {
        Self {
            lots: Vec::new(),
            wafers: Vec::new(),
            row_lot: Vec::new(),
            row_wafer: Vec::new(),
            x: Vec::new(),
            y: Vec::new(),
            hbin: Vec::new(),
            sbin: Vec::new(),
            site: Vec::new(),
            tests: Vec::new(),
            cols: Vec::new(),
            hbin_names: HashMap::new(),
            sbin_names: HashMap::new(),
            wafer_geom: Vec::new(),
            records: 0,
            col_index: HashMap::new(),
            custom_cols: Vec::new(),
        }
    }

    pub fn lot_index(&mut self, name: &str) -> u16 {
        if let Some(i) = self.lots.iter().position(|l| l == name) {
            return i as u16;
        }
        self.lots.push(name.to_string());
        (self.lots.len() - 1) as u16
    }

    pub fn wafer_index(&mut self, lot: u16, name: &str) -> u16 {
        if let Some(i) = self
            .wafers
            .iter()
            .position(|(l, n)| *l == lot && n == name)
        {
            return i as u16;
        }
        self.wafers.push((lot, name.to_string()));
        self.wafer_geom.push(WaferGeom::default());
        (self.wafers.len() - 1) as u16
    }

    pub fn new_row(&mut self, lot: u16, wafer: u16) -> usize {
        let r = self.row_lot.len();
        self.row_lot.push(lot);
        self.row_wafer.push(wafer);
        self.x.push(i16::MIN);
        self.y.push(i16::MIN);
        self.hbin.push(0);
        self.sbin.push(0);
        self.site.push(None);
        r
    }

    /// Return the index of a test column, creating an empty one if needed.
    /// STDF default PTR/MPR records can arrive before the first die, so the
    /// parser needs a test slot without writing a value.
    pub fn test_slot(&mut self, key: (u32, u16)) -> usize {
        if let Some(&i) = self.col_index.get(&key) {
            return i;
        }
        let i = self.cols.len();
        self.cols.push(Vec::new());
        self.tests.push(TestInfo::new(String::new()));
        self.col_index.insert(key, i);
        i
    }

    pub fn column(&mut self, key: (u32, u16), row: usize, value: f32) -> usize {
        let idx = self.test_slot(key);
        self.write_column(idx, row, value);
        idx
    }

    /// Parser paths already resolved the column while updating metadata.
    pub fn write_column(&mut self, idx: usize, row: usize, value: f32) {
        let col = &mut self.cols[idx];
        if col.len() < row {
            col.resize(row, NAN);
        }
        if col.len() == row {
            col.push(value);
        } else {
            col[row] = value;
        }
    }

    pub fn finish(mut self) -> Self {
        let rows = self.row_lot.len();
        for c in self.cols.iter_mut() {
            if !c.is_empty() && c.len() < rows {
                c.resize(rows, NAN);
            }
        }
        for (i, t) in self.tests.iter_mut().enumerate() {
            t.count = self.cols[i].iter().filter(|v| v.is_finite()).count();
            if t.name.is_empty() {
                t.name = format!("Test {}", i + 1);
            }
        }
        self
    }
}

impl Dataset {
    /// Resolve retests once after all selected files have been merged. The
    /// complete last attempt wins, including missing/invalid measurements.
    pub fn resolve_retests(&mut self) {
        let mut latest = HashMap::with_capacity(self.rows);
        let mut keep = vec![true; self.rows];
        for r in 0..self.rows {
            // Unknown coordinates cannot establish a physical die identity.
            if self.x[r] == i16::MIN || self.y[r] == i16::MIN { continue; }
            let key = (self.lot_of_row[r], self.wafer_of_row[r], self.x[r], self.y[r]);
            if let Some(previous) = latest.insert(key, r) {
                keep[previous] = false;
                self.retest_count += 1;
            }
        }
        fn compact<T: Copy>(v: &mut Vec<T>, keep: &[bool]) {
            if v.is_empty() { return; }
            let mut dst = 0;
            for (src, retained) in keep.iter().enumerate() {
                if *retained { v[dst] = v[src]; dst += 1; }
            }
            v.truncate(dst);
        }
        if keep.iter().any(|k| !k) {
            compact(&mut self.lot_of_row, &keep);
            compact(&mut self.wafer_of_row, &keep);
            compact(&mut self.x, &keep);
            compact(&mut self.y, &keep);
            compact(&mut self.hbin, &keep);
            compact(&mut self.sbin, &keep);
            compact(&mut self.site, &keep);
            for col in &mut self.cols { compact(col, &keep); }
            self.rows = self.x.len();
        }
        self.recompute();
    }

    pub fn merge(&mut self, imp: Imported) {
        self.merge_impl(imp, true);
    }

    /// Append a file without rescanning previous measurements. Import callers
    /// finalize counts/geometry with resolve_retests after the final file.
    pub fn append_import(&mut self, imp: Imported) {
        self.merge_impl(imp, false);
    }

    fn merge_impl(&mut self, imp: Imported, refresh_stats: bool) {
        let base_rows = self.rows;

        let lot_map: Vec<u16> = imp
            .lots
            .iter()
            .map(|name| {
                if let Some(i) = self.lots.iter().position(|l| l == name) {
                    i as u16
                } else {
                    self.lots.push(name.clone());
                    (self.lots.len() - 1) as u16
                }
            })
            .collect();

        let mut wafer_map = Vec::with_capacity(imp.wafers.len());
        for (wi, (li, name)) in imp.wafers.iter().enumerate() {
            let glot = lot_map[*li as usize];
            let geom = imp
                .wafer_geom
                .get(wi)
                .copied()
                .unwrap_or_default();
            if let Some(j) = self
                .wafers
                .iter()
                .position(|w| w.lot == glot && &w.name == name)
            {
                // A later file may carry the WCR geometry for an existing
                // wafer. Fill only missing values so the first definition wins.
                let w = &mut self.wafers[j];
                if w.diameter_mm.is_none() {
                    w.diameter_mm = geom.diameter_mm;
                }
                if w.die_w_mm.is_none() {
                    w.die_w_mm = geom.die_w_mm;
                }
                if w.die_h_mm.is_none() {
                    w.die_h_mm = geom.die_h_mm;
                }
                if w.center_x.is_none() {
                    w.center_x = geom.center_x;
                }
                if w.center_y.is_none() {
                    w.center_y = geom.center_y;
                }
                if w.flat.is_none() {
                    w.flat = geom.flat.map(|c| c.to_string());
                }
                wafer_map.push(j as u16);
            } else {
                self.wafers.push(WaferInfo {
                    lot: glot,
                    name: name.clone(),
                    dice: 0,
                    x_min: i16::MAX,
                    x_max: i16::MIN,
                    y_min: i16::MAX,
                    y_max: i16::MIN,
                    diameter_mm: geom.diameter_mm,
                    die_w_mm: geom.die_w_mm,
                    die_h_mm: geom.die_h_mm,
                    center_x: geom.center_x,
                    center_y: geom.center_y,
                    flat: geom.flat.map(|c| c.to_string()),
                });
                wafer_map.push((self.wafers.len() - 1) as u16);
            }
        }

        // A repeated display name does not imply the same measurement. Keep
        // test numbers and units distinct, including MPR result suffixes.
        let mut test_lookup: HashMap<(Option<u32>, String, String), usize> = self.tests
            .iter().enumerate().map(|(i, t)| ((t.number, t.name.clone(), t.units.clone()), i)).collect();
        let mut test_map = Vec::with_capacity(imp.tests.len());
        for t in imp.tests.iter() {
            let key = (t.number, t.name.clone(), t.units.clone());
            if let Some(&i) = test_lookup.get(&key) {
                let dst = &mut self.tests[i];
                if dst.number.is_none() {
                    dst.number = t.number;
                }
                if dst.units.is_empty() && !t.units.is_empty() {
                    dst.units = t.units.clone();
                }
                if limits_differ(dst.lo_limit, t.lo_limit)
                    || limits_differ(dst.hi_limit, t.hi_limit)
                    || limits_differ(dst.lo_spec, t.lo_spec)
                    || limits_differ(dst.hi_spec, t.hi_spec)
                {
                    dst.limit_conflict = true;
                }
                dst.limit_conflict |= t.limit_conflict;
                if dst.lo_limit.is_none() {
                    dst.lo_limit = t.lo_limit;
                }
                if dst.hi_limit.is_none() {
                    dst.hi_limit = t.hi_limit;
                }
                if dst.lo_spec.is_none() {
                    dst.lo_spec = t.lo_spec;
                }
                if dst.hi_spec.is_none() {
                    dst.hi_spec = t.hi_spec;
                }
                test_map.push(i);
            } else {
                self.tests.push(t.clone());
                self.cols.push(vec![NAN; base_rows]);
                test_lookup.insert(key, self.tests.len() - 1);
                test_map.push(self.tests.len() - 1);
            }
        }

        let new_rows = imp.row_lot.len();
        for r in 0..new_rows {
            self.lot_of_row
                .push(lot_map[imp.row_lot[r] as usize]);
            self.wafer_of_row
                .push(wafer_map[imp.row_wafer[r] as usize]);
            self.x.push(imp.x[r]);
            self.y.push(imp.y[r]);
            self.hbin.push(imp.hbin[r]);
            self.sbin.push(imp.sbin[r]);
            self.site.push(imp.site.get(r).copied().flatten());
        }

        let total = base_rows + new_rows;
        for c in self.cols.iter_mut() {
            if c.len() < total {
                c.resize(total, NAN);
            }
        }
        for (ti, src) in imp.cols.iter().enumerate() {
            let gi = test_map[ti];
            let n = src.len().min(new_rows);
            if n > 0 {
                self.cols[gi][base_rows..base_rows + n].copy_from_slice(&src[..n]);
            }
        }

        // Text columns such as an Excel-added "Split" are imported as
        // wafer-level custom columns. Re-map the file-local wafer/category
        // codes into the merged dataset.
        for imported in imp.custom_cols {
            let idx = match self.custom_cols.iter().position(|c| c.name == imported.name) {
                Some(i) => i,
                None => {
                    self.custom_cols.push(CustomColumn {
                        name: imported.name,
                        categories: vec![String::new()],
                        wafer_values: vec![0; self.wafers.len()],
                    });
                    self.custom_cols.len() - 1
                }
            };
            if self.custom_cols[idx].wafer_values.len() < self.wafers.len() {
                self.custom_cols[idx]
                    .wafer_values
                    .resize(self.wafers.len(), 0);
            }
            for (local_w, code) in imported.wafer_values.iter().enumerate() {
                if *code == 0 {
                    continue;
                }
                let Some(label) = imported
                    .categories
                    .get(*code as usize)
                    .filter(|label| !label.is_empty())
                else {
                    continue;
                };
                let Some(global_w) = wafer_map.get(local_w).copied() else {
                    continue;
                };
                let global_w = global_w as usize;
                if global_w >= self.custom_cols[idx].wafer_values.len() {
                    continue;
                }
                let code = match self.custom_cols[idx]
                    .categories
                    .iter()
                    .position(|c| c == label)
                {
                    Some(i) => i as u16,
                    None => {
                        self.custom_cols[idx].categories.push(label.clone());
                        (self.custom_cols[idx].categories.len() - 1) as u16
                    }
                };
                self.custom_cols[idx].wafer_values[global_w] = code;
            }
        }

        for (code, (name, pass)) in imp.hbin_names {
            self.hbin_names.entry(code).or_insert(name);
            if pass {
                self.pass_hbin[code as usize] = true;
            }
        }
        for (code, (name, pass)) in imp.sbin_names {
            self.sbin_names.entry(code).or_insert(name);
            if pass {
                self.pass_sbin[code as usize] = true;
            }
        }

        self.rows = total;
        if refresh_stats { self.recompute(); }
    }

    fn recompute(&mut self) {
        for w in self.wafers.iter_mut() {
            w.dice = 0;
            w.x_min = i16::MAX;
            w.x_max = i16::MIN;
            w.y_min = i16::MAX;
            w.y_max = i16::MIN;
        }
        for r in 0..self.rows {
            let w = &mut self.wafers[self.wafer_of_row[r] as usize];
            w.dice += 1;
            w.x_min = w.x_min.min(self.x[r]);
            w.x_max = w.x_max.max(self.x[r]);
            w.y_min = w.y_min.min(self.y[r]);
            w.y_max = w.y_max.max(self.y[r]);
        }
        for t in self.tests.iter_mut() {
            t.count = 0;
        }
        for (i, c) in self.cols.iter().enumerate() {
            self.tests[i].count = c.iter().filter(|v| v.is_finite()).count();
        }
    }

    pub fn info(&self) -> DatasetInfo {
        // Count each bin once instead of scanning every row for every bin.
        fn bins(values: &[u16], names: &HashMap<u16, String>, pass: &[bool]) -> Vec<BinInfo> {
            let mut counts = HashMap::new();
            for code in values { *counts.entry(*code).or_insert(0usize) += 1; }
            for code in names.keys() { counts.entry(*code).or_insert(0); }
            let mut out: Vec<_> = counts.into_iter().map(|(code, count)| BinInfo {
                code, count,
                name: names.get(&code).cloned().unwrap_or_else(|| format!("Bin {code}")),
                pass: pass[code as usize] || (code == 1 && !names.contains_key(&code)),
            }).collect();
            out.sort_by_key(|b| b.code);
            out
        }
        let hbins = bins(&self.hbin, &self.hbin_names, &self.pass_hbin);
        let sbins = bins(&self.sbin, &self.sbin_names, &self.pass_sbin);

        DatasetInfo {
            files: self.files.clone(),
            lots: self.lots.clone(),
            wafers: self.wafers.clone(),
            tests: self.tests.clone(),
            rows: self.rows,
            sites: {
                let mut seen = [false; 256];
                for site in self.site.iter().flatten() { seen[*site as usize] = true; }
                let mut sites: Vec<u16> = seen.iter().enumerate().filter_map(|(site, used)| used.then_some(site as u16)).collect();
                if self.site.iter().any(Option::is_none) { sites.push(u16::MAX); }
                sites
            },
            retest_count: self.retest_count,
            hbins,
            sbins,
            custom_columns: self.custom_cols.clone(),
            memory_mb: self.memory_bytes() as f64 / (1024.0 * 1024.0),
        }
    }
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetInfo {
    pub sites: Vec<u16>,
    pub files: Vec<String>,
    pub lots: Vec<String>,
    pub wafers: Vec<WaferInfo>,
    pub tests: Vec<TestInfo>,
    pub rows: usize,
    pub retest_count: usize,
    pub hbins: Vec<BinInfo>,
    pub sbins: Vec<BinInfo>,
    pub custom_columns: Vec<CustomColumn>,
    pub memory_mb: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attempt(value: f32, bin: u16, number: u32, units: &str) -> Imported {
        let mut imp = Imported::new();
        let lot = imp.lot_index("L1");
        let wafer = imp.wafer_index(lot, "W1");
        let r = imp.new_row(lot, wafer);
        imp.x[r] = 2;
        imp.y[r] = 3;
        imp.hbin[r] = bin;
        let idx = imp.column((number, 0), r, value);
        imp.tests[idx].name = "Same name".into();
        imp.tests[idx].number = Some(number);
        imp.tests[idx].units = units.into();
        imp.finish()
    }

    #[test]
    fn last_attempt_replaces_complete_die_across_files() {
        let mut ds = Dataset::new();
        let mut first = attempt(10.0, 2, 100, "V"); first.site[0] = Some(0);
        let mut last = attempt(f32::NAN, 1, 100, "V"); last.site[0] = Some(3);
        ds.merge(first);
        ds.merge(last);
        ds.resolve_retests();
        assert_eq!(ds.rows, 1);
        assert_eq!(ds.retest_count, 1);
        assert_eq!(ds.hbin, vec![1]);
        assert_eq!(ds.site, vec![Some(3)], "site belongs to the latest attempt");
        assert!(ds.cols[0][0].is_nan(), "do not carry old values into a partial retest");
        assert_eq!(ds.tests[0].count, 0);
        ds.resolve_retests();
        assert_eq!(ds.retest_count, 1, "resolution is idempotent");
    }

    #[test]
    fn repeated_coordinates_on_different_wafers_are_not_retests() {
        let mut ds = Dataset::new();
        ds.merge(attempt(1.0, 1, 100, "V"));
        let mut other = attempt(2.0, 1, 100, "V");
        other.wafers[0].1 = "W2".into();
        ds.merge(other);
        ds.resolve_retests();
        assert_eq!(ds.rows, 2);
        assert_eq!(ds.retest_count, 0);
    }

    #[test]
    fn deferred_import_matches_eager_merge_after_finalization() {
        let mut eager = Dataset::new(); let mut deferred = Dataset::new();
        for name in ["W1", "W2", "W1"] {
            let make = || { let mut imp = attempt(3.0, 1, 100, "V"); imp.wafers[0].1 = name.into(); imp };
            eager.merge(make()); deferred.append_import(make());
        }
        eager.resolve_retests(); deferred.resolve_retests();
        assert_eq!(deferred.cols, eager.cols);
        let mut a = serde_json::to_value(eager.info()).unwrap();
        let mut b = serde_json::to_value(deferred.info()).unwrap();
        a.as_object_mut().unwrap().remove("memoryMb"); b.as_object_mut().unwrap().remove("memoryMb");
        assert_eq!(a, b);
    }

    #[test]
    fn test_identity_includes_number_and_units() {
        let mut ds = Dataset::new();
        ds.merge(attempt(1.0, 1, 100, "V"));
        ds.merge(attempt(2.0, 1, 101, "V"));
        ds.merge(attempt(3.0, 1, 100, "mV"));
        assert_eq!(ds.tests.len(), 3);
        assert_eq!(ds.cols[0][0], 1.0);
        assert_eq!(ds.cols[1][1], 2.0);
        assert_eq!(ds.cols[2][2], 3.0);
    }

    #[test]
    fn same_name_tests_with_different_numbers_survive_one_file() {
        let mut imp = attempt(1.0, 1, 100, "V");
        let idx = imp.column((101, 0), 0, 7.0);
        imp.tests[idx] = imp.tests[0].clone();
        imp.tests[idx].number = Some(101);
        let mut ds = Dataset::new();
        ds.merge(imp.finish());
        assert_eq!(ds.cols.len(), 2);
        assert_eq!(ds.cols[0][0], 1.0);
        assert_eq!(ds.cols[1][0], 7.0);
    }

    #[test]
    fn merge_remaps_imported_custom_columns() {
        let mut imp = Imported::new();
        let lot = imp.lot_index("L1");
        let w0 = imp.wafer_index(lot, "W01");
        let w1 = imp.wafer_index(lot, "W02");
        imp.new_row(lot, w0);
        imp.new_row(lot, w1);
        imp.custom_cols.push(CustomColumn {
            name: "Split".into(),
            categories: vec![String::new(), "A".into(), "B".into()],
            wafer_values: vec![1, 2],
        });

        let mut ds = Dataset::new();
        ds.merge(imp);
        assert_eq!(ds.wafers.len(), 2);
        assert_eq!(ds.custom_cols.len(), 1);
        let split = &ds.custom_cols[0];
        assert_eq!(split.name, "Split");
        assert_eq!(split.categories, vec!["", "A", "B"]);
        assert_eq!(split.wafer_values, vec![1, 2]);
    }

    #[test]
    fn merge_adds_labels_to_existing_column() {
        let mut imp = Imported::new();
        let lot = imp.lot_index("L1");
        let w0 = imp.wafer_index(lot, "W01");
        imp.new_row(lot, w0);
        imp.custom_cols.push(CustomColumn {
            name: "Split".into(),
            categories: vec![String::new(), "A".into()],
            wafer_values: vec![1],
        });

        let mut ds = Dataset::new();
        ds.custom_cols.push(CustomColumn {
            name: "Split".into(),
            categories: vec![String::new(), "B".into()],
            wafer_values: vec![],
        });
        ds.merge(imp);
        let split = &ds.custom_cols[0];
        assert_eq!(split.categories, vec!["", "B", "A"]);
        assert_eq!(split.wafer_values, vec![2]);
    }
}
