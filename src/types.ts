export interface TestInfo {
  number: number | null;
  name: string;
  units: string;
  loLimit: number | null;
  hiLimit: number | null;
  loSpec: number | null;
  hiSpec: number | null;
  count: number;
  limitConflict: boolean;
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
  centerX: number | null;
  centerY: number | null;
  flat: string | null;
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
  sites?: number[];
  /** Earlier die attempts replaced by the latest imported attempt. */
  retestCount?: number;
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
  /** Missing site metadata uses code 65535. */
  sites?: number[];
  lots: number[];
  wafers: number[];
  hbins: number[];
  sbins: number[];
  stat: StatFilter | null;
}

export const emptyFilter = (): Filter => ({
  lots: [],
  wafers: [],
  hbins: [],
  sbins: [],
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
  summary: Summary;
  positiveSummary: Summary;
  xKey: number;
  xLabel: string;
  groupKey: number;
  groupLabel: string;
  values: number[];
  xs: number[];
  ys: number[];
  n: number;
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
  testPass?: number;
  testFail?: number;
  testYieldPct?: number | null;
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
  /** True for the all-wafer mean map. */
  isMean: boolean;
  /** Number of wafers that contributed to the map. */
  waferCount: number;
  /** Dice removed by the statistical/outlier filter. */
  excluded: number;
}

export interface ParetoBar {
  code: number;
  name: string;
  count: number;
  pct: number;
  pass: boolean;
}

export interface ParetoGroup {
  key: number;
  label: string;
  total: number;
  pass: number;
  fail: number;
  yieldPct: number;
}

export interface ParetoSeries {
  code: number;
  name: string;
  counts: number[];
  pcts: number[];
  pass: boolean;
}

export interface ParetoResponse {
  mode: "global" | "grouped";
  bars: ParetoBar[];
  groups: ParetoGroup[];
  series: ParetoSeries[];
  total: number;
  failTotal: number;
  yieldPct: number;
  groupLabel: string;
}

export interface BinOverviewWafer {
  wafer: WaferInfo;
  lotName: string;
  dice: MapDie[];
  pass: number;
  fail: number;
  yieldPct: number;
}

export interface BinOverviewResponse {
  wafers: BinOverviewWafer[];
}

export interface CsvMapping {
  lot: number | null;
  wafer: number | null;
  x: number | null;
  y: number | null;
  hbin: number | null;
  sbin: number | null;
}

export interface CsvInspection {
  headers: string[];
  headerLine: number;
  delimiter: string;
  mapping: CsvMapping;
  missing: string[];
  longFormat: boolean;
}

export interface HistGroup {
  key: number;
  label: string;
  counts: number[];
}

export interface HistResponse {
  edges: number[];
  counts: number[];
  groups: HistGroup[];
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

export type ScatterZMode = "none" | "continuous";
export type ScatterColorMode = ScatterZMode | "category";
export type LimitMode = "auto" | "manual" | "sigma" | "iqr" | "spec";

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
  zMode: ScatterColorMode;
  zCol: string | null;
  zColLabel: string;
  /** Category used to split the points into series, if any. */
  groupBy: string | null;
  groupLabel: string;
  zMin: number | null;
  zMax: number | null;
  total: number;
  excluded: number;
  truncated: boolean;
  r: number | null;
  lots: string[];
  wafers: string[];
}

export type PlotType = "box" | "map" | "binmap" | "pareto" | "hist" | "trend" | "scatter";

export type ShowPoints = "outliers" | "all" | "none";

export interface PlotSpec {
  id: string;
  type: PlotType;
  test: number | null;
  title: string;
  /**
   * Box/trend category on the horizontal axis, or the Pareto grouping column.
   * Pareto also accepts `none` for the global view.
   */
  xAxis: string;
  /** Colour / grouping / split category. `none` means one default-coloured series. */
  groupBy: string;
  logY: boolean;
  showPoints: ShowPoints;
  lsl: number | null;
  usl: number | null;
  showLimits: boolean;
  mapMode: "value" | "bin";
  palette: string;
  edgeExclusion: number;
  binCategory: "hard" | "soft";
  top: number;
  bins: number | null;
  showNormal: boolean;
  showBand: boolean;
  /** Manual axis/colour-scale limits when limitMode is "manual". */
  yMin: number | null;
  yMax: number | null;
  /** How the plot range is chosen. Auto keeps the data-driven default. */
  limitMode: LimitMode;
  /** k for the sigma / IQR range modes. */
  limitK: number;
  /** Larger fonts, thicker lines and stronger markers for slide-sized charts. */
  presentation: boolean;
  scatterX: number | null;
  scatterY: number | null;
  /** Continuous value colouring; categorical colouring now uses groupBy. */
  scatterZMode: ScatterZMode;
  scatterZTest: number | null;
  scatterFit: boolean;
  /** Render a grouped plot as one small chart per group. */
  splitPlots: boolean;
}

export const defaultSpec = (type: PlotType, test: number | null, title: string): PlotSpec => ({
  id: Math.random().toString(36).slice(2, 10),
  type,
  test,
  title,
  xAxis: type === "pareto" ? "none" : "wafer",
  groupBy: "none",
  logY: false,
  showPoints: "outliers",
  lsl: null,
  usl: null,
  showLimits: true,
  mapMode: "value",
  palette: "brand",
  edgeExclusion: 0,
  binCategory: "hard",
  top: 20,
  bins: null,
  showNormal: true,
  showBand: true,
  yMin: null,
  yMax: null,
  limitMode: "auto",
  limitK: 3,
  presentation: true,
  scatterX: null,
  scatterY: null,
  scatterZMode: "none",
  scatterZTest: null,
  scatterFit: true,
  splitPlots: false,
});

export interface ReportItem {
  id: string;
  spec: PlotSpec;
  filters: Filter;
}
