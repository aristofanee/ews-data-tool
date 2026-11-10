import { useStore } from "../store";
import { useExportCsv, useLoadTemplate, useOpenFiles, useSaveTemplate } from "../lib/useData";
import { fmtInt } from "../lib/format";
import * as api from "../lib/api";
import { WindowControls } from "./WindowControls";
import {
  IconDownload,
  IconFolder,
  IconMoon,
  IconOpen,
  IconReport,
  IconSave,
  IconSun,
} from "./Icons";

const appIcon = new URL("../../src-tauri/app-icon.svg", import.meta.url).href;

export function TopBar() {
  const info = useStore((s) => s.info);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const reportCount = useStore((s) => s.report.length);
  const setReportOpen = useStore((s) => s.setReportOpen);
  const open = useOpenFiles();
  const exportCsv = useExportCsv();
  const saveTemplate = useSaveTemplate();
  const loadTemplate = useLoadTemplate();
  const importMetadata = async () => {
    const store = useStore.getState();
    try {
      const paths = await api.pickFiles();
      if (!paths.length) return;
      if (paths.some(path => !/\.(stdf|std|z|gz)$/i.test(path))) throw new Error("Select reference STDF files of the same product (.stdf, .std, .Z or .gz).");
      store.setBusy(true, 0, "Reading product metadata…");
      const updated = await api.importProductMetadata(paths);
      store.setInfo(updated, { keepFilters: true }); store.bumpData();
      store.notify("Missing wafer geometry and bin descriptions filled from the selected reference files.");
    } catch (e) { store.setError(String(e)); } finally { store.setBusy(false); }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <img className="brand-mark" src={appIcon} alt="" />
        <div className="brand-text">
          <div className="brand-name">EWS Data Tool</div>
          <div className="brand-sub">Wafer-sort analytics</div>
        </div>
      </div>

      {info ? (
        <div className="dataset-meta">
          <span className="meta-chip">
            <b>{info.lots.length}</b> lot{info.lots.length > 1 ? "s" : ""}
          </span>
          <span className="meta-dot" />
          <span className="meta-chip">
            <b>{fmtInt(info.wafers.length)}</b> wafers
          </span>
          <span className="meta-dot" />
          <span className="meta-chip">
            <b>{fmtInt(info.rows)}</b> dice
          </span>
          <span className="meta-dot" />
          <span className="meta-chip">
            <b>{fmtInt(info.tests.length)}</b> tests
          </span>
        </div>
      ) : (
        <div className="dataset-meta muted">No dataset loaded</div>
      )}

      {api.isTauri && <div className="window-drag-region" data-tauri-drag-region />}

      <div className="topbar-actions">
        <button className="btn icon" onClick={toggleTheme} title={theme === "dark" ? "Light mode" : "Dark mode"}>
          {theme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
        </button>
        <span className="topbar-sep" />
        <button className="btn primary" onClick={() => open()} title="Open STDF, .Z, .gz, ZIP or CSV files">
          <IconFolder size={15} /> Open data
        </button>
        <button
          className="btn"
          onClick={exportCsv}
          disabled={!info}
          title="Export the full dataset to CSV"
        >
          <IconDownload size={15} /> Export CSV
        </button>
        <button className="btn" disabled={!info || !api.isTauri} onClick={importMetadata}
          title="Fill missing wafer geometry and bin descriptions from reference STDF files of the same product">Metadata</button>
        <span className="topbar-sep" />
        <button className="btn icon" onClick={saveTemplate} title="Save template (all report plots + settings)">
          <IconSave size={16} />
        </button>
        <button className="btn icon" onClick={loadTemplate} title="Load template">
          <IconOpen size={16} />
        </button>
        <button className="btn report-btn" onClick={() => setReportOpen(true)} title="Open the report builder">
          <IconReport size={16} /> Report
          {reportCount > 0 && <span className="badge">{reportCount}</span>}
        </button>
      </div>
      {api.isTauri && <WindowControls />}
    </header>
  );
}
