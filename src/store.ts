import { create } from "zustand";
import type { CustomColumn, DatasetInfo, Filter, PlotSpec, PlotType, ReportItem, TestInfo } from "./types";
import { defaultSpec, emptyFilter } from "./types";
import type { Theme } from "./lib/theme";

export const PLOT_LABELS: Record<PlotType, string> = {
  box: "Box plot",
  map: "Wafer map",
  pareto: "Pareto",
  hist: "Histogram",
  trend: "Trend",
  scatter: "Scatter",
};

export interface TemplateFile {
  app: "EWS Data Tool";
  version: 1;
  name: string;
  created: string;
  theme?: Theme;
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

export function autoTitle(testName: string | null, type: PlotType): string {
  if (type === "pareto") return "Fail Pareto";
  if (!testName) return PLOT_LABELS[type];
  return `${tidyTitle(testName)} · ${PLOT_LABELS[type]}`;
}

export function scatterTitle(xName: string | null, yName: string | null): string {
  if (xName && yName) return `${tidyTitle(xName)} vs ${tidyTitle(yName)}`;
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
  const x = spec.scatterX !== null ? tests[spec.scatterX]?.name ?? null : null;
  const y = spec.scatterY !== null ? tests[spec.scatterY]?.name ?? null : null;
  return scatterTitle(x, y);
}

const initialTheme: Theme =
  typeof localStorage !== "undefined" && localStorage.getItem("ews-theme") === "dark" ? "dark" : "light";

interface AppState {
  info: DatasetInfo | null;
  busy: boolean;
  busyPct: number;
  busyMsg: string;
  error: string | null;
  toast: string | null;
  theme: Theme;
  spec: PlotSpec;
  filters: Filter;
  report: ReportItem[];
  reportOpen: boolean;
  templateName: string;
  showInspector: boolean;
  dataVersion: number;

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
  spec: defaultSpec("box", null, "Box plot"),
  filters: emptyFilter(),
  report: [],
  reportOpen: false,
  templateName: "",
  showInspector: true,
  dataVersion: 0,

  setInfo: (info, opts) => {
    const prev = get();
    const patch: Partial<AppState> = { info };
    if (!opts?.keepFilters) patch.filters = emptyFilter();
    if (info) {
      let test = prev.spec.test;
      if (test === null || test >= info.tests.length) test = 0;
      const name = info.tests[test]?.name ?? null;
      const wafer = prev.spec.mapWafer;
      let spec: PlotSpec = {
        ...prev.spec,
        test,
        mapWafer: wafer !== null && wafer < info.wafers.length ? wafer : 0,
      };
      const hasColumn = (name: string) => info.customColumns.some((c) => c.name === name);
      if (spec.blockCol && spec.blockCol !== "__wafer" && !hasColumn(spec.blockCol)) {
        spec.blockCol = "";
      }
      if (
        spec.scatterZCol &&
        !["lot", "wafer", "hbin", "sbin"].includes(spec.scatterZCol) &&
        !hasColumn(spec.scatterZCol)
      ) {
        spec.scatterZCol = "lot";
      }
      if (spec.type === "scatter") {
        spec = normalizeScatter(spec, info.tests);
        spec.title = scatterSpecTitle(spec, info.tests);
      } else {
        spec.title = autoTitle(name, spec.type);
      }
      patch.spec = spec;
    }
    set(patch);
  },

  setBusy: (busy, pct = 0, msg = "") => set({ busy, busyPct: pct, busyMsg: msg }),
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
    if (type === "scatter") {
      let spec = normalizeScatter({ ...s.spec, type }, s.info?.tests ?? []);
      spec.title = scatterSpecTitle(spec, s.info?.tests ?? []);
      set({ spec });
      return;
    }
    const test = s.info?.tests[s.spec.test ?? -1]?.name ?? null;
    set({ spec: { ...s.spec, type, title: autoTitle(test, type) } });
  },
  patchSpec: (p) => {
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
      } else if (typeof p.test === "number") {
        title = autoTitle(s.info?.tests[p.test]?.name ?? null, next.type);
      }
    }
    set({ spec: { ...next, title } });
  },
  selectTest: (index) => {
    const s = get();
    const name = s.info?.tests[index]?.name ?? null;
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
      set({ spec });
      return;
    }
    set({ spec: { ...s.spec, test: index, title: autoTitle(name, s.spec.type) } });
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
      const needsTest = s.spec.type !== "pareto" && s.spec.type !== "map";
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
      const spec = { ...it.spec, id: rid() };
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
    const s = get();
    const tests = s.info?.tests ?? [];
    const plots = (t.plots ?? []).map((p) => {
      let spec: PlotSpec = {
        ...defaultSpec(p.spec.type ?? "box", p.spec.test ?? null, p.spec.title ?? ""),
        ...p.spec,
        id: rid(),
      };
      if (spec.type === "scatter") {
        spec = normalizeScatter(spec, tests);
        if (!spec.title) spec.title = scatterSpecTitle(spec, tests);
      }
      return { id: spec.id, spec, filters: p.filters ?? emptyFilter() };
    });
    set({
      report: plots,
      filters: t.filters ?? emptyFilter(),
      templateName: t.name ?? "Template",
      theme: t.theme === "dark" || t.theme === "light" ? t.theme : s.theme,
      reportOpen: true,
      spec: plots[0]?.spec ?? s.spec,
    });
    s.notify(`Template “${t.name}” loaded: ${plots.length} plots.`);
  },
  setShowInspector: (showInspector) => set({ showInspector }),
  bumpData: () => set({ dataVersion: get().dataVersion + 1 }),
}));
