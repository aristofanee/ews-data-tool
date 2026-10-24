import type { Summary } from "../types";

export function mean(v: ArrayLike<number>): number {
  if (v.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i];
  return s / v.length;
}

export function stdDev(v: ArrayLike<number>, m = mean(v)): number {
  if (v.length < 2) return 0;
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    const d = v[i] - m;
    s += d * d;
  }
  return Math.sqrt(s / (v.length - 1));
}

export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const pos = Math.min(1, Math.max(0, q)) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const f = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * f;
}

export function summarize(values: ArrayLike<number>): Summary {
  const v: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const x = values[i];
    if (Number.isFinite(x)) v.push(x);
  }
  if (v.length === 0) {
    return {
      n: 0,
      mean: NaN,
      sd: NaN,
      min: NaN,
      max: NaN,
      q1: NaN,
      median: NaN,
      q3: NaN,
      whiskerLo: NaN,
      whiskerHi: NaN,
    };
  }
  v.sort((a, b) => a - b);
  const m = mean(v);
  const sd = stdDev(v, m);
  const q1 = quantileSorted(v, 0.25);
  const med = quantileSorted(v, 0.5);
  const q3 = quantileSorted(v, 0.75);
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr;
  const hiFence = q3 + 1.5 * iqr;
  let wLo = v[0];
  for (let i = 0; i < v.length; i++) {
    if (v[i] >= loFence) {
      wLo = v[i];
      break;
    }
  }
  let wHi = v[v.length - 1];
  for (let i = v.length - 1; i >= 0; i--) {
    if (v[i] <= hiFence) {
      wHi = v[i];
      break;
    }
  }
  return {
    n: v.length,
    mean: m,
    sd,
    min: v[0],
    max: v[v.length - 1],
    q1,
    median: med,
    q3,
    whiskerLo: wLo,
    whiskerHi: wHi,
  };
}

export function keepMask(values: number[], kind: "sigma" | "iqr", k: number): boolean[] {
  if (kind === "sigma") {
    const m = mean(values);
    const sd = stdDev(values, m);
    if (!Number.isFinite(sd) || sd === 0) return values.map(() => true);
    const lim = k * sd;
    return values.map((v) => Math.abs(v - m) <= lim);
  }
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return values.map(() => true);
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - k * iqr;
  const hi = q3 + k * iqr;
  return values.map((v) => v >= lo && v <= hi);
}

export function cpCpk(
  values: number[],
  lsl: number | null,
  usl: number | null
): { cp: number | null; cpk: number | null } {
  const m = mean(values);
  const sd = stdDev(values, m);
  if (!Number.isFinite(sd) || sd <= 0) return { cp: null, cpk: null };
  const cp = lsl !== null && usl !== null ? (usl - lsl) / (6 * sd) : null;
  let cpk: number | null = null;
  if (lsl !== null && usl !== null) cpk = Math.min((usl - m) / (3 * sd), (m - lsl) / (3 * sd));
  else if (lsl !== null) cpk = (m - lsl) / (3 * sd);
  else if (usl !== null) cpk = (usl - m) / (3 * sd);
  return { cp, cpk };
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Normal distribution pdf, used for the histogram overlay. */
export function normalPdf(x: number, mu: number, sigma: number): number {
  if (!(sigma > 0)) return 0;
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}
