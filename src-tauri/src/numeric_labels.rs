use crate::model::{CustomColumn, Dataset};
use std::collections::{HashMap, HashSet};

const MAX_CATEGORIES: usize = 512;
const SAMPLE_WAFERS: usize = 256;
const ROWS_PER_WAFER: usize = 16;

fn bits(value: f32) -> u32 { if value == 0.0 { 0 } else { value.to_bits() } }

/// Bounded, stratified sample: include both ends of the import and both ends of
/// each sampled wafer. Never assume that the first 200 dice represent all wafers.
pub(crate) fn sample_rows(ds: &Dataset) -> Vec<usize> {
    let mut counts = vec![0usize; ds.wafers.len()];
    for &wafer in &ds.wafer_of_row { counts[wafer as usize] += 1; }
    let active: Vec<_> = counts.iter().enumerate().filter_map(|(i, &n)| (n > 0).then_some(i)).collect();
    let n = active.len().min(SAMPLE_WAFERS);
    if n == 0 { return Vec::new(); }
    let mut selected = vec![false; counts.len()];
    for i in 0..n { selected[active[if n == 1 { 0 } else { i * (active.len() - 1) / (n - 1) }]] = true; }
    let mut seen = vec![0usize; counts.len()];
    let mut taken = vec![0usize; counts.len()];
    let mut rows = Vec::with_capacity(n * ROWS_PER_WAFER);
    for (row, &wafer) in ds.wafer_of_row.iter().enumerate() {
        let w = wafer as usize;
        if !selected[w] { continue; }
        let sample_count = counts[w].min(ROWS_PER_WAFER);
        let target = if sample_count == 1 { 0 } else { taken[w] * (counts[w] - 1) / (sample_count - 1) };
        if taken[w] < sample_count && seen[w] == target { rows.push(row); taken[w] += 1; }
        seen[w] += 1;
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{dataset::Imported, model::TestInfo};

    fn dataset(counts: &[usize], columns: Vec<(&str, &str, Vec<f32>)>) -> Dataset {
        let mut imp = Imported::new();
        let lot = imp.lot_index("L");
        for (i, &count) in counts.iter().enumerate() {
            let wafer = imp.wafer_index(lot, &format!("W{i}"));
            for x in 0..count { let row = imp.new_row(lot, wafer); imp.x[row] = x as i16; imp.y[row] = 0; }
        }
        for (i, (name, units, values)) in columns.into_iter().enumerate() {
            let mut test = TestInfo::new(name); test.units = units.into(); test.number = Some(1000 + i as u32);
            imp.tests.push(test); imp.cols.push(values);
        }
        let mut ds = Dataset::new(); ds.append_import(imp.finish()); ds.resolve_retests(); ds
    }

    #[test]
    fn numeric_labels_require_integer_unitless_diverse_wafer_constants() {
        let codes:Vec<_> = (0..600).map(|i| if i < 300 { 1.0 } else { 2.0 }).collect();
        let mut missing = codes.clone(); missing[0] = f32::NAN; missing[300] = f32::NAN;
        let mut conflict = codes.clone(); conflict[1] = 3.0;
        let mut late_float = codes.clone(); late_float[1] = 1.5;
        let mut infinity = codes.clone(); infinity[1] = f32::INFINITY;
        let mut ds = dataset(&[300,300],vec![
            ("Code","",missing), ("Has units","V",codes.clone()),
            ("Float","",codes.iter().map(|v|v+0.25).collect()),
            ("Constant","",vec![7.0;600]), ("Conflict","",conflict),
            ("Late fractional value","",late_float), ("Infinity","",infinity),
            ("Empty","",vec![f32::NAN;600]), ("Signed zero","",(0..600).map(|i|if i<300 {-0.0}else{0.0}).collect()),
        ]);
        let before:Vec<Vec<u32>> = ds.cols.iter().map(|col|col.iter().map(|v|v.to_bits()).collect()).collect();
        ds.detect_numeric_labels();
        assert_eq!(ds.custom_cols.len(),1);
        assert_eq!(ds.custom_cols[0].name,"Code");
        assert_eq!(ds.custom_cols[0].categories,vec!["","1","2"]);
        assert_eq!(ds.custom_cols[0].wafer_values,vec![1,2]);
        assert_eq!(ds.cols.iter().map(|col|col.iter().map(|v|v.to_bits()).collect::<Vec<_>>()).collect::<Vec<_>>(),before);
        assert_eq!(ds.tests.len(),9);
        ds.detect_numeric_labels();assert_eq!(ds.custom_cols.len(),1,"detection is idempotent");
    }

    #[test]
    fn too_many_categories_and_empty_wafers_are_handled_conservatively() {
        let mut ds=dataset(&vec![1;600],vec![("Identifier","",(0..600).map(|i|i as f32).collect())]);
        ds.detect_numeric_labels();assert!(ds.custom_cols.is_empty());
        let mut ds=dataset(&[2,2,2],vec![("Code","",vec![0.0,-0.0,2.0,2.0,f32::NAN,f32::NAN])]);
        ds.detect_numeric_labels();assert_eq!(ds.custom_cols[0].wafer_values,vec![1,2,0]);
        assert_eq!(ds.custom_cols[0].categories,vec!["","0","2"]);
    }

    #[test]
    fn detection_uses_the_latest_attempt_without_replacing_existing_labels() {
        let mut ds=dataset(&[2,2],vec![("Code","",vec![1.0,1.0,2.0,2.0])]);
        ds.set_custom_column("Code",&[(0,"Manual A".into()),(1,"Manual B".into())]).unwrap();
        ds.detect_numeric_labels();assert_eq!(ds.custom_cols.len(),1);assert_eq!(ds.custom_cols[0].label(1),"Manual A");
        ds.remove_custom_column("Code");
        let mut imp=Imported::new();let lot=imp.lot_index("L");let wafer=imp.wafer_index(lot,"W0");
        for x in 0..2 {let row=imp.new_row(lot,wafer);imp.x[row]=x;imp.y[row]=0;}
        imp.tests.push(ds.tests[0].clone());imp.cols.push(vec![3.0,3.0]);
        ds.append_import(imp.finish());ds.resolve_retests();ds.detect_numeric_labels();
        assert_eq!(ds.retest_count,2);assert_eq!(ds.custom_cols[0].categories,vec!["","2","3"]);
        assert_eq!(ds.custom_cols[0].wafer_values,vec![2,1]);
    }
}

impl Dataset {
    /// Add categorical views of integer-valued, unitless measurements. Keep every
    /// original test/value. Run once after all files are merged and retests resolved.
    pub fn detect_numeric_labels(&mut self) {
        if self.rows == 0 || self.wafers.len() < 2 { return; }
        let classified: HashSet<_> = self.numeric_label_sources.values().copied().collect();
        if !self.tests.iter().enumerate().any(|(i,t)|t.units.trim().is_empty()&&!classified.contains(&i)) { return; }
        let sample = sample_rows(self);
        let headers: HashSet<_> = self.tests.iter().map(|t| t.display_with_units()).collect();
        let mut names: HashSet<_> = self.custom_cols.iter().map(|c| c.name.clone()).collect();
        let mut base_counts = HashMap::new();
        for test in &self.tests { *base_counts.entry(test.name.split_whitespace().collect::<Vec<_>>().join(" ")).or_insert(0usize) += 1; }
        'column: for (index, test) in self.tests.iter().enumerate() {
            if !test.units.trim().is_empty() || classified.contains(&index) { continue; }
            let col = &self.cols[index];
            if col.len() != self.rows { continue; }
            let mut values = HashSet::new();
            let mut per_wafer = vec![None; self.wafers.len()];
            for &row in &sample {
                let value = col[row];
                if value.is_nan() { continue; }
                if !value.is_finite() || value.fract() != 0.0 { continue 'column; }
                let w = self.wafer_of_row[row] as usize;
                if per_wafer[w].is_some_and(|old| old != value) { continue 'column; }
                per_wafer[w] = Some(value);
                values.insert(bits(value));
                if values.len() > MAX_CATEGORIES { continue 'column; }
            }
            if values.len() < 2 { continue; }
            // Sampling proposes a candidate; the full source column must still
            // satisfy every rule, including late fractional/conflicting values.
            per_wafer.fill(None);
            values.clear();
            for (row, &value) in col.iter().enumerate() {
                if value.is_nan() { continue; }
                if !value.is_finite() || value.fract() != 0.0 { continue 'column; }
                let w = self.wafer_of_row[row] as usize;
                if per_wafer[w].is_some_and(|old| old != value) { continue 'column; }
                per_wafer[w] = Some(value);
                values.insert(bits(value));
                if values.len() > MAX_CATEGORIES { continue 'column; }
            }
            if values.len() < 2 { continue; }
            let base = test.name.split_whitespace().collect::<Vec<_>>().join(" ");
            if names.contains(&base) { continue; } // Preserve explicit/manual labels.
            let mut name = if base.is_empty() || base_counts.get(&base).copied().unwrap_or(0) > 1 { test.display_name() } else { base };
            if headers.contains(&name) || matches!(name.to_lowercase().as_str(), "lot" | "wafer" | "site" | "hbin" | "sbin" | "__wafer") { name.push_str(" label"); }
            let preferred = name.clone();
            let mut suffix = 2;
            while names.contains(&name) || headers.contains(&name) { name = format!("{preferred} {suffix}"); suffix += 1; }
            let mut distinct: Vec<f32> = values.into_iter().map(f32::from_bits).collect();
            distinct.sort_by(f32::total_cmp);
            let codes: HashMap<_, _> = distinct.iter().enumerate().map(|(i, &v)| (bits(v), (i + 1) as u16)).collect();
            let mut categories = vec![String::new()];
            categories.extend(distinct.iter().map(|&v| if v == 0.0 { "0".into() } else { v.to_string() }));
            let wafer_values = per_wafer.into_iter().map(|v| v.map(|v| codes[&bits(v)]).unwrap_or(0)).collect();
            names.insert(name.clone());
            self.numeric_label_sources.insert(name.clone(), index);
            self.custom_cols.push(CustomColumn {name, categories, wafer_values});
        }
    }
}
