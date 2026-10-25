import { useEffect } from "react";
import { useStore } from "./store";
import * as api from "./lib/api";
import { useExportCsv, useOpenFiles, useSaveTemplate } from "./lib/useData";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { ChartPanel } from "./components/ChartPanel";
import { Inspector } from "./components/Inspector";
import { ReportDrawer } from "./components/ReportDrawer";
import { CsvMappingDialog } from "./components/CsvMappingDialog";
import { StatusBar, ErrorBanner, ProgressOverlay, Toast } from "./components/StatusBar";
import type { PlotType } from "./types";

const PLOT_KEYS: PlotType[] = ["box", "map", "binmap", "pareto", "hist", "trend", "scatter"];

export default function App() {
  const theme = useStore((s) => s.theme);
  const info = useStore((s) => s.info);
  const open = useOpenFiles();
  const saveTemplate = useSaveTemplate();
  const exportCsv = useExportCsv();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    return api.onImportProgress((pct, msg) => useStore.getState().setProgress(pct, msg));
  }, []);

  // The Rust side keeps the dataset across a webview reload; restore it so a
  // reload (or HMR) does not drop the user back to the empty state.
  useEffect(() => {
    if (!api.isTauri) return;
    let cancelled = false;
    void api
      .datasetInfo()
      .then((restored) => {
        if (!cancelled && restored && !useStore.getState().info) {
          useStore.getState().setInfo(restored);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "o") {
        e.preventDefault();
        void open();
      } else if (key === "s") {
        e.preventDefault();
        void saveTemplate();
      } else if (key === "e") {
        e.preventDefault();
        void exportCsv();
      } else if (key >= "1" && key <= "7") {
        e.preventDefault();
        const t = PLOT_KEYS[Number(key) - 1];
        if (t) useStore.getState().setPlotType(t);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saveTemplate, exportCsv]);

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        {info && <Sidebar />}
        <main className="main">
          <ChartPanel />
        </main>
        {info && <Inspector />}
      </div>
      <StatusBar />
      <ReportDrawer />
      <CsvMappingDialog />
      <ProgressOverlay />
      <ErrorBanner />
      <Toast />
    </div>
  );
}
