use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const NAN: f32 = f32::NAN;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestInfo {
    pub name: String,
    pub units: String,
    pub lo_limit: Option<f32>,
    pub hi_limit: Option<f32>,
    pub lo_spec: Option<f32>,
    pub hi_spec: Option<f32>,
    pub count: usize,
}

impl TestInfo {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            units: String::new(),
            lo_limit: None,
            hi_limit: None,
            lo_spec: None,
            hi_spec: None,
            count: 0,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaferInfo {
    pub lot: u16,
    pub name: String,
    pub dice: usize,
    pub x_min: i16,
    pub x_max: i16,
    pub y_min: i16,
    pub y_max: i16,
    pub diameter_mm: Option<f32>,
    pub die_w_mm: Option<f32>,
    pub die_h_mm: Option<f32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinInfo {
    pub code: u16,
    pub name: String,
    pub count: usize,
    pub pass: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Filter {
    pub lots: Vec<u16>,
    pub wafers: Vec<u16>,
    pub hbins: Vec<u16>,
    pub sbins: Vec<u16>,
    pub pass_only: bool,
    pub stat: Option<StatFilter>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StatKind {
    Sigma,
    Iqr,
    Percentile,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatFilter {
    pub kind: StatKind,
    pub k: f32,
    /// Apply the statistical filter independently per wafer (default) or on the whole selection.
    pub per_wafer: bool,
}

impl Default for StatFilter {
    fn default() -> Self {
        Self {
            kind: StatKind::Sigma,
            k: 3.0,
            per_wafer: true,
        }
    }
}

pub struct Dataset {
    pub files: Vec<String>,
    pub lots: Vec<String>,
    pub wafers: Vec<WaferInfo>,
    pub lot_of_row: Vec<u16>,
    pub wafer_of_row: Vec<u16>,
    pub x: Vec<i16>,
    pub y: Vec<i16>,
    pub hbin: Vec<u16>,
    pub sbin: Vec<u16>,
    pub tests: Vec<TestInfo>,
    /// One column per test, same length as `rows`.
    pub cols: Vec<Vec<f32>>,
    pub rows: usize,
    pub hbin_names: HashMap<u16, String>,
    pub sbin_names: HashMap<u16, String>,
    pub pass_hbin: Vec<bool>,
    pub pass_sbin: Vec<bool>,
}

impl Dataset {
    pub fn new() -> Self {
        Self {
            files: Vec::new(),
            lots: Vec::new(),
            wafers: Vec::new(),
            lot_of_row: Vec::new(),
            wafer_of_row: Vec::new(),
            x: Vec::new(),
            y: Vec::new(),
            hbin: Vec::new(),
            sbin: Vec::new(),
            tests: Vec::new(),
            cols: Vec::new(),
            rows: 0,
            hbin_names: HashMap::new(),
            sbin_names: HashMap::new(),
            pass_hbin: vec![false; 65536],
            pass_sbin: vec![false; 65536],
        }
    }

    pub fn test_index(&self, name: &str) -> Option<usize> {
        self.tests.iter().position(|t| t.name == name)
    }

    pub fn memory_bytes(&self) -> usize {
        let cols: usize = self.cols.iter().map(|c| c.capacity() * 4).sum();
        cols + self.rows * (2 + 2 + 2 + 2 + 2 + 2)
            + self.files.iter().map(|f| f.len()).sum::<usize>()
    }

    /// Rows that pass lot / wafer / bin filters.
    pub fn base_mask(&self, f: &Filter) -> Vec<bool> {
        let lot_ok = |l: u16| f.lots.is_empty() || f.lots.contains(&l);
        let wafer_ok = |w: u16| f.wafers.is_empty() || f.wafers.contains(&w);
        let hbin_ok = |b: u16| f.hbins.is_empty() || f.hbins.contains(&b);
        let sbin_ok = |b: u16| f.sbins.is_empty() || f.sbins.contains(&b);

        (0..self.rows)
            .map(|r| {
                lot_ok(self.lot_of_row[r])
                    && wafer_ok(self.wafer_of_row[r])
                    && hbin_ok(self.hbin[r])
                    && sbin_ok(self.sbin[r])
                    && (!f.pass_only || self.is_pass(self.hbin[r]))
            })
            .collect()
    }

    pub fn is_pass(&self, hbin: u16) -> bool {
        if self.pass_hbin[hbin as usize] {
            return true;
        }
        // fall back to the usual convention when no bin definitions were present
        if self.hbin_names.is_empty() {
            hbin == 1
        } else {
            false
        }
    }

    pub fn lot_name(&self, i: u16) -> &str {
        self.lots.get(i as usize).map(|s| s.as_str()).unwrap_or("?")
    }

    pub fn bin_name(&self, hard: bool, code: u16) -> String {
        let m = if hard { &self.hbin_names } else { &self.sbin_names };
        m.get(&code)
            .filter(|name| !name.is_empty())
            .cloned()
            .unwrap_or_else(|| format!("Bin {code}"))
    }
}
