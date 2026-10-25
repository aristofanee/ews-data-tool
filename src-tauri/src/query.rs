use crate::model::*;
use crate::stats::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GroupBy {
    Wafer,
    Lot,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MapMode {
    Value,
    Bin,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BinCategory {
    Hard,
    Soft,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoxRequest {
    pub test: usize,
    pub group_by: GroupBy,
    #[serde(default)]
    pub filter: Filter,
    pub max_points: Option<usize>,
    /// `None`/empty means colour by lot. `__wafer` colours by wafer; any other
    /// value names a custom categorical column (for example `Split`).
    pub block_col: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoxGroup {
    pub key: u16,
    pub label: String,
    pub values: Vec<f32>,
    pub xs: Vec<i16>,
    pub ys: Vec<i16>,
    pub n: usize,
    pub block: String,
    pub block_code: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoxResponse {
    pub groups: Vec<BoxGroup>,
    pub summary: Summary,
    pub test: TestInfo,
    pub lsl: Option<f32>,
    pub usl: Option<f32>,
    pub cp: Option<f32>,
    pub cpk: Option<f32>,
    pub excluded: usize,
    pub truncated: bool,
}

pub fn box_plot(ds: &Dataset, req: &BoxRequest) -> BoxResponse {
    let test = ds
        .tests
        .get(req.test)
        .cloned()
        .unwrap_or_else(|| TestInfo::new("?"));
    if req.test >= ds.cols.len() || ds.cols[req.test].is_empty() {
        return BoxResponse {
            groups: Vec::new(),
            summary: Summary::default(),
            test,
            lsl: None,
            usl: None,
            cp: None,
            cpk: None,
            excluded: 0,
            truncated: false,
        };
    }
    let mask = ds.base_mask(&req.filter);
    let col = &ds.cols[req.test];
    let multi_lot = ds.lots.len() > 1;

    let mut buckets: HashMap<u16, Vec<(f32, i16, i16)>> = HashMap::new();
    for r in 0..ds.rows {
        if !mask[r] {
            continue;
        }
        let v = col[r];
        if !v.is_finite() {
            continue;
        }
        let key = match req.group_by {
            GroupBy::Wafer => ds.wafer_of_row[r],
            GroupBy::Lot => ds.lot_of_row[r],
        };
        buckets.entry(key).or_default().push((v, ds.x[r], ds.y[r]));
    }

    let mut keys: Vec<u16> = buckets.keys().copied().collect();
    keys.sort_by(|a, b| {
        let la = label(ds, req.group_by, *a, multi_lot);
        let lb = label(ds, req.group_by, *b, multi_lot);
        natural_cmp(&la, &lb)
    });

    let cap = req.max_points.unwrap_or(400_000);
    let total: usize = buckets.values().map(|v| v.len()).sum();
    let stride = if total > cap {
        ((total as f64 / cap as f64).ceil() as usize).max(1)
    } else {
        1
    };

    let mut excluded = 0usize;
    let mut all: Vec<f32> = Vec::new();
    let mut groups = Vec::new();
    for k in keys {
        let mut vals = buckets.remove(&k).unwrap_or_default();
        if let Some(sf) = &req.filter.stat {
            if sf.per_wafer {
                let plain: Vec<f32> = vals.iter().map(|v| v.0).collect();
                let keep = keep_mask(&plain, sf);
                let before = vals.len();
                vals = vals
                    .into_iter()
                    .zip(keep)
                    .filter_map(|(v, k)| if k { Some(v) } else { None })
                    .collect();
                excluded += before - vals.len();
            }
        }
        let n = vals.len();
        let mut values = Vec::with_capacity(n / stride + 1);
        let mut xs = Vec::with_capacity(n / stride + 1);
        let mut ys = Vec::with_capacity(n / stride + 1);
        for (i, (v, x, y)) in vals.iter().enumerate() {
            if i % stride == 0 {
                values.push(*v);
                xs.push(*x);
                ys.push(*y);
                all.push(*v);
            }
        }
        let (block_code, block) =
            block_for(ds, req.group_by, k, multi_lot, req.block_col.as_deref());
        groups.push(BoxGroup {
            key: k,
            label: label(ds, req.group_by, k, multi_lot),
            n,
            values,
            xs,
            ys,
            block,
            block_code,
        });
    }

    if let Some(sf) = &req.filter.stat {
        if !sf.per_wafer {
            let keep = keep_mask(&all, sf);
            excluded = all.len() - keep.iter().filter(|k| **k).count();
            let mut idx = 0usize;
            for g in groups.iter_mut() {
                let mut nv = Vec::new();
                let mut nx = Vec::new();
                let mut ny = Vec::new();
                for i in 0..g.values.len() {
                    if keep[idx] {
                        nv.push(g.values[i]);
                        nx.push(g.xs[i]);
                        ny.push(g.ys[i]);
                    }
                    idx += 1;
                }
                g.values = nv;
                g.xs = nx;
                g.ys = ny;
            }
            all = all
                .into_iter()
                .zip(keep)
                .filter_map(|(v, k)| if k { Some(v) } else { None })
                .collect();
        }
    }

    let summary = summarize(&all);
    let (cp, cpk) = cp_cpk(&all, test.lo_spec, test.hi_spec);
    BoxResponse {
        groups,
        summary,
        lsl: test.lo_spec,
        usl: test.hi_spec,
        cp,
        cpk,
        excluded,
        truncated: stride > 1,
        test,
    }
}

fn label(ds: &Dataset, by: GroupBy, key: u16, multi_lot: bool) -> String {
    match by {
        GroupBy::Wafer => {
            if let Some(w) = ds.wafers.get(key as usize) {
                if multi_lot {
                    format!("{} / {}", ds.lot_name(w.lot), w.name)
                } else {
                    w.name.clone()
                }
            } else {
                format!("W{key}")
            }
        }
        GroupBy::Lot => ds.lot_name(key).to_string(),
    }
}

fn custom_label(col: &CustomColumn, code: u16) -> String {
    col.categories
        .get(code as usize)
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| "Unassigned".to_string())
}

/// Resolve the block/colour label for a box group. The default is the lot;
/// custom columns are stored per wafer, so lot-level groups may be "Mixed".
fn block_for(
    ds: &Dataset,
    by: GroupBy,
    key: u16,
    multi_lot: bool,
    block_col: Option<&str>,
) -> (u16, String) {
    let fallback = || {
        let code = match by {
            GroupBy::Wafer => ds
                .wafers
                .get(key as usize)
                .map(|w| w.lot)
                .unwrap_or(0),
            GroupBy::Lot => key,
        };
        (code, ds.lot_name(code).to_string())
    };

    let name = match block_col {
        Some(s) if !s.is_empty() => s,
        _ => return fallback(),
    };
    if name == "__wafer" {
        let code = key;
        let text = match by {
            GroupBy::Wafer => label(ds, GroupBy::Wafer, key, multi_lot),
            GroupBy::Lot => ds.lot_name(key).to_string(),
        };
        return (code, text);
    }
    let Some(col) = ds.custom_column(name) else {
        return fallback();
    };
    match by {
        GroupBy::Wafer => {
            let code = col.wafer_values.get(key as usize).copied().unwrap_or(0);
            (code, custom_label(col, code))
        }
        GroupBy::Lot => {
            let mut codes: Vec<u16> = Vec::new();
            for (wi, w) in ds.wafers.iter().enumerate() {
                if w.lot == key {
                    let code = col.wafer_values.get(wi).copied().unwrap_or(0);
                    if !codes.contains(&code) {
                        codes.push(code);
                    }
                }
            }
            match codes.as_slice() {
                [] => (0, "Unassigned".to_string()),
                [code] => (*code, custom_label(col, *code)),
                _ => (0, "Mixed".to_string()),
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapRequest {
    pub wafer: u16,
    pub test: Option<usize>,
    pub mode: MapMode,
    #[serde(default)]
    pub filter: Filter,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapDie {
    pub x: i16,
    pub y: i16,
    pub v: f32,
    pub hbin: u16,
    pub sbin: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapResponse {
    pub wafer: Option<WaferInfo>,
    pub lot_name: String,
    pub dice: Vec<MapDie>,
    pub test: Option<TestInfo>,
    pub lsl: Option<f32>,
    pub usl: Option<f32>,
    pub vmin: f32,
    pub vmax: f32,
    pub pass: usize,
    pub fail: usize,
    pub yield_pct: f32,
}

pub fn wafer_map(ds: &Dataset, req: &MapRequest) -> MapResponse {
    let w = ds.wafers.get(req.wafer as usize).cloned();
    let test = req
        .test
        .and_then(|t| ds.tests.get(t).cloned());
    if w.is_none() {
        return MapResponse {
            wafer: None,
            lot_name: String::new(),
            dice: Vec::new(),
            test,
            lsl: None,
            usl: None,
            vmin: f32::NAN,
            vmax: f32::NAN,
            pass: 0,
            fail: 0,
            yield_pct: 0.0,
        };
    }
    let mask = ds.base_mask(&req.filter);
    let mut dice = Vec::new();
    let mut pass = 0usize;
    let mut fail = 0usize;
    let mut vmin = f32::INFINITY;
    let mut vmax = f32::NEG_INFINITY;
    for r in 0..ds.rows {
        if ds.wafer_of_row[r] != req.wafer || !mask[r] {
            continue;
        }
        let v = match req.mode {
            MapMode::Value => req
                .test
                .and_then(|t| ds.cols.get(t))
                .and_then(|c| c.get(r))
                .copied()
                .unwrap_or(f32::NAN),
            MapMode::Bin => ds.hbin[r] as f32,
        };
        if req.mode == MapMode::Value && v.is_finite() {
            vmin = vmin.min(v);
            vmax = vmax.max(v);
        }
        if ds.is_pass(ds.hbin[r]) {
            pass += 1;
        } else {
            fail += 1;
        }
        dice.push(MapDie {
            x: ds.x[r],
            y: ds.y[r],
            v,
            hbin: ds.hbin[r],
            sbin: ds.sbin[r],
        });
    }
    if !vmin.is_finite() {
        vmin = f32::NAN;
        vmax = f32::NAN;
    }
    let tested = pass + fail;
    let lsl = test.as_ref().and_then(|t| t.lo_spec);
    let usl = test.as_ref().and_then(|t| t.hi_spec);
    MapResponse {
        lot_name: w.as_ref().map(|w| ds.lot_name(w.lot).to_string()).unwrap_or_default(),
        wafer: w,
        dice,
        test,
        lsl,
        usl,
        vmin,
        vmax,
        pass,
        fail,
        yield_pct: if tested > 0 {
            pass as f32 * 100.0 / tested as f32
        } else {
            0.0
        },
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParetoRequest {
    pub category: BinCategory,
    #[serde(default)]
    pub filter: Filter,
    pub top: Option<usize>,
    /// Include the pass bin (bin 1) in the chart. Defaults to false: a Pareto
    /// of failures only is far more informative than one dominated by yield.
    #[serde(default)]
    pub include_pass: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParetoBar {
    pub code: u16,
    pub name: String,
    pub count: usize,
    pub pct: f32,
    pub cum_pct: f32,
    pub pass: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParetoResponse {
    pub bars: Vec<ParetoBar>,
    pub total: usize,
    pub fail_total: usize,
}

pub fn pareto(ds: &Dataset, req: &ParetoRequest) -> ParetoResponse {
    let mask = ds.base_mask(&req.filter);
    let codes = match req.category {
        BinCategory::Hard => &ds.hbin,
        BinCategory::Soft => &ds.sbin,
    };
    let is_pass = |code: u16| match req.category {
        BinCategory::Hard => ds.pass_hbin[code as usize] || (code == 1 && ds.hbin_names.is_empty()),
        BinCategory::Soft => ds.pass_sbin[code as usize] || (code == 1 && ds.sbin_names.is_empty()),
    };
    let mut counts: HashMap<u16, usize> = HashMap::new();
    let mut total = 0usize;
    let mut fail_total = 0usize;
    for r in 0..ds.rows {
        if !mask[r] {
            continue;
        }
        let code = codes[r];
        if !is_pass(code) {
            fail_total += 1;
        }
        if !req.include_pass && is_pass(code) {
            continue;
        }
        total += 1;
        *counts.entry(code).or_insert(0) += 1;
    }
    let mut bars: Vec<(u16, usize)> = counts.into_iter().collect();
    bars.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

    let top = req.top.unwrap_or(25).max(1);
    let mut out = Vec::new();
    let mut cum = 0usize;
    let mut others = 0usize;
    for (i, (code, count)) in bars.iter().enumerate() {
        if i >= top {
            others += count;
            continue;
        }
        cum += count;
        out.push(ParetoBar {
            code: *code,
            name: match req.category {
                BinCategory::Hard => ds.bin_name(true, *code),
                BinCategory::Soft => ds.bin_name(false, *code),
            },
            count: *count,
            pct: if total > 0 {
                *count as f32 * 100.0 / total as f32
            } else {
                0.0
            },
            cum_pct: if total > 0 {
                cum as f32 * 100.0 / total as f32
            } else {
                0.0
            },
            pass: is_pass(*code),
        });
    }
    if others > 0 {
        out.push(ParetoBar {
            code: 0xFFFF,
            name: "Others".to_string(),
            count: others,
            pct: if total > 0 {
                others as f32 * 100.0 / total as f32
            } else {
                0.0
            },
            cum_pct: 100.0,
            pass: false,
        });
    }
    ParetoResponse {
        bars: out,
        total,
        fail_total,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistRequest {
    pub test: usize,
    #[serde(default)]
    pub filter: Filter,
    pub bins: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistResponse {
    pub edges: Vec<f32>,
    pub counts: Vec<u32>,
    pub summary: Summary,
    pub test: TestInfo,
    pub lsl: Option<f32>,
    pub usl: Option<f32>,
    pub excluded: usize,
}

pub fn histogram(ds: &Dataset, req: &HistRequest) -> HistResponse {
    let test = ds
        .tests
        .get(req.test)
        .cloned()
        .unwrap_or_else(|| TestInfo::new("?"));
    if req.test >= ds.cols.len() || ds.cols[req.test].is_empty() {
        return HistResponse {
            edges: Vec::new(),
            counts: Vec::new(),
            summary: Summary::default(),
            test,
            lsl: None,
            usl: None,
            excluded: 0,
        };
    }
    let mask = ds.base_mask(&req.filter);
    let col = &ds.cols[req.test];
    let mut vals: Vec<f32> = Vec::new();
    for r in 0..ds.rows {
        if mask[r] && col[r].is_finite() {
            vals.push(col[r]);
        }
    }
    let before = vals.len();
    if let Some(sf) = &req.filter.stat {
        let keep = keep_mask(&vals, sf);
        vals = vals
            .into_iter()
            .zip(keep)
            .filter_map(|(v, k)| if k { Some(v) } else { None })
            .collect();
    }
    let excluded = before - vals.len();
    let summary = summarize(&vals);
    if vals.is_empty() {
        return HistResponse {
            edges: Vec::new(),
            counts: Vec::new(),
            summary,
            test,
            lsl: None,
            usl: None,
            excluded,
        };
    }
    let (lo, hi) = (summary.min, summary.max);
    let n_bins = req.bins.unwrap_or_else(|| {
        let n = vals.len() as f64;
        let iqr = (summary.q3 - summary.q1) as f64;
        if iqr > 0.0 && n > 0.0 {
            let w = 2.0 * iqr / n.cbrt();
            if w > 0.0 {
                let b = ((hi - lo) as f64 / w).ceil() as usize;
                return b.clamp(8, 120);
            }
        }
        (n.sqrt() as usize).clamp(8, 80)
    });
    let n_bins = n_bins.max(1);
    let width = if hi > lo {
        (hi - lo) / n_bins as f32
    } else {
        1.0
    };
    let mut edges = Vec::with_capacity(n_bins + 1);
    for i in 0..=n_bins {
        edges.push(lo + width * i as f32);
    }
    let mut counts = vec![0u32; n_bins];
    for v in vals.iter() {
        let mut idx = ((*v - lo) / width) as usize;
        if idx >= n_bins {
            idx = n_bins - 1;
        }
        counts[idx] += 1;
    }
    HistResponse {
        edges,
        counts,
        summary,
        lsl: test.lo_spec,
        usl: test.hi_spec,
        test,
        excluded,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendRequest {
    pub test: usize,
    pub by: GroupBy,
    #[serde(default)]
    pub filter: Filter,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendPoint {
    pub label: String,
    pub mean: f32,
    pub min: f32,
    pub max: f32,
    pub sd: f32,
    pub n: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendResponse {
    pub points: Vec<TrendPoint>,
    pub test: TestInfo,
    pub lsl: Option<f32>,
    pub usl: Option<f32>,
}

pub fn trend(ds: &Dataset, req: &TrendRequest) -> TrendResponse {
    let test = ds
        .tests
        .get(req.test)
        .cloned()
        .unwrap_or_else(|| TestInfo::new("?"));
    if req.test >= ds.cols.len() || ds.cols[req.test].is_empty() {
        return TrendResponse {
            points: Vec::new(),
            test,
            lsl: None,
            usl: None,
        };
    }
    let mask = ds.base_mask(&req.filter);
    let col = &ds.cols[req.test];
    let multi_lot = ds.lots.len() > 1;
    let mut buckets: HashMap<u16, Vec<f32>> = HashMap::new();
    for r in 0..ds.rows {
        if !mask[r] || !col[r].is_finite() {
            continue;
        }
        let key = match req.by {
            GroupBy::Wafer => ds.wafer_of_row[r],
            GroupBy::Lot => ds.lot_of_row[r],
        };
        buckets.entry(key).or_default().push(col[r]);
    }
    let mut keys: Vec<u16> = buckets.keys().copied().collect();
    keys.sort_by(|a, b| {
        let la = label(ds, req.by, *a, multi_lot);
        let lb = label(ds, req.by, *b, multi_lot);
        natural_cmp(&la, &lb)
    });
    let mut points = Vec::new();
    for k in keys {
        let v = buckets.remove(&k).unwrap_or_default();
        let m = mean(&v);
        let sd = std_dev(&v, m);
        points.push(TrendPoint {
            label: label(ds, req.by, k, multi_lot),
            mean: m,
            min: v.iter().copied().fold(f32::INFINITY, f32::min),
            max: v.iter().copied().fold(f32::NEG_INFINITY, f32::max),
            sd,
            n: v.len(),
        });
    }
    TrendResponse {
        points,
        lsl: test.lo_spec,
        usl: test.hi_spec,
        test,
    }
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScatterZMode {
    #[default]
    None,
    Continuous,
    Category,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScatterRequest {
    pub x_test: usize,
    pub y_test: usize,
    #[serde(default)]
    pub z_mode: ScatterZMode,
    pub z_test: Option<usize>,
    pub z_col: Option<String>,
    #[serde(default)]
    pub filter: Filter,
    pub max_points: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScatterPoint {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub lot: u16,
    pub wafer: u16,
    pub hbin: u16,
    pub sbin: u16,
    pub x_die: i16,
    pub y_die: i16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScatterSeries {
    pub key: u16,
    pub name: String,
    pub points: Vec<ScatterPoint>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScatterResponse {
    pub series: Vec<ScatterSeries>,
    pub x_test: TestInfo,
    pub y_test: TestInfo,
    pub z_test: Option<TestInfo>,
    pub z_mode: ScatterZMode,
    pub z_col: Option<String>,
    pub z_col_label: String,
    pub z_min: f32,
    pub z_max: f32,
    pub total: usize,
    pub excluded: usize,
    pub truncated: bool,
    pub r: f32,
    pub lots: Vec<String>,
    pub wafers: Vec<String>,
}

fn pearson(x: &[f32], y: &[f32]) -> f32 {
    let n = x.len().min(y.len());
    if n < 2 {
        return f32::NAN;
    }
    let mut sx = 0.0f64;
    let mut sy = 0.0f64;
    for i in 0..n {
        sx += x[i] as f64;
        sy += y[i] as f64;
    }
    let mx = sx / n as f64;
    let my = sy / n as f64;
    let mut sxy = 0.0f64;
    let mut sxx = 0.0f64;
    let mut syy = 0.0f64;
    for i in 0..n {
        let dx = x[i] as f64 - mx;
        let dy = y[i] as f64 - my;
        sxy += dx * dy;
        sxx += dx * dx;
        syy += dy * dy;
    }
    if sxx <= 0.0 || syy <= 0.0 {
        return f32::NAN;
    }
    (sxy / (sxx * syy).sqrt()) as f32
}

fn scatter_category(ds: &Dataset, col: &str, row: usize, multi_lot: bool) -> (u16, String) {
    match col {
        "wafer" => {
            let wi = ds.wafer_of_row[row];
            (wi, label(ds, GroupBy::Wafer, wi, multi_lot))
        }
        "hbin" => {
            let code = ds.hbin[row];
            (code, ds.bin_name(true, code))
        }
        "sbin" => {
            let code = ds.sbin[row];
            (code, ds.bin_name(false, code))
        }
        "lot" | "" => {
            let li = ds.lot_of_row[row];
            (li, ds.lot_name(li).to_string())
        }
        other => {
            if let Some(cc) = ds.custom_column(other) {
                let wi = ds.wafer_of_row[row];
                let code = cc.wafer_values.get(wi as usize).copied().unwrap_or(0);
                (code, custom_label(cc, code))
            } else {
                let li = ds.lot_of_row[row];
                (li, ds.lot_name(li).to_string())
            }
        }
    }
}

fn scatter_col_label(ds: &Dataset, col: &str) -> String {
    match col {
        "lot" | "" => "Lot".to_string(),
        "wafer" => "Wafer ID (OCR)".to_string(),
        "hbin" => "Hard bin".to_string(),
        "sbin" => "Soft bin".to_string(),
        other => ds
            .custom_column(other)
            .map(|c| c.name.clone())
            .unwrap_or_else(|| "Lot".to_string()),
    }
}

pub fn scatter(ds: &Dataset, req: &ScatterRequest) -> ScatterResponse {
    let x_test = ds
        .tests
        .get(req.x_test)
        .cloned()
        .unwrap_or_else(|| TestInfo::new("?"));
    let y_test = ds
        .tests
        .get(req.y_test)
        .cloned()
        .unwrap_or_else(|| TestInfo::new("?"));
    let empty = || ScatterResponse {
        series: Vec::new(),
        x_test: x_test.clone(),
        y_test: y_test.clone(),
        z_test: req.z_test.and_then(|i| ds.tests.get(i).cloned()),
        z_mode: req.z_mode,
        z_col: req.z_col.clone(),
        z_col_label: req
            .z_col
            .as_deref()
            .map(|c| scatter_col_label(ds, c))
            .unwrap_or_default(),
        z_min: f32::NAN,
        z_max: f32::NAN,
        total: 0,
        excluded: 0,
        truncated: false,
        r: f32::NAN,
        lots: ds.lots.clone(),
        wafers: (0..ds.wafers.len())
            .map(|i| label(ds, GroupBy::Wafer, i as u16, ds.lots.len() > 1))
            .collect(),
    };

    if req.x_test >= ds.cols.len()
        || req.y_test >= ds.cols.len()
        || ds.cols[req.x_test].is_empty()
        || ds.cols[req.y_test].is_empty()
    {
        return empty();
    }
    let mask = ds.base_mask(&req.filter);
    let xcol = &ds.cols[req.x_test];
    let ycol = &ds.cols[req.y_test];
    let mut candidates: Vec<usize> = Vec::new();
    for r in 0..ds.rows {
        if mask[r] && xcol[r].is_finite() && ycol[r].is_finite() {
            candidates.push(r);
        }
    }

    let mut kept: Vec<usize> = Vec::new();
    let mut excluded = 0usize;
    if let Some(sf) = &req.filter.stat {
        if sf.per_wafer {
            let mut by_wafer: HashMap<u16, Vec<usize>> = HashMap::new();
            for r in &candidates {
                by_wafer.entry(ds.wafer_of_row[*r]).or_default().push(*r);
            }
            for (_, idxs) in by_wafer {
                let xv: Vec<f32> = idxs.iter().map(|r| xcol[*r]).collect();
                let yv: Vec<f32> = idxs.iter().map(|r| ycol[*r]).collect();
                let kx = keep_mask(&xv, sf);
                let ky = keep_mask(&yv, sf);
                for (j, r) in idxs.iter().enumerate() {
                    if kx[j] && ky[j] {
                        kept.push(*r);
                    } else {
                        excluded += 1;
                    }
                }
            }
            kept.sort_unstable();
        } else {
            let xv: Vec<f32> = candidates.iter().map(|r| xcol[*r]).collect();
            let yv: Vec<f32> = candidates.iter().map(|r| ycol[*r]).collect();
            let kx = keep_mask(&xv, sf);
            let ky = keep_mask(&yv, sf);
            for (j, r) in candidates.iter().enumerate() {
                if kx[j] && ky[j] {
                    kept.push(*r);
                } else {
                    excluded += 1;
                }
            }
        }
    } else {
        kept = candidates;
    }

    let total = kept.len();
    let cap = req.max_points.unwrap_or(30_000).max(1);
    let stride = if total > cap {
        ((total as f64 / cap as f64).ceil() as usize).max(1)
    } else {
        1
    };
    let sampled: Vec<usize> = kept.iter().step_by(stride).copied().collect();
    let truncated = stride > 1;

    let kept_x: Vec<f32> = kept.iter().map(|r| xcol[*r]).collect();
    let kept_y: Vec<f32> = kept.iter().map(|r| ycol[*r]).collect();
    let r = pearson(&kept_x, &kept_y);

    let multi_lot = ds.lots.len() > 1;
    let zcol = match req.z_mode {
        ScatterZMode::Continuous => req
            .z_test
            .and_then(|i| ds.cols.get(i))
            .filter(|c| !c.is_empty()),
        _ => None,
    };
    let z_test = match req.z_mode {
        ScatterZMode::Continuous => req.z_test.and_then(|i| ds.tests.get(i).cloned()),
        _ => None,
    };
    let z_col_label = match req.z_mode {
        ScatterZMode::Continuous => z_test
            .as_ref()
            .map(|t| t.name.clone())
            .unwrap_or_else(|| "Z".to_string()),
        ScatterZMode::Category => req
            .z_col
            .as_deref()
            .map(|c| scatter_col_label(ds, c))
            .unwrap_or_else(|| "Lot".to_string()),
        ScatterZMode::None => String::new(),
    };

    let mut z_min = f32::INFINITY;
    let mut z_max = f32::NEG_INFINITY;
    let mut series_map: HashMap<u16, ScatterSeries> = HashMap::new();
    let mut ordered_points: Vec<ScatterPoint> = Vec::with_capacity(sampled.len());

    for r in sampled {
        let z = match (&req.z_mode, zcol) {
            (ScatterZMode::Continuous, Some(col)) => {
                let v = col.get(r).copied().unwrap_or(f32::NAN);
                if v.is_finite() {
                    z_min = z_min.min(v);
                    z_max = z_max.max(v);
                }
                v
            }
            _ => f32::NAN,
        };
        let p = ScatterPoint {
            x: xcol[r],
            y: ycol[r],
            z,
            lot: ds.lot_of_row[r],
            wafer: ds.wafer_of_row[r],
            hbin: ds.hbin[r],
            sbin: ds.sbin[r],
            x_die: ds.x[r],
            y_die: ds.y[r],
        };
        if req.z_mode == ScatterZMode::Category {
            let (key, name) = scatter_category(
                ds,
                req.z_col.as_deref().unwrap_or("lot"),
                r,
                multi_lot,
            );
            let entry = series_map.entry(key).or_insert_with(|| ScatterSeries {
                key,
                name,
                points: Vec::new(),
            });
            entry.points.push(p);
        } else {
            ordered_points.push(p);
        }
    }

    let mut series: Vec<ScatterSeries> = if req.z_mode == ScatterZMode::Category {
        let mut list: Vec<ScatterSeries> = series_map.into_values().collect();
        list.sort_by(|a, b| natural_cmp(&a.name, &b.name).then(a.key.cmp(&b.key)));
        // Keep the legend manageable. Small categories are folded into "Other".
        if list.len() > 16 {
            list.sort_by(|a, b| b.points.len().cmp(&a.points.len()));
            let mut kept_series = list.split_off(16);
            let mut other = ScatterSeries {
                key: u16::MAX,
                name: "Other".to_string(),
                points: Vec::new(),
            };
            for s in kept_series.drain(..) {
                other.points.extend(s.points);
            }
            list.push(other);
            list.sort_by(|a, b| natural_cmp(&a.name, &b.name).then(a.key.cmp(&b.key)));
        }
        list
    } else if ordered_points.is_empty() {
        Vec::new()
    } else {
        vec![ScatterSeries {
            key: 0,
            name: String::new(),
            points: ordered_points,
        }]
    };
    if req.z_mode == ScatterZMode::Category {
        // Stable ordering for the legend: natural order by label.
        series.sort_by(|a, b| natural_cmp(&a.name, &b.name).then(a.key.cmp(&b.key)));
    }

    if !z_min.is_finite() {
        z_min = f32::NAN;
        z_max = f32::NAN;
    }

    ScatterResponse {
        series,
        x_test,
        y_test,
        z_test,
        z_mode: req.z_mode,
        z_col: req.z_col.clone(),
        z_col_label,
        z_min,
        z_max,
        total,
        excluded,
        truncated,
        r,
        lots: ds.lots.clone(),
        wafers: (0..ds.wafers.len())
            .map(|i| label(ds, GroupBy::Wafer, i as u16, multi_lot))
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stdf::import_stdf;

    fn demo_dataset() -> Option<Dataset> {
        let p = std::env::var("STDF_DEMO").ok().filter(|p| !p.is_empty())?;
        let imp = import_stdf(std::path::Path::new(&p), &mut |_, _| {}).ok()?;
        let mut ds = Dataset::new();
        ds.merge(imp);
        Some(ds)
    }

    #[test]
    fn query_pipeline_returns_data() {
        let Some(ds) = demo_dataset() else { return };
        assert!(ds.rows > 0);
        let test = ds
            .tests
            .iter()
            .position(|t| t.count > 0)
            .expect("demo has a test with values");
        let filter = Filter::default();

        let bx = box_plot(
            &ds,
            &BoxRequest {
                test,
                group_by: GroupBy::Wafer,
                filter: filter.clone(),
                max_points: None,
                block_col: None,
            },
        );
        assert!(!bx.groups.is_empty(), "box groups");
        assert!(bx.groups.iter().map(|g| g.n).sum::<usize>() > 0);
        assert!(bx.summary.n > 0);

        let mp = wafer_map(
            &ds,
            &MapRequest {
                wafer: 0,
                test: Some(test),
                mode: MapMode::Value,
                filter: filter.clone(),
            },
        );
        assert!(!mp.dice.is_empty(), "map dice");
        assert_eq!(mp.pass + mp.fail, mp.dice.len(), "map pass+fail");
        assert!(mp.pass > 0, "map pass count");

        let pa = pareto(
            &ds,
            &ParetoRequest {
                category: BinCategory::Hard,
                filter: filter.clone(),
                top: Some(20),
                include_pass: false,
            },
        );
        assert!(!pa.bars.is_empty(), "pareto bars");
        assert!(pa.bars.iter().all(|b| !b.pass), "pareto excludes pass");
        assert!(pa.bars.iter().all(|b| !b.name.is_empty()), "pareto names");
        let last = pa.bars.last().unwrap();
        assert!(
            (last.cum_pct - 100.0).abs() < 0.01,
            "cumulative {}",
            last.cum_pct
        );

        let hi = histogram(
            &ds,
            &HistRequest {
                test,
                filter: filter.clone(),
                bins: Some(40),
            },
        );
        assert_eq!(hi.counts.len(), 40);
        assert!(hi.counts.iter().map(|c| *c as usize).sum::<usize>() > 0);

        let tr = trend(
            &ds,
            &TrendRequest {
                test,
                by: GroupBy::Wafer,
                filter: filter.clone(),
            },
        );
        assert!(!tr.points.is_empty(), "trend points");
        assert!(tr.points.iter().all(|p| p.n > 0));

        let other = (test + 1..ds.tests.len())
            .find(|i| ds.tests[*i].count > 0)
            .unwrap_or(test);
        let sc = scatter(
            &ds,
            &ScatterRequest {
                x_test: test,
                y_test: other,
                z_mode: ScatterZMode::Continuous,
                z_test: Some(test),
                z_col: None,
                filter: filter.clone(),
                max_points: None,
            },
        );
        assert!(sc.total > 0, "scatter total");
        assert!(!sc.series.is_empty(), "scatter series");
        assert!(
            sc.series.iter().map(|s| s.points.len()).sum::<usize>() > 0,
            "scatter points"
        );
        assert!(sc.z_min.is_finite() && sc.z_max.is_finite(), "scatter z range");

        let mut ds2 = ds;
        ds2.set_custom_column("Split", &[(0, "Split A".to_string())])
            .expect("custom column");
        let bx2 = box_plot(
            &ds2,
            &BoxRequest {
                test,
                group_by: GroupBy::Wafer,
                filter: Filter::default(),
                max_points: None,
                block_col: Some("Split".to_string()),
            },
        );
        assert!(bx2.groups.iter().any(|g| g.block == "Split A"), "box block");

        let sc_cat = scatter(
            &ds2,
            &ScatterRequest {
                x_test: test,
                y_test: other,
                z_mode: ScatterZMode::Category,
                z_test: None,
                z_col: Some("wafer".to_string()),
                filter: Filter::default(),
                max_points: None,
            },
        );
        assert!(!sc_cat.series.is_empty(), "wafer category series");
        assert!(sc_cat.series.len() <= ds2.wafers.len(), "one series per wafer");
        assert!(
            sc_cat.series.iter().all(|s| !s.name.is_empty()),
            "wafer category labels"
        );

        let sc_split = scatter(
            &ds2,
            &ScatterRequest {
                x_test: test,
                y_test: other,
                z_mode: ScatterZMode::Category,
                z_test: None,
                z_col: Some("Split".to_string()),
                filter: Filter::default(),
                max_points: None,
            },
        );
        assert!(
            sc_split.series.iter().any(|s| s.name == "Split A"),
            "custom category series"
        );

        // A create request with only blank labels must not leave an empty column.
        assert!(ds2
            .set_custom_column("Empty", &[(0, String::new())])
            .is_err());
        assert!(
            !ds2.custom_cols.iter().any(|c| c.name == "Empty"),
            "empty custom column cleanup"
        );
    }
}
