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
        groups.push(BoxGroup {
            key: k,
            label: label(ds, req.group_by, k, multi_lot),
            n,
            values,
            xs,
            ys,
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
                filter,
            },
        );
        assert!(!tr.points.is_empty(), "trend points");
        assert!(tr.points.iter().all(|p| p.n > 0));
    }
}
