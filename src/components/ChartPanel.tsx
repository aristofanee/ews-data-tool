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
import { PlotPreviewGrid } from "./PlotPreviewGrid";
import { usePlotSelection, usePlotViewKey } from "../lib/usePlotMemory";
import { WaferMapView, type MapExportApi } from "./WaferMapView";
import { BinMapView, type BinMapExportApi } from "./BinMapView";
import { MapFacetView, type MapFacetExportApi } from "./MapFacetView";
import { ParetoFacetView, type ParetoFacetExportApi } from "./ParetoFacetView";
import { EmptyState } from "./EmptyState";
import { EXPORT_CONFIG } from "../charts/plotlyTheme";
import type { Theme } from "../lib/theme";
import { binLabel } from "../lib/theme";
import * as api from "../lib/api";
import { fmt, fmtInt, safeName } from "../lib/format";
import {
  IconArrowLeft,
  IconBox,
  IconChevronLeft,
  IconChevronRight,
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
  { type: "hist", label: "Histogram", Icon: IconHist },
  { type: "scatter", label: "Scatter", Icon: IconScatter },
  { type: "trend", label: "Trend", Icon: IconTrend },
  { type: "binmap", label: "Bin map", Icon: IconMap },
  { type: "pareto", label: "Pareto", Icon: IconPareto },
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

function categoryLabel(value: string): string {
  if (value === "site") return "Site";
  if (value === "wafer") return "Wafer ID (OCR)";
  if (value === "lot") return "Lot";
  if (value === "hbin") return "HBIN";
  if (value === "sbin") return "SBIN";
  return value;
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
      const capability = cpk(s.mean, s.sd, spec.lsl ?? d.test.loSpec, spec.usl ?? d.test.hiSpec);
      if (capability.cp !== null) out.push({ k: "Cp", v: fmt(capability.cp, 2) });
      if (capability.cpk !== null)
        out.push({ k: "Cpk", v: fmt(capability.cpk, 2), tone: capability.cpk < 1.33 ? "warn" : capability.cpk >= 1.67 ? "good" : undefined });
      if (d.excluded > 0) out.push({ k: "Excluded", v: fmtInt(d.excluded), tone: "warn" });
      return out;
    }
    case "map": {
      const d = data.data;
      const out: Stat[] = [
        {
          k: "Wafer yield (HBIN 1)",
          v: `${d.yieldPct.toFixed(2)}%`,
          tone: "good",
        },
        { k: "Bin 1", v: fmtInt(d.pass) },
        { k: "Other bins", v: fmtInt(d.fail) },
        { k: "Tested dice", v: fmtInt(d.pass + d.fail) },
      ];
      if (d.testYieldPct != null) {
        out.push({ k: "Test yield (LSL/USL)", v: `${d.testYieldPct.toFixed(2)}%`, tone: "good" });
        out.push({ k: "Considered dice", v: fmtInt((d.testPass ?? 0) + (d.testFail ?? 0)) });
      }
      if (spec.groupBy !== "none") {
        out.unshift({ k: "View", v: `Grouped by ${categoryLabel(spec.groupBy)}` });
      } else if (d.isMean) {
        out.unshift({ k: "Scope", v: `All wafers (mean of ${fmtInt(d.waferCount)})` });
      }
      if (d.excluded > 0) out.push({ k: "Excluded", v: fmtInt(d.excluded), tone: "warn" });
      return out;
    }
    case "binmap": {
      const d = data.data;
      const pass = d.wafers.reduce((n, w) => n + w.pass, 0);
      const fail = d.wafers.reduce((n, w) => n + w.fail, 0);
      const tested = pass + fail;
      return [
        {
          k: "Wafer yield (HBIN 1)",
          v: `${tested ? ((pass * 100) / tested).toFixed(2) : "0.00"}%`,
          tone: "good",
        },
        { k: "Bin", v: spec.binCategory === "soft" ? "SBIN" : "HBIN" },
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
        { k: "Bin", v: spec.binCategory === "soft" ? "SBIN" : "HBIN" },
        {
          k: "Bin categories",
          v: fmtInt(d.mode === "global" ? d.bars.length : d.series.length),
        },
        {
          k: "Yield",
          v: `${d.yieldPct.toFixed(2)}%`,
          tone: "good",
        },
      ];
      if (top) out.push({ k: "Top bin", v: `${binLabel(spec.binCategory, top.code, top.name)} · ${top.pct.toFixed(1)}%` });
      if (d.mode === "grouped") out.push({ k: "Groups", v: fmtInt(d.groups.length) });
      if (spec.groupBy !== "none") {
        out.unshift({ k: "View", v: `Split by ${categoryLabel(spec.groupBy)}` });
      } else if (spec.xAxis !== "none") {
        out.unshift({ k: "X axis", v: categoryLabel(spec.xAxis) });
      }
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
        let min = Infinity;
        let max = -Infinity;
        for (const v of means) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
        out.push({ k: "Min", v: fmt(min) });
        out.push({ k: "Max", v: fmt(max) });
      }
      return out;
    }
    case "scatter": {
      const d = data.data;
      const points = d.series.reduce((n, s) => n + s.points.length, 0);
      const out: Stat[] = [
        { k: "Considered dice", v: fmtInt(d.total) },
        { k: "Displayed points", v: fmtInt(points) },
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

function dataMatchesSpec(data: PlotData | null, spec: PlotSpec): boolean {
  return !!data && data.kind === spec.type;
}

function facetsFor(data: PlotData, spec: PlotSpec): Facet[] {
  if (!spec.splitPlots || spec.groupBy === "none") return [];
  if (data.kind === "box") {
    return [...new Set(data.data.groups.map((g) => g.groupLabel).filter(Boolean))].map(
      (label) => ({ label })
    );
  }
  if (data.kind === "hist") {
    return data.data.groups.map((g) => ({ key: g.key, label: g.label }));
  }
  if (
    data.kind === "scatter" &&
    data.data.series.length > 1 &&
    (data.data.groupLabel !== "" || data.data.zMode === "category")
  ) {
    return data.data.series.map((s) => ({ key: s.key, label: s.name }));
  }
  return [];
}

function buildFigure(
  data: PlotData,
  spec: PlotSpec,
  theme: Theme,
  title?: string,
  facet?: Facet,
  preview = false
): Figure | null {
  switch (data.kind) {
    case "box":
      return figureBox(data.data, {
        theme,
        spec,
        title,
        facetLabel: facet?.label,
        preview,
      });
    case "pareto":
      return figurePareto(data.data, {
        theme,
        spec,
        title,
        facetKey: facet?.key,
        preview,
      });
    case "hist":
      return figureHist(data.data, {
        theme,
        spec,
        title,
        facetLabel: facet?.label,
        preview,
      });
    case "trend":
      return figureTrend(data.data, { theme, spec, title });
    case "scatter":
      return figureScatter(data.data, {
        theme,
        spec,
        title,
        facetKey: facet?.key,
        preview,
      });
    default:
      return null;
  }
}

/**
 * Split views can contain dozens of facets. Building and mounting every
 * Plotly chart up front made the scatter split feel frozen, so facets are
 * created only when they approach the visible part of the scroll area.
 */
function LazyFacetChart({
  data,
  spec,
  theme,
  facet,
  preview = false,
  onOpen,
}: {
  data: PlotData;
  spec: PlotSpec;
  theme: Theme;
  facet: Facet;
  preview?: boolean;
  onOpen?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const root = el.closest(".facet-grid");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: root instanceof Element ? root : null, rootMargin: "320px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The facet label is already shown above the plot; do not repeat the title
  // inside the plot area.
  const figure = useMemo(
    () => (visible ? buildFigure(data, spec, theme, undefined, facet, preview) : null),
    [visible, data, spec, theme, facet, preview]
  );

  return (
    <div
      className={"facet-card" + (preview ? " preview" : "")}
      onClick={onOpen}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="facet-label">{facet.label}</div>
      <div className="facet-chart-body" ref={wrapRef}>
        {!figure && (
          <div className="facet-loading">
            <div className="spinner" />
            <span>Preparing…</span>
          </div>
        )}
        {figure && <PlotlyChart figure={figure} hostRef={plotRef} staticPlot={preview} />}
        {preview && onOpen && (
          <button
            className="facet-open"
            aria-label={`Open ${facet.label}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Mosaic of split-plot previews; clicking one opens the enlarged chart. */
function SplitPlotView({
  data,
  spec,
  theme,
  facets,
}: {
  data: PlotData;
  spec: PlotSpec;
  theme: Theme;
  facets: Facet[];
}) {
  const viewKey = usePlotViewKey(spec);
  const [selected, setSelected] = usePlotSelection(`split:${spec.type}`, viewKey);
  const facet = selected !== null ? facets[selected] : undefined;
  const detail = useMemo(
    () =>
      data && facet
        ? buildFigure(data, spec, theme, undefined, facet, false)
        : null,
    [data, spec, theme, facet]
  );

  useEffect(() => {
    if (selected !== null && selected >= facets.length) setSelected(null);
  }, [facets.length, selected]);

  useEffect(() => {
    if (selected === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (target?.isContentEditable || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelected((i) => (i === null ? null : Math.max(0, i - 1)));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSelected((i) => (i === null ? null : Math.min(facets.length - 1, i + 1)));
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, facets.length]);

  if (facet && selected !== null) {
    return (
      <div className="facet-detail">
        <div className="facet-detail-head">
          <button className="btn map-detail-back" onClick={() => setSelected(null)} title="Back to all plots">
            <IconArrowLeft size={14} />
            All plots
          </button>
          <div className="facet-detail-title">{facet.label}</div>
          <div className="map-detail-nav">
            <button
              className="btn icon"
              onClick={() => setSelected(Math.max(0, selected - 1))}
              disabled={selected <= 0}
              title="Previous plot (left arrow)"
            >
              <IconChevronLeft size={16} />
            </button>
            <span className="map-detail-count">
              {selected + 1} / {facets.length}
            </span>
            <button
              className="btn icon"
              onClick={() => setSelected(Math.min(facets.length - 1, selected + 1))}
              disabled={selected >= facets.length - 1}
              title="Next plot (right arrow)"
            >
              <IconChevronRight size={16} />
            </button>
          </div>
        </div>
        <div className="facet-detail-body">
          {detail ? (
            <PlotlyChart key={facet.key ?? facet.label} figure={detail} cacheKey={`${viewKey}:${facet.key ?? facet.label}`} />
          ) : (
            <div className="chart-placeholder">
              <div className="spinner" />
              <span>Preparing plot…</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <PlotPreviewGrid>
      {facets.map((f, i) => (
        <LazyFacetChart
          key={f.key ?? f.label}
          data={data}
          spec={spec}
          theme={theme}
          facet={f}
          preview
          onOpen={() => setSelected(i)}
        />
      ))}
    </PlotPreviewGrid>
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
  const viewKey = usePlotViewKey(spec);
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
  const paretoFacetApi = useRef<ParetoFacetExportApi | null>(null);
  const binMapApi = useRef<BinMapExportApi | null>(null);
  const [titleDraft, setTitleDraft] = useState(spec.title);

  useEffect(() => setTitleDraft(spec.title), [spec.title]);

  // While a new plot type is loading, usePlotData still exposes the previous
  // response. Never render that stale kind: switching away from a wafer map
  // used to flash the old map for a frame.
  const currentData = dataMatchesSpec(data, spec) ? data : null;
  const facets = useMemo<Facet[]>(
    () => (currentData ? facetsFor(currentData, spec) : []),
    [currentData, spec]
  );
  const splitActive = facets.length > 0;
  const paretoSplitActive = spec.type === "pareto" && spec.groupBy !== "none";
  // Do not build the hidden full-size figure while a split view is active.
  // With tens of thousands of scatter points that construction is pure waste.
  const figure = useMemo<Figure | null>(
    () =>
      currentData && !splitActive && !paretoSplitActive
        ? buildFigure(currentData, spec, theme)
        : null,
    [currentData, spec, theme, splitActive, paretoSplitActive]
  );
  const mapSpec = useMemo(() => ({ ...spec, mapMode: "value" as const }), [spec]);

  if (!info) return <EmptyState />;

  const stats = currentData ? statsFor(currentData, spec) : [];
  const isMap = spec.type === "map";
  const isBinMap = spec.type === "binmap";
  const mapSplitActive = isMap && spec.groupBy !== "none";

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
      } else if (paretoSplitActive) {
        const first = paretoFacetApi.current?.figures("light")[0];
        if (first) url = await renderExportFigure(first.figure, "png");
      } else if (currentData) {
        const first = splitActive ? facets[0] : undefined;
        const fig = buildFigure(
          currentData,
          spec,
          "light",
          first ? `${spec.title} · ${first.label}` : spec.title,
          first
        );
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
      if (paretoSplitActive) {
        const folder = await api.pickFolder();
        if (!folder) return;
        const images = paretoFacetApi.current?.figures("light") ?? [];
        const base = folder.replace(/[\\/]+$/, "");
        for (const image of images) {
          const url = await renderExportFigure(image.figure, "jpeg");
          const file = `${safeName(spec.title)}_${safeName(image.label)}.jpg`;
          await api.saveImage(`${base}\\${file}`, url);
        }
        notify(`Saved ${images.length} split Pareto${images.length === 1 ? "" : "s"}.`);
        return;
      }
      if (splitActive && !isMap && !isBinMap) {
        const folder = await api.pickFolder();
        if (!folder) return;
        let count = 0;
        for (const facet of facets) {
          if (!currentData) break;
          const facetFigure = buildFigure(
            currentData,
            spec,
            "light",
            `${spec.title} · ${facet.label}`,
            facet
          );
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
      } else if (currentData) {
        const fig = buildFigure(currentData, spec, "light", spec.title);
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
            {(currentData?.kind === "box" || currentData?.kind === "scatter") &&
              currentData.data.truncated && (
                <div className="stat" title={currentData.kind === "scatter"
                  ? `Showing ${fmtInt(currentData.data.series.reduce((n, s) => n + s.points.length, 0))} of ${fmtInt(currentData.data.total)} considered X/Y measurements for responsiveness. Correlation uses all considered measurements; the fit line uses the displayed subset. No measurements are removed from the imported data.`
                  : "Regular markers are sampled for responsiveness. Every outlier is retained, and box statistics use all considered measurements."}>
                  <span className="stat-k">Rendering</span>
                  <span className="stat-v tone-warn">{currentData.kind === "scatter" ? "Sampled display" : "Regular points sampled"}</span>
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
            </div>
          ) : mapSplitActive ? (
            <MapFacetView
              spec={spec}
              filter={filters}
              onReady={(apiRef) => (mapFacetApi.current = apiRef)}
            />
          ) : paretoSplitActive ? (
            <ParetoFacetView
              spec={spec}
              filter={filters}
              onReady={(apiRef) => (paretoFacetApi.current = apiRef)}
            />
          ) : currentData?.kind === "map" ? (
            <WaferMapView
              data={currentData.data}
              spec={mapSpec}
              onReady={(apiRef) => (mapApi.current = apiRef)}
            />
          ) : currentData?.kind === "binmap" ? (
            <BinMapView
              data={currentData.data}
              spec={spec}
              onReady={(apiRef) => (binMapApi.current = apiRef)}
            />
          ) : splitActive && currentData ? (
            <SplitPlotView data={currentData} spec={spec} theme={theme} facets={facets} />
          ) : figure ? (
            <PlotlyChart figure={figure} hostRef={plotRef} cacheKey={viewKey} />
          ) : (
            <div className="chart-placeholder">
              <div className="spinner" />
              <span>Preparing plot…</span>
            </div>
          )}
          {loading && currentData && <div className="chart-busy" />}
        </div>
      </div>
    </>
  );
}
