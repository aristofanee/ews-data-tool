use crate::model::*;
use crate::stats::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

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

fn custom_label(col: &CustomColumn, code: u16) -> String {
    col.categories
        .get(code as usize)
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| "Unassigned".to_string())
}

fn wafer_label(ds: &Dataset, wi: u16, multi_lot: bool) -> String {
    if let Some(w) = ds.wafers.get(wi as usize) {
        if multi_lot {
            format!("{} / {}", ds.lot_name(w.lot), w.name)
        } else {
            w.name.clone()
        }
    } else {
        format!("W{wi}")
    }
}

/// Resolve a category name to a stable numeric key and a display label for a
/// single row. Categories can be built in (lot/wafer/bin) or a custom column.
fn category_for_row(ds: &Dataset, category: &str, row: usize, multi_lot: bool) -> (u16, String) {
    match category {
        "" | "none" => (0, "All".to_string()),
        "wafer" => {
            let wi = ds.wafer_of_row[row];
            (wi, wafer_label(ds, wi, multi_lot))
        }
        "lot" => {
            let lot = ds.lot_of_row[row];
            (lot, ds.lot_name(lot).to_string())
        }
        "hbin" => {
            let code = ds.hbin[row];
            (code, format!("HBIN {code}"))
        }
        "site" => match ds.site.get(row).copied().flatten() {
            Some(site) => (site as u16, format!("Site {site}")),
            None => (u16::MAX, "Unknown site".into()),
        },
        "sbin" => {
            let code = ds.sbin[row];
            (code, format!("SBIN {code}"))
        }
        other => {
            let wi = ds.wafer_of_row[row] as usize;
            if let Some(cc) = ds.custom_column(other) {
                let code = cc.wafer_values.get(wi).copied().unwrap_or(0);
                (code, custom_label(cc, code))
            } else {
                (0, "All".to_string())
            }
        }
    }
}

/// Resolve a category that is constant for a whole wafer (used by map groups
/// and by the bin overview).
fn category_for_wafer(ds: &Dataset, category: &str, wi: u16, multi_lot: bool) -> (u16, String) {
    match category {
        "" | "none" => (0, "All".to_string()),
        "wafer" => (wi, wafer_label(ds, wi, multi_lot)),
        "lot" => {
            let lot = ds.wafers.get(wi as usize).map(|w| w.lot).unwrap_or(0);
            (lot, ds.lot_name(lot).to_string())
        }
        other => {
            if let Some(cc) = ds.custom_column(other) {
                let code = cc.wafer_values.get(wi as usize).copied().unwrap_or(0);
                (code, custom_label(cc, code))
            } else {
                (0, "All".to_string())
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoxRequest {
    pub test: usize,
    #[serde(default)]
    pub x_axis: String,
    #[serde(default)]
    pub group_by: Option<String>,
    #[serde(default)]
    pub filter: Filter,
    pub max_points: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoxGroup {
    pub summary: Summary,
    pub positive_summary: Summary,
    pub x_key: u16,
    pub x_label: String,
    pub group_key: u16,
    pub group_label: String,
    pub values: Vec<f32>,
    pub xs: Vec<i16>,
    pub ys: Vec<i16>,
    pub n: usize,
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
    let (stat_keep, excluded) =
        stat_keep_rows(ds, req.test, &req.filter, None).unwrap_or((vec![true; ds.rows], 0));
    let col = &ds.cols[req.test];
    let multi_lot = ds.lots.len() > 1;
    let x_category = if req.x_axis.is_empty() { "wafer" } else { req.x_axis.as_str() };
    let group_category = req
        .group_by
        .as_deref()
        .filter(|s| !s.is_empty() && *s != "none");

    let mut buckets: HashMap<(u16, u16), Vec<(f32, i16, i16)>> = HashMap::new();
    let mut x_labels: HashMap<u16, String> = HashMap::new();
    let mut group_labels: HashMap<u16, String> = HashMap::new();
    for r in 0..ds.rows {
        if !mask[r] || !stat_keep[r] {
            continue;
        }
        let v = col[r];
        if !v.is_finite() {
            continue;
        }
        let (x_key, x_label) = category_for_row(ds, x_category, r, multi_lot);
        let (group_key, group_label) = match group_category {
            Some(cat) => category_for_row(ds, cat, r, multi_lot),
            None => (0, String::new()),
        };
        x_labels.entry(x_key).or_insert(x_label);
        group_labels.entry(group_key).or_insert(group_label);
        buckets
            .entry((x_key, group_key))
            .or_default()
            .push((v, ds.x[r], ds.y[r]));
    }

    let mut x_keys: Vec<u16> = x_labels.keys().copied().collect();
    x_keys.sort_by(|a, b| natural_cmp(&x_labels[a], &x_labels[b]));
    let mut group_keys: Vec<u16> = group_labels.keys().copied().collect();
    group_keys.sort_by(|a, b| natural_cmp(&group_labels[a], &group_labels[b]));

    let cap = req.max_points.unwrap_or(30_000).max(1);
    let total: usize = buckets.values().map(|v| v.len()).sum();
    let stride = if total > cap {
        ((total as f64 / cap as f64).ceil() as usize).max(1)
    } else {
        1
    };

    let mut all: Vec<f32> = Vec::new();
    let mut groups = Vec::new();
    for x_key in x_keys {
        for group_key in &group_keys {
            let Some(vals) = buckets.remove(&(x_key, *group_key)) else {
                continue;
            };
            let n = vals.len();
            let full_values: Vec<f32> = vals.iter().map(|(v, _, _)| *v).collect();
            let group_summary = summarize(&full_values);
            let positive_summary = summarize(&full_values.iter().copied().filter(|v| *v > 0.0).collect::<Vec<_>>());
            let mut values = Vec::with_capacity(n / stride + 1);
            let mut xs = Vec::with_capacity(n / stride + 1);
            let mut ys = Vec::with_capacity(n / stride + 1);
            for (i, (v, x, y)) in vals.iter().enumerate() {
                all.push(*v);
                let outlier = |s: &Summary| *v < s.q1 - 1.5 * (s.q3 - s.q1) || *v > s.q3 + 1.5 * (s.q3 - s.q1);
                if i % stride == 0 || outlier(&group_summary) || (*v > 0.0 && outlier(&positive_summary)) {
                    values.push(*v);
                    xs.push(*x);
                    ys.push(*y);
                }
            }
            groups.push(BoxGroup {
                summary: group_summary,
                positive_summary,
                x_key,
                x_label: x_labels.get(&x_key).cloned().unwrap_or_default(),
                group_key: *group_key,
                group_label: group_labels.get(group_key).cloned().unwrap_or_default(),
                n,
                values,
                xs,
                ys,
            });
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapRequest {
    pub lsl: Option<f32>,
    pub usl: Option<f32>,
    /// `None` means the mean map across every selected wafer.
    #[serde(default)]
    pub wafer: Option<u16>,
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
    pub test_pass: usize,
    pub test_fail: usize,
    pub test_yield_pct: Option<f32>,
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
    /// True for the all-wafer mean map.
    pub is_mean: bool,
    /// Number of wafers that contributed to the map.
    pub wafer_count: usize,
    /// Dice removed by the statistical/outlier filter.
    pub excluded: usize,
}

#[derive(Default)]
struct MapAcc {
    sum: f64,
    n: usize,
    hbin_counts: HashMap<u16, usize>,
    sbin_counts: HashMap<u16, usize>,
}

fn majority(map: &HashMap<u16, usize>) -> u16 {
    map.iter()
        .max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0)))
        .map(|(code, _)| *code)
        .unwrap_or(0)
}

/// Build a row mask for the selected test's statistical/outlier filter.
/// The ordinary lot/wafer/bin filters are applied first. `per_wafer` decides
/// whether each wafer gets its own limits or the whole selection is pooled.
fn stat_keep_rows(
    ds: &Dataset,
    test: usize,
    filter: &Filter,
    wafer_scope: Option<u16>,
) -> Option<(Vec<bool>, usize)> {
    let sf = filter.stat.as_ref()?;
    let col = ds.cols.get(test)?;
    let mask = ds.base_mask(filter);
    let mut keep = vec![true; ds.rows];
    let mut groups: HashMap<u16, Vec<usize>> = HashMap::new();
    let mut excluded = 0usize;

    // For a single-wafer map with a pooled (not per-wafer) filter, the limits
    // must still be computed over every selected wafer. Only per-wafer limits
    // restrict the input rows to the wafer currently being displayed.
    let restrict_to_scope = if sf.per_wafer { wafer_scope } else { None };
    for r in 0..ds.rows {
        if !mask[r] {
            continue;
        }
        if let Some(w) = restrict_to_scope {
            if ds.wafer_of_row[r] != w {
                continue;
            }
        }
        let v = col.get(r).copied().unwrap_or(f32::NAN);
        if !v.is_finite() {
            // Missing measurements are already omitted from a value map; do
            // not report them as outliers.
            keep[r] = false;
            continue;
        }
        groups.entry(ds.wafer_of_row[r]).or_default().push(r);
    }

    let count_excluded = |r: usize| {
        wafer_scope
            .map(|w| ds.wafer_of_row[r] == w)
            .unwrap_or(true)
    };

    if sf.per_wafer {
        for idxs in groups.values() {
            let vals: Vec<f32> = idxs.iter().map(|r| col[*r]).collect();
            let allowed = keep_mask(&vals, sf);
            for (j, r) in idxs.iter().enumerate() {
                if !allowed[j] {
                    keep[*r] = false;
                    if count_excluded(*r) {
                        excluded += 1;
                    }
                }
            }
        }
    } else {
        let idxs: Vec<usize> = groups.values().flatten().copied().collect();
        let vals: Vec<f32> = idxs.iter().map(|r| col[*r]).collect();
        let allowed = keep_mask(&vals, sf);
        for (j, r) in idxs.iter().enumerate() {
            if !allowed[j] {
                keep[*r] = false;
                if count_excluded(*r) {
                    excluded += 1;
                }
            }
        }
    }
    Some((keep, excluded))
}

/// Aggregate by coordinate. Repeated coordinates (for example after merging
/// several files or retests) become one die whose value is the mean of all
/// finite values and whose bin is the majority bin. With `wafer = None` the
/// same aggregation runs across every wafer selected by the filter, producing
/// the all-wafer mean map. Value maps omit coordinates with no measurement.
fn aggregate_map(
    ds: &Dataset,
    wafer: Option<u16>,
    test: Option<usize>,
    mode: MapMode,
    mask: &[bool],
    rows: &[usize],
    keep_rows: Option<&[bool]>,
) -> (Vec<MapDie>, usize, usize, f32, f32, usize) {
    let col = test.and_then(|t| ds.cols.get(t));
    let mut by_coord: HashMap<(i16, i16), MapAcc> = HashMap::new();
    let mut used_wafers: HashSet<u16> = HashSet::new();
    for &r in rows {
        if let Some(w) = wafer {
            if ds.wafer_of_row[r] != w {
                continue;
            }
        }
        if !mask[r] {
            continue;
        }
        if let Some(keep) = keep_rows {
            if !keep.get(r).copied().unwrap_or(false) {
                continue;
            }
        }
        used_wafers.insert(ds.wafer_of_row[r]);
        let acc = by_coord.entry((ds.x[r], ds.y[r])).or_default();
        *acc.hbin_counts.entry(ds.hbin[r]).or_insert(0) += 1;
        *acc.sbin_counts.entry(ds.sbin[r]).or_insert(0) += 1;
        if mode == MapMode::Value {
            if let Some(v) = col.and_then(|c| c.get(r)).copied() {
                if v.is_finite() {
                    acc.sum += v as f64;
                    acc.n += 1;
                }
            }
        }
    }

    let mut dice = Vec::with_capacity(by_coord.len());
    let mut pass = 0usize;
    let mut fail = 0usize;
    let mut vmin = f32::INFINITY;
    let mut vmax = f32::NEG_INFINITY;
    for ((x, y), acc) in by_coord {
        if mode == MapMode::Value && acc.n == 0 {
            continue;
        }
        let v = match mode {
            MapMode::Value => (acc.sum / acc.n as f64) as f32,
            MapMode::Bin => majority(&acc.hbin_counts) as f32,
        };
        let hbin = majority(&acc.hbin_counts);
        let sbin = majority(&acc.sbin_counts);
        if mode == MapMode::Value {
            vmin = vmin.min(v);
            vmax = vmax.max(v);
        }
        if ds.is_pass(hbin) {
            pass += 1;
        } else {
            fail += 1;
        }
        dice.push(MapDie {
            x,
            y,
            v,
            hbin,
            sbin,
        });
    }
    dice.sort_by_key(|d| (d.x, d.y));
    if !vmin.is_finite() {
        vmin = f32::NAN;
        vmax = f32::NAN;
    }
    (dice, pass, fail, vmin, vmax, used_wafers.len())
}

pub fn wafer_map(ds: &Dataset, req: &MapRequest) -> MapResponse {
    let keep = if req.mode == MapMode::Value {
        req.test
            .and_then(|t| stat_keep_rows(ds, t, &req.filter, req.wafer))
    } else {
        None
    };
    let considered = ds.base_mask(&req.filter);
    let rows: Vec<usize> = (0..ds.rows).filter(|&r| req.wafer.map_or(true, |w| ds.wafer_of_row[r] == w)).collect();
    wafer_map_prepared(ds, req, keep.as_ref().map(|(mask, _)| mask.as_slice()), &considered, &rows)
}

/// Batch individual-wafer maps with one filter/outlier calculation and one
/// row partition. Each map then visits only its own source rows.
pub fn wafer_maps(ds: &Dataset, req: &MapRequest) -> Vec<MapResponse> {
    let considered = ds.base_mask(&req.filter);
    let keep = if req.mode == MapMode::Value {
        req.test.and_then(|t| stat_keep_rows(ds, t, &req.filter, None))
    } else { None };
    let mut rows = vec![Vec::new(); ds.wafers.len()];
    for r in 0..ds.rows { rows[ds.wafer_of_row[r] as usize].push(r); }
    rows.iter().enumerate().filter(|(wi, _)| {
        let w = &ds.wafers[*wi];
        (req.filter.wafers.is_empty() || req.filter.wafers.contains(&(*wi as u16)))
            && (req.filter.lots.is_empty() || req.filter.lots.contains(&w.lot))
    }).map(|(wi, rows)| {
        let single = MapRequest { wafer: Some(wi as u16), test: req.test, mode: req.mode,
            filter: req.filter.clone(), lsl: req.lsl, usl: req.usl };
        wafer_map_prepared(ds, &single, keep.as_ref().map(|(mask, _)| mask.as_slice()), &considered, rows)
    }).collect()
}

fn wafer_map_prepared(ds: &Dataset, req: &MapRequest, keep_ref: Option<&[bool]>, considered: &[bool], rows: &[usize]) -> MapResponse {
    let test = req.test.and_then(|t| ds.tests.get(t).cloned());
    let excluded = rows.iter().filter(|&&r| considered[r] && keep_ref.is_some_and(|k| !k[r])
        && req.test.and_then(|t| ds.cols.get(t)).and_then(|c| c.get(r)).is_some_and(|v| v.is_finite())).count();
    let (dice, _, _, vmin, vmax, wafer_count) =
        aggregate_map(ds, req.wafer, req.test, req.mode, considered, rows, keep_ref);

    let is_mean = req.wafer.is_none();
    let lsl = req.lsl.or_else(|| test.as_ref().and_then(|t| t.lo_spec));
    let usl = req.usl.or_else(|| test.as_ref().and_then(|t| t.hi_spec));
    let valid_limits = (lsl.is_some() || usl.is_some())
        && lsl.map_or(true, |v| v.is_finite()) && usl.map_or(true, |v| v.is_finite())
        && lsl.zip(usl).map_or(true, |(l, u)| l <= u);
    let col = req.test.and_then(|t| ds.cols.get(t));
    let (mut pass, mut fail, mut test_pass, mut test_fail) = (0, 0, 0, 0);
    for &r in rows {
        if req.wafer.is_some_and(|w| ds.wafer_of_row[r] != w)
            || (!req.filter.lots.is_empty() && !req.filter.lots.contains(&ds.lot_of_row[r]))
            || (!req.filter.wafers.is_empty() && !req.filter.wafers.contains(&ds.wafer_of_row[r])) { continue; }
        // Physical wafer yield never changes with a test/outlier/bin filter.
        if ds.hbin[r] == 1 { pass += 1; } else { fail += 1; }
        if valid_limits && considered[r] && keep_ref.map_or(true, |k| k[r]) {
            if let Some(v) = col.and_then(|c| c.get(r)).copied().filter(|v| v.is_finite()) {
                if lsl.map_or(true, |l| v >= l) && usl.map_or(true, |u| v <= u) {
                    test_pass += 1;
                } else { test_fail += 1; }
            }
        }
    }
    let tested = pass + fail;

    let (wafer, lot_name) = if let Some(wi) = req.wafer {
        match ds.wafers.get(wi as usize) {
            Some(w) => (Some(w.clone()), ds.lot_name(w.lot).to_string()),
            None => (None, String::new()),
        }
    } else {
        // Reuse the first selected wafer's physical geometry (die size,
        // diameter, notch) for the synthetic mean-map wafer.
        let first = ds
            .wafers
            .iter()
            .enumerate()
            .find(|(i, w)| {
                (req.filter.wafers.is_empty() || req.filter.wafers.contains(&(*i as u16)))
                    && (req.filter.lots.is_empty() || req.filter.lots.contains(&w.lot))
            })
            .map(|(_, w)| w.clone());
        let mut wf = first;
        if let Some(w) = wf.as_mut() {
            w.name = "All wafers (mean)".to_string();
            w.dice = dice.len();
            if !dice.is_empty() {
                w.x_min = dice.iter().map(|d| d.x).min().unwrap_or(w.x_min);
                w.x_max = dice.iter().map(|d| d.x).max().unwrap_or(w.x_max);
                w.y_min = dice.iter().map(|d| d.y).min().unwrap_or(w.y_min);
                w.y_max = dice.iter().map(|d| d.y).max().unwrap_or(w.y_max);
            }
        }
        (
            wf,
            if dice.is_empty() {
                String::new()
            } else {
                "All wafers".to_string()
            },
        )
    };

    MapResponse {
        test_pass,
        test_fail,
        test_yield_pct: (test_pass + test_fail > 0).then(|| test_pass as f32 * 100.0 / (test_pass + test_fail) as f32),
        wafer,
        lot_name,
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
        is_mean,
        wafer_count,
        excluded,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinOverviewRequest {
    #[serde(default)]
    pub filter: Filter,
    #[serde(default)]
    pub category: Option<BinCategory>,
}

fn is_pass_category(_ds: &Dataset, _category: BinCategory, code: u16) -> bool {
    code == 1
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinOverviewWafer {
    pub wafer: WaferInfo,
    pub lot_name: String,
    pub dice: Vec<MapDie>,
    pub pass: usize,
    pub fail: usize,
    pub yield_pct: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinOverviewResponse {
    pub wafers: Vec<BinOverviewWafer>,
}

/// Bin maps for every selected wafer, in dataset order. The frontend groups
/// these by lot when more than one lot is present.
pub fn bin_overview(ds: &Dataset, req: &BinOverviewRequest) -> BinOverviewResponse {
    // Both bin columns are returned; category selects the frontend palette.
    let _category = req.category;
    let mask = ds.base_mask(&req.filter);
    let mut dice_by_wafer: Vec<Vec<MapDie>> = (0..ds.wafers.len()).map(|_| Vec::new()).collect();
    let mut totals = vec![(0usize, 0usize); ds.wafers.len()];
    // One pass for the entire overview, rather than one full-dataset scan
    // and allocation per wafer. Import has already resolved duplicate dice.
    for r in 0..ds.rows {
        let wi = ds.wafer_of_row[r] as usize;
        if (!req.filter.lots.is_empty() && !req.filter.lots.contains(&ds.lot_of_row[r]))
            || (!req.filter.wafers.is_empty() && !req.filter.wafers.contains(&(wi as u16))) { continue; }
        if ds.hbin[r] == 1 { totals[wi].0 += 1; } else { totals[wi].1 += 1; }
        if mask[r] {
            dice_by_wafer[wi].push(MapDie { x: ds.x[r], y: ds.y[r],
                v: ds.hbin[r] as f32, hbin: ds.hbin[r], sbin: ds.sbin[r] });
        }
    }
    let mut wafers = Vec::new();
    for (wi, mut dice) in dice_by_wafer.into_iter().enumerate() {
        if dice.is_empty() { continue; }
        dice.sort_by_key(|d| (d.x, d.y));
        let w = &ds.wafers[wi];
        let (pass, fail) = totals[wi];
        wafers.push(BinOverviewWafer {
            wafer: w.clone(), lot_name: ds.lot_name(w.lot).to_string(), dice,
            pass, fail, yield_pct: pass as f32 * 100.0 / (pass + fail) as f32,
        });
    }
    BinOverviewResponse { wafers }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParetoRequest {
    pub category: BinCategory,
    #[serde(default)]
    pub filter: Filter,
    pub top: Option<usize>,
    /// Empty/`none` is the global failure Pareto. `lot`, `wafer`, or a custom
    /// column name switches to the grouped mode.
    pub group_by: Option<String>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ParetoMode {
    Global,
    Grouped,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParetoBar {
    pub code: u16,
    pub name: String,
    pub count: usize,
    pub pct: f32,
    pub pass: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParetoGroup {
    pub key: usize,
    pub label: String,
    pub total: usize,
    pub pass: usize,
    pub fail: usize,
    pub yield_pct: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParetoSeries {
    pub code: u16,
    pub name: String,
    pub counts: Vec<usize>,
    pub pcts: Vec<f32>,
    pub pass: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParetoResponse {
    pub mode: ParetoMode,
    pub bars: Vec<ParetoBar>,
    pub groups: Vec<ParetoGroup>,
    pub series: Vec<ParetoSeries>,
    pub total: usize,
    pub fail_total: usize,
    pub yield_pct: f32,
    pub group_label: String,
}

#[derive(Default)]
struct ParetoGroupAcc {
    total: usize,
    pass: usize,
    counts: HashMap<u16, usize>,
}

fn pareto_group_label(
    ds: &Dataset,
    group_by: &str,
    row: usize,
    multi_lot: bool,
) -> String {
    category_for_row(ds, group_by, row, multi_lot).1
}

fn pareto_group_title(ds: &Dataset, group_by: &str) -> String {
    match group_by {
        "lot" => "Lot".to_string(),
        "wafer" => "Wafer ID (OCR)".to_string(),
        "site" => "Site".to_string(),
        "hbin" => "HBIN".to_string(),
        "sbin" => "SBIN".to_string(),
        other => ds
            .custom_column(other)
            .map(|c| c.name.clone())
            .unwrap_or_else(|| "Group".to_string()),
    }
}

pub fn pareto(ds: &Dataset, req: &ParetoRequest) -> ParetoResponse {
    let mask = ds.base_mask(&req.filter);
    let codes = match req.category {
        BinCategory::Hard => &ds.hbin,
        BinCategory::Soft => &ds.sbin,
    };
    let is_pass = |code: u16| is_pass_category(ds, req.category, code);
    let multi_lot = ds.lots.len() > 1;
    let group_by = req
        .group_by
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "none");
    // Bin selection controls which failures are displayed, not the tested
    // population. Selecting a failing bin must not make its rate become 100%.
    let mut population_filter = req.filter.clone();
    population_filter.hbins.clear(); population_filter.sbins.clear();
    let population = ds.base_mask(&population_filter);
    let mut counts: HashMap<u16, usize> = HashMap::new();
    let mut total = 0usize;
    let mut pass_total = 0usize;
    let mut fail_total = 0usize;
    let mut grouped: HashMap<String, ParetoGroupAcc> = HashMap::new();

    for r in 0..ds.rows {
        if !population[r] {
            continue;
        }
        let code = codes[r];
        let pass = is_pass(code);
        total += 1;
        if pass {
            pass_total += 1;
        } else {
            fail_total += 1;
        }
        if mask[r] { *counts.entry(code).or_insert(0) += 1; }
        if let Some(by) = group_by {
            let glabel = pareto_group_label(ds, by, r, multi_lot);
            let g = grouped.entry(glabel).or_default();
            g.total += 1;
            if pass {
                g.pass += 1;
            }
            if mask[r] { *g.counts.entry(code).or_insert(0) += 1; }
        }
    }

    let yield_pct = if total > 0 {
        pass_total as f32 * 100.0 / total as f32
    } else {
        0.0
    };
    let top = req.top.unwrap_or(20).max(1);

    if let Some(by) = group_by {
        let mut group_rows: Vec<(String, ParetoGroupAcc)> = grouped.into_iter().collect();
        group_rows.sort_by(|a, b| natural_cmp(&a.0, &b.0));
        let groups: Vec<ParetoGroup> = group_rows
            .iter()
            .enumerate()
            .map(|(key, (label, g))| ParetoGroup {
                key,
                label: label.clone(),
                total: g.total,
                pass: g.pass,
                fail: g.total.saturating_sub(g.pass),
                yield_pct: if g.total > 0 {
                    g.pass as f32 * 100.0 / g.total as f32
                } else {
                    0.0
                },
            })
            .collect();

        let mut failure_codes: Vec<(u16, usize)> = counts
            .iter()
            .filter(|(code, _)| !is_pass(**code))
            .map(|(code, count)| (*code, *count))
            .collect();
        failure_codes.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        let selected: Vec<u16> = failure_codes
            .iter()
            .take(top)
            .map(|(code, _)| *code)
            .collect();
        let has_others = failure_codes.len() > selected.len();

        let mut series = Vec::new();
        for code in &selected {
            let counts_by_group: Vec<usize> = group_rows
                .iter()
                .map(|(_, g)| g.counts.get(code).copied().unwrap_or(0))
                .collect();
            let pcts = counts_by_group
                .iter()
                .zip(group_rows.iter())
                .map(|(count, (_, g))| {
                    if g.total > 0 {
                        *count as f32 * 100.0 / g.total as f32
                    } else {
                        0.0
                    }
                })
                .collect();
            series.push(ParetoSeries {
                code: *code,
                name: match req.category {
                    BinCategory::Hard => ds.bin_name(true, *code),
                    BinCategory::Soft => ds.bin_name(false, *code),
                },
                counts: counts_by_group,
                pcts,
                pass: false,
            });
        }
        if has_others {
            let selected_set: std::collections::HashSet<u16> = selected.iter().copied().collect();
            let counts_by_group: Vec<usize> = group_rows
                .iter()
                .map(|(_, g)| {
                    g.counts
                        .iter()
                        .filter(|(code, _)| !selected_set.contains(code) && !is_pass(**code))
                        .map(|(_, count)| *count)
                        .sum()
                })
                .collect();
            let pcts = counts_by_group
                .iter()
                .zip(group_rows.iter())
                .map(|(count, (_, g))| {
                    if g.total > 0 {
                        *count as f32 * 100.0 / g.total as f32
                    } else {
                        0.0
                    }
                })
                .collect();
            series.push(ParetoSeries {
                code: 0xFFFF,
                name: "Others".to_string(),
                counts: counts_by_group,
                pcts,
                pass: false,
            });
        }

        return ParetoResponse {
            mode: ParetoMode::Grouped,
            bars: Vec::new(),
            groups,
            series,
            total,
            fail_total,
            yield_pct,
            group_label: pareto_group_title(ds, by),
        };
    }

    let mut failure_bars: Vec<(u16, usize)> = counts
        .iter()
        .filter(|(code, _)| !is_pass(**code))
        .map(|(code, count)| (*code, *count))
        .collect();
    failure_bars.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let mut bars = Vec::new();
    let mut others = 0usize;
    for (i, (code, count)) in failure_bars.iter().enumerate() {
        if i >= top {
            others += count;
            continue;
        }
        bars.push(ParetoBar {
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
            pass: false,
        });
    }
    if others > 0 {
        bars.push(ParetoBar {
            code: 0xFFFF,
            name: "Others".to_string(),
            count: others,
            pct: if total > 0 {
                others as f32 * 100.0 / total as f32
            } else {
                0.0
            },
            pass: false,
        });
    }
    ParetoResponse {
        mode: ParetoMode::Global,
        bars,
        groups: Vec::new(),
        series: Vec::new(),
        total,
        fail_total,
        yield_pct,
        group_label: String::new(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistRequest {
    pub test: usize,
    #[serde(default)]
    pub filter: Filter,
    pub bins: Option<usize>,
    #[serde(default)]
    pub group_by: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistGroup {
    pub key: u16,
    pub label: String,
    pub counts: Vec<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistResponse {
    pub edges: Vec<f32>,
    pub counts: Vec<u32>,
    pub groups: Vec<HistGroup>,
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
            groups: Vec::new(),
            summary: Summary::default(),
            test,
            lsl: None,
            usl: None,
            excluded: 0,
        };
    }
    let mask = ds.base_mask(&req.filter);
    let (stat_keep, excluded) =
        stat_keep_rows(ds, req.test, &req.filter, None).unwrap_or((vec![true; ds.rows], 0));
    let col = &ds.cols[req.test];
    let multi_lot = ds.lots.len() > 1;
    let group_category = req
        .group_by
        .as_deref()
        .filter(|s| !s.is_empty() && *s != "none");
    let mut vals: Vec<f32> = Vec::new();
    let mut grouped: HashMap<u16, (String, Vec<f32>)> = HashMap::new();
    for r in 0..ds.rows {
        if !mask[r] || !stat_keep[r] || !col[r].is_finite() {
            continue;
        }
        let v = col[r];
        vals.push(v);
        if let Some(cat) = group_category {
            let (key, label) = category_for_row(ds, cat, r, multi_lot);
            grouped.entry(key).or_insert((label, Vec::new())).1.push(v);
        }
    }
    let summary = summarize(&vals);
    if vals.is_empty() {
        return HistResponse {
            edges: Vec::new(),
            counts: Vec::new(),
            groups: Vec::new(),
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
    let bin_index = |v: f32| {
        let mut idx = ((v - lo) / width) as usize;
        if idx >= n_bins {
            idx = n_bins - 1;
        }
        idx
    };
    let mut counts = vec![0u32; n_bins];
    for v in vals.iter() {
        counts[bin_index(*v)] += 1;
    }
    let mut group_rows: Vec<(u16, String, Vec<f32>)> = grouped
        .into_iter()
        .map(|(key, (label, values))| (key, label, values))
        .collect();
    group_rows.sort_by(|a, b| natural_cmp(&a.1, &b.1));
    let groups = group_rows
        .into_iter()
        .map(|(key, label, values)| {
            let mut gc = vec![0u32; n_bins];
            for v in values {
                gc[bin_index(v)] += 1;
            }
            HistGroup {
                key,
                label,
                counts: gc,
            }
        })
        .collect();
    HistResponse {
        edges,
        counts,
        groups,
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
    #[serde(default)]
    pub by: String,
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
    let by = if req.by.is_empty() { "wafer" } else { req.by.as_str() };
    let mut buckets: HashMap<u16, (String, Vec<f32>)> = HashMap::new();
    for r in 0..ds.rows {
        if !mask[r] || !col[r].is_finite() {
            continue;
        }
        let (key, label) = category_for_row(ds, by, r, multi_lot);
        buckets.entry(key).or_insert((label, Vec::new())).1.push(col[r]);
    }
    let mut rows: Vec<(u16, String, Vec<f32>)> = buckets
        .into_iter()
        .map(|(key, (label, values))| (key, label, values))
        .collect();
    rows.sort_by(|a, b| natural_cmp(&a.1, &b.1));
    let mut points = Vec::new();
    for (_, label, v) in rows {
        let m = mean(&v);
        let sd = std_dev(&v, m);
        points.push(TrendPoint {
            label,
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
    /// Independent category grouping (lot, wafer, HBIN, SBIN or a custom column).
    #[serde(default)]
    pub group_by: Option<String>,
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
    pub group_by: Option<String>,
    pub group_label: String,
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
    category_for_row(ds, if col.is_empty() { "lot" } else { col }, row, multi_lot)
}

fn scatter_col_label(ds: &Dataset, col: &str) -> String {
    match col {
        "lot" | "" => "Lot".to_string(),
        "wafer" => "Wafer ID (OCR)".to_string(),
        "site" => "Site".to_string(),
        "hbin" => "HBIN".to_string(),
        "sbin" => "SBIN".to_string(),
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
        group_by: req.group_by.clone(),
        group_label: req
            .group_by
            .as_deref()
            .filter(|c| !c.is_empty() && *c != "none")
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
            .map(|i| wafer_label(ds, i as u16, ds.lots.len() > 1))
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
    // Categorical colouring and grouping share the same series machinery. A
    // group-by is now independent from continuous Z colouring, so both can be
    // active at the same time.
    let group_col = match req.z_mode {
        ScatterZMode::Category => Some(req.z_col.as_deref().unwrap_or("lot")),
        _ => req
            .group_by
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty() && *c != "none"),
    };
    let group_label = group_col
        .map(|c| scatter_col_label(ds, c))
        .unwrap_or_default();
    let z_col_label = match req.z_mode {
        ScatterZMode::Continuous => z_test
            .as_ref()
            .map(|t| t.display_with_units())
            .unwrap_or_else(|| "Z".to_string()),
        ScatterZMode::Category => group_label.clone(),
        ScatterZMode::None => group_label.clone(),
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
        if let Some(col) = group_col {
            let (key, name) = scatter_category(ds, col, r, multi_lot);
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

    let mut series: Vec<ScatterSeries> = if group_col.is_some() {
        let mut list: Vec<ScatterSeries> = series_map.into_values().collect();
        list.sort_by(|a, b| natural_cmp(&a.name, &b.name).then(a.key.cmp(&b.key)));
        // Keep the legend manageable for the legacy categorical-colour mode.
        // Explicit group-by series must stay separate for the split view.
        if req.z_mode == ScatterZMode::Category && list.len() > 16 {
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
    if group_col.is_some() {
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
        group_by: req.group_by.clone(),
        group_label,
        z_min,
        z_max,
        total,
        excluded,
        truncated,
        r,
        lots: ds.lots.clone(),
        wafers: (0..ds.wafers.len())
            .map(|i| wafer_label(ds, i as u16, multi_lot))
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{StatFilter, StatKind, TestInfo, WaferInfo};
    use crate::stdf::import_stdf;

    fn small_dataset(values: &[f32]) -> Dataset {
        let mut imp = crate::dataset::Imported::new();
        let lot = imp.lot_index("L");
        let wafer = imp.wafer_index(lot, "W");
        for (i, v) in values.iter().enumerate() {
            let row = imp.new_row(lot, wafer);
            imp.x[row] = i as i16;
            imp.y[row] = 0;
            imp.hbin[row] = if i == 0 { 1 } else { 2 };
            let idx = imp.column((100, 0), row, *v);
            imp.tests[idx].name = "V".into();
        }
        let mut ds = Dataset::new();
        ds.merge(imp.finish());
        ds
    }

    #[test]
    fn box_statistics_are_exact_even_when_points_are_sampled() {
        let ds = small_dataset(&[-100.0, 1.0, 2.0, 3.0, 100.0]);
        let b = box_plot(&ds, &BoxRequest {
            test: 0, x_axis: "wafer".into(), group_by: None,
            filter: Filter::default(), max_points: Some(1),
        });
        assert!(b.truncated);
        assert_eq!(b.groups[0].values, vec![-100.0, 100.0], "all outliers survive marker sampling");
        assert_eq!(b.groups[0].summary.median, 2.0);
        assert_eq!(b.groups[0].summary.q1, 1.0);
        assert_eq!(b.groups[0].summary.whisker_hi, 3.0);
        assert_eq!(b.groups[0].positive_summary.median, 2.5);
    }

    #[test]
    fn pareto_rates_use_all_tested_dice_globally_and_per_site() {
        let mut ds = small_dataset(&[1.0; 4]);
        ds.hbin = vec![1, 1, 2, 3];
        ds.site = vec![Some(0), Some(1), Some(0), Some(1)];
        let mut req = ParetoRequest { category: BinCategory::Hard, filter: Filter::default(), top: Some(1), group_by: None };
        let global = pareto(&ds, &req);
        assert_eq!(global.bars.iter().map(|b| b.pct).sum::<f32>(), 50.0);
        assert!(global.bars.iter().all(|b| b.pct == 25.0));
        req.group_by = Some("site".into());
        let grouped = pareto(&ds, &req);
        assert_eq!(grouped.groups.len(), 2);
        for (i, g) in grouped.groups.iter().enumerate() {
            assert_eq!(g.total, 2);
            assert_eq!(grouped.series.iter().map(|s| s.pcts[i]).sum::<f32>(), 50.0);
        }
        req.group_by = None;
        req.filter.hbins = vec![2];
        let selected = pareto(&ds, &req);
        assert_eq!(selected.total, 4);
        assert_eq!(selected.bars[0].pct, 25.0, "selecting a failing bin preserves the tested denominator");
        req.filter.sites = vec![0];
        let site = pareto(&ds, &req);
        assert_eq!(site.total, 2);
        assert_eq!(site.bars[0].pct, 50.0);
        let b = box_plot(&ds, &BoxRequest { test: 0, x_axis: "site".into(), group_by: None, filter: Filter::default(), max_points: None });
        assert_eq!(b.groups.len(), 2);
        assert_eq!(b.groups[0].x_label, "Site 0");
        assert_eq!(b.groups[0].n, 2);
        ds.site[0] = None;
        assert!(ds.info().sites.contains(&65535));
        let unknown = box_plot(&ds, &BoxRequest { test: 0, x_axis: "site".into(), group_by: None, filter: Filter::default(), max_points: None });
        assert!(unknown.groups.iter().any(|g| g.x_label == "Unknown site" && g.n == 1));
    }

    #[test]
    fn batch_maps_match_individual_queries_with_pooled_and_per_wafer_filters() {
        let mut ds = small_dataset(&[0.0, 1.0, 100.0, 10.0, 11.0, 12.0]);
        ds.wafers.push(ds.wafers[0].clone());
        ds.wafer_of_row = vec![0, 0, 0, 1, 1, 1];
        for per_wafer in [false, true] {
            let req = MapRequest { wafer: None, test: Some(0), mode: MapMode::Value,
                filter: Filter { stat: Some(StatFilter { kind: StatKind::Sigma, k: 1.0, per_wafer }), ..Filter::default() },
                lsl: Some(0.0), usl: Some(15.0) };
            let maps = wafer_maps(&ds, &req);
            assert_eq!(maps.len(), 2);
            for (wi, map) in maps.iter().enumerate() {
                let single = MapRequest { wafer: Some(wi as u16), test: req.test, mode: req.mode,
                    filter: req.filter.clone(), lsl: req.lsl, usl: req.usl };
                assert_eq!(serde_json::to_value(map).unwrap(), serde_json::to_value(wafer_map(&ds, &single)).unwrap());
            }
        }
    }

    #[test]
    fn wafer_and_test_yield_use_source_dice_not_mean_coordinates() {
        let mut ds = small_dataset(&[0.0, 10.0, 10.0]);
        // Three wafers at the same coordinate: mean value passes, but just
        // one of the three actual measurements is inside the test limits.
        let first = ds.wafers[0].clone();
        ds.wafers.extend([first.clone(), first]);
        ds.wafer_of_row = vec![0, 1, 2];
        ds.x = vec![0; 3];
        let req = MapRequest { wafer: None, test: Some(0), mode: MapMode::Value,
            filter: Filter::default(), lsl: Some(0.0), usl: Some(7.0) };
        let m = wafer_map(&ds, &req);
        assert_eq!(m.dice.len(), 1);
        assert_eq!((m.pass, m.fail), (1, 2));
        assert!((m.yield_pct - 100.0 / 3.0).abs() < 1e-4);
        assert_eq!((m.test_pass, m.test_fail), (1, 2));
        let mut filtered = req;
        filtered.filter.hbins = vec![1];
        let m = wafer_map(&ds, &filtered);
        assert_eq!((m.pass, m.fail), (1, 2), "bin filters must not change physical yield");
        assert_eq!(m.test_yield_pct, Some(100.0));
    }

    #[test]
    #[ignore = "synthetic performance benchmark; run explicitly with --ignored --nocapture"]
    fn first_pillar_benchmark() {
        let start = std::time::Instant::now();
        let mut imp = crate::dataset::Imported::new();
        let lot = imp.lot_index("L");
        let wafers: Vec<_> = (0..25).map(|w| imp.wafer_index(lot, &format!("W{w}"))).collect();
        for &wafer in &wafers {
            for die in 0..4500 {
                let row = imp.new_row(lot, wafer);
                imp.x[row] = (die % 75) as i16;
                imp.y[row] = (die / 75) as i16;
                imp.hbin[row] = if die % 10 == 0 { 2 } else { 1 };
                for t in 0..32 {
                    imp.column((t, 0), row, t as f32 + (die % 101) as f32 * 0.01);
                }
            }
        }
        let mut ds = Dataset::new();
        ds.merge(imp.finish());
        ds.resolve_retests();
        let import_ms = start.elapsed().as_millis();
        let start = std::time::Instant::now();
        let bx = box_plot(&ds, &BoxRequest { test: 0, x_axis: "wafer".into(), group_by: None,
            filter: Filter::default(), max_points: None });
        let box_ms = start.elapsed().as_millis();
        let start = std::time::Instant::now();
        let maps = bin_overview(&ds, &BinOverviewRequest { filter: Filter::default(), category: None });
        let maps_ms = start.elapsed().as_millis();
        let start = std::time::Instant::now();
        ds.info();
        let info_ms = start.elapsed().as_millis();
        let req = MapRequest { wafer: None, test: Some(0), mode: MapMode::Value,
            filter: Filter { stat: Some(StatFilter { kind: StatKind::Sigma, k: 3.0, per_wafer: true }), ..Filter::default() },
            lsl: None, usl: None };
        let start = std::time::Instant::now();
        let batch = wafer_maps(&ds, &req);
        let batch_ms = start.elapsed().as_millis();
        let start = std::time::Instant::now();
        for wi in 0..25 {
            let single = MapRequest { wafer: Some(wi), test: req.test, mode: req.mode,
                filter: req.filter.clone(), lsl: None, usl: None };
            wafer_map(&ds, &single);
        }
        let individual_ms = start.elapsed().as_millis();
        assert_eq!(batch.len(), 25);
        assert_eq!(ds.rows, 112_500);
        assert_eq!(maps.wafers.len(), 25);
        assert_eq!(bx.summary.n, ds.rows);
        eprintln!("112500 dice x 32 tests: construct/merge/retests={import_ms}ms box={box_ms}ms bin_overview={maps_ms}ms metadata={info_ms}ms sampled_points={} memory={:.1}MiB", bx.groups.iter().map(|g| g.values.len()).sum::<usize>(), ds.memory_bytes() as f64 / 1048576.0);
        eprintln!("25 value maps with per-wafer sigma filtering: batch={batch_ms}ms individual={individual_ms}ms");
    }

    fn demo_dataset() -> Option<Dataset> {
        let p = std::env::var("STDF_DEMO").ok().filter(|p| !p.is_empty())?;
        let imp = import_stdf(std::path::Path::new(&p), &mut |_, _| {}).ok()?;
        let mut ds = Dataset::new();
        ds.merge(imp);
        Some(ds)
    }

    #[test]
    #[ignore = "requires STDF_DEMO fixture; run explicitly with --ignored"]
    fn query_pipeline_returns_data() {
        let ds = demo_dataset().expect("Set STDF_DEMO to a valid reference file");
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
                x_axis: "wafer".to_string(),
                group_by: None,
                filter: filter.clone(),
                max_points: None,
            },
        );
        assert!(!bx.groups.is_empty(), "box groups");
        assert!(bx.groups.iter().map(|g| g.n).sum::<usize>() > 0);
        assert!(bx.summary.n > 0);

        let mp = wafer_map(
            &ds,
            &MapRequest {
                lsl: None,
                usl: None,
                wafer: Some(0),
                test: Some(test),
                mode: MapMode::Value,
                filter: filter.clone(),
            },
        );
        assert!(!mp.dice.is_empty(), "map dice");
        assert_eq!(mp.pass + mp.fail, mp.dice.len(), "map pass+fail");
        assert!(mp.pass > 0, "map pass count");
        assert!(!mp.is_mean, "single wafer map is not the mean map");

        let all = wafer_map(
            &ds,
            &MapRequest {
                lsl: None,
                usl: None,
                wafer: None,
                test: Some(test),
                mode: MapMode::Value,
                filter: filter.clone(),
            },
        );
        assert!(all.is_mean, "all-wafer map is the mean map");
        assert!(all.wafer_count >= 1, "all-wafer map has wafers");
        assert!(!all.dice.is_empty(), "all-wafer map dice");
        assert_eq!(all.pass + all.fail, ds.rows, "all-wafer yield counts source dice");

        let pa = pareto(
            &ds,
            &ParetoRequest {
                category: BinCategory::Hard,
                filter: filter.clone(),
                top: Some(20),
                group_by: None,
            },
        );
        assert!(!pa.bars.is_empty(), "pareto bars");
        assert!(pa.bars.iter().all(|b| !b.pass), "pareto excludes pass bins");
        assert!(pa.bars.iter().all(|b| !b.name.is_empty()), "pareto names");
        assert_eq!(pa.mode, ParetoMode::Global);
        assert!(pa.yield_pct >= 0.0 && pa.yield_pct <= 100.0);

        let pg = pareto(
            &ds,
            &ParetoRequest {
                category: BinCategory::Hard,
                filter: filter.clone(),
                top: Some(5),
                group_by: Some("lot".to_string()),
            },
        );
        assert_eq!(pg.mode, ParetoMode::Grouped);
        assert!(!pg.groups.is_empty());
        assert!(pg.series.iter().all(|s| !s.pass));
        assert_eq!(pg.series[0].counts.len(), pg.groups.len());

        let hi = histogram(
            &ds,
            &HistRequest {
                test,
                filter: filter.clone(),
                bins: Some(40),
                group_by: None,
            },
        );
        assert_eq!(hi.counts.len(), 40);
        assert!(hi.counts.iter().map(|c| *c as usize).sum::<usize>() > 0);

        let tr = trend(
            &ds,
            &TrendRequest {
                test,
                by: "wafer".to_string(),
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
                group_by: None,
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
                x_axis: "wafer".to_string(),
                group_by: Some("Split".to_string()),
                filter: Filter::default(),
                max_points: None,
            },
        );
        assert!(
            bx2.groups.iter().any(|g| g.group_label == "Split A"),
            "box group label"
        );

        let sc_cat = scatter(
            &ds2,
            &ScatterRequest {
                x_test: test,
                y_test: other,
                z_mode: ScatterZMode::Category,
                z_test: None,
                z_col: Some("wafer".to_string()),
                group_by: None,
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
                group_by: None,
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

    #[test]
    fn pooled_outlier_limits_span_selected_wafers_for_single_map() {
        let mut ds = Dataset::new();
        ds.lots = vec!["L".to_string()];
        ds.wafers = vec![
            WaferInfo {
                lot: 0,
                name: "W1".to_string(),
                dice: 5,
                x_min: 0,
                x_max: 4,
                y_min: 0,
                y_max: 0,
                diameter_mm: None,
                die_w_mm: None,
                die_h_mm: None,
                center_x: None,
                center_y: None,
                flat: None,
            },
            WaferInfo {
                lot: 0,
                name: "W2".to_string(),
                dice: 5,
                x_min: 0,
                x_max: 4,
                y_min: 0,
                y_max: 0,
                diameter_mm: None,
                die_w_mm: None,
                die_h_mm: None,
                center_x: None,
                center_y: None,
                flat: None,
            },
        ];
        ds.rows = 10;
        ds.lot_of_row = vec![0; 10];
        ds.wafer_of_row = vec![0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
        ds.x = vec![0, 1, 2, 3, 4, 0, 1, 2, 3, 4];
        ds.y = vec![0; 10];
        ds.hbin = vec![1; 10];
        ds.sbin = vec![1; 10];
        let mut test = TestInfo::new("V");
        test.count = 10;
        ds.tests = vec![test];
        ds.cols = vec![vec![0.0, 0.0, 0.0, 0.0, 100.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0]];

        let filter = Filter {
            stat: Some(StatFilter {
                kind: StatKind::Sigma,
                k: 1.0,
                per_wafer: false,
            }),
            ..Filter::default()
        };
        let pooled = wafer_map(
            &ds,
            &MapRequest {
                lsl: None,
                usl: None,
                wafer: Some(0),
                test: Some(0),
                mode: MapMode::Value,
                filter: filter.clone(),
            },
        );
        assert_eq!(
            pooled.dice.len(),
            5,
            "pooled limits must use both selected wafers"
        );
        assert_eq!(pooled.excluded, 0, "no wafer-0 die is a pooled outlier");

        let mut per_wafer_filter = filter.clone();
        per_wafer_filter.stat.as_mut().unwrap().per_wafer = true;
        let per_wafer = wafer_map(
            &ds,
            &MapRequest {
                lsl: None,
                usl: None,
                wafer: Some(0),
                test: Some(0),
                mode: MapMode::Value,
                filter: per_wafer_filter,
            },
        );
        assert_eq!(per_wafer.dice.len(), 4, "wafer-0 limits drop the 100 value");
        assert_eq!(per_wafer.excluded, 1);

        let mean = wafer_map(
            &ds,
            &MapRequest {
                lsl: None,
                usl: None,
                wafer: None,
                test: Some(0),
                mode: MapMode::Value,
                filter,
            },
        );
        assert!(mean.is_mean);
        assert_eq!(mean.wafer_count, 2);
        assert_eq!(mean.dice.len(), 5, "one mean die per coordinate");
        let at_zero = mean.dice.iter().find(|d| d.x == 0).unwrap();
        assert!((at_zero.v - 500.0).abs() < 1e-3, "mean of 0 and 1000");
    }
}
