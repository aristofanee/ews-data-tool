import type {
  BinInfo,
  BoxResponse,
  DatasetInfo,
  Filter,
  HistResponse,
  MapResponse,
  ParetoResponse,
  Summary,
  TestInfo,
  TrendResponse,
  WaferInfo,
} from "../types";
import { cpCpk, keepMask, mean, naturalCompare, quantileSorted, stdDev, summarize } from "./stats";

/* ------------------------------------------------------------------ */
/* Synthetic dataset used when the app runs in a plain browser (dev).  */
/* ------------------------------------------------------------------ */

const RADIUS = 38;
const WAFER_COUNT = 25;

interface MockWafer {
  index: number;
  lot: number;
  name: string;
  x: Int16Array;
  y: Int16Array;
  hbin: Uint16Array;
  sbin: Uint16Array;
  cols: Float32Array[];
}

interface MockDataset {
  lots: string[];
  wafers: MockWafer[];
  tests: TestInfo[];
  info: DatasetInfo;
}

interface TestDef {
  name: string;
  units: string;
  base: number;
  sd: number;
  edge: number;
  center: number;
  lsl: number | null;
  usl: number | null;
  log?: boolean;
}

const TEST_DEFS: TestDef[] = [
  { name: "Vt_nch", units: "V", base: 0.412, sd: 0.0062, edge: 0.0075, center: -0.0015, lsl: 0.38, usl: 0.44 },
  { name: "Idsat", units: "uA/um", base: 545, sd: 13, edge: -24, center: 11, lsl: 480, usl: 600 },
  { name: "Rds_on", units: "ohm", base: 12.4, sd: 0.32, edge: 0.6, center: -0.12, lsl: null, usl: 14.2 },
  { name: "Ioff", units: "A", base: -10.2, sd: 0.16, edge: 0.28, center: -0.12, lsl: null, usl: 1e-9, log: true },
  { name: "Vfb", units: "V", base: -0.852, sd: 0.011, edge: 0.005, center: -0.006, lsl: -0.9, usl: -0.8 },
  { name: "Gm", units: "mS/mm", base: 312, sd: 7, edge: -15, center: 7, lsl: 280, usl: 340 },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGauss(rng: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * m;
    return u * m;
  };
}

let cached: MockDataset | null = null;

function buildDataset(): MockDataset {
  const rng = mulberry32(0x5eed1234);
  const gauss = makeGauss(rng);
  const lots = ["L24-0417", "L24-0421"];
  const coords: { x: number; y: number; r: number; r2: number }[] = [];
  for (let y = -RADIUS; y <= RADIUS; y++) {
    for (let x = -RADIUS; x <= RADIUS; x++) {
      const r2 = x * x + y * y;
      if (r2 <= (RADIUS + 0.45) * (RADIUS + 0.45)) {
        coords.push({ x, y, r: Math.sqrt(r2) / RADIUS, r2 });
      }
    }
  }
  const n = coords.length;
  const tests: TestInfo[] = TEST_DEFS.map((d) => ({
    name: d.name,
    units: d.units,
    loLimit: null,
    hiLimit: null,
    loSpec: d.lsl,
    hiSpec: d.usl,
    count: 0,
  }));

  const wafers: MockWafer[] = [];
  let index = 0;
  for (let lot = 0; lot < lots.length; lot++) {
    const lotShift = lot === 0 ? 0 : 0.004;
    for (let w = 0; w < WAFER_COUNT; w++) {
      const name = String(w + 1).padStart(2, "0");
      const xa = new Int16Array(n);
      const ya = new Int16Array(n);
      const hbin = new Uint16Array(n);
      const sbin = new Uint16Array(n);
      for (let i = 0; i < n; i++) {
        xa[i] = coords[i].x;
        ya[i] = coords[i].y;
      }
      const waferFail = 0.012 + gauss() * 0.012;
      const waferBias = (w - 12) * 0.0016 + gauss() * 0.002;

      const cols = TEST_DEFS.map((d) => {
        const arr = new Float32Array(n);
        const shift = gauss() * d.sd * 0.55 + lotShift * (d.log ? 0.5 : 1);
        for (let i = 0; i < n; i++) {
          const c = coords[i];
          const edge = d.edge * Math.pow(c.r, 5);
          const center = d.center * Math.exp(-c.r2 / 120);
          const noise = gauss() * d.sd;
          if (d.log) {
            arr[i] = Math.pow(10, d.base + shift + edge + center * 0.02 + noise);
          } else {
            arr[i] = d.base + shift + edge + center + noise + waferBias * (d.base > 1 ? 6 : 1);
          }
        }
        // missing values
        for (let i = 0; i < n; i++) if (rng() < 0.012) arr[i] = NaN;
        return arr;
      });

      for (let i = 0; i < n; i++) {
        const c = coords[i];
        const pFail =
          0.015 + 0.10 * Math.pow(c.r, 7) + 0.012 * Math.exp(-c.r2 / 260) + Math.max(0, waferFail);
        let code = 1;
        if (rng() < pFail) {
          const u = rng();
          if (c.r > 0.88) code = 20;
          else if (u < 0.36) code = 8;
          else if (u < 0.68) code = 5;
          else if (u < 0.86) code = 2;
          else code = 20;
        }
        hbin[i] = code;
        sbin[i] = code === 1 ? 1 : 100 + code;
      }

      wafers.push({ index, lot, name, x: xa, y: ya, hbin, sbin, cols });
      index++;
    }
  }

  const hbinCounts = new Map<number, number>();
  const sbinCounts = new Map<number, number>();
  for (const w of wafers) {
    for (let i = 0; i < w.hbin.length; i++) {
      hbinCounts.set(w.hbin[i], (hbinCounts.get(w.hbin[i]) ?? 0) + 1);
      sbinCounts.set(w.sbin[i], (sbinCounts.get(w.sbin[i]) ?? 0) + 1);
    }
  }
  const hbinNames: Record<number, string> = {
    1: "Pass",
    2: "Contact / probe",
    5: "Parametric",
    8: "Functional",
    20: "Edge die",
  };
  const hbins: BinInfo[] = [...hbinCounts.entries()]
    .map(([code, count]) => ({
      code,
      name: hbinNames[code] ?? `Bin ${code}`,
      count,
      pass: code === 1,
    }))
    .sort((a, b) => a.code - b.code);
  const sbins: BinInfo[] = [...sbinCounts.entries()]
    .map(([code, count]) => ({
      code,
      name: code === 1 ? "Pass" : `Soft ${code}`,
      count,
      pass: code === 1,
    }))
    .sort((a, b) => a.code - b.code);

  const waferInfos: WaferInfo[] = wafers.map((w) => ({
    lot: w.lot,
    name: w.name,
    dice: w.x.length,
    xMin: -RADIUS,
    xMax: RADIUS,
    yMin: -RADIUS,
    yMax: RADIUS,
    diameterMm: 300,
    dieWMm: 6.4,
    dieHMm: 6.4,
  }));

  for (const t of tests) {
    let c = 0;
    for (const w of wafers) {
      const col = w.cols[tests.indexOf(t)];
      for (let i = 0; i < col.length; i++) if (Number.isFinite(col[i])) c++;
    }
    t.count = c;
  }

  const rows = wafers.reduce((a, w) => a + w.x.length, 0);
  const info: DatasetInfo = {
    files: ["demo_L24-0417.stdf", "demo_L24-0421.stdf"],
    lots,
    wafers: waferInfos,
    tests,
    rows,
    hbins,
    sbins,
    memoryMb: (rows * (2 + 2 + 2 + 2 + 2 + 2) + rows * tests.length * 4) / (1024 * 1024),
  };
  return { lots, wafers, tests, info };
}

function dataset(): MockDataset {
  if (!cached) cached = buildDataset();
  return cached;
}

function delay<T>(v: T, ms = 60): Promise<T> {
  return new Promise((res) => setTimeout(() => res(v), ms));
}

/* ------------------------------------------------------------------ */
/* Query helpers                                                       */
/* ------------------------------------------------------------------ */

function waferAllowed(w: MockWafer, f: Filter): boolean {
  if (f.lots.length && !f.lots.includes(w.lot)) return false;
  if (f.wafers.length && !f.wafers.includes(w.index)) return false;
  return true;
}

function binAllowed(w: MockWafer, i: number, f: Filter): boolean {
  if (f.passOnly && w.hbin[i] !== 1) return false;
  if (f.hbins.length && !f.hbins.includes(w.hbin[i])) return false;
  if (f.sbins.length && !f.sbins.includes(w.sbin[i])) return false;
  return true;
}

function labelOf(w: MockWafer, multiLot: boolean): string {
  return multiLot ? `${dataset().lots[w.lot]} / ${w.name}` : w.name;
}

function emptySummary(): Summary {
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

/* ------------------------------------------------------------------ */
/* Public mock API                                                     */
/* ------------------------------------------------------------------ */

export async function pickFiles(): Promise<string[]> {
  return ["demo_L24-0417.stdf", "demo_L24-0421.stdf"];
}

export async function openPaths(_paths: string[], onProgress?: (pct: number, msg: string) => void): Promise<DatasetInfo> {
  onProgress?.(8, "Reading header...");
  await new Promise((r) => setTimeout(r, 120));
  onProgress?.(42, "Parsing STDF records...");
  const ds = dataset();
  await new Promise((r) => setTimeout(r, 160));
  onProgress?.(88, "Building die matrix...");
  await new Promise((r) => setTimeout(r, 90));
  onProgress?.(100, "Done");
  return ds.info;
}

export async function boxPlot(req: {
  test: number;
  groupBy: "wafer" | "lot";
  filter: Filter;
}): Promise<BoxResponse> {
  const ds = dataset();
  const multiLot = ds.lots.length > 1;
  const groups = new Map<string, { key: number; label: string; values: number[]; xs: number[]; ys: number[] }>();

  for (const w of ds.wafers) {
    if (!waferAllowed(w, req.filter)) continue;
    const key = req.groupBy === "lot" ? w.lot : w.index;
    const k = String(key);
    let g = groups.get(k);
    if (!g) {
      g = {
        key,
        label: req.groupBy === "lot" ? ds.lots[w.lot] : labelOf(w, multiLot),
        values: [],
        xs: [],
        ys: [],
      };
      groups.set(k, g);
    }
    const col = w.cols[req.test];
    if (!col) continue;
    for (let i = 0; i < col.length; i++) {
      if (!binAllowed(w, i, req.filter)) continue;
      const v = col[i];
      if (!Number.isFinite(v)) continue;
      g.values.push(v);
      g.xs.push(w.x[i]);
      g.ys.push(w.y[i]);
    }
  }

  const ordered = [...groups.values()].sort((a, b) => naturalCompare(a.label, b.label));
  let excluded = 0;
  const all: number[] = [];
  if (req.filter.stat) {
    const sf = req.filter.stat;
    if (sf.perWafer) {
      for (const g of ordered) {
        const keep = keepMask(g.values, sf.kind, sf.k);
        const before = g.values.length;
        const nv: number[] = [];
        const nx: number[] = [];
        const ny: number[] = [];
        for (let i = 0; i < g.values.length; i++) {
          if (keep[i]) {
            nv.push(g.values[i]);
            nx.push(g.xs[i]);
            ny.push(g.ys[i]);
          }
        }
        excluded += before - nv.length;
        g.values = nv;
        g.xs = nx;
        g.ys = ny;
        for (let i = 0; i < nv.length; i++) all.push(nv[i]);
      }
    } else {
      const flat = ordered.flatMap((g) => g.values);
      const keep = keepMask(flat, sf.kind, sf.k);
      let idx = 0;
      for (const g of ordered) {
        const nv: number[] = [];
        const nx: number[] = [];
        const ny: number[] = [];
        for (let i = 0; i < g.values.length; i++) {
          if (keep[idx]) {
            nv.push(g.values[i]);
            nx.push(g.xs[i]);
            ny.push(g.ys[i]);
          }
          idx++;
        }
        g.values = nv;
        g.xs = nx;
        g.ys = ny;
        for (let i = 0; i < nv.length; i++) all.push(nv[i]);
      }
      excluded = flat.length - all.length;
    }
  } else {
    for (const g of ordered) for (let i = 0; i < g.values.length; i++) all.push(g.values[i]);
  }

  const summary = summarize(all);
  const test = ds.tests[req.test];
  const { cp, cpk } = cpCpk(all, test?.loSpec ?? null, test?.hiSpec ?? null);
  return delay({
    groups: ordered.map((g) => ({
      key: g.key,
      label: g.label,
      values: g.values,
      xs: g.xs,
      ys: g.ys,
      n: g.values.length,
    })),
    summary,
    test: test ?? { name: "?", units: "", loLimit: null, hiLimit: null, loSpec: null, hiSpec: null, count: 0 },
    lsl: test?.loSpec ?? null,
    usl: test?.hiSpec ?? null,
    cp,
    cpk,
    excluded,
    truncated: false,
  });
}

export async function waferMap(req: {
  wafer: number;
  test: number | null;
  mode: "value" | "bin";
  filter: Filter;
}): Promise<MapResponse> {
  const ds = dataset();
  const w = ds.wafers.find((x) => x.index === req.wafer);
  if (!w) {
    return delay({
      wafer: null,
      lotName: "",
      dice: [],
      test: null,
      lsl: null,
      usl: null,
      vmin: NaN,
      vmax: NaN,
      pass: 0,
      fail: 0,
      yieldPct: 0,
    });
  }
  const dice = [];
  let pass = 0;
  let fail = 0;
  let vmin = Infinity;
  let vmax = -Infinity;
  const col = req.test !== null ? w.cols[req.test] : undefined;
  for (let i = 0; i < w.x.length; i++) {
    if (!binAllowed(w, i, req.filter)) continue;
    const v = req.mode === "bin" ? w.hbin[i] : col ? col[i] : NaN;
    if (req.mode === "value" && Number.isFinite(v)) {
      vmin = Math.min(vmin, v);
      vmax = Math.max(vmax, v);
    }
    if (w.hbin[i] === 1) pass++;
    else fail++;
    dice.push({ x: w.x[i], y: w.y[i], v, hbin: w.hbin[i], sbin: w.sbin[i] });
  }
  const test = req.test !== null ? ds.tests[req.test] : null;
  return delay({
    wafer: ds.info.wafers[w.index],
    lotName: ds.lots[w.lot],
    dice,
    test,
    lsl: test?.loSpec ?? null,
    usl: test?.hiSpec ?? null,
    vmin: Number.isFinite(vmin) ? vmin : NaN,
    vmax: Number.isFinite(vmax) ? vmax : NaN,
    pass,
    fail,
    yieldPct: pass + fail > 0 ? (pass * 100) / (pass + fail) : 0,
  });
}

export async function pareto(req: {
  category: "hard" | "soft";
  filter: Filter;
  top?: number;
  includePass?: boolean;
}): Promise<ParetoResponse> {
  const ds = dataset();
  const counts = new Map<number, number>();
  let total = 0;
  for (const w of ds.wafers) {
    if (!waferAllowed(w, req.filter)) continue;
    const codes = req.category === "hard" ? w.hbin : w.sbin;
    for (let i = 0; i < codes.length; i++) {
      if (!binAllowed(w, i, req.filter)) continue;
      const code = codes[i];
      if (code === 1 && req.includePass !== true) continue;
      counts.set(code, (counts.get(code) ?? 0) + 1);
      total++;
    }
  }
  const defs = req.category === "hard" ? ds.info.hbins : ds.info.sbins;
  const nameOf = (code: number) => defs.find((b) => b.code === code)?.name ?? `Bin ${code}`;
  const passOf = (code: number) => defs.find((b) => b.code === code)?.pass ?? code === 1;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const top = req.top ?? 20;
  const bars = [];
  let cum = 0;
  let others = 0;
  for (let i = 0; i < sorted.length; i++) {
    const [code, count] = sorted[i];
    if (i >= top) {
      others += count;
      continue;
    }
    cum += count;
    bars.push({
      code,
      name: nameOf(code),
      count,
      pct: total ? (count * 100) / total : 0,
      cumPct: total ? (cum * 100) / total : 0,
      pass: passOf(code),
    });
  }
  if (others > 0) {
    bars.push({
      code: 0xffff,
      name: "Others",
      count: others,
      pct: total ? (others * 100) / total : 0,
      cumPct: 100,
      pass: false,
    });
  }
  const failTotal = sorted
    .filter(([code]) => !passOf(code))
    .reduce((a, [, c]) => a + c, 0);
  return delay({ bars, total, failTotal });
}

export async function histogram(req: {
  test: number;
  filter: Filter;
  bins?: number | null;
}): Promise<HistResponse> {
  const ds = dataset();
  const vals: number[] = [];
  for (const w of ds.wafers) {
    if (!waferAllowed(w, req.filter)) continue;
    const col = w.cols[req.test];
    if (!col) continue;
    for (let i = 0; i < col.length; i++) {
      if (!binAllowed(w, i, req.filter)) continue;
      const v = col[i];
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  const before = vals.length;
  let kept = vals;
  if (req.filter.stat) {
    const keep = keepMask(vals, req.filter.stat.kind, req.filter.stat.k);
    kept = vals.filter((_, i) => keep[i]);
  }
  const summary = summarize(kept);
  const test = ds.tests[req.test];
  if (kept.length === 0) {
    return delay({
      edges: [],
      counts: [],
      summary: emptySummary(),
      test,
      lsl: test?.loSpec ?? null,
      usl: test?.hiSpec ?? null,
      excluded: before,
    });
  }
  let nBins = req.bins ?? 0;
  if (!nBins) {
    const iqr = summary.q3 - summary.q1;
    const w = iqr > 0 ? (2 * iqr) / Math.cbrt(kept.length) : 0;
    nBins = w > 0 ? Math.ceil((summary.max - summary.min) / w) : Math.ceil(Math.sqrt(kept.length));
    nBins = Math.min(120, Math.max(8, nBins));
  }
  const lo = summary.min;
  const hi = summary.max;
  const width = hi > lo ? (hi - lo) / nBins : 1;
  const edges = Array.from({ length: nBins + 1 }, (_, i) => lo + width * i);
  const counts = new Array(nBins).fill(0);
  for (const v of kept) {
    let idx = Math.floor((v - lo) / width);
    if (idx < 0) idx = 0;
    if (idx >= nBins) idx = nBins - 1;
    counts[idx]++;
  }
  return delay({
    edges,
    counts,
    summary,
    test,
    lsl: test?.loSpec ?? null,
    usl: test?.hiSpec ?? null,
    excluded: before - kept.length,
  });
}

export async function trend(req: {
  test: number;
  by: "wafer" | "lot";
  filter: Filter;
}): Promise<TrendResponse> {
  const ds = dataset();
  const multiLot = ds.lots.length > 1;
  const buckets = new Map<string, { label: string; values: number[] }>();
  for (const w of ds.wafers) {
    if (!waferAllowed(w, req.filter)) continue;
    const label = req.by === "lot" ? ds.lots[w.lot] : labelOf(w, multiLot);
    let b = buckets.get(label);
    if (!b) {
      b = { label, values: [] };
      buckets.set(label, b);
    }
    const col = w.cols[req.test];
    if (!col) continue;
    for (let i = 0; i < col.length; i++) {
      if (!binAllowed(w, i, req.filter)) continue;
      const v = col[i];
      if (Number.isFinite(v)) b.values.push(v);
    }
  }
  const points = [...buckets.values()]
    .sort((a, b) => naturalCompare(a.label, b.label))
    .map((b) => {
      const m = mean(b.values);
      const sd = stdDev(b.values, m);
      return {
        label: b.label,
        mean: m,
        min: Math.min(...b.values),
        max: Math.max(...b.values),
        sd,
        n: b.values.length,
      };
    });
  const test = ds.tests[req.test];
  return delay({ points, test, lsl: test?.loSpec ?? null, usl: test?.hiSpec ?? null });
}

export async function pickSavePath(defaultName: string): Promise<string | null> {
  return defaultName;
}

export async function pickFolder(): Promise<string | null> {
  return "downloads";
}

export async function saveBinary(path: string, dataUrl: string): Promise<void> {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = path.split(/[\\/]/).pop() || "plot.jpg";
  a.click();
}

export async function saveText(path: string, contents: string): Promise<void> {
  const blob = new Blob([contents], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = path.split(/[\\/]/).pop() || "template.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function readText(_path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return reject(new Error("No file"));
      f.text().then(resolve).catch(reject);
    };
    input.click();
  });
}

export async function exportCsv(_path: string, _filter: Filter): Promise<string> {
  return "CSV export is available in the desktop app.";
}

export function onProgress(cb: (pct: number, msg: string) => void): () => void {
  void cb;
  return () => {};
}
