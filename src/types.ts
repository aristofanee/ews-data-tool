export interface TestInfo {
  name: string;
  units: string;
  loLimit: number | null;
  hiLimit: number | null;
  loSpec: number | null;
  hiSpec: number | null;
  count: number;
}

export interface WaferInfo {
  lot: number;
  name: string;
  dice: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  diameterMm: number | null;
  dieWMm: number | null;
  dieHMm: number | null;
}

export interface BinInfo {
  code: number;
  name: string;
  count: number;
  pass: boolean;
}

export interface CustomColumn {
  name: string;
  /** Index 0 is the unassigned label. */
  categories: string[];
  /** One category code per wafer; 0 = unassigned. */
  waferValues: number[];
}

export interface DatasetInfo {
  files: string[];
  lots: string[];
  wafers: WaferInfo[];
  tests: TestInfo[];
  rows: number;
  hbins: BinInfo[];
  sbins: BinInfo[];
  customColumns: CustomColumn[];
  memoryMb: number;
}

export interface StatFilter {
  kind: "sigma" | "iqr";
  k: number;
  perWafer: boolean;
}

export interface Filter {
  lots: number[];
  wafers: number[];
  hbins: number[];
  sbins: number[];
  passOnly: boolean;
  stat: StatFilter | null;
}

export const emptyFilter = (): Filter => ({
  lots: [],
  wafers: [],
  hbins: [],
  sbins: [],
  passOnly: false,
  stat: null,
});

export interface Summary {
  n: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
  q1: number;
  median: number;
  q3: number;
  whiskerLo: number;
  whiskerHi: number;
}

export interface BoxGroup {
  key: number;
  label: string;
  values: number[];
  xs: number[];
  ys: number[];
  n: number;
  block: string;
  blockCode: number;
}

export interface BoxResponse {
  groups: BoxGroup[];
  summary: Summary;
  test: TestInfo;
  lsl: number | null;
  usl: number | null;
  cp: number | null;
  cpk: number | null;
  excluded: number;
  truncated: boolean;
}

export interface MapDie {
  x: number;
  y: number;
  v: number;
  hbin: number;
  sbin: number;
}

export interface MapResponse {
  wafer: WaferInfo | null;
  lotName: string;
  dice: MapDie[];
  test: TestInfo | null;
  lsl: number | null;
  usl: number | null;
  vmin: number;
  vmax: number;
  pass: number;
  fail: number;
  yieldPct: number;
}

export interface ParetoBar {
  code: number;
  name: string;
  count: number;
  pct: number;
  cumPct: number;
  pass: boolean;
}

export interface ParetoResponse {
  bars: ParetoBar[];
  total: number;
  failTotal: number;
}

export interface HistResponse {
  edges: number[];
  counts: number[];
  summary: Summary;
  test: TestInfo;
  lsl: number | null;
  usl: number | null;
  excluded: number;
}

export interface TrendPoint {
  label: string;
  mean: number;
  min: number;
  max: number;
  sd: number;
  n: number;
}

export interface TrendResponse {
  points: TrendPoint[];
  test: TestInfo;
  lsl: number | null;
  usl: number | null;
}

export type ScatterZMode = "none" | "continuous" | "category";

export interface ScatterPoint {
  x: number;
  y: number;
  z: number | null;
  lot: number;
  wafer: number;
  hbin: number;
  sbin: number;
  xDie: number;
  yDie: number;
}

export interface ScatterSeries {
  key: number;
  name: string;
  points: ScatterPoint[];
}

export interface ScatterResponse {
  series: ScatterSeries[];
  xTest: TestInfo;
  yTest: TestInfo;
  zTest: TestInfo | null;
  zMode: ScatterZMode;
  zCol: string | null;
  zColLabel: string;
  zMin: number | null;
  zMax: number | null;
  total: number;
  excluded: number;
  truncated: boolean;
  r: number | null;
  lots: string[];
  wafers: string[];
}

export type PlotType = "box" | "map" | "pareto" | "hist" | "trend" | "scatter";

export type ShowPoints = "outliers" | "all" | "none";

export interface PlotSpec {
  id: string;
  type: PlotType;
  test: number | null;
  title: string;
  groupBy: "wafer" | "lot";
  logY: boolean;
  showPoints: ShowPoints;
  lsl: number | null;
  usl: number | null;
  showLimits: boolean;
  mapWafer: number | null;
  mapMode: "value" | "bin";
  palette: string;
  edgeExclusion: number;
  binCategory: "hard" | "soft";
  top: number;
  cumulative: boolean;
  includePass: boolean;
  bins: number | null;
  showNormal: boolean;
  showBand: boolean;
  yMin: number | null;
  yMax: number | null;
  /** Larger fonts, thicker lines and stronger markers for slide-sized charts. */
  presentation: boolean;
  /** Lot by default; `__wafer` or a custom column name for box block/colour. */
  blockCol: string;
  scatterX: number | null;
  scatterY: number | null;
  scatterZMode: ScatterZMode;
  scatterZTest: number | null;
  scatterZCol: string;
  scatterFit: boolean;
}

export const defaultSpec = (type: PlotType, test: number | null, title: string): PlotSpec => ({
  id: Math.random().toString(36).slice(2, 10),
  type,
  test,
  title,
  groupBy: "wafer",
  logY: false,
  showPoints: "outliers",
  lsl: null,
  usl: null,
  showLimits: true,
  mapWafer: null,
  mapMode: "value",
  palette: "brand",
  edgeExclusion: 0,
  binCategory: "hard",
  top: 20,
  cumulative: true,
  includePass: false,
  bins: null,
  showNormal: true,
  showBand: true,
  yMin: null,
  yMax: null,
  presentation: true,
  blockCol: "",
  scatterX: null,
  scatterY: null,
  scatterZMode: "none",
  scatterZTest: null,
  scatterZCol: "lot",
  scatterFit: true,
});

export interface ReportItem {
  id: string;
  spec: PlotSpec;
  filters: Filter;
}
