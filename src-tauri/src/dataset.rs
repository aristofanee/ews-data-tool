use crate::model::*;
use std::collections::HashMap;

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
    pub tests: Vec<TestInfo>,
    pub cols: Vec<Vec<f32>>,
    pub hbin_names: HashMap<u16, (String, bool)>,
    pub sbin_names: HashMap<u16, (String, bool)>,
    pub wafer_geom: Vec<(Option<f32>, Option<f32>, Option<f32>)>,
    pub records: u64,
    pub col_index: HashMap<(u32, u16), usize>,
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
            tests: Vec::new(),
            cols: Vec::new(),
            hbin_names: HashMap::new(),
            sbin_names: HashMap::new(),
            wafer_geom: Vec::new(),
            records: 0,
            col_index: HashMap::new(),
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
        self.wafer_geom.push((None, None, None));
        (self.wafers.len() - 1) as u16
    }

    pub fn new_row(&mut self, lot: u16, wafer: u16) -> usize {
        let r = self.row_lot.len();
        self.row_lot.push(lot);
        self.row_wafer.push(wafer);
        self.x.push(0);
        self.y.push(0);
        self.hbin.push(0);
        self.sbin.push(0);
        r
    }

    pub fn column(&mut self, key: (u32, u16), row: usize, value: f32) -> usize {
        let idx = if let Some(&i) = self.col_index.get(&key) {
            i
        } else {
            let i = self.cols.len();
            self.cols.push(Vec::new());
            self.tests.push(TestInfo::new(String::new()));
            self.col_index.insert(key, i);
            i
        };
        let col = &mut self.cols[idx];
        if col.len() < row {
            col.resize(row, NAN);
        }
        if col.len() == row {
            col.push(value);
        } else {
            col[row] = value;
        }
        idx
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
    pub fn merge(&mut self, imp: Imported) {
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
            if let Some(j) = self
                .wafers
                .iter()
                .position(|w| w.lot == glot && &w.name == name)
            {
                wafer_map.push(j as u16);
            } else {
                let geom = imp
                    .wafer_geom
                    .get(wi)
                    .copied()
                    .unwrap_or((None, None, None));
                self.wafers.push(WaferInfo {
                    lot: glot,
                    name: name.clone(),
                    dice: 0,
                    x_min: i16::MAX,
                    x_max: i16::MIN,
                    y_min: i16::MAX,
                    y_max: i16::MIN,
                    diameter_mm: geom.0,
                    die_w_mm: geom.1,
                    die_h_mm: geom.2,
                });
                wafer_map.push((self.wafers.len() - 1) as u16);
            }
        }

        // Test union by name.
        let mut test_map = Vec::with_capacity(imp.tests.len());
        for t in imp.tests.iter() {
            if let Some(i) = self.test_index(&t.name) {
                let dst = &mut self.tests[i];
                if dst.units.is_empty() && !t.units.is_empty() {
                    dst.units = t.units.clone();
                }
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
        self.recompute();
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
        let mut hbins: Vec<BinInfo> = self
            .hbin_names
            .iter()
            .map(|(code, name)| BinInfo {
                code: *code,
                name: name.clone(),
                count: self.hbin.iter().filter(|b| *b == code).count(),
                pass: self.pass_hbin[*code as usize],
            })
            .collect();
        hbins.sort_by_key(|b| b.code);
        // bins that are used but undefined
        let mut seen: Vec<u16> = Vec::new();
        for b in self.hbin.iter() {
            if !self.hbin_names.contains_key(b) && !seen.contains(b) {
                seen.push(*b);
            }
        }
        for code in seen {
            hbins.push(BinInfo {
                code,
                name: format!("Bin {code}"),
                count: self.hbin.iter().filter(|b| **b == code).count(),
                pass: code == 1,
            });
        }
        hbins.sort_by_key(|b| b.code);

        let mut sbins: Vec<BinInfo> = self
            .sbin_names
            .iter()
            .map(|(code, name)| BinInfo {
                code: *code,
                name: name.clone(),
                count: self.sbin.iter().filter(|b| *b == code).count(),
                pass: self.pass_sbin[*code as usize],
            })
            .collect();
        sbins.sort_by_key(|b| b.code);

        DatasetInfo {
            files: self.files.clone(),
            lots: self.lots.clone(),
            wafers: self.wafers.clone(),
            tests: self.tests.clone(),
            rows: self.rows,
            hbins,
            sbins,
            memory_mb: self.memory_bytes() as f64 / (1024.0 * 1024.0),
        }
    }
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetInfo {
    pub files: Vec<String>,
    pub lots: Vec<String>,
    pub wafers: Vec<WaferInfo>,
    pub tests: Vec<TestInfo>,
    pub rows: usize,
    pub hbins: Vec<BinInfo>,
    pub sbins: Vec<BinInfo>,
    pub memory_mb: f64,
}
