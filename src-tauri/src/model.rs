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

/// A user-defined categorical column. One label per wafer (code 0 means
/// "unassigned"). Storing wafer-level codes instead of per-die strings keeps
/// the wide dataset compact even for millions of rows.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomColumn {
    pub name: String,
    /// Index 0 is reserved for the empty/unassigned label.
    pub categories: Vec<String>,
    /// One category code per wafer; 0 = unassigned.
    pub wafer_values: Vec<u16>,
}

impl CustomColumn {
    pub fn label(&self, code: u16) -> String {
        self.categories
            .get(code as usize)
            .filter(|s| !s.is_empty())
            .cloned()
            .unwrap_or_else(|| "Unassigned".to_string())
    }
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
    pub custom_cols: Vec<CustomColumn>,
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
            custom_cols: Vec::new(),
        }
    }

    pub fn test_index(&self, name: &str) -> Option<usize> {
        self.tests.iter().position(|t| t.name == name)
    }

    pub fn custom_column(&self, name: &str) -> Option<&CustomColumn> {
        self.custom_cols.iter().find(|c| c.name == name)
    }

    pub fn memory_bytes(&self) -> usize {
        let cols: usize = self.cols.iter().map(|c| c.capacity() * 4).sum();
        let custom: usize = self
            .custom_cols
            .iter()
            .map(|c| {
                c.name.len()
                    + c.categories.iter().map(|s| s.len() + 2).sum::<usize>()
                    + c.wafer_values.capacity() * 2
            })
            .sum();
        cols + self.rows * (2 + 2 + 2 + 2 + 2 + 2)
            + self.files.iter().map(|f| f.len()).sum::<usize>()
            + custom
    }

    /// Merge labels into a custom column (or create it). Labels are applied at
    /// wafer level; an empty label clears the assignment for that wafer.
    pub fn set_custom_column(
        &mut self,
        name: &str,
        assignments: &[(u16, String)],
    ) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("Enter a column name.".into());
        }
        let reserved = ["lot", "wafer", "hbin", "sbin", "__wafer"];
        if reserved.iter().any(|r| r.eq_ignore_ascii_case(name)) {
            return Err(format!("“{name}” is a reserved column name."));
        }

        let (idx, created) = match self.custom_cols.iter().position(|c| c.name == name) {
            Some(i) => (i, false),
            None => {
                self.custom_cols.push(CustomColumn {
                    name: name.to_string(),
                    categories: vec![String::new()],
                    wafer_values: vec![0; self.wafers.len()],
                });
                (self.custom_cols.len() - 1, true)
            }
        };

        // Grow defensively if the dataset gained wafers since the column was created.
        if self.custom_cols[idx].wafer_values.len() < self.wafers.len() {
            self.custom_cols[idx]
                .wafer_values
                .resize(self.wafers.len(), 0);
        }

        for (wi, label) in assignments {
            let wi = *wi as usize;
            if wi >= self.custom_cols[idx].wafer_values.len() {
                continue;
            }
            let label = label.trim();
            if label.is_empty() {
                self.custom_cols[idx].wafer_values[wi] = 0;
                continue;
            }
            let code = match self.custom_cols[idx]
                .categories
                .iter()
                .position(|c| c == label)
            {
                Some(i) => i as u16,
                None => {
                    if self.custom_cols[idx].categories.len() >= u16::MAX as usize {
                        return Err("Too many labels in this column.".into());
                    }
                    self.custom_cols[idx].categories.push(label.to_string());
                    (self.custom_cols[idx].categories.len() - 1) as u16
                }
            };
            self.custom_cols[idx].wafer_values[wi] = code;
        }

        if self.custom_cols[idx].categories.len() <= 1 {
            if created {
                // Do not leave a label-less column behind when a create request
                // contained only blank assignments.
                self.custom_cols.remove(idx);
            }
            return Err("Assign at least one wafer label.".into());
        }
        Ok(())
    }

    pub fn remove_custom_column(&mut self, name: &str) -> bool {
        let before = self.custom_cols.len();
        self.custom_cols.retain(|c| c.name != name);
        before != self.custom_cols.len()
    }

    pub fn restore_custom_columns(&mut self, columns: Vec<CustomColumn>) -> Result<(), String> {
        for c in &columns {
            if c.name.trim().is_empty() {
                return Err("A custom column has an empty name.".into());
            }
            if c.wafer_values.len() != self.wafers.len() {
                return Err(format!(
                    "Column “{}” has {} wafer labels but the dataset has {} wafers.",
                    c.name,
                    c.wafer_values.len(),
                    self.wafers.len()
                ));
            }
        }
        self.custom_cols = columns;
        Ok(())
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
