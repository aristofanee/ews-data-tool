import { useState } from "react";
import { PLOT_LABELS, useStore } from "../store";
import type { DatasetInfo, Filter, ReportItem } from "../types";
import * as api from "../lib/api";
import { generateReport } from "../lib/report";
import { useLoadTemplate, useSaveTemplate } from "../lib/useData";
import {
  IconBox,
  IconChevronDown,
  IconChevronUp,
  IconFolder,
  IconGrid,
  IconHist,
  IconLayers,
  IconMap,
  IconOpen,
  IconPareto,
  IconPlus,
  IconReport,
  IconSave,
  IconTrash,
  IconTrend,
  IconX,
} from "./Icons";

function iconFor(type: ReportItem["spec"]["type"]) {
  const p = { size: 15 };
  switch (type) {
    case "box":
      return <IconBox {...p} />;
    case "map":
      return <IconMap {...p} />;
    case "pareto":
      return <IconPareto {...p} />;
    case "hist":
      return <IconHist {...p} />;
    case "trend":
      return <IconTrend {...p} />;
  }
}

function summarizeFilters(f: Filter, info: DatasetInfo): string {
  const parts: string[] = [];
  if (f.lots.length) {
    parts.push(f.lots.map((l) => info.lots[l] ?? `L${l}`).join(", "));
  }
  if (f.wafers.length) parts.push(`${f.wafers.length} wafers`);
  if (f.hbins.length) parts.push(`bins ${f.hbins.join(",")}`);
  if (f.passOnly) parts.push("pass only");
  if (f.stat) parts.push(f.stat.kind === "sigma" ? `${f.stat.k}σ` : `IQR×${f.stat.k}`);
  return parts.length ? parts.join(" · ") : "all data";
}

function subtitleFor(it: ReportItem, info: DatasetInfo): string {
  const s = it.spec;
  const test = s.test !== null ? info.tests[s.test] : null;
  const parts: string[] = [];
  if (s.type === "map") {
    const w = info.wafers[s.mapWafer ?? 0];
    parts.push(`Wafer ${w?.name ?? "?"}`);
  }
  if (test) parts.push(test.units ? `${test.name} [${test.units}]` : test.name);
  if (s.type === "box" || s.type === "trend") parts.push(s.groupBy === "wafer" ? "by wafer" : "by lot");
  parts.push(summarizeFilters(it.filters, info));
  return parts.join(" · ");
}

export function ReportDrawer() {
  const open = useStore((s) => s.reportOpen);
  const setOpen = useStore((s) => s.setReportOpen);
  const report = useStore((s) => s.report);
  const info = useStore((s) => s.info);
  const spec = useStore((s) => s.spec);
  const filters = useStore((s) => s.filters);
  const theme = useStore((s) => s.theme);
  const templateName = useStore((s) => s.templateName);
  const setTemplateName = useStore((s) => s.setTemplateName);
  const addReport = useStore((s) => s.addReport);
  const addReportItems = useStore((s) => s.addReportItems);
  const removeReport = useStore((s) => s.removeReport);
  const moveReport = useStore((s) => s.moveReport);
  const clearReport = useStore((s) => s.clearReport);
  const setBusy = useStore((s) => s.setBusy);
  const setProgress = useStore((s) => s.setProgress);
  const setError = useStore((s) => s.setError);
  const notify = useStore((s) => s.notify);
  const saveTemplate = useSaveTemplate();
  const loadTemplate = useLoadTemplate();

  const [folder, setFolder] = useState<string | null>(() => {
    try {
      return localStorage.getItem("ews-report-folder");
    } catch {
      return null;
    }
  });

  if (!open) return null;

  const chooseFolder = async () => {
    const f = await api.pickFolder();
    if (f) {
      setFolder(f);
      try {
        localStorage.setItem("ews-report-folder", f);
      } catch {
        /* ignore */
      }
    }
  };

  const addAllWafers = () => {
    if (!info) return;
    if (spec.type !== "map") {
      notify("Switch to a wafer map first.");
      return;
    }
    const test = spec.test !== null ? info.tests[spec.test] : null;
    const wafers = info.wafers
      .map((w, i) => ({ w, i }))
      .filter(
        ({ w, i }) =>
          (filters.lots.length === 0 || filters.lots.includes(w.lot)) &&
          (filters.wafers.length === 0 || filters.wafers.includes(i))
      );
    if (wafers.length > 20 && !window.confirm(`Add ${wafers.length} wafer maps to the report?`)) return;
    addReportItems(
      wafers.map(({ w, i }) => ({
        spec: {
          ...spec,
          mapWafer: i,
          title: `${test?.name ?? "Wafer"} · ${info.lots[w.lot]} / ${w.name}`,
        },
        filters,
      }))
    );
  };

  const addAllTests = () => {
    if (!info) return;
    if (spec.type !== "box" && spec.type !== "hist" && spec.type !== "trend") {
      notify("Switch to a box plot, histogram or trend first.");
      return;
    }
    const tests = info.tests.map((t, i) => ({ t, i })).filter(({ t }) => t.count > 0);
    if (tests.length > 20 && !window.confirm(`Add ${tests.length} plots (one per test) to the report?`)) return;
    addReportItems(
      tests.map(({ t, i }) => ({
        spec: { ...spec, test: i, title: `${t.name} · ${PLOT_LABELS[spec.type]}` },
        filters,
      }))
    );
  };

  const editItem = (it: ReportItem) => {
    useStore.setState({ spec: structuredClone(it.spec), filters: structuredClone(it.filters) });
    setOpen(false);
  };

  const generate = async () => {
    if (!info) return;
    if (!report.length) {
      notify("Add at least one plot to the report.");
      return;
    }
    if (!api.isTauri) {
      notify("Batch export is available in the desktop app — use Save JPG here in the browser demo.");
      return;
    }
    let dest = folder;
    if (!dest) {
      dest = await api.pickFolder();
      if (!dest) return;
      setFolder(dest);
      try {
        localStorage.setItem("ews-report-folder", dest);
      } catch {
        /* ignore */
      }
    }
    try {
      setBusy(true, 1, "Preparing report…");
      const res = await generateReport({
        items: report,
        info,
        theme,
        folder: dest,
        templateName: templateName || "EWS report",
        onProgress: (pct, msg) => setProgress(pct, msg),
      });
      setBusy(false);
      notify(`Report ready · ${res.files.length} JPGs + index.html`);
      void api.openInExplorer(res.indexHtml).catch(() => undefined);
    } catch (e) {
      setBusy(false);
      setError(`Report generation failed. ${String(e)}`);
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={() => setOpen(false)} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <div className="drawer-title">
              <IconReport size={17} /> Report builder
            </div>
            <div className="drawer-sub">
              {report.length} plot{report.length === 1 ? "" : "s"} ·{" "}
              {templateName ? <b>{templateName}</b> : "untitled template"}
            </div>
          </div>
          <button className="btn icon ghost" onClick={() => setOpen(false)} title="Close">
            <IconX size={16} />
          </button>
        </div>

        <div className="drawer-tools">
          <div className="template-row">
            <input
              className="input"
              placeholder="Report / template name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
            <button className="btn icon" onClick={saveTemplate} title="Save template">
              <IconSave size={15} />
            </button>
            <button className="btn icon" onClick={loadTemplate} title="Load template">
              <IconOpen size={15} />
            </button>
          </div>
          <div className="batch-row">
            <button className="btn" onClick={addReport} title="Add the plot currently on screen">
              <IconPlus size={14} /> Add current plot
            </button>
            {spec.type === "map" && (
              <button className="btn" onClick={addAllWafers} title="One map per selected wafer">
                <IconGrid size={14} /> All selected wafers
              </button>
            )}
            {(spec.type === "box" || spec.type === "hist" || spec.type === "trend") && (
              <button className="btn" onClick={addAllTests} title="One plot per test">
                <IconLayers size={14} /> All tests
              </button>
            )}
          </div>
        </div>

        <div className="report-list">
          {report.length === 0 && (
            <div className="report-empty">
              <div className="report-empty-icon">
                <IconReport size={26} />
              </div>
              <b>No plots yet</b>
              <span>
                Add the current plot, or batch-add every wafer for a map. Then generate all JPGs in one click.
              </span>
            </div>
          )}
          {report.map((it, i) => (
            <div className="report-item" key={it.id}>
              <button className="ri-main" onClick={() => editItem(it)} title="Load this plot into the viewer">
                <span className="ri-icon">{iconFor(it.spec.type)}</span>
                <span className="ri-text">
                  <span className="ri-title">{it.spec.title}</span>
                  <span className="ri-sub">{info ? subtitleFor(it, info) : ""}</span>
                </span>
              </button>
              <div className="ri-actions">
                <button
                  className="mini"
                  onClick={() => moveReport(it.id, -1)}
                  disabled={i === 0}
                  title="Move up"
                >
                  <IconChevronUp size={12} />
                </button>
                <button
                  className="mini"
                  onClick={() => moveReport(it.id, 1)}
                  disabled={i === report.length - 1}
                  title="Move down"
                >
                  <IconChevronDown size={12} />
                </button>
                <button className="mini danger" onClick={() => removeReport(it.id)} title="Remove">
                  <IconTrash size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="drawer-foot">
          <div className="folder-row">
            <IconFolder size={14} />
            <span className="folder-path" title={folder ?? ""}>
              {folder ?? "Choose an output folder"}
            </span>
            <button className="link-btn" onClick={chooseFolder}>
              {folder ? "Change" : "Browse"}
            </button>
          </div>
          <div className="foot-actions">
            <button className="link-btn" onClick={clearReport} disabled={!report.length}>
              Clear
            </button>
            <button className="btn primary wide" onClick={generate} disabled={!report.length}>
              <IconReport size={15} /> Generate {report.length || ""} JPG{report.length === 1 ? "" : "s"}
            </button>
          </div>
          <div className="hint">
            Writes numbered JPGs, an <code>index.html</code> contact sheet and <code>report.json</code>.
          </div>
        </div>
      </aside>
    </>
  );
}
