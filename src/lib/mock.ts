import type {
  BinInfo,
  BinOverviewResponse,
  BoxResponse,
  CsvInspection,
  CustomColumn,
  DatasetInfo,
  Filter,
  HistResponse,
  MapResponse,
  ParetoGroup,
  ParetoResponse,
  ParetoSeries,
  ScatterPoint,
  ScatterResponse,
  ScatterSeries,
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
  customCols: CustomColumn[];
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
  const tests: TestInfo[] = TEST_DEFS.map((d, i) => ({
    number: 1001 + i,
    name: d.name,
    units: d.units,
    loLimit: null,
    hiLimit: null,
    loSpec: d.lsl,
    hiSpec: d.usl,
    count: 0,
    limitConflict: false,
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
      name: hbinNames[code] ?? `HBIN ${code}`,
      count,
      pass: code === 1,
    }))
    .sort((a, b) => a.code - b.code);
  const sbins: BinInfo[] = [...sbinCounts.entries()]
    .map(([code, count]) => ({
      code,
      name: code === 1 ? "Pass" : `SBIN ${code}`,
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
    dieWMm: 300 / (2 * RADIUS + 1),
    dieHMm: 300 / (2 * RADIUS + 1),
    centerX: 0,
    centerY: 0,
    flat: "D",
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
    sites: [0, 1, 2, 3],
    files: ["demo_L24-0417.stdf", "demo_L24-0421.stdf"],
    lots,
    wafers: waferInfos,
    tests,
    rows,
    hbins,
    sbins,
    customColumns: [],
    memoryMb: (rows * (2 + 2 + 2 + 2 + 2 + 2) + rows * tests.length * 4) / (1024 * 1024),
  };
  return { lots, wafers, tests, customCols: [], info };
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
  if (f.sites?.length && !f.sites.includes(i % 4)) return false;
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

function refreshInfo(ds: MockDataset): DatasetInfo {
  ds.info = {
    ...ds.info,
    customColumns: ds.customCols.map((c) => ({
      name: c.name,
      categories: [...c.categories],
      waferValues: [...c.waferValues],
    })),
  };
  return ds.info;
}

function customLabel(col: CustomColumn, code: number): string {
  return col.categories[code] || "Unassigned";
}

function categoryFor(
  ds: MockDataset,
  w: MockWafer,
  i: number,
  col: string
): { code: number; name: string } {
  switch (col) {
    case "wafer":
      return { code: w.index, name: labelOf(w, ds.lots.length > 1) };
    case "hbin":
      return { code: w.hbin[i], name: `HBIN ${w.hbin[i]}` };
    case "site":
      return { code: i % 4, name: `Site ${i % 4}` };
    case "sbin":
      return { code: w.sbin[i], name: `SBIN ${w.sbin[i]}` };
    case "none":
    case "":
      return { code: 0, name: "" };
    case "lot":
      return { code: w.lot, name: ds.lots[w.lot] };
    default: {
      const c = ds.customCols.find((x) => x.name === col);
      if (!c) return { code: w.lot, name: ds.lots[w.lot] };
      const code = c.waferValues[w.index] ?? 0;
      return { code, name: customLabel(c, code) };
    }
  }
}

function scatterCategory(
  ds: MockDataset,
  w: MockWafer,
  i: number,
  col: string
): { code: number; name: string } {
  const c = categoryFor(ds, w, i, col || "lot");
  return c.name ? c : { code: w.lot, name: ds.lots[w.lot] };
}

function scatterGroupLabel(ds: MockDataset, col: string): string {
  switch (col) {
    case "lot":
    case "":
      return "Lot";
    case "wafer":
      return "Wafer ID (OCR)";
    case "hbin":
      return "HBIN";
    case "site":
      return "Site";
    case "sbin":
      return "SBIN";
    default:
      return ds.customCols.find((c) => c.name === col)?.name ?? "Lot";
  }
}

function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
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

export function getDatasetInfo(): DatasetInfo { return dataset().info; }

export async function inspectCsv(_path: string): Promise<CsvInspection> {
  return delay({
    headers: ["Lot", "Wafer", "X", "Y", "HBIN", "Vt [V]"],
    headerLine: 1,
    delimiter: ",",
    mapping: { lot: 0, wafer: 1, x: 2, y: 3, hbin: 4, sbin: null },
    missing: [],
    longFormat: false,
  });
}

export async function boxPlot(req: {
  test: number;
  xAxis: string;
  groupBy?: string | null;
  filter: Filter;
  maxPoints?: number;
}): Promise<BoxResponse> {
  const ds = dataset();
  const buckets = new Map<
    string,
    {
      xKey: number;
      xLabel: string;
      groupKey: number;
      groupLabel: string;
      values: number[];
      xs: number[];
      ys: number[];
    }
  >();
  const xAxis = req.xAxis || "wafer";
  const groupBy = req.groupBy && req.groupBy !== "none" ? req.groupBy : null;

  for (const w of ds.wafers) {
    if (!waferAllowed(w, req.filter)) continue;
    const col = w.cols[req.test];
    if (!col) continue;
    for (let i = 0; i < col.length; i++) {
      if (!binAllowed(w, i, req.filter)) continue;
      const v = col[i];
      if (!Number.isFinite(v)) continue;
      const x = categoryFor(ds, w, i, xAxis);
      const g = groupBy ? categoryFor(ds, w, i, groupBy) : { code: 0, name: "" };
      const key = `${x.code}|${g.code}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          xKey: x.code,
          xLabel: x.name,
          groupKey: g.code,
          groupLabel: g.name,
          values: [],
          xs: [],
          ys: [],
        };
        buckets.set(key, bucket);
      }
      bucket.values.push(v);
      bucket.xs.push(w.x[i]);
      bucket.ys.push(w.y[i]);
    }
  }

  const ordered = [...buckets.values()].sort(
    (a, b) => naturalCompare(a.xLabel, b.xLabel) || naturalCompare(a.groupLabel, b.groupLabel)
  );
  let excluded = 0;
  const all: number[] = [];
  if (req.filter.stat) {
    const sf = req.filter.stat;
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
      for (const v of nv) all.push(v);
    }
    excluded = flat.length - all.length;
  } else {
    for (const g of ordered) {
      for (const v of g.values) all.push(v);
    }
  }

  const summary = summarize(all);
  const test = ds.tests[req.test];
  const { cp, cpk } = cpCpk(all, test?.loSpec ?? null, test?.hiSpec ?? null);
  return delay({
    groups: ordered.map((g) => ({
      summary: summarize(g.values),
      positiveSummary: summarize(g.values.filter((v) => v > 0)),
      xKey: g.xKey,
      xLabel: g.xLabel,
      groupKey: g.groupKey,
      groupLabel: g.groupLabel,
      values: g.values,
      xs: g.xs,
      ys: g.ys,
      n: g.values.length,
    })),
    summary,
    test:
      test ??
      {
        number: null,
        name: "?",
        units: "",
        loLimit: null,
        hiLimit: null,
        loSpec: null,
        hiSpec: null,
        count: 0,
        limitConflict: false,
      },
    lsl: test?.loSpec ?? null,
    usl: test?.hiSpec ?? null,
    cp,
    cpk,
    excluded,
    truncated: false,
  });
}

export async function waferMap(req: {
  lsl?: number | null;
  usl?: number | null;
  wafer: number | null;
  test: number | null;
  mode: "value" | "bin";
  filter: Filter;
}): Promise<MapResponse> {
  const ds = dataset();
  const selected =
    req.wafer !== null
      ? ds.wafers.filter((w) => w.index === req.wafer && waferAllowed(w, req.filter))
      : ds.wafers.filter((w) => waferAllowed(w, req.filter));
  const isMean = req.wafer === null;
  if (selected.length === 0) {
    return delay({
      wafer: null,
      lotName: "",
      dice: [],
      test: req.test !== null ? ds.tests[req.test] : null,
      lsl: null,
      usl: null,
      vmin: NaN,
      vmax: NaN,
      pass: 0,
      fail: 0,
      yieldPct: 0,
      isMean,
      waferCount: 0,
      excluded: 0,
    });
  }

  const test = req.test !== null ? ds.tests[req.test] : null;
  const colOf = (w: MockWafer) => (req.test !== null ? w.cols[req.test] : undefined);
  const rowW: MockWafer[] = [];
  const rowI: number[] = [];
  for (const w of selected) {
    for (let i = 0; i < w.x.length; i++) {
      if (binAllowed(w, i, req.filter)) {
        rowW.push(w);
        rowI.push(i);
      }
    }
  }

  const rowKeep = rowW.map(() => true);
  let excluded = 0;
  if (req.mode === "value" && req.filter.stat && req.test !== null) {
    const sf = req.filter.stat;
    const valuesFor = (idxs: number[]) => {
      const vals: number[] = [];
      for (const j of idxs) {
        const v = colOf(rowW[j])?.[rowI[j]] ?? NaN;
        if (Number.isFinite(v)) vals.push(v);
      }
      return vals;
    };
    if (sf.perWafer) {
      for (const w of selected) {
        const idxs = rowW.map((rw, j) => (rw === w ? j : -1)).filter((j) => j >= 0);
        const allowed = keepMask(valuesFor(idxs), sf.kind, sf.k);
        let k = 0;
        for (const j of idxs) {
          const v = colOf(rowW[j])?.[rowI[j]] ?? NaN;
          if (!Number.isFinite(v)) {
            rowKeep[j] = false;
            continue;
          }
          if (!allowed[k++]) {
            rowKeep[j] = false;
            excluded++;
          }
        }
      }
    } else {
      // Pooled limits are computed over every selected wafer, even when the
      // map request itself is for a single wafer.
      const pool =
        req.wafer === null
          ? selected
          : ds.wafers.filter((w) => waferAllowed(w, req.filter));
      const poolVals: number[] = [];
      const poolKeys: string[] = [];
      for (const w of pool) {
        const col = colOf(w);
        if (!col) continue;
        for (let i = 0; i < w.x.length; i++) {
          if (!binAllowed(w, i, req.filter)) continue;
          const v = col[i];
          if (Number.isFinite(v)) {
            poolVals.push(v);
            poolKeys.push(`${w.index}:${i}`);
          }
        }
      }
      const allowed = keepMask(poolVals, sf.kind, sf.k);
      const allowedKeys = new Set<string>();
      allowed.forEach((ok, i) => {
        if (ok) allowedKeys.add(poolKeys[i]);
      });
      for (let j = 0; j < rowW.length; j++) {
        const v = colOf(rowW[j])?.[rowI[j]] ?? NaN;
        if (!Number.isFinite(v)) {
          rowKeep[j] = false;
          continue;
        }
        if (!allowedKeys.has(`${rowW[j].index}:${rowI[j]}`)) {
          rowKeep[j] = false;
          excluded++;
        }
      }
    }
  }

  const byCoord = new Map<
    string,
    { x: number; y: number; sum: number; n: number; hb: Map<number, number>; sb: Map<number, number> }
  >();
  for (let j = 0; j < rowW.length; j++) {
    if (!rowKeep[j]) continue;
    const w = rowW[j];
    const i = rowI[j];
    const key = `${w.x[i]},${w.y[i]}`;
    let acc = byCoord.get(key);
    if (!acc) {
      acc = { x: w.x[i], y: w.y[i], sum: 0, n: 0, hb: new Map(), sb: new Map() };
      byCoord.set(key, acc);
    }
    acc.hb.set(w.hbin[i], (acc.hb.get(w.hbin[i]) ?? 0) + 1);
    acc.sb.set(w.sbin[i], (acc.sb.get(w.sbin[i]) ?? 0) + 1);
    const v = colOf(w)?.[i] ?? NaN;
    if (req.mode === "value" && Number.isFinite(v)) {
      acc.sum += v;
      acc.n++;
    }
  }

  const majority = (m: Map<number, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
  const dice = [...byCoord.values()]
    .filter((a) => req.mode === "bin" || a.n > 0)
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((a) => ({
      x: a.x,
      y: a.y,
      v: req.mode === "value" ? a.sum / a.n : majority(a.hb),
      hbin: majority(a.hb),
      sbin: majority(a.sb),
    }));
  let pass = 0;
  let fail = 0;
  let vmin = Infinity;
  let vmax = -Infinity;
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const d of dice) {
    if (req.mode === "value") {
      vmin = Math.min(vmin, d.v);
      vmax = Math.max(vmax, d.v);
    }
    xMin = Math.min(xMin, d.x);
    xMax = Math.max(xMax, d.x);
    yMin = Math.min(yMin, d.y);
    yMax = Math.max(yMax, d.y);
    if (d.hbin === 1) pass++;
    else fail++;
  }

  // Wafer yield uses every tested die, independently of plot filters and
  // coordinate averaging. Test yield uses considered source measurements.
  pass = 0;
  fail = 0;
  for (const w of selected) {
    for (const bin of w.hbin) { if (bin === 1) pass++; else fail++; }
  }
  const lsl = req.lsl ?? test?.loSpec ?? null;
  const usl = req.usl ?? test?.hiSpec ?? null;
  let testPass = 0;
  let testFail = 0;
  const validLimits = (lsl !== null || usl !== null) &&
    (lsl === null || Number.isFinite(lsl)) && (usl === null || Number.isFinite(usl)) &&
    (lsl === null || usl === null || lsl <= usl);
  if (validLimits) {
    for (let j = 0; j < rowW.length; j++) {
      if (!rowKeep[j]) continue;
      const v = colOf(rowW[j])?.[rowI[j]] ?? NaN;
      if (!Number.isFinite(v)) continue;
      if ((lsl === null || v >= lsl) && (usl === null || v <= usl)) testPass++;
      else testFail++;
    }
  }
  const first = selected[0];
  const baseWafer = ds.info.wafers[first.index];
  const wafer = isMean
    ? {
        ...baseWafer,
        name: "All wafers (mean)",
        dice: dice.length,
        xMin: dice.length ? xMin : baseWafer.xMin,
        xMax: dice.length ? xMax : baseWafer.xMax,
        yMin: dice.length ? yMin : baseWafer.yMin,
        yMax: dice.length ? yMax : baseWafer.yMax,
      }
    : baseWafer;

  return delay({
    wafer,
    testPass,
    testFail,
    testYieldPct: testPass + testFail ? testPass * 100 / (testPass + testFail) : null,
    lotName: isMean ? "All wafers" : ds.lots[first.lot],
    dice,
    test,
    lsl,
    usl,
    vmin: Number.isFinite(vmin) ? vmin : NaN,
    vmax: Number.isFinite(vmax) ? vmax : NaN,
    pass,
    fail,
    yieldPct: pass + fail > 0 ? (pass * 100) / (pass + fail) : 0,
    isMean,
    waferCount: selected.length,
    excluded,
  });
}

export async function binOverview(req: {
  filter: Filter;
  category: "hard" | "soft";
}): Promise<BinOverviewResponse> {
  const ds = dataset();
  const wafers = [];
  for (const w of ds.wafers) {
    if (!waferAllowed(w, req.filter)) continue;
    const byCoord = new Map<string, { x: number; y: number; hb: Map<number, number>; sb: Map<number, number> }>();
    for (let i = 0; i < w.x.length; i++) {
      if (!binAllowed(w, i, req.filter)) continue;
      const key = `${w.x[i]},${w.y[i]}`;
      let acc = byCoord.get(key);
      if (!acc) {
        acc = { x: w.x[i], y: w.y[i], hb: new Map(), sb: new Map() };
        byCoord.set(key, acc);
      }
      acc.hb.set(w.hbin[i], (acc.hb.get(w.hbin[i]) ?? 0) + 1);
      acc.sb.set(w.sbin[i], (acc.sb.get(w.sbin[i]) ?? 0) + 1);
    }
    const majority = (m: Map<number, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
    const dice = [...byCoord.values()]
      .sort((a, b) => a.x - b.x || a.y - b.y)
      .map((a) => ({
        x: a.x,
        y: a.y,
        v: majority(a.hb),
        hbin: majority(a.hb),
        sbin: majority(a.sb),
      }));
    let pass = 0;
    let fail = 0;
    for (const code of w.hbin) {
      if (code === 1) pass++;
      else fail++;
    }
    if (dice.length) {
      wafers.push({
        wafer: ds.info.wafers[w.index],
        lotName: ds.lots[w.lot],
        dice,
        pass,
        fail,
        yieldPct: pass + fail ? (pass * 100) / (pass + fail) : 0,
      });
    }
  }
  return delay({ wafers });
}

export async function pareto(req: {
  category: "hard" | "soft";
  filter: Filter;
  top?: number;
  groupBy?: string | null;
}): Promise<ParetoResponse> {
  const ds = dataset();
  const defs = req.category === "hard" ? ds.info.hbins : ds.info.sbins;
  const nameOf = (code: number) => defs.find((b) => b.code === code)?.name ?? `Bin ${code}`;
  const passOf = (code: number) => code === 1;
  const counts = new Map<number, number>();
  const grouped = new Map<string, { total: number; pass: number; counts: Map<number, number> }>();
  const multiLot = ds.lots.length > 1;
  let total = 0;
  let passTotal = 0;
  for (const w of ds.wafers) {
    if (!waferAllowed(w, req.filter)) continue;
    const codes = req.category === "hard" ? w.hbin : w.sbin;
    for (let i = 0; i < codes.length; i++) {
      if (req.filter.sites?.length && !req.filter.sites.includes(i % 4)) continue;
      const visible = binAllowed(w, i, req.filter);
      const code = codes[i];
      const pass = passOf(code);
      total++;
      if (pass) passTotal++;
      if (visible) counts.set(code, (counts.get(code) ?? 0) + 1);
      if (req.groupBy && req.groupBy !== "none") {
        const label = categoryFor(ds, w, i, req.groupBy).name || ds.lots[w.lot];
        let g = grouped.get(label);
        if (!g) {
          g = { total: 0, pass: 0, counts: new Map() };
          grouped.set(label, g);
        }
        g.total++;
        if (pass) g.pass++;
        if (visible) g.counts.set(code, (g.counts.get(code) ?? 0) + 1);
      }
    }
  }
  const yieldPct = total ? (passTotal * 100) / total : 0;
  const top = req.top ?? 20;
  const failureCodes = [...counts.entries()]
    .filter(([code]) => !passOf(code))
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const failTotal = total - passTotal;

  if (req.groupBy && req.groupBy !== "none") {
    const rows = [...grouped.entries()].sort((a, b) => naturalCompare(a[0], b[0]));
    const groups: ParetoGroup[] = rows.map(([label, g], key) => ({
      key,
      label,
      total: g.total,
      pass: g.pass,
      fail: g.total - g.pass,
      yieldPct: g.total ? (g.pass * 100) / g.total : 0,
    }));
    const selected = failureCodes.slice(0, top);
    const hasOthers = failureCodes.length > selected.length;
    const series: ParetoSeries[] = selected.map(([code]) => {
      const cs = rows.map(([, g]) => g.counts.get(code) ?? 0);
      return {
        code,
        name: nameOf(code),
        counts: cs,
        pcts: cs.map((c, i) => {
          const fail = rows[i][1].total;
          return fail ? (c * 100) / fail : 0;
        }),
        pass: false,
      };
    });
    if (hasOthers) {
      const selectedSet = new Set(selected.map(([code]) => code));
      const cs = rows.map(([, g]) => {
        let n = 0;
        for (const [code, count] of g.counts) {
          if (!selectedSet.has(code) && !passOf(code)) n += count;
        }
        return n;
      });
      series.push({
        code: 0xffff,
        name: "Others",
        counts: cs,
        pcts: cs.map((c, i) => {
          const fail = rows[i][1].total;
          return fail ? (c * 100) / fail : 0;
        }),
        pass: false,
      });
    }
    const groupLabel =
      req.groupBy === "site" ? "Site" : req.groupBy === "lot"
        ? "Lot"
        : req.groupBy === "wafer"
          ? "Wafer ID (OCR)"
          : ds.customCols.find((c) => c.name === req.groupBy)?.name ?? "Group";
    return delay({
      mode: "grouped",
      bars: [],
      groups,
      series,
      total,
      failTotal,
      yieldPct,
      groupLabel,
    });
  }

  const bars = failureCodes.slice(0, top).map(([code, count]) => ({
    code,
    name: nameOf(code),
    count,
    pct: total ? (count * 100) / total : 0,
    pass: false,
  }));
  if (failureCodes.length > top) {
    const others = failureCodes.slice(top).reduce((a, [, c]) => a + c, 0);
    bars.push({
      code: 0xffff,
      name: "Others",
      count: others,
      pct: total ? (others * 100) / total : 0,
      pass: false,
    });
  }
  return delay({
    mode: "global",
    bars,
    groups: [],
    series: [],
    total,
    failTotal,
    yieldPct,
    groupLabel: "",
  });
}

export async function histogram(req: {
  test: number;
  filter: Filter;
  bins?: number | null;
  groupBy?: string | null;
}): Promise<HistResponse> {
  const ds = dataset();
  const rows: { v: number; w: MockWafer; i: number }[] = [];
  for (const w of ds.wafers) {
    if (!waferAllowed(w, req.filter)) continue;
    const col = w.cols[req.test];
    if (!col) continue;
    for (let i = 0; i < col.length; i++) {
      if (!binAllowed(w, i, req.filter)) continue;
      const v = col[i];
      if (Number.isFinite(v)) rows.push({ v, w, i });
    }
  }
  const before = rows.length;
  let kept = rows;
  if (req.filter.stat) {
    const keep = keepMask(rows.map((r) => r.v), req.filter.stat.kind, req.filter.stat.k);
    kept = rows.filter((_, i) => keep[i]);
  }
  const vals = kept.map((r) => r.v);
  const summary = summarize(vals);
  const test = ds.tests[req.test];
  if (vals.length === 0) {
    return delay({
      edges: [],
      counts: [],
      groups: [],
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
    const w = iqr > 0 ? (2 * iqr) / Math.cbrt(vals.length) : 0;
    nBins = w > 0 ? Math.ceil((summary.max - summary.min) / w) : Math.ceil(Math.sqrt(vals.length));
    nBins = Math.min(120, Math.max(8, nBins));
  }
  const lo = summary.min;
  const hi = summary.max;
  const width = hi > lo ? (hi - lo) / nBins : 1;
  const edges = Array.from({ length: nBins + 1 }, (_, i) => lo + width * i);
  const binIndex = (v: number) => {
    let idx = Math.floor((v - lo) / width);
    if (idx < 0) idx = 0;
    if (idx >= nBins) idx = nBins - 1;
    return idx;
  };
  const counts = new Array(nBins).fill(0);
  for (const v of vals) counts[binIndex(v)]++;

  const groupBy = req.groupBy && req.groupBy !== "none" ? req.groupBy : null;
  const grouped = new Map<string, { key: number; label: string; counts: number[] }>();
  if (groupBy) {
    for (const r of kept) {
      const c = categoryFor(ds, r.w, r.i, groupBy);
      let g = grouped.get(c.name);
      if (!g) {
        g = { key: c.code, label: c.name, counts: new Array(nBins).fill(0) };
        grouped.set(c.name, g);
      }
      g.counts[binIndex(r.v)]++;
    }
  }
  const groups = [...grouped.values()].sort((a, b) => naturalCompare(a.label, b.label));
  return delay({
    edges,
    counts,
    groups,
    summary,
    test,
    lsl: test?.loSpec ?? null,
    usl: test?.hiSpec ?? null,
    excluded: before - kept.length,
  });
}

export async function trend(req: {
  test: number;
  by: string;
  filter: Filter;
}): Promise<TrendResponse> {
  const ds = dataset();
  const buckets = new Map<string, { label: string; values: number[] }>();
  for (const w of ds.wafers) {
    if (!waferAllowed(w, req.filter)) continue;
    const col = w.cols[req.test];
    if (!col) continue;
    for (let i = 0; i < col.length; i++) {
      if (!binAllowed(w, i, req.filter)) continue;
      const v = col[i];
      if (!Number.isFinite(v)) continue;
      const c = categoryFor(ds, w, i, req.by || "wafer");
      let b = buckets.get(c.name);
      if (!b) {
        b = { label: c.name, values: [] };
        buckets.set(c.name, b);
      }
      b.values.push(v);
    }
  }
  const points = [...buckets.values()]
    .sort((a, b) => naturalCompare(a.label, b.label))
    .map((b) => {
      const m = mean(b.values);
      const sd = stdDev(b.values, m);
      let min = Infinity;
      let max = -Infinity;
      for (const v of b.values) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      return {
        label: b.label,
        mean: m,
        min,
        max,
        sd,
        n: b.values.length,
      };
    });
  const test = ds.tests[req.test];
  return delay({ points, test, lsl: test?.loSpec ?? null, usl: test?.hiSpec ?? null });
}

export async function scatter(req: {
  xTest: number;
  yTest: number;
  zMode: "none" | "continuous" | "category";
  zTest?: number | null;
  zCol?: string | null;
  groupBy?: string | null;
  filter: Filter;
  maxPoints?: number;
}): Promise<ScatterResponse> {
  const ds = dataset();
  const xTest = ds.tests[req.xTest] ?? {
    number: null,
    name: "?",
    units: "",
    loLimit: null,
    hiLimit: null,
    loSpec: null,
    hiSpec: null,
    count: 0,
    limitConflict: false,
  };
  const yTest = ds.tests[req.yTest] ?? xTest;
  const multiLot = ds.lots.length > 1;
  const zTest = req.zMode === "continuous" && req.zTest != null ? ds.tests[req.zTest] ?? null : null;
  const groupCol =
    req.zMode === "category"
      ? req.zCol ?? "lot"
      : req.groupBy && req.groupBy !== "none"
        ? req.groupBy
        : null;
  const groupLabel = groupCol ? scatterGroupLabel(ds, groupCol) : "";
  const zColLabel =
    req.zMode === "continuous" ? zTest?.name ?? "Z" : groupLabel;

  interface Raw {
    x: number;
    y: number;
    z: number | null;
    lot: number;
    wafer: number;
    hbin: number;
    sbin: number;
    xDie: number;
    yDie: number;
    code?: number;
    name?: string;
  }
  let points: Raw[] = [];
  let excluded = 0;
  for (const w of ds.wafers) {
    if (!waferAllowed(w, req.filter)) continue;
    const xc = w.cols[req.xTest];
    const yc = w.cols[req.yTest];
    if (!xc || !yc) continue;
    const zc = req.zMode === "continuous" && req.zTest != null ? w.cols[req.zTest] : undefined;
    for (let i = 0; i < w.x.length; i++) {
      if (!binAllowed(w, i, req.filter)) continue;
      const x = xc[i];
      const y = yc[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const z = zc && Number.isFinite(zc[i]) ? zc[i] : null;
      const cat = groupCol ? scatterCategory(ds, w, i, groupCol) : null;
      points.push({
        x,
        y,
        z,
        lot: w.lot,
        wafer: w.index,
        hbin: w.hbin[i],
        sbin: w.sbin[i],
        xDie: w.x[i],
        yDie: w.y[i],
        code: cat?.code,
        name: cat?.name,
      });
    }
  }

  if (req.filter.stat) {
    const sf = req.filter.stat;
    const before = points.length;
    const keepX = keepMask(points.map((p) => p.x), sf.kind, sf.k);
    const keepY = keepMask(points.map((p) => p.y), sf.kind, sf.k);
    points = points.filter((_, i) => keepX[i] && keepY[i]);
    excluded = before - points.length;
  }

  const total = points.length;
  const cap = Math.max(1, req.maxPoints ?? 30000);
  const stride = total > cap ? Math.ceil(total / cap) : 1;
  const sampled = points.filter((_, i) => i % stride === 0);
  const r = pearson(
    points.map((p) => p.x),
    points.map((p) => p.y)
  );
  let zMin: number | null = null;
  let zMax: number | null = null;
  for (const p of sampled) {
    if (p.z !== null) {
      zMin = zMin === null ? p.z : Math.min(zMin, p.z);
      zMax = zMax === null ? p.z : Math.max(zMax, p.z);
    }
  }
  const toPoint = (p: Raw): ScatterPoint => ({
    x: p.x,
    y: p.y,
    z: p.z,
    lot: p.lot,
    wafer: p.wafer,
    hbin: p.hbin,
    sbin: p.sbin,
    xDie: p.xDie,
    yDie: p.yDie,
  });

  let series: ScatterSeries[] = [];
  if (groupCol) {
    const map = new Map<number, ScatterSeries>();
    for (const p of sampled) {
      const code = p.code ?? 0;
      const name = p.name ?? "Unassigned";
      let s = map.get(code);
      if (!s) {
        s = { key: code, name, points: [] };
        map.set(code, s);
      }
      s.points.push(toPoint(p));
    }
    series = [...map.values()];
    if (req.zMode === "category" && series.length > 16) {
      series.sort((a, b) => b.points.length - a.points.length);
      const rest = series.splice(16);
      const other: ScatterSeries = { key: 65535, name: "Other", points: [] };
      for (const s of rest) {
        for (const p of s.points) other.points.push(p);
      }
      series.push(other);
    }
    series.sort((a, b) => naturalCompare(a.name, b.name) || a.key - b.key);
  } else if (sampled.length) {
    series = [{ key: 0, name: "", points: sampled.map(toPoint) }];
  }

  return delay({
    series,
    xTest,
    yTest,
    zTest,
    zMode: req.zMode,
    zCol: req.zCol ?? null,
    zColLabel,
    groupBy: req.groupBy ?? null,
    groupLabel,
    zMin,
    zMax,
    total,
    excluded,
    truncated: stride > 1,
    r: Number.isFinite(r) ? r : null,
    lots: ds.lots,
    wafers: ds.wafers.map((w) => labelOf(w, multiLot)),
  });
}

export async function addCustomColumn(
  name: string,
  assignments: { wafer: number; label: string }[]
): Promise<DatasetInfo> {
  const ds = dataset();
  const clean = name.trim();
  if (!clean) throw new Error("Enter a column name.");
  if (["lot", "wafer", "hbin", "sbin", "site", "__wafer"].some((r) => r === clean.toLowerCase())) {
    throw new Error(`“${clean}” is a reserved column name.`);
  }
  let col = ds.customCols.find((c) => c.name === clean);
  if (!col) {
    col = { name: clean, categories: [""], waferValues: new Array(ds.wafers.length).fill(0) };
    ds.customCols.push(col);
  }
  for (const a of assignments) {
    if (a.wafer < 0 || a.wafer >= ds.wafers.length) continue;
    const label = a.label.trim();
    if (!label) {
      col.waferValues[a.wafer] = 0;
      continue;
    }
    let code = col.categories.indexOf(label);
    if (code < 0) {
      col.categories.push(label);
      code = col.categories.length - 1;
    }
    col.waferValues[a.wafer] = code;
  }
  if (col.categories.length <= 1) throw new Error("Assign at least one wafer label.");
  return delay(refreshInfo(ds));
}

export async function removeCustomColumn(name: string): Promise<DatasetInfo> {
  const ds = dataset();
  ds.customCols = ds.customCols.filter((c) => c.name !== name);
  return delay(refreshInfo(ds));
}

export async function restoreCustomColumns(columns: CustomColumn[]): Promise<DatasetInfo> {
  const ds = dataset();
  for (const c of columns) {
    if (c.waferValues.length !== ds.wafers.length) {
      throw new Error(
        `Column “${c.name}” has ${c.waferValues.length} wafer labels but the demo has ${ds.wafers.length} wafers.`
      );
    }
  }
  ds.customCols = columns.map((c) => ({
    name: c.name,
    categories: [...c.categories],
    waferValues: [...c.waferValues],
  }));
  return delay(refreshInfo(ds));
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
