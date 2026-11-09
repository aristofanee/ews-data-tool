import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "../store";

export function WindowTitleBar() {
  const [window] = useState(getCurrentWindow);
  const [maximized, setMaximized] = useState(false);
  const setError = useStore(s => s.setError);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const value = await window.isMaximized();
      if (active) setMaximized(value);
    };
    const listen = window.onResized(() => { void refresh().catch(console.error); });
    void refresh().catch(console.error);
    return () => {
      active = false;
      void listen.then(unlisten => unlisten()).catch(console.error);
    };
  }, [window]);

  const run = (action: Promise<void>) => {
    void action.catch(error => setError(String(error)));
  };
  const maximizeLabel = maximized ? "Restore down" : "Maximize";
  return (
    <header className="window-titlebar" aria-label="Window controls">
      <div className="window-drag-region" data-tauri-drag-region />
      <button type="button" aria-label="Minimize" title="Minimize" onClick={() => run(window.minimize())}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10" /></svg>
      </button>
      <button type="button" aria-label={maximizeLabel} title={maximizeLabel} onClick={() => run(window.toggleMaximize())}>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          {maximized ? <path d="M4 2h6v6M2 4h6v6H2z" /> : <path d="M1 1h10v10H1z" />}
        </svg>
      </button>
      <button type="button" className="window-close" aria-label="Close window" title="Close" onClick={() => run(window.close())}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m1 1 10 10m0-10L1 11" /></svg>
      </button>
    </header>
  );
}
