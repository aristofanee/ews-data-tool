import { create } from "zustand";
import type {
  CsvInspection,
  CustomColumn,
  DatasetInfo,
  Filter,
  PlotSpec,
  PlotType,
  ReportItem,
  TestInfo,
} from "./types";
import { defaultSpec, emptyFilter } from "./types";
import type { Theme } from "./lib/theme";
import { testLabelWithUnits } from "./lib/format";

export const PLOT_LABELS: Record<PlotType, string> = {
  box: "Box plot",
  map: "Wafer map",
  binmap: "Bin map",
  pareto: "Pareto",
  hist: "Histogram",
  trend: "Trend",
  scatter: "Scatter",
};

const PLOT_TITLE_LABELS: Record<PlotType, string> = {
  box: "BoxPlot",
  map: "Wafer map",
  binmap: "Bin map",
  pareto: "Pareto",
  hist: "Histogram",
  trend: "Trend",
  scatter: "Scatter",
};

const PLOT_TYPES: PlotType[] = ["box", "map", "hist", "scatter", "trend", "binmap", "pareto"];
const BUILTIN_CATEGORIES = ["lot", "wafer", "hbin", "sbin", "site"];

function defaultSpecs(): Record<PlotType, PlotSpec> {
  return Object.fromEntries(
    PLOT_TYPES.map((type) => [type, defaultSpec(type, null, PLOT_LABELS[type])])
  ) as Record<PlotType, PlotSpec>;
}

function hasCategory(info: DatasetInfo | null, value: string): boolean {
  if (!info || !value) return false;
  return BUILTIN_CATEGORIES.includes(value) || info.customColumns.some((c) => c.name === value);
}

/** Pareto splits include the per-die site category as well as wafer labels. */
function isParetoCategory(info: DatasetInfo | null, value: string): boolean {
  if (value === "lot" || value === "wafer" || value === "site") return true;
  if (!info) return true;
  return info.customColumns.some((c) => c.name === value);
}

/** Keep old templates and removed custom columns from leaving a dead category selected. */
function sanitizeSpec(spec: PlotSpec, info: DatasetInfo | null): PlotSpec {
  const next = { ...spec };
  if (next.type === "pareto") {
    if (next.xAxis !== "none" && !hasCategory(info, next.xAxis)) next.xAxis = "none";
    if (next.groupBy !== "none" && !isParetoCategory(info, next.groupBy)) next.groupBy = "none";
  } else {
    if (!hasCategory(info, next.xAxis)) next.xAxis = "wafer";
    if (next.groupBy !== "none") {
      const valid =
        next.type === "map"
          ? next.groupBy === "lot" || next.groupBy === "wafer" || !!info?.customColumns.some((c) => c.name === next.groupBy)
          : hasCategory(info, next.groupBy);
      if (!valid) next.groupBy = "none";
    }
  }
  if ((next.scatterZMode as string) === "category") next.scatterZMode = "none";
  if (!info) return next;
  if (next.test !== null && (next.test < 0 || next.test >= info.tests.length)) {
    next.test = info.tests.length ? 0 : null;
  }
  return next;
}

export interface TemplateFile {
  app: "EWS Data Tool";
  version: 1;
  name: string;
  created: string;
  theme?: Theme;
  presentation?: boolean;
  filters: Filter;
  plots: { spec: PlotSpec; filters: Filter }[];
  /** Labels created in the app; restored when the same wafers are loaded. */
  customColumns?: CustomColumn[];
}

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Test names in STDF files are often padded; keep exported titles compact. */
function tidyTitle(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function autoTitle(test: TestInfo | null, type: PlotType): string {
  if (type === "pareto") return "Fail Pareto";
  if (type === "map") return "Wafer map";
  if (type === "binmap") return "Bin map";
  if (!test) return PLOT_LABELS[type];
  return `${tidyTitle(testLabelWithUnits(test))} · ${PLOT_TITLE_LABELS[type]}`;
}

export function scatterTitle(x: TestInfo | null, y: TestInfo | null): string {
  if (x && y) {
    return `${tidyTitle(testLabelWithUnits(x))} vs ${tidyTitle(testLabelWithUnits(y))} - Scatter`;
  }
  return "Scatter";
}

/** Fill in sensible X/Y tests (never the same test twice) for a scatter spec. */
function normalizeScatter(spec: PlotSpec, tests: TestInfo[]): PlotSpec {
  const n = tests.length;
  if (n === 0) return { ...spec, scatterX: null, scatterY: null };
  let x = spec.scatterX;
  let y = spec.scatterY;
  if (x === null || x < 0 || x >= n) x = spec.test !== null && spec.test < n ? spec.test : 0;
  if (y === null || y < 0 || y >= n) y = x + 1 < n ? x + 1 : x;
  if (n > 1 && x === y) y = (x + 1) % n;
  return { ...spec, test: y, scatterX: x, scatterY: y };
}

function scatterSpecTitle(spec: PlotSpec, tests: TestInfo[]): string {
  const x = spec.scatterX !== null ? tests[spec.scatterX] ?? null : null;
  const y = spec.scatterY !== null ? tests[spec.scatterY] ?? null : null;
  return scatterTitle(x, y);
}

const initialTheme: Theme =
  typeof localStorage !== "undefined" && localStorage.getItem("ews-theme") === "dark" ? "dark" : "light";
const initialPresentation = typeof localStorage === "undefined" || localStorage.getItem("ews-presentation") !== "false";

export interface CsvPrompt {
  paths: string[];
  path: string;
  inspection: CsvInspection;
}

interface AppState {
  info: DatasetInfo | null;
  busy: boolean;
  busyPct: number;
  busyMsg: string;
  error: string | null;
  toast: string | null;
  theme: Theme;
  presentation: boolean;
  setPresentation: (value: boolean) => void;
  spec: PlotSpec;
  /** Inspector state is remembered independently for every plot type. */
  specs: Record<PlotType, PlotSpec>;
  filters: Filter;
  report: ReportItem[];
  reportOpen: boolean;
  templateName: string;
  showInspector: boolean;
  dataVersion: number;
  csvPrompt: CsvPrompt | null;

  setInfo: (info: DatasetInfo | null, opts?: { keepFilters?: boolean }) => void;
  setBusy: (busy: boolean, pct?: number, msg?: string) => void;
  setProgress: (pct: number, msg: string) => void;
  setError: (e: string | null) => void;
  notify: (msg: string) => void;
  toggleTheme: () => void;

  setPlotType: (type: PlotType) => void;
  patchSpec: (p: Partial<PlotSpec>) => void;
  selectTest: (index: number) => void;

  patchFilters: (p: Partial<Filter>) => void;
  resetFilters: () => void;
  toggleArrayFilter: (key: "lots" | "wafers" | "hbins" | "sbins", value: number) => void;

  addReport: () => void;
  addReportItems: (items: { spec: PlotSpec; filters: Filter }[]) => void;
  removeReport: (id: string) => void;
  moveReport: (id: string, dir: -1 | 1) => void;
  clearReport: () => void;
  setReportOpen: (open: boolean) => void;
  setTemplateName: (name: string) => void;
  applyTemplate: (t: TemplateFile) => void;
  setShowInspector: (v: boolean) => void;
  setCsvPrompt: (prompt: CsvPrompt | null) => void;
  bumpData: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<AppState>((set, get) => ({
  info: null,
  busy: false,
  busyPct: 0,
  busyMsg: "",
  error: null,
  toast: null,
  theme: initialTheme,
  presentation: initialPresentation,
  spec: { ...defaultSpec("box", null, "Box plot"), presentation: initialPresentation },
  specs: Object.fromEntries(Object.entries(defaultSpecs()).map(([key, spec]) => [key, { ...spec, presentation: initialPresentation }])) as Record<PlotType, PlotSpec>,
  filters: emptyFilter(),
  report: [],
  reportOpen: false,
  templateName: "",
  showInspector: true,
  dataVersion: 0,
  csvPrompt: null,

  setInfo: (info, opts) => {
    const prev = get();
    const patch: Partial<AppState> = { info };
    if (!opts?.keepFilters) patch.filters = emptyFilter();
    if (info) {
      let test = prev.spec.test;
      if (test === null || test >= info.tests.length) test = info.tests.length ? 0 : null;
      const testInfo = test !== null ? info.tests[test] ?? null : null;
      let spec = sanitizeSpec({ ...prev.spec, test }, info);
      if (spec.type === "scatter") {
        spec = normalizeScatter(spec, info.tests);
        spec.title = scatterSpecTitle(spec, info.tests);
      } else {
        spec.title = autoTitle(testInfo, spec.type);
      }

      const specs = { ...prev.specs };
      for (const type of PLOT_TYPES) {
        let s = specs[type] ?? defaultSpec(type, test, PLOT_LABELS[type]);
        s = sanitizeSpec({ ...s, type }, info);
        if (type === spec.type) {
          s = spec;
        } else {
          if (s.test === null || s.test < 0 || s.test >= info.tests.length) {
            s = { ...s, test };
          }
          if (type === "scatter") {
            s = normalizeScatter(s, info.tests);
          }
        }
        specs[type] = s;
      }
      patch.spec = spec;
      patch.specs = specs;
    }
    set(patch);
  },

  setBusy: (busy, pct = 0, msg = "") => set({ busy, busyPct: pct, busyMsg: msg }),
  setPresentation: (presentation) => {
    const s = get();
    try { localStorage.setItem("ews-presentation", String(presentation)); } catch {}
    set({ presentation, spec: { ...s.spec, presentation },
      specs: Object.fromEntries(Object.entries(s.specs).map(([key, spec]) => [key, { ...spec, presentation }])) as Record<PlotType, PlotSpec>,
      report: s.report.map((item) => ({ ...item, spec: { ...item.spec, presentation } })),
    });
  },
  setProgress: (pct, msg) => set({ busyPct: pct, busyMsg: msg }),
  setError: (error) => set({ error }),
  notify: (msg) => {
    set({ toast: msg });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 3600);
  },
  toggleTheme: () => {
    const theme: Theme = get().theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("ews-theme", theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },

  setPlotType: (type) => {
    const s = get();
    if (type === s.spec.type) return;
    const tests = s.info?.tests ?? [];
    const specs = { ...s.specs, [s.spec.type]: s.spec };
    let next = specs[type] ?? defaultSpec(type, s.spec.test, PLOT_LABELS[type]);
    next = { ...next, type, presentation: s.presentation };
    if (type === "scatter") {
      next = normalizeScatter({ ...next, test: next.test ?? s.spec.test }, tests);
      next.title = scatterSpecTitle(next, tests);
    } else {
      next.test = s.spec.test;
      if (type === "map") next.mapMode = "value";
      next.title = autoTitle(next.test !== null ? tests[next.test] ?? null : null, type);
    }
    next = sanitizeSpec(next, s.info);
    specs[type] = next;
    set({ spec: next, specs });
  },
  patchSpec: (p) => {
    if (p.presentation !== undefined && p.presentation !== get().presentation) get().setPresentation(p.presentation);
    const s = get();
    const next: PlotSpec = { ...s.spec, ...p };
    let title = p.title ?? s.spec.title;
    if (p.title === undefined) {
      if (next.type === "scatter") {
        // Keep X and Y distinct when the user picks the same test twice.
        if (next.scatterX !== null && next.scatterX === next.scatterY) {
          if (p.scatterX !== undefined) {
            next.scatterY =
              s.spec.scatterY !== null && s.spec.scatterY !== p.scatterX
                ? s.spec.scatterY
                : (next.scatterX + 1) % Math.max(1, s.info?.tests.length ?? 1);
          } else if (p.scatterY !== undefined) {
            next.scatterX =
              s.spec.scatterX !== null && s.spec.scatterX !== p.scatterY
                ? s.spec.scatterX
                : (next.scatterY + 1) % Math.max(1, s.info?.tests.length ?? 1);
          }
        }
        if (
          p.scatterX !== undefined ||
          p.scatterY !== undefined ||
          p.type !== undefined
        ) {
          title = scatterSpecTitle(next, s.info?.tests ?? []);
        }
      } else if (p.test !== undefined || p.type !== undefined) {
        title = autoTitle(
          next.test !== null ? s.info?.tests[next.test] ?? null : null,
          next.type
        );
      }
    }
    const spec = sanitizeSpec({ ...next, title }, s.info);
    set({ spec, specs: { ...s.specs, [spec.type]: spec } });
  },
  selectTest: (index) => {
    const s = get();
    const test = s.info?.tests[index] ?? null;
    if (s.spec.type === "scatter") {
      const tests = s.info?.tests ?? [];
      let x = s.spec.scatterX;
      const y = index;
      if (x === null) x = tests.length > 1 ? (y + 1) % tests.length : y;
      if (tests.length > 1 && x === y) {
        x = s.spec.scatterY !== null && s.spec.scatterY !== y
          ? s.spec.scatterY
          : (y + 1) % tests.length;
      }
      const spec: PlotSpec = { ...s.spec, test: y, scatterX: x, scatterY: y };
      spec.title = scatterSpecTitle(spec, tests);
      set({ spec, specs: { ...s.specs, scatter: spec } });
      return;
    }
    const spec: PlotSpec = { ...s.spec, test: index, title: autoTitle(test, s.spec.type) };
    set({ spec, specs: { ...s.specs, [spec.type]: spec } });
  },

  patchFilters: (p) => set({ filters: { ...get().filters, ...p } }),
  resetFilters: () => set({ filters: emptyFilter() }),
  toggleArrayFilter: (key, value) => {
    const f = get().filters;
    const arr = f[key];
    const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
    set({ filters: { ...f, [key]: next } });
  },

  addReport: () => {
    const s = get();
    if (s.spec.type === "scatter") {
      if (s.spec.scatterX === null || s.spec.scatterY === null) {
        s.notify("Select X and Y tests before adding a scatter plot.");
        return;
      }
    } else {
      const needsTest =
        s.spec.type !== "pareto" && s.spec.type !== "map" && s.spec.type !== "binmap";
      if (needsTest && s.spec.test === null) {
        s.notify("Select a test before adding a plot.");
        return;
      }
    }
    const spec: PlotSpec = { ...s.spec, id: rid() };
    const item: ReportItem = { id: spec.id, spec, filters: structuredClone(s.filters) };
    set({ report: [...s.report, item], reportOpen: true });
    s.notify(`Added “${spec.title}” to the report.`);
  },
  addReportItems: (items) => {
    const s = get();
    const added: ReportItem[] = items.map((it) => {
      const spec = { ...it.spec, id: rid(), presentation: s.presentation };
      return { id: spec.id, spec, filters: structuredClone(it.filters) };
    });
    set({ report: [...s.report, ...added], reportOpen: true });
    s.notify(`Added ${added.length} plots to the report.`);
  },
  removeReport: (id) => set({ report: get().report.filter((r) => r.id !== id) }),
  moveReport: (id, dir) => {
    const list = [...get().report];
    const i = list.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set({ report: list });
  },
  clearReport: () => set({ report: [] }),
  setReportOpen: (reportOpen) => set({ reportOpen }),
  setTemplateName: (templateName) => set({ templateName }),
  applyTemplate: (t) => {
    const presentation = t.presentation ?? t.plots?.[0]?.spec.presentation ?? get().presentation;
    get().setPresentation(presentation);
    const s = get();
    const tests = s.info?.tests ?? [];
    const plots = (t.plots ?? []).map((p) => {
      const raw = p.spec as PlotSpec & {
        blockCol?: string;
        paretoGroup?: string;
        scatterZCol?: string;
        scatterZMode?: string;
      };
      let spec: PlotSpec = {
        ...defaultSpec(p.spec.type ?? "box", p.spec.test ?? null, p.spec.title ?? ""),
        ...raw,
        presentation,
        id: rid(),
      };
      // Migrate templates saved before grouping was unified.
      if (raw.groupBy === undefined) {
        if (raw.blockCol) spec.groupBy = raw.blockCol === "__wafer" ? "wafer" : raw.blockCol;
        if (raw.paretoGroup && raw.paretoGroup !== "none") spec.groupBy = raw.paretoGroup;
        if ((raw.scatterZMode as string) === "category" && raw.scatterZCol) {
          spec.groupBy = raw.scatterZCol;
        }
      }
      if ((spec.scatterZMode as string) === "category") spec.scatterZMode = "none";
      if (!raw.limitMode) {
        spec.limitMode = spec.yMin !== null || spec.yMax !== null ? "manual" : "auto";
      }
      spec = sanitizeSpec(spec, s.info);
      if (spec.type === "scatter") {
        spec = normalizeScatter(spec, tests);
        if (!spec.title) spec.title = scatterSpecTitle(spec, tests);
      } else if (!spec.title) {
        spec.title = autoTitle(
          spec.test !== null ? tests[spec.test] ?? null : null,
          spec.type
        );
      }
      return { id: spec.id, spec, filters: p.filters ?? emptyFilter() };
    });
    const specs = { ...s.specs };
    for (const item of plots) specs[item.spec.type] = item.spec;
    const active = plots[0]?.spec ?? s.spec;
    specs[active.type] = active;
    set({
      report: plots,
      filters: t.filters ?? emptyFilter(),
      templateName: t.name ?? "Template",
      theme: t.theme === "dark" || t.theme === "light" ? t.theme : s.theme,
      reportOpen: true,
      spec: active,
      specs,
    });
    s.notify(`Template “${t.name}” loaded: ${plots.length} plots.`);
  },
  setShowInspector: (showInspector) => set({ showInspector }),
  setCsvPrompt: (csvPrompt) => set({ csvPrompt }),
  bumpData: () => set({ dataVersion: get().dataVersion + 1 }),
}));
