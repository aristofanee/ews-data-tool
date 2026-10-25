import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import Plotly from "plotly.js-dist-min";
import { PLOT_LABELS, useStore } from "../store";
import type { PlotSpec, PlotType } from "../types";
import { usePlotData, type PlotData } from "../lib/usePlotData";
import {
  figureBox,
  figureHist,
  figurePareto,
  figureScatter,
  figureTrend,
  type Figure,
} from "../charts/figures";
import { PlotlyChart } from "./PlotlyChart";
import { WaferMapView, type MapExportApi } from "./WaferMapView";
import { BinMapView, type BinMapExportApi } from "./BinMapView";
import { MapFacetView, type MapFacetExportApi } from "./MapFacetView";
import { EmptyState } from "./EmptyState";
import { EXPORT_CONFIG } from "../charts/plotlyTheme";
import type { Theme } from "../lib/theme";
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
  IconScatter,
  IconTrend,
} from "./Icons";

const TABS: { type: PlotType; label: string; Icon: ComponentType<{ size?: number }> }[] = [
  { type: "box", label: "Box plot", Icon: IconBox },
  { type: "map", label: "Wafer map", Icon: IconMap },
  { type: "binmap", label: "Bin map", Icon: IconMap },
  { type: "pareto", label: "Pareto", Icon: IconPareto },
  { type: "hist", label: "Histogram", Icon: IconHist },
  { type: "trend", label: "Trend", Icon: IconTrend },
  { type: "scatter", label: "Scatter", Icon: IconScatter },
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
    case "binmap": {
      const d = data.data;
      const pass = d.wafers.reduce((n, w) => n + w.pass, 0);
      const fail = d.wafers.reduce((n, w) => n + w.fail, 0);
      const tested = pass + fail;
      return [
        {
          k: "Yield",
          v: `${tested ? ((pass * 100) / tested).toFixed(2) : "0.00"}%`,
          tone: tested && pass / tested < 0.9 ? "bad" : tested && pass / tested < 0.96 ? "warn" : "good",
        },
        { k: "Wafers", v: fmtInt(d.wafers.length) },
        { k: "Pass", v: fmtInt(pass) },
        { k: "Fail", v: fmtInt(fail) },
      ];
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
    case "scatter": {
      const d = data.data;
      const points = d.series.reduce((n, s) => n + s.points.length, 0);
      const out: Stat[] = [
        { k: "Dice", v: fmtInt(d.total) },
        { k: "Points", v: fmtInt(points) },
      ];
      if (d.r !== null && Number.isFinite(d.r)) {
        out.push({ k: "r", v: fmt(d.r, 3) });
        out.push({ k: "R²", v: fmt(d.r * d.r, 3) });
      }
      if (d.series.length > 1) out.push({ k: "Groups", v: fmtInt(d.series.length) });
      if (d.excluded > 0) out.push({ k: "Excluded", v: fmtInt(d.excluded), tone: "warn" });
      return out;
    }
  }
}

interface Facet {
  key?: number;
  label: string;
}

function facetsFor(data: PlotData, spec: PlotSpec): Facet[] {
  if (!spec.splitPlots) return [];
  if (data.kind === "box") {
    return [...new Set(data.data.groups.map((g) => g.block))].map((label) => ({ label }));
  }
  if (data.kind === "scatter" && data.data.zMode === "category") {
    return data.data.series.map((s) => ({ key: s.key, label: s.name }));
  }
  return [];
}

function buildFigure(
  data: PlotData,
  spec: PlotSpec,
  theme: Theme,
  title?: string,
  facet?: Facet
): Figure | null {
  switch (data.kind) {
    case "box":
      return figureBox(data.data, { theme, spec, title, facetLabel: facet?.label });
    case "pareto":
      return figurePareto(data.data, { theme, spec, title });
    case "hist":
      return figureHist(data.data, { theme, spec, title });
    case "trend":
      return figureTrend(data.data, { theme, spec, title });
    case "scatter":
      return figureScatter(data.data, { theme, spec, title, facetKey: facet?.key });
    default:
      return null;
  }
}

function FacetChart({ figure, label }: { figure: Figure; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="facet-card">
      <div className="facet-label">{label}</div>
      <PlotlyChart figure={figure} hostRef={ref} />
    </div>
  );
}

/**
 * Render an export at slide-friendly dimensions. The on-screen chart has the
 * editable title in the card header, but exported images need the title baked
 * in, so we build a standalone light-theme figure for clipboard/JPG output.
 */
async function renderExportFigure(
  fig: Figure,
  format: "png" | "jpeg",
  width = 2400,
  height = 1500
): Promise<string> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-30000px;top:0;width:${width}px;height:${height}px;`;
  document.body.appendChild(host);
  try {
    const layout = { ...fig.layout, width, height, autosize: false };
    await Plotly.newPlot(host, fig.data, layout, EXPORT_CONFIG);
    return await Plotly.toImage(host, {
      format,
      width,
      height,
      scale: 1.25,
      quality: 0.96,
    });
  } finally {
    try {
      Plotly.purge(host);
    } catch {
      /* ignore */
    }
    host.remove();
  }
}

export function ChartPanel() {
  const info = useStore((s) => s.info);
  const spec = useStore((s) => s.spec);
  const theme = useStore((s) => s.theme);
  const filters = useStore((s) => s.filters);
  const setPlotType = useStore((s) => s.setPlotType);
  const patchSpec = useStore((s) => s.patchSpec);
  const addReport = useStore((s) => s.addReport);
  const notify = useStore((s) => s.notify);
  const setError = useStore((s) => s.setError);

  const { data, loading, error } = usePlotData();
  const plotRef = useRef<HTMLDivElement>(null);
  const mapApi = useRef<MapExportApi | null>(null);
  const mapFacetApi = useRef<MapFacetExportApi | null>(null);
  const binMapApi = useRef<BinMapExportApi | null>(null);
  const [titleDraft, setTitleDraft] = useState(spec.title);

  useEffect(() => setTitleDraft(spec.title), [spec.title]);

  const facets = useMemo<Facet[]>(() => (data ? facetsFor(data, spec) : []), [data, spec]);
  const facetFigures = useMemo(
    () =>
      data
        ? facets.map((facet) => ({
            facet,
            figure: buildFigure(data, spec, theme, `${spec.title} · ${facet.label}`, facet),
          }))
        : [],
    [data, facets, spec, theme]
  );
  const figure = useMemo<Figure | null>(
    () => (data ? buildFigure(data, spec, theme) : null),
    [data, spec, theme]
  );

  if (!info) return <EmptyState />;

  const stats = data ? statsFor(data, spec) : [];
  const isMap = spec.type === "map";
  const isBinMap = spec.type === "binmap";
  const mapSplitActive = isMap && spec.splitPlots;
  const splitActive = facets.length > 1 && facetFigures.some((f) => f.figure);

  const commitTitle = () => {
    const t = titleDraft.trim();
    if (t && t !== spec.title) patchSpec({ title: t });
    else setTitleDraft(spec.title);
  };

  const copyImage = async () => {
    try {
      let url: string | null = null;
      if (mapSplitActive) {
        url = mapFacetApi.current?.toDataURLs("png", "light", 2400, 1500)[0]?.url ?? null;
      } else if (isMap) {
        url = mapApi.current?.toDataURL("png", "light", 2400, 1500) ?? null;
      } else if (isBinMap) {
        url = binMapApi.current?.toDataURL("png", "light", 2400, 1500) ?? null;
      } else if (data) {
        const fig = splitActive
          ? facetFigures[0]?.figure
          : buildFigure(data, spec, "light", spec.title);
        if (fig) url = await renderExportFigure(fig, "png");
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
      // Split plots are a cluster: save one image per split into a folder,
      // with the split name in every filename.
      if (mapSplitActive) {
        const folder = await api.pickFolder();
        if (!folder) return;
        const images = mapFacetApi.current?.toDataURLs("jpeg", "light", 2400, 1500) ?? [];
        const base = folder.replace(/[\\/]+$/, "");
        for (const image of images) {
          const file = `${safeName(spec.title)}_${safeName(image.label)}.jpg`;
          await api.saveImage(`${base}\\${file}`, image.url);
        }
        notify(`Saved ${images.length} split map${images.length === 1 ? "" : "s"}.`);
        return;
      }
      if (splitActive && !isMap && !isBinMap) {
        const folder = await api.pickFolder();
        if (!folder) return;
        let count = 0;
        for (const { facet, figure: facetFigure } of facetFigures) {
          if (!facetFigure) continue;
          const url = await renderExportFigure(facetFigure, "jpeg");
          const base = folder.replace(/[\\/]+$/, "");
          const file = `${safeName(spec.title)}_${safeName(facet.label)}.jpg`;
          await api.saveImage(`${base}\\${file}`, url);
          count++;
        }
        notify(`Saved ${count} split image${count === 1 ? "" : "s"}.`);
        return;
      }

      const path = await api.pickSavePath(`${safeName(spec.title || "plot")}.jpg`, ["jpg", "jpeg"]);
      if (!path) return;
      let url: string | null = null;
      if (isMap) {
        url = mapApi.current?.toDataURL("jpeg", "light", 2400, 1500) ?? null;
      } else if (isBinMap) {
        url = binMapApi.current?.toDataURL("jpeg", "light", 2400, 1500) ?? null;
      } else if (data) {
        const fig = buildFigure(data, spec, "light", spec.title);
        if (fig) url = await renderExportFigure(fig, "jpeg");
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
            {(data?.kind === "box" || data?.kind === "scatter") && data.data.truncated && (
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
          ) : mapSplitActive ? (
            <MapFacetView
              spec={spec}
              filter={filters}
              onReady={(apiRef) => (mapFacetApi.current = apiRef)}
            />
          ) : data?.kind === "map" ? (
            <WaferMapView data={data.data} spec={spec} onReady={(apiRef) => (mapApi.current = apiRef)} />
          ) : data?.kind === "binmap" ? (
            <BinMapView data={data.data} spec={spec} onReady={(apiRef) => (binMapApi.current = apiRef)} />
          ) : splitActive ? (
            <div className="facet-grid">
              {facetFigures.map(
                ({ facet, figure: facetFigure }) =>
                  facetFigure && (
                    <FacetChart key={facet.label} figure={facetFigure} label={facet.label} />
                  )
              )}
            </div>
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
