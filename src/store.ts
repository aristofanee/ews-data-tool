import { create } from "zustand";
import type { DatasetInfo, Filter, PlotSpec, PlotType, ReportItem } from "./types";
import { defaultSpec, emptyFilter } from "./types";
import type { Theme } from "./lib/theme";

export const PLOT_LABELS: Record<PlotType, string> = {
  box: "Box plot",
  map: "Wafer map",
  pareto: "Pareto",
  hist: "Histogram",
  trend: "Trend",
};

export interface TemplateFile {
  app: "EWS Data Tool";
  version: 1;
  name: string;
  created: string;
  theme?: Theme;
  filters: Filter;
  plots: { spec: PlotSpec; filters: Filter }[];
}

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function autoTitle(testName: string | null, type: PlotType): string {
  if (type === "pareto") return "Fail Pareto";
  if (!testName) return PLOT_LABELS[type];
  return `${testName} · ${PLOT_LABELS[type]}`;
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
      patch.spec = {
        ...prev.spec,
        test,
        title: autoTitle(name, prev.spec.type),
        mapWafer: wafer !== null && wafer < info.wafers.length ? wafer : 0,
      };
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
    const test = s.info?.tests[s.spec.test ?? -1]?.name ?? null;
    set({ spec: { ...s.spec, type, title: autoTitle(test, type) } });
  },
  patchSpec: (p) => {
    const s = get();
    let title = p.title ?? s.spec.title;
    if (typeof p.test === "number" && p.title === undefined) {
      title = autoTitle(s.info?.tests[p.test]?.name ?? null, p.type ?? s.spec.type);
    }
    set({ spec: { ...s.spec, ...p, title } });
  },
  selectTest: (index) => {
    const s = get();
    const name = s.info?.tests[index]?.name ?? null;
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
    const needsTest = s.spec.type !== "pareto" && s.spec.type !== "map";
    if (needsTest && s.spec.test === null) {
      s.notify("Select a test before adding a plot.");
      return;
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
    const plots = (t.plots ?? []).map((p) => ({
      id: rid(),
      spec: { ...defaultSpec(p.spec.type ?? "box", p.spec.test ?? null, p.spec.title ?? ""), ...p.spec, id: rid() },
      filters: p.filters ?? emptyFilter(),
    }));
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
