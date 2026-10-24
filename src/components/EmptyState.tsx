import { useMemo } from "react";
import { isTauri } from "../lib/api";
import { useOpenFiles } from "../lib/useData";
import { IconFolder, IconGrid, IconLayers, IconReport, IconTable } from "./Icons";

function WaferArt() {
  const cells = useMemo(() => {
    const out: { x: number; y: number; fail: boolean; edge: boolean }[] = [];
    const R = 8.6;
    for (let y = -9; y <= 9; y++) {
      for (let x = -9; x <= 9; x++) {
        const r = Math.hypot(x, y);
        if (r > R) continue;
        const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const f = h - Math.floor(h);
        out.push({ x, y, fail: f > 0.962, edge: r > R - 1.15 });
      }
    }
    return out;
  }, []);

  return (
    <div className="wafer-art" aria-hidden="true">
      <svg viewBox="-10.5 -10.5 21 21" className="wafer-svg">
        <defs>
          <radialGradient id="waferGrad" cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#2f6fe4" />
            <stop offset="58%" stopColor="#1d4ed8" />
            <stop offset="100%" stopColor="#0b2a6b" />
          </radialGradient>
        </defs>
        <circle cx="0" cy="0" r="9" fill="url(#waferGrad)" />
        {cells.map((c, i) => (
          <rect
            key={i}
            x={c.x - 0.39}
            y={c.y - 0.39}
            width="0.78"
            height="0.78"
            rx="0.08"
            fill={c.fail ? "#f5b301" : c.edge ? "rgba(147,197,253,0.38)" : "rgba(147,197,253,0.62)"}
            opacity={c.fail ? 1 : 0.55 + ((c.x * 3 + c.y * 5) % 7) * 0.045}
          />
        ))}
        <path d="M -1.1 8.55 L 1.1 8.55 L 0 7.3 Z" fill="var(--bg)" />
      </svg>
      <div className="art-badge badge-yield">
        <span>Wafer 07</span>
        <b>96.4%</b>
      </div>
      <div className="art-badge badge-cpk">
        <span>Cpk</span>
        <b>1.84</b>
      </div>
    </div>
  );
}

export function EmptyState() {
  const open = useOpenFiles();

  return (
    <div className="empty">
      <div className="empty-inner">
        <div className="empty-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" /> Wafer-sort analytics · offline
          </div>
          <h1>
            From STDF to a report
            <br />
            in a few clicks.
          </h1>
          <p>
            Open one lot or hundreds. Explore box plots, wafer maps and Pareto charts, then build a full
            JPG report from a single template — no scripting.
          </p>
          <div className="empty-actions">
            <button className="btn primary lg" onClick={() => open()}>
              <IconFolder size={17} /> Open STDF or CSV
            </button>
            {!isTauri && (
              <button className="btn lg" onClick={() => open(["demo_L24-0417.stdf", "demo_L24-0421.stdf"])}>
                Load demo data
              </button>
            )}
          </div>
          <div className="empty-feats">
            <span>
              <IconLayers size={14} /> STDF V4 · CSV
            </span>
            <span>
              <IconGrid size={14} /> Box · Map · Pareto
            </span>
            <span>
              <IconReport size={14} /> Batch reports
            </span>
            <span>
              <IconTable size={14} /> STDF → CSV
            </span>
          </div>
        </div>
        <WaferArt />
      </div>
      <div className="empty-foot">
        Everything runs locally. No data leaves this computer.
      </div>
    </div>
  );
}
