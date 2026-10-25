import { useStore } from "../store";
import { isTauri } from "../lib/api";
import { fmtInt } from "../lib/format";
import { IconAlert, IconX } from "./Icons";

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
          ? `${fmtInt(info.rows)} dice · ${info.files.length} file${info.files.length === 1 ? "" : "s"} · ${info.memoryMb.toFixed(0)} MB in memory`
          : "Open a file to begin"}
      </div>
      <div className="status-right">
        {!isTauri && <span className="demo-badge">browser demo</span>}
        <span>v0.3.0</span>
        <span className="meta-dot" />
        <span>offline</span>
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
    <div className="overlay">
      <div className="overlay-card">
        <div className="overlay-head">
          <span className="spinner" />
          <span className="overlay-title">{msg || "Working…"}</span>
        </div>
        <div className="progress-track">
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
