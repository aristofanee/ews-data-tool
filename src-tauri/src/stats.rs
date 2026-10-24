use crate::model::{StatFilter, StatKind};
use serde::Serialize;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub n: usize,
    pub mean: f32,
    pub sd: f32,
    pub min: f32,
    pub max: f32,
    pub q1: f32,
    pub median: f32,
    pub q3: f32,
    pub whisker_lo: f32,
    pub whisker_hi: f32,
}

pub fn mean(v: &[f32]) -> f32 {
    if v.is_empty() {
        return f32::NAN;
    }
    let s: f64 = v.iter().map(|x| *x as f64).sum();
    (s / v.len() as f64) as f32
}

pub fn std_dev(v: &[f32], m: f32) -> f32 {
    if v.len() < 2 {
        return 0.0;
    }
    let s: f64 = v
        .iter()
        .map(|x| {
            let d = *x as f64 - m as f64;
            d * d
        })
        .sum();
    (s / (v.len() as f64 - 1.0)).sqrt() as f32
}

/// Linear-interpolated quantile (type 7), `sorted` must be ascending.
pub fn quantile_sorted(sorted: &[f32], q: f64) -> f32 {
    if sorted.is_empty() {
        return f32::NAN;
    }
    if sorted.len() == 1 {
        return sorted[0];
    }
    let pos = q.clamp(0.0, 1.0) * (sorted.len() - 1) as f64;
    let lo = pos.floor() as usize;
    let hi = pos.ceil() as usize;
    let frac = (pos - lo as f64) as f32;
    sorted[lo] + (sorted[hi] - sorted[lo]) * frac
}

pub fn summarize(values: &[f32]) -> Summary {
    let mut v: Vec<f32> = values.iter().copied().filter(|x| x.is_finite()).collect();
    if v.is_empty() {
        return Summary::default();
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let m = mean(&v);
    let sd = std_dev(&v, m);
    let q1 = quantile_sorted(&v, 0.25);
    let med = quantile_sorted(&v, 0.5);
    let q3 = quantile_sorted(&v, 0.75);
    let iqr = q3 - q1;
    let lo_fence = q1 - 1.5 * iqr;
    let hi_fence = q3 + 1.5 * iqr;
    let whisker_lo = v.iter().copied().find(|x| *x >= lo_fence).unwrap_or(v[0]);
    let whisker_hi = v
        .iter()
        .rev()
        .copied()
        .find(|x| *x <= hi_fence)
        .unwrap_or(*v.last().unwrap());
    Summary {
        n: v.len(),
        mean: m,
        sd,
        min: v[0],
        max: *v.last().unwrap(),
        q1,
        median: med,
        q3,
        whisker_lo,
        whisker_hi,
    }
}

/// Returns true for values that should be kept.
pub fn keep_mask(values: &[f32], sf: &StatFilter) -> Vec<bool> {
    let n = values.len();
    match sf.kind {
        StatKind::Sigma => {
            let m = mean(values);
            let sd = std_dev(values, m);
            if !sd.is_finite() || sd == 0.0 {
                return vec![true; n];
            }
            let lim = sf.k * sd;
            values.iter().map(|v| (v - m).abs() <= lim).collect()
        }
        StatKind::Iqr => {
            let mut sorted: Vec<f32> = values.iter().copied().filter(|v| v.is_finite()).collect();
            sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            if sorted.is_empty() {
                return vec![true; n];
            }
            let q1 = quantile_sorted(&sorted, 0.25);
            let q3 = quantile_sorted(&sorted, 0.75);
            let iqr = q3 - q1;
            let lo = q1 - sf.k * iqr;
            let hi = q3 + sf.k * iqr;
            values.iter().map(|v| *v >= lo && *v <= hi).collect()
        }
        StatKind::Percentile => vec![true; n],
    }
}

pub fn cp_cpk(values: &[f32], lsl: Option<f32>, usl: Option<f32>) -> (Option<f32>, Option<f32>) {
    let m = mean(values);
    let sd = std_dev(values, m);
    if !sd.is_finite() || sd <= 0.0 {
        return (None, None);
    }
    let cp = match (lsl, usl) {
        (Some(l), Some(u)) => Some((u - l) / (6.0 * sd)),
        _ => None,
    };
    let cpk = match (lsl, usl) {
        (Some(l), Some(u)) => Some(((u - m) / (3.0 * sd)).min((m - l) / (3.0 * sd))),
        (Some(l), None) => Some((m - l) / (3.0 * sd)),
        (None, Some(u)) => Some((u - m) / (3.0 * sd)),
        _ => None,
    };
    (cp, cpk)
}

/// Natural sort so that wafer 2 comes before wafer 10.
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let mut ai = a.char_indices().peekable();
    let mut bi = b.char_indices().peekable();
    loop {
        match (ai.peek(), bi.peek()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some((_, ca)), Some((_, cb))) => {
                if ca.is_ascii_digit() && cb.is_ascii_digit() {
                    let sa: String = a[ai.peek().unwrap().0..]
                        .chars()
                        .take_while(|c| c.is_ascii_digit())
                        .collect();
                    let sb: String = b[bi.peek().unwrap().0..]
                        .chars()
                        .take_while(|c| c.is_ascii_digit())
                        .collect();
                    let na: u64 = sa.parse().unwrap_or(0);
                    let nb: u64 = sb.parse().unwrap_or(0);
                    match na.cmp(&nb) {
                        std::cmp::Ordering::Equal => {
                            for _ in 0..sa.len() {
                                ai.next();
                            }
                            for _ in 0..sb.len() {
                                bi.next();
                            }
                        }
                        o => return o,
                    }
                } else {
                    match ca.cmp(cb) {
                        std::cmp::Ordering::Equal => {
                            ai.next();
                            bi.next();
                        }
                        o => return o,
                    }
                }
            }
        }
    }
}
