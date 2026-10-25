import { useCallback } from "react";
import * as api from "./api";
import { fmtInt, safeName } from "./format";
import { useStore, type TemplateFile } from "../store";
import type { CsvMapping } from "../types";

const CSV_EXT = /\.(csv|txt|tsv|dat)$/i;

export function useOpenFiles() {
  const setBusy = useStore((s) => s.setBusy);
  const setProgress = useStore((s) => s.setProgress);
  const setInfo = useStore((s) => s.setInfo);
  const setError = useStore((s) => s.setError);
  const notify = useStore((s) => s.notify);
  const setCsvPrompt = useStore((s) => s.setCsvPrompt);

  return useCallback(
    async (pathsArg?: string[], mapping?: CsvMapping) => {
      try {
        const paths = pathsArg ?? (await api.pickFiles());
        if (!paths.length) return;
        setError(null);

        // Inspect text/CSV files first. If OCR/Wafer/X/Y cannot be detected,
        // ask the user to map those columns instead of silently importing a
        // misaligned table.
        if (!mapping) {
          const csvPaths = paths.filter((p) => CSV_EXT.test(p));
          if (csvPaths.length) {
            setBusy(true, 0, "Inspecting CSV columns…");
            for (const path of csvPaths) {
              const inspection = await api.inspectCsv(path);
              if (inspection.missing.length) {
                setBusy(false);
                setCsvPrompt({ paths, path, inspection });
                return;
              }
            }
          }
        }

        setBusy(true, 1, `Opening ${paths.length} file${paths.length > 1 ? "s" : ""}…`);
        const info = await api.openPaths(
          paths,
          (pct, msg) => setProgress(pct, msg),
          mapping ?? null
        );
        setInfo(info);
        setCsvPrompt(null);
        notify(`Loaded ${fmtInt(info.rows)} dice · ${info.tests.length} tests · ${info.lots.length} lot${info.lots.length > 1 ? "s" : ""}`);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [setBusy, setProgress, setInfo, setError, notify, setCsvPrompt]
  );
}

export function useExportCsv() {
  const filters = useStore((s) => s.filters);
  const setBusy = useStore((s) => s.setBusy);
  const setError = useStore((s) => s.setError);
  const notify = useStore((s) => s.notify);
  const info = useStore((s) => s.info);

  return useCallback(async () => {
    if (!info) return;
    try {
      const base = info.lots.length === 1 ? safeName(info.lots[0]) : "ews_data";
      const path = await api.pickSavePath(`${base}_export.csv`, ["csv"]);
      if (!path) return;
      setBusy(true, 25, "Writing CSV (this can take a moment for large lots)…");
      const msg = await api.exportCsv(path, filters);
      notify(msg);
      setBusy(false);
    } catch (e) {
      setBusy(false);
      setError(String(e));
    }
  }, [filters, info, setBusy, setError, notify]);
}

export function useSaveTemplate() {
  const setError = useStore((s) => s.setError);
  const notify = useStore((s) => s.notify);

  return useCallback(async () => {
    try {
      const s = useStore.getState();
      const plots =
        s.report.length > 0
          ? s.report.map((r) => ({ spec: r.spec, filters: r.filters }))
          : [{ spec: s.spec, filters: s.filters }];
      const name = s.templateName.trim() || "EWS report template";
      const t: TemplateFile = {
        app: "EWS Data Tool",
        version: 1,
        name,
        created: new Date().toISOString(),
        theme: s.theme,
        filters: s.filters,
        plots,
        customColumns: s.info?.customColumns ?? [],
      };
      const path = await api.pickSavePath(`${safeName(name)}.json`, ["json"]);
      if (!path) return;
      await api.saveText(path, JSON.stringify(t, null, 2));
      notify(`Template saved · ${plots.length} plot${plots.length > 1 ? "s" : ""}`);
    } catch (e) {
      setError(String(e));
    }
  }, [setError, notify]);
}

export function useLoadTemplate() {
  const setError = useStore((s) => s.setError);
  const applyTemplate = useStore((s) => s.applyTemplate);

  return useCallback(async () => {
    try {
      const path = await api.pickTemplate();
      if (!path) return;
      const text = await api.readText(path);
      const t = JSON.parse(text) as TemplateFile;
      if (!t || !Array.isArray(t.plots)) throw new Error("This file is not an EWS Data Tool template.");
      const state = useStore.getState();
      let customWarning: string | null = null;
      if (state.info && t.customColumns?.length) {
        try {
          const info = await api.restoreCustomColumns(t.customColumns);
          useStore.getState().setInfo(info, { keepFilters: true });
        } catch (e) {
          customWarning = `Template loaded, but custom labels were not restored: ${String(e)}`;
        }
      }
      applyTemplate(t);
      if (customWarning) useStore.getState().notify(customWarning);
    } catch (e) {
      setError(String(e));
    }
  }, [setError, applyTemplate]);
}

export function filtersSummary(): string {
  const f = useStore.getState().filters;
  const info = useStore.getState().info;
  const parts: string[] = [];
  if (f.lots.length && info) parts.push(f.lots.map((l) => info.lots[l] ?? `L${l}`).join(", "));
  if (f.wafers.length) parts.push(`${f.wafers.length} wafers`);
  if (f.passOnly) parts.push("pass only");
  if (f.hbins.length) parts.push(`bins ${f.hbins.join(",")}`);
  if (f.stat) parts.push(`${f.stat.kind === "sigma" ? `${f.stat.k}σ` : `IQR×${f.stat.k}`}${f.stat.perWafer ? " /wafer" : ""}`);
  return parts.length ? parts.join(" · ") : "All data";
}
