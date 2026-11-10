import { useState } from "react";
import { useStore } from "../store";
import { fileName, isTauri } from "../lib/api";
import { fmtInt } from "../lib/format";
import { IconAlert, IconX } from "./Icons";
import { version } from "../../package.json";

export function StatusBar() {
  const info = useStore((s) => s.info);
  const busy = useStore((s) => s.busy);
  const busyMsg = useStore((s) => s.busyMsg);
  const error = useStore((s) => s.error);

  return (
    <footer className="statusbar">
      <div className="status-left">
        <span className={"status-dot" + (busy ? " busy" : error ? " error" : "")} />
        <span className="status-msg">{busy ? busyMsg || "Working…" : error ? "Last action failed" : "Ready"}</span>
      </div>
      <div className="status-mid">
        {info
          ? `${fmtInt(info.rows)} dice · ${info.files.length} file${info.files.length === 1 ? "" : "s"} · ${info.memoryMb.toFixed(0)} MB in memory${info.retestCount ? ` · ${fmtInt(info.retestCount)} earlier attempts replaced (latest kept)` : ""}`
          : ""}
      </div>
      <div className="status-right">
        {!isTauri && <span className="demo-badge">browser demo</span>}
        <span>v{version}</span>
      </div>
    </footer>
  );
}

export function ProgressOverlay() {
  const busy = useStore((s) => s.busy);
  const pct = useStore((s) => s.busyPct);
  const msg = useStore((s) => s.busyMsg);
  if (!busy) return null;
  return (
    <div className="overlay" role="status" aria-live="polite">
      <div className="overlay-card">
        <div className="overlay-head">
          <span className="spinner" />
          <span className="overlay-title">{msg || "Working…"}</span>
        </div>
        <div className="progress-track" role="progressbar" aria-label="Operation progress" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className="progress-fill" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
        </div>
        <div className="overlay-pct">{Math.round(pct)}%</div>
      </div>
    </div>
  );
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return <div className="toast">{toast}</div>;
}

export function ErrorBanner() {
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  if (!error) return null;
  return (
    <div className="error-banner" role="alert">
      <IconAlert size={16} />
      <span>{error}</span>
      <button onClick={() => setError(null)} title="Dismiss">
        <IconX size={14} />
      </button>
    </div>
  );
}

export function CsvImportWarning() {
  const warnings = useStore(s => s.info?.csvWarnings);
  const busy = useStore(s => s.busy);
  const error = useStore(s => s.error);
  const [dismissed, setDismissed] = useState<typeof warnings>();
  if (!warnings?.length || warnings === dismissed || busy || error) return null;
  const skipped = warnings.reduce((total, warning) => total + warning.lines.length, 0);
  const filePreviewLimit = 5;
  const linePreviewLimit = 10;
  const remainingFiles = warnings.length - filePreviewLimit;
  return (
    <div className="error-banner csv-warning" role="status">
      <IconAlert size={16} />
      <div className="csv-warning-details">
        <strong>Skipped {fmtInt(skipped)} CSV {skipped === 1 ? "row" : "rows"} with missing or invalid X/Y coordinates</strong>
        {warnings.slice(0, filePreviewLimit).map(({ file, lines }, index) => (
          <div key={index} title={file}>
            {fileName(file)} · {lines.length === 1 ? "line" : "lines"} {lines.slice(0, linePreviewLimit).join(", ")}
            {lines.length > linePreviewLimit && ` and ${fmtInt(lines.length - linePreviewLimit)} more`}
          </div>
        ))}
        {remainingFiles > 0 && <div>And {fmtInt(remainingFiles)} more {remainingFiles === 1 ? "file" : "files"}</div>}
      </div>
      <button onClick={() => setDismissed(warnings)} title="Dismiss CSV warning"><IconX size={14} /></button>
    </div>
  );
}
