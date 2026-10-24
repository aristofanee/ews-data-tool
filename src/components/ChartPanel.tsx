import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import Plotly from "plotly.js-dist-min";
import { PLOT_LABELS, useStore } from "../store";
import type { PlotSpec, PlotType } from "../types";
import { usePlotData, type PlotData } from "../lib/usePlotData";
import { figureBox, figureHist, figurePareto, figureTrend, type Figure } from "../charts/figures";
import { PlotlyChart } from "./PlotlyChart";
import { WaferMapView, type MapExportApi } from "./WaferMapView";
import { EmptyState } from "./EmptyState";
import * as api from "../lib/api";
import { fmt, fmtInt, safeName } from "../lib/format";
import {
  IconBox,
  IconCopy,
  IconHist,
  IconImage,
  IconMap,
  IconPareto,
  IconPlus,
  IconTrend,
} from "./Icons";

const TABS: { type: PlotType; label: string; Icon: ComponentType<{ size?: number }> }[] = [
  { type: "box", label: "Box plot", Icon: IconBox },
  { type: "map", label: "Wafer map", Icon: IconMap },
  { type: "pareto", label: "Pareto", Icon: IconPareto },
  { type: "hist", label: "Histogram", Icon: IconHist },
  { type: "trend", label: "Trend", Icon: IconTrend },
];

interface Stat {
  k: string;
  v: string;
  tone?: "good" | "warn" | "bad";
}

function cpk(mean: number, sd: number, lsl: number | null, usl: number | null): { cp: number | null; cpk: number | null } {
  if (!(sd > 0)) return { cp: null, cpk: null };
  const cp = lsl !== null && usl !== null ? (usl - lsl) / (6 * sd) : null;
  let k: number | null = null;
  if (lsl !== null && usl !== null) k = Math.min((usl - mean) / (3 * sd), (mean - lsl) / (3 * sd));
  else if (lsl !== null) k = (mean - lsl) / (3 * sd);
  else if (usl !== null) k = (usl - mean) / (3 * sd);
  return { cp, cpk: k };
}

function statsFor(data: PlotData, spec: PlotSpec): Stat[] {
  switch (data.kind) {
    case "box": {
      const d = data.data;
      const s = d.summary;
      const out: Stat[] = [
        { k: "Dice", v: fmtInt(s.n) },
        { k: "Mean", v: fmt(s.mean) },
        { k: "SD", v: fmt(s.sd) },
        { k: "Median", v: fmt(s.median) },
      ];
      if (d.cp !== null) out.push({ k: "Cp", v: fmt(d.cp, 2) });
      if (d.cpk !== null)
        out.push({ k: "Cpk", v: fmt(d.cpk, 2), tone: d.cpk < 1.33 ? "warn" : d.cpk >= 1.67 ? "good" : undefined });
      if (d.excluded > 0) out.push({ k: "Excluded", v: fmtInt(d.excluded), tone: "warn" });
      return out;
    }
    case "map": {
      const d = data.data;
      const out: Stat[] = [
        {
          k: "Yield",
          v: `${d.yieldPct.toFixed(2)}%`,
          tone: d.yieldPct < 90 ? "bad" : d.yieldPct < 96 ? "warn" : "good",
        },
        { k: "Pass", v: fmtInt(d.pass) },
        { k: "Fail", v: fmtInt(d.fail) },
        { k: "Dice", v: fmtInt(d.pass + d.fail) },
      ];
      return out;
    }
    case "pareto": {
      const d = data.data;
      const top = d.bars[0];
      const out: Stat[] = [
        { k: "Failures", v: fmtInt(d.failTotal) },
        { k: "Bin categories", v: fmtInt(d.bars.length) },
      ];
      if (top) out.push({ k: "Top bin", v: `${top.name} · ${top.pct.toFixed(1)}%` });
      return out;
    }
    case "hist": {
      const d = data.data;
      const s = d.summary;
      const lsl = spec.lsl ?? d.test.loSpec;
      const usl = spec.usl ?? d.test.hiSpec;
      const { cp, cpk: k } = cpk(s.mean, s.sd, lsl, usl);
      const out: Stat[] = [
        { k: "Dice", v: fmtInt(s.n) },
        { k: "Mean", v: fmt(s.mean) },
        { k: "SD", v: fmt(s.sd) },
      ];
      if (cp !== null) out.push({ k: "Cp", v: fmt(cp, 2) });
      if (k !== null) out.push({ k: "Cpk", v: fmt(k, 2), tone: k < 1.33 ? "warn" : k >= 1.67 ? "good" : undefined });
      if (d.excluded > 0) out.push({ k: "Excluded", v: fmtInt(d.excluded), tone: "warn" });
      return out;
    }
    case "trend": {
      const d = data.data;
      const means = d.points.map((p) => p.mean);
      const avg = means.length ? means.reduce((a, b) => a + b, 0) / means.length : NaN;
      const out: Stat[] = [
        { k: "Points", v: fmtInt(d.points.length) },
        { k: "Mean", v: fmt(avg) },
      ];
      if (means.length) {
        out.push({ k: "Min", v: fmt(Math.min(...means)) });
        out.push({ k: "Max", v: fmt(Math.max(...means)) });
      }
      return out;
    }
  }
}

export function ChartPanel() {
  const info = useStore((s) => s.info);
  const spec = useStore((s) => s.spec);
  const theme = useStore((s) => s.theme);
  const setPlotType = useStore((s) => s.setPlotType);
  const patchSpec = useStore((s) => s.patchSpec);
  const addReport = useStore((s) => s.addReport);
  const notify = useStore((s) => s.notify);
  const setError = useStore((s) => s.setError);

  const { data, loading, error } = usePlotData();
  const plotRef = useRef<HTMLDivElement>(null);
  const mapApi = useRef<MapExportApi | null>(null);
  const [titleDraft, setTitleDraft] = useState(spec.title);

  useEffect(() => setTitleDraft(spec.title), [spec.title]);

  const figure = useMemo<Figure | null>(() => {
    if (!data) return null;
    switch (data.kind) {
      case "box": {
        const lotOf = data.data.groups.map((g) =>
          spec.groupBy === "lot" ? g.key : (info?.wafers[g.key]?.lot ?? 0)
        );
        return figureBox(data.data, { theme, spec, lotOf, lotNames: info?.lots });
      }
      case "pareto":
        return figurePareto(data.data, { theme, spec });
      case "hist":
        return figureHist(data.data, { theme, spec });
      case "trend":
        return figureTrend(data.data, { theme, spec });
      default:
        return null;
    }
  }, [data, spec, theme, info]);

  if (!info) return <EmptyState />;

  const stats = data ? statsFor(data, spec) : [];
  const isMap = spec.type === "map";

  const commitTitle = () => {
    const t = titleDraft.trim();
    if (t && t !== spec.title) patchSpec({ title: t });
    else setTitleDraft(spec.title);
  };

  const copyImage = async () => {
    try {
      let url: string | null = null;
      if (isMap) {
        url = mapApi.current?.toDataURL("png") ?? null;
      } else if (plotRef.current) {
        url = await Plotly.toImage(plotRef.current, {
          format: "png",
          width: 1800,
          height: 1100,
          scale: 1,
        });
      }
      if (!url) throw new Error("The chart is not ready yet.");

      if (api.isTauri) {
        // WebView2 blocks navigator.clipboard.write for images; use the native
        // clipboard plugin instead.
        const [{ Image }, { writeImage }] = await Promise.all([
          import("@tauri-apps/api/image"),
          import("@tauri-apps/plugin-clipboard-manager"),
        ]);
        const blob = await (await fetch(url)).blob();
        const image = await Image.fromBytes(new Uint8Array(await blob.arrayBuffer()));
        try {
          await writeImage(image);
        } finally {
          await image.close();
        }
        notify("Image copied to the clipboard.");
        return;
      }

      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        throw new Error("This system does not allow images on the clipboard.");
      }
      const blob = await (await fetch(url)).blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      notify("Image copied to the clipboard.");
    } catch (e) {
      setError(`Could not copy the image. ${String(e)}`);
    }
  };

  const saveJpg = async () => {
    try {
      const path = await api.pickSavePath(`${safeName(spec.title || "plot")}.jpg`, ["jpg", "jpeg"]);
      if (!path) return;
      let url: string | null = null;
      if (isMap) {
        url = mapApi.current?.toDataURL("jpeg") ?? null;
      } else if (plotRef.current) {
        url = await Plotly.toImage(plotRef.current, {
          format: "jpeg",
          width: 1800,
          height: 1100,
          scale: 1,
          quality: 0.95,
        });
      }
      if (!url) throw new Error("The chart is not ready yet.");
      await api.saveImage(path, url);
      notify(`Saved ${api.fileName(path)}`);
    } catch (e) {
      setError(`Could not save the image. ${String(e)}`);
    }
  };

  return (
    <>
      <div className="tabs">
        {TABS.map(({ type, label, Icon }) => (
          <button
            key={type}
            className={"tab" + (spec.type === type ? " active" : "")}
            onClick={() => setPlotType(type)}
            title={`${label} (Ctrl+${TABS.findIndex((t) => t.type === type) + 1})`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
        <div className="tabs-spacer" />
        <button className="btn" onClick={addReport} title="Add this plot to the report">
          <IconPlus size={15} /> Add to report
        </button>
      </div>

      <div className="chart-card">
        <div className="chart-head">
          <div className="chart-head-top">
            <input
              className="chart-title"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setTitleDraft(spec.title);
                  e.currentTarget.blur();
                }
              }}
              spellCheck={false}
              aria-label="Plot title"
            />
            <div className="chart-actions">
              <button className="btn icon" onClick={copyImage} title="Copy image to clipboard">
                <IconCopy size={16} />
              </button>
              <button className="btn icon" onClick={saveJpg} title="Save as JPG">
                <IconImage size={16} />
              </button>
            </div>
          </div>
          <div className="stats">
            {stats.map((s) => (
              <div className="stat" key={s.k}>
                <span className="stat-k">{s.k}</span>
                <span className={"stat-v" + (s.tone ? ` tone-${s.tone}` : "")}>{s.v}</span>
              </div>
            ))}
            {data?.kind === "box" && data.data.truncated && (
              <div className="stat">
                <span className="stat-k">Note</span>
                <span className="stat-v tone-warn">large N · points sampled</span>
              </div>
            )}
            <div className="stats-spacer" />
            <span className="plot-kind">{PLOT_LABELS[spec.type]}</span>
          </div>
        </div>

        <div className="chart-body">
          {error ? (
            <div className="chart-error">
              <div className="chart-error-title">Could not build this plot</div>
              <div className="chart-error-msg">{error}</div>
              <div className="hint">Try a different test, or reset the filters on the left.</div>
            </div>
          ) : data?.kind === "map" ? (
            <WaferMapView data={data.data} spec={spec} onReady={(apiRef) => (mapApi.current = apiRef)} />
          ) : figure ? (
            <PlotlyChart figure={figure} hostRef={plotRef} />
          ) : (
            <div className="chart-placeholder">
              <div className="spinner" />
              <span>Preparing plot…</span>
            </div>
          )}
          {loading && data && <div className="chart-busy" />}
        </div>
      </div>
    </>
  );
}
