import type {
  BoxResponse,
  HistResponse,
  ParetoResponse,
  PlotSpec,
  ScatterPoint,
  ScatterResponse,
  TrendResponse,
} from "../types";
import { axisTitle, fmt, fmtInt, testLabel, tidyName } from "../lib/format";
import { capability, limitRange, mean, normalPdf, stdDev, summarize, scatterStatistics, type AxisStats } from "../lib/stats";
import { categoryName, statisticsFooter, type ExportPlotStyle } from "./imageExport";
import type { Filter } from "../types";
import { graphFontOffset } from "../lib/demoFonts";
import type { Theme } from "../lib/theme";
import { binColor, binLabel } from "../lib/theme";
import {
  baseLayout,
  categoricalColor,
  categoricalFill,
  chartStyle,
  chartTheme,
  CHART_FONT,
  type ChartStyle,
  type ChartTheme,
} from "./plotlyTheme";

export interface Figure {
  /** Standalone image context, drawn by the export renderer only. */
  exportNotes?: string[];
  exportSubtitle?: string;
  exportStyle?: ExportPlotStyle;
  exportFilter?: Filter;
  data: any[];
  layout: any;
  rasterScatter?: boolean;
  sampledMarkers?: boolean;
}

export interface FigureOpts {
  theme: Theme;
  spec: PlotSpec;
  title?: string;
  /** Render only one split/block/category. */
  facetKey?: number;
  facetLabel?: string;
  /** Mosaic thumbnail: no titles, tick labels or legend. */
  preview?: boolean;
}

function categoryTitle(value: string): string {
  return categoryName(value);
}

/** Small charts retain meaningful axes while using consistent compact type. */
function previewFigure(data: any[], layout: any, preview: boolean, xTitle: string, yTitle: string): Figure {
  if (!preview) return { data, layout };
  const compact = (text: string, max = 36) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
  layout.margin = { l: 62, r: layout.yaxis2 ? 54 : 24, t: 22, b: 62 };
  layout.showlegend = false;
  layout.font = { ...layout.font, size: 13 + graphFontOffset() };
  for (const [key, title] of [["xaxis", xTitle], ["yaxis", yTitle], ["yaxis2", "Yield [%]"]]) {
    if (!layout[key]) continue;
    layout[key] = { ...layout[key], showticklabels: true, automargin: true,
      tickfont: { ...layout[key].tickfont, size: 12 + graphFontOffset() }, nticks: 4,
      title: { text: compact(title), font: { size: 13 + graphFontOffset(), color: key === "yaxis2" ? layout[key].tickfont?.color : layout.font.color, family: CHART_FONT }, standoff: 8 },
    };
  }
  const axis = layout.xaxis;
  if (axis.tickvals?.length > 8) {
    const stride = Math.ceil(axis.tickvals.length / 8);
    if (axis.ticktext) axis.ticktext = axis.ticktext.filter((_: unknown, i: number) => i % stride === 0);
    axis.tickvals = axis.tickvals.filter((_: unknown, i: number) => i % stride === 0);
  }
  return { data, layout };
}

const ALPHA_POINT = 0.55;

// Apply the normal-mode font increase after scaling smaller chart labels.
function scaledFont(size: number, factor: number, presentation: boolean): number {
  const increase = presentation ? 0 : 2 + graphFontOffset();
  return Math.round((size - increase) * factor) + increase;
}

function pseudo(i: number): number {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** "L24-0417 / 01" -> "01"; "L24-0417" -> "L24-0417". */
function shortTick(label: string): string {
  const i = label.lastIndexOf(" / ");
  return i >= 0 ? label.slice(i + 3) : label;
}

interface LotBlock {
  start: number;
  end: number;
  name: string;
}

/** Contiguous runs of the same lot in a "LOT / wafer" label sequence. */
function lotBlocks(labels: string[]): LotBlock[] {
  const blocks: LotBlock[] = [];
  for (let i = 0; i < labels.length; i++) {
    const sep = labels[i].lastIndexOf(" / ");
    if (sep < 0) return [];
    const name = labels[i].slice(0, sep);
    const last = blocks[blocks.length - 1];
    if (last && last.name === name) last.end = i;
    else blocks.push({ start: i, end: i, name });
  }
  return blocks;
}

/** Every nth category, restarting at each lot block so both lots show 01, 03, ... */
function tickSubset(labels: string[], stride: number): number[] {
  if (stride <= 1) return labels.map((_, i) => i);
  const blocks = lotBlocks(labels);
  if (blocks.length < 2) {
    return labels.map((_, i) => i).filter((i) => i % stride === 0);
  }
  const keep: number[] = [];
  for (const b of blocks) {
    for (let i = b.start; i <= b.end; i++) {
      if ((i - b.start) % stride === 0) {
        // Keep the new lot's first tick clear of the preceding lot's last tick.
        if (i === b.start && keep.length && i - keep[keep.length - 1] < stride) keep.pop();
        keep.push(i);
      }
    }
  }
  return keep;
}

/** Label each lot block above a trend chart and separate blocks with a rule. */
function addLabelBlocks(
  t: ChartTheme,
  labels: string[],
  shapes: any[],
  annotations: any[],
  style: ChartStyle
): boolean {
  const blocks = lotBlocks(labels);
  if (blocks.length < 2) return false;
  for (const b of blocks) {
    annotations.push({
      xref: "x",
      x: (b.start + b.end) / 2,
      yref: "paper",
      y: 1,
      yanchor: "bottom",
      yshift: Math.max(4, Math.round(style.annotation * 0.3)),
      text: b.name,
      showarrow: false,
      font: { size: style.annotation, color: t.muted, family: CHART_FONT },
    });
  }
  for (let b = 1; b < blocks.length; b++) {
    shapes.push({
      type: "line",
      xref: "x",
      x0: blocks[b].start - 0.5,
      x1: blocks[b].start - 0.5,
      yref: "paper",
      y0: 0,
      y1: 1,
      line: { color: t.axis, width: Math.max(1, style.line * 0.5), dash: "dot" },
      layer: "below",
    });
  }
  return true;
}

interface LimitLines {
  shapes: any[];
  annotations: any[];
}

/** LSL/USL (red dashed) on a cartesian axis. */
export function limitLines(
  t: ChartTheme,
  lsl: number | null,
  usl: number | null,
  yref = "y",
  style: ChartStyle = chartStyle(false),
  logY = false
): LimitLines {
  const shapes: any[] = [];
  const annotations: any[] = [];
  const add = (v: number, label: string, anchor: "bottom" | "top") => {
    // Draw above gridlines so a gridline cannot split the dashes.
    shapes.push({
      name: "ews-spec-limit",
      type: "line",
      xref: "paper",
      x0: 0,
      x1: 1,
      yref,
      y0: v,
      y1: v,
      line: { color: t.red, width: style.line, dash: "dash" },
      layer: "above",
    });
    annotations.push({
      xref: "paper",
      x: 0.996,
      xanchor: "right",
      yref,
      // Plotly annotations use log10 coordinates on a log axis, unlike
      // shapes, which use the raw data coordinate.
      y: logY && yref === "y" && v > 0 ? Math.log10(v) : v,
      yanchor: anchor,
      yshift: 0,
      text: `${label} ${fmt(v)}`,
      showarrow: false,
      font: { size: style.annotation, color: t.red, family: CHART_FONT },
      bgcolor: t.paper,
      borderpad: 1,
      opacity: 1,
    });
  };
  if (lsl !== null && Number.isFinite(lsl)) add(lsl, "LSL", "bottom");
  if (usl !== null && Number.isFinite(usl)) add(usl, "USL", "top");
  return { shapes, annotations };
}

/** LSL/USL (red dashed) on a value x-axis. */
export function limitLinesX(
  t: ChartTheme,
  lsl: number | null,
  usl: number | null,
  style: ChartStyle = chartStyle(false)
): LimitLines {
  const shapes: any[] = [];
  const annotations: any[] = [];
  const add = (v: number, label: string, side: "left" | "right") => {
    shapes.push({
      name: "ews-spec-limit",
      type: "line",
      xref: "x",
      x0: v,
      x1: v,
      yref: "paper",
      y0: 0,
      y1: 1,
      line: { color: t.red, width: style.line, dash: "dash" },
      layer: "above",
    });
    annotations.push({
      xref: "x",
      x: v,
      xanchor: side,
      xshift: side === "left" ? Math.round(style.annotation * 0.5) : -Math.round(style.annotation * 0.5),
      yref: "paper",
      y: 1,
      yanchor: "bottom",
      yshift: Math.max(3, Math.round(style.annotation * 0.3)),
      text: `${label} ${fmt(v)}`,
      showarrow: false,
      font: { size: style.annotation, color: t.red, family: CHART_FONT },
      opacity: 1,
    });
  };
  if (lsl !== null && Number.isFinite(lsl)) add(lsl, "LSL", "left");
  if (usl !== null && Number.isFinite(usl)) add(usl, "USL", "right");
  return { shapes, annotations };
}

function applyAxisRange(
  layout: any,
  axis: "x" | "y",
  spec: PlotSpec,
  stats: AxisStats,
  lsl: number | null,
  usl: number | null,
  fallbackLo: number,
  fallbackHi: number
) {
  if (spec.limitMode === "auto") return;
  const range = limitRange(spec, stats, lsl, usl, fallbackLo, fallbackHi);
  if (!range) return;
  if (spec.logY && axis === "y") {
    if (range[0] <= 0 || range[1] <= 0) return;
    // Plotly's log-axis range is expressed in log10 units, not data units.
    layout[`${axis}axis`].range = [Math.log10(range[0]), Math.log10(range[1])];
    return;
  }
  layout[`${axis}axis`].range = range;
}

/* ------------------------------------------------------------------ */
/* Box plot                                                            */
/* ------------------------------------------------------------------ */

/** Shared outer grouping: contiguous categories with headings, never a legend. */
function addGroupBlocks(t: ChartTheme, groups: { groupLabel: string }[], spec: PlotSpec,
  style: ChartStyle, shapes: any[], annotations: any[]) {
  const groupLabels = [...new Set(groups.map((g) => g.groupLabel).filter(Boolean))];
  let start = 0;
  for (const label of groupLabels) {
    const length = groups.filter((g) => g.groupLabel === label).length;
    const heading = spec.groupBy === "wafer" ? shortTick(label) : label;
    const dense = groupLabels.length > 8;
    annotations.push({ xref: "x", x: start + (length - 1) / 2,
      yref: "paper", y: 1.02, xanchor: "center", yanchor: "bottom",
      text: heading, textangle: dense && heading.length > 3 ? (groupLabels.length > 20 ? -75 : -55) : 0,
      showarrow: false, font: { size: dense ? Math.min(spec.presentation ? 11 : 13 + graphFontOffset(), style.annotation) : style.annotation, color: t.text, family: CHART_FONT } });
    if (start > 0) shapes.push({ type: "line", xref: "x", x0: start - 0.5, x1: start - 0.5,
      yref: "paper", y0: 0, y1: 1, line: { color: t.axis, width: 1, dash: "dot" } });
    start += length;
  }

}

function figureBoxCore(data: BoxResponse, opts: FigureOpts): Figure {
  const t = chartTheme(opts.theme);
  const spec = opts.spec;
  const style = chartStyle(opts.preview ? false : spec.presentation);
  const units = data.test.units;
  const preview = opts.preview === true;
  let groups = opts.facetLabel === undefined ? data.groups
    : data.groups.filter((g) => g.groupLabel === opts.facetLabel);
  const groupLabels = [...new Set(groups.map((g) => g.groupLabel).filter(Boolean))];
  const hasGrouping = opts.facetLabel === undefined && groupLabels.length > 0;
  // Group is the outer category. Each block contains its own contiguous X
  // categories, rather than interleaving every group at each X value.
  if (hasGrouping) groups = groupLabels.flatMap((label) => groups.filter((g) => g.groupLabel === label));
  const xLabels = groups.map((g) => g.xLabel);
  const n = groups.length;
  const traces: any[] = [];
  // A thumbnail uses SVG. Bound regular markers across the whole thumbnail,
  // including when the split contains many boxes.
  const previewStride = preview && spec.showPoints === "all"
    ? Math.ceil(groups.reduce((total, group) => total + group.values.length, 0) / 800)
    : 1;
  let sampledMarkers = false;

  for (const [xIndex, g] of groups.entries()) {
    const xPos = xIndex;
    const width = spec.presentation ? 0.62 : 0.54;
    const useDefaultColor = opts.facetLabel !== undefined || !hasGrouping;
    const line = useDefaultColor ? t.blue : categoricalColor(t, g.groupKey, g.groupLabel);
    const fill = useDefaultColor ? t.blueFill : categoricalFill(t, g.groupKey, g.groupLabel);
    const idx: number[] = [];
    for (let k = 0; k < g.values.length; k++) {
      if (!spec.logY || g.values[k] > 0) idx.push(k);
    }
    const summary = spec.logY ? g.positiveSummary : g.summary;
    if (summary.n === 0) continue;
    const ys = idx.map((k) => g.values[k]);
    const label = hasGrouping ? g.groupLabel : g.xLabel;

    traces.push({
      type: "box",
      name: label,
      x: [xPos],
      q1: [summary.q1],
      median: [summary.median],
      q3: [summary.q3],
      lowerfence: [summary.whiskerLo],
      upperfence: [summary.whiskerHi],
      mean: [summary.mean],
      sd: [summary.sd],
      showlegend: false,
      legendgroup: label,
      // Exact full-population statistics; only marker points are sampled.
      boxpoints: false,
      boxmean: true,
      width,
      whiskerwidth: 0.55,
      fillcolor: fill,
      line: { color: line, width: style.line },
      marker: { size: 0, opacity: 0, color: line },
      hoveron: "boxes",
      hovertemplate:
        `<b>${g.xLabel}${hasGrouping ? " · " + g.groupLabel : ""}</b><br>` +
        `median %{median:.5~g}<br>` +
        `q1 %{q1:.5~g} · q3 %{q3:.5~g}<br>` +
        `n ${g.n.toLocaleString("en-US")}<extra></extra>`,
    });

    const mode = spec.showPoints;
    if (mode !== "none") {
      let pick: number[] = [];
      if (mode === "outliers") {
        const q1 = summary.q1;
        const q3 = summary.q3;
        const iqr = q3 - q1;
        const lo = q1 - 1.5 * iqr;
        const hi = q3 + 1.5 * iqr;
        for (let k = 0; k < ys.length; k++) {
          if (ys[k] < lo || ys[k] > hi) pick.push(k);
        }
      } else {
        const stride = spec.displayAllData && !preview ? 1 : Math.max(1, previewStride, Math.ceil(ys.length / 2500));
        const lo = summary.q1 - 1.5 * (summary.q3 - summary.q1);
        const hi = summary.q3 + 1.5 * (summary.q3 - summary.q1);
        for (let k = 0; k < ys.length; k++) {
          if (k % stride === 0 || ys[k] < lo || ys[k] > hi) pick.push(k);
        }
        sampledMarkers ||= pick.length < summary.n;
      }
      if (pick.length > 0) {
        const px = pick.map(
          (k) => xPos + (pseudo(idx[k] + xIndex * 977) - 0.5) * width * 0.72
        );
        const py = pick.map((k) => ys[k]);
        const cd = pick.map((k) => [g.xs[idx[k]], g.ys[idx[k]], `${g.xLabel}${hasGrouping ? " · " + g.groupLabel : ""}`]);
        traces.push({
          type: preview ? "scatter" : "scattergl",
          mode: "markers",
          name: label,
          x: px,
          y: py,
          customdata: cd,
          showlegend: false,
          legendgroup: label,
          marker: {
            symbol: mode === "outliers" ? "cross-thin" : "circle",
            size: mode === "all" ? style.point : style.marker,
            color: line,
            opacity: ALPHA_POINT,
            line: {
              width: mode === "outliers" ? Math.max(0.8, style.line * 0.25) : 0,
              color: line,
            },
          },
          hovertemplate:
            `<b>%{y:.5~g}${units ? " " + units : ""}</b><br>` +
            `die (%{customdata[0]}, %{customdata[1]})<br>` +
            `%{customdata[2]}<extra></extra>`,
        });
      }
    }
  }

  const lsl = spec.lsl ?? data.test.loSpec;
  const usl = spec.usl ?? data.test.hiSpec;
  const limits = preview || !spec.showLimits
    ? { shapes: [], annotations: [] }
    : limitLines(t, lsl, usl, "y", style, spec.logY);

  const short = xLabels.map(shortTick);
  const stride = Math.max(1, Math.ceil(n / (spec.presentation ? 24 : 36)));
  const angle =
    !preview && n > (spec.presentation ? 10 : 12) && short.some((s) => s.length > 5)
      ? -45
      : 0;
  const ticks = tickSubset(xLabels, stride);

  const layout = baseLayout(t, preview ? "" : opts.title, spec.presentation);
  layout.margin = preview
    ? { l: 8, r: 8, t: 8, b: 8 }
    : {
        ...layout.margin,
        l: style.margin.l,
        r: style.margin.r,
        b: style.margin.b + (angle !== 0 ? Math.round(style.tick * 2.2) : 0),
        t: layout.margin.t + (hasGrouping ? Math.round(style.annotation * (groupLabels.length > 8 ? 5 : 1.2)) : 0),
      };
  layout.boxgap = 0.32;
  layout.boxgroupgap = 0;
  layout.showlegend = false;
  if (hasGrouping) addGroupBlocks(t, groups, spec, style, limits.shapes, limits.annotations);
  else if (!preview && spec.xAxis === "wafer" && addLabelBlocks(t, xLabels, limits.shapes, limits.annotations, style)) {
    layout.margin.t += Math.round(style.annotation * 1.2);
  }
  layout.xaxis = {
    ...layout.xaxis,
    title: preview
      ? { text: "" }
      : {
          text: categoryTitle(spec.xAxis),
          font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
        },
    tickmode: "array",
    tickvals: ticks,
    ticktext: ticks.map((i) => short[i]),
    tickangle: angle,
    showticklabels: !preview,
    tickfont: {
      size: style.tick,
      color: t.muted,
      family: CHART_FONT,
    },
    showgrid: false,
    zeroline: false,
    range: [-0.65, Math.max(0.65, n - 0.35)],
  };
  layout.yaxis = {
    ...layout.yaxis,
    title: preview
      ? { text: "" }
      : {
          text: axisTitle(testLabel(data.test), units, scaledFont(style.axisTitle, 0.62, spec.presentation)),
          font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
        },
    showticklabels: !preview,
    type: spec.logY ? "log" : "linear",
  };
  if (!preview) {
    const summary = (opts.facetLabel === undefined ? undefined : data.groupStats?.[opts.facetLabel]?.summary) ?? data.summary;
    applyAxisRange(
      layout,
      "y",
      spec,
      summary,
      lsl,
      usl,
      summary.min,
      summary.max
    );
  }
  layout.shapes = limits.shapes;
  layout.annotations = limits.annotations;
  // Both point modes use WebGL interactively, so switching to fewer outliers
  // does not switch back to costly SVG point elements. Static previews use SVG.
  // Keep native boxes separate: Plotly box hovers use trace.name, not per-box
  // hovertemplate/customdata. Point layers can be batched without losing identity.
  const boxes: any[] = [];
  const batches = new Map<string, any>();
  for (const trace of traces) {
    if (trace.type === "box") { boxes.push(trace); continue; }
    const key = JSON.stringify([trace.type, trace.line, trace.fillcolor, trace.width, trace.marker]);
    const batch = batches.get(key);
    if (!batch) { batches.set(key, trace); continue; }
    const columns = ["x", "y", "customdata"];
    for (const column of columns) for (const value of trace[column]) batch[column].push(value);
  }
  const result = previewFigure([...boxes, ...batches.values()], layout, preview, categoryTitle(spec.xAxis), `${testLabel(data.test)}${units ? ` [${units}]` : ""}`);
  result.sampledMarkers = sampledMarkers;
  result.exportNotes = [`${fmtInt(groups.reduce((n, g) => n + g.summary.n, 0))} considered measurements${data.excluded ? ` · ${fmtInt(data.excluded)} excluded by statistical filtering` : ""}`,
    ...(sampledMarkers ? ["Regular markers are sampled; every outlier is retained. Box statistics use all considered measurements."] : [])];
  return result;
}

/* ------------------------------------------------------------------ */
/* Pareto                                                              */
/* ------------------------------------------------------------------ */

function figureParetoCore(data: ParetoResponse, opts: FigureOpts): Figure {
  const t = chartTheme(opts.theme);
  const spec = opts.spec;
  const style = chartStyle(opts.preview ? false : spec.presentation);
  const preview = opts.preview === true;
  const traces: any[] = [];

  // Split view: turn one grouped response into a global Pareto for a single
  // group, using the same per-group failure counts the grouped chart uses.
  const facetIndex = opts.facetKey;
  if (facetIndex !== undefined && data.mode === "grouped") {
    const group = data.groups[facetIndex];
    if (!group) {
      return { data: [], layout: baseLayout(t, preview ? "" : opts.title, spec.presentation) };
    }
    const bars = data.series
      .map((s) => ({
        code: s.code,
        name: s.name,
        count: s.counts[facetIndex] ?? 0,
        pct: s.pcts[facetIndex] ?? 0,
        pass: s.pass,
      }))
      .filter((b) => b.count > 0)
      .sort((a, b) => b.count - a.count || a.code - b.code);
    data = {
      mode: "global",
      bars,
      groups: [],
      series: [],
      total: group.total,
      failTotal: group.fail,
      yieldPct: group.yieldPct,
      groupLabel: data.groupLabel,
    };
  }

  if (data.mode === "grouped") {
    const groups = data.groups;
    const labels = groups.map((g) => g.label);
    const angle = labels.some((l) => l.length > 8) ? -38 : 0;
    for (const s of data.series) {
      traces.push({
        type: "bar",
        name: binLabel(spec.binCategory, s.code, s.name, false),
        x: labels,
        y: s.pcts,
        customdata: s.counts,
        marker: {
          color: binColor(s.code),
          line: { width: 0 },
        },
        hovertemplate:
          `<b>${binLabel(spec.binCategory, s.code, s.name)}</b><br>%{y:.2f}% of tested dice · %{customdata} dice<extra></extra>`,
      });
    }
    traces.push({
      type: "scatter",
      mode: "lines+markers",
      name: "Yield",
      x: labels,
      y: groups.map((g) => g.unknownTotal ? null : g.yieldPct),
      yaxis: "y2",
      line: { color: t.green, width: 2.4 * 2.2 },
      marker: {
        size: Math.max(10, style.marker),
        color: t.green,
        line: { color: t.paper, width: Math.max(1, style.line * 0.5) },
      },
      hovertemplate: "Yield %{y:.1f}%<extra></extra>",
      cliponaxis: false,
    });

    const layout = baseLayout(t, preview ? "" : opts.title, spec.presentation);
    layout.margin = preview
      ? { l: 8, r: 8, t: 8, b: 8 }
      : {
          ...layout.margin,
          l: style.margin.l,
          r: Math.max(100, style.margin.r + Math.round(style.axisTitle * 1.4)),
          b: style.margin.b + (angle !== 0 ? Math.round(style.tick * 2.0) : 0),
          t: layout.margin.t + Math.round(style.annotation * 1.2),
        };
    layout.barmode = "stack";
    layout.bargap = 0.35;
    layout.showlegend = data.series.length > 0 && !preview;
    layout.legend = {
      orientation: "h",
      x: 0,
      xanchor: "left",
      y: 1.02,
      yanchor: "bottom",
      font: { size: scaledFont(style.annotation, 0.8, spec.presentation), color: t.text, family: CHART_FONT },
      bgcolor: "rgba(0,0,0,0)",
      borderwidth: 0,
      itemwidth: 30,
    };
    layout.xaxis = {
      ...layout.xaxis,
      type: "category",
      title: preview
        ? { text: "" }
        : {
            text: data.groupLabel || "Group",
            font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
          },
      tickangle: angle,
      showticklabels: !preview,
      tickfont: { size: style.tick, color: t.muted, family: CHART_FONT },
      showgrid: false,
      zeroline: false,
    };
    const failPeak = Math.max(0, ...groups.map((_, i) => data.series.reduce((n, series) => n + (series.pcts[i] ?? 0), 0)));
    const yields = groups.filter((g) => !g.unknownTotal).map((g) => g.yieldPct);
    const minYield = yields.length ? Math.min(...yields) : 0;
    const maxYield = yields.length ? Math.max(...yields) : 100;
    const yieldPad = Math.max(1, (maxYield - minYield) * 0.15);
    const yieldLo = Math.max(0, minYield - yieldPad), yieldHi = Math.min(100, maxYield + yieldPad);
    const rawStep = (yieldHi - yieldLo) / 5;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const multiple = rawStep / magnitude;
    const yieldStep = (multiple <= 1 ? 1 : multiple <= 2 ? 2 : multiple <= 5 ? 5 : 10) * magnitude;
    layout.yaxis = {
      ...layout.yaxis,
      title: preview
        ? { text: "" }
        : {
            text: "Fail [%]",
            font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
          },
      showticklabels: !preview,
      range: [0, Math.min(100, Math.max(1, failPeak * 1.2))],
      ticksuffix: "%",
      rangemode: "tozero",
    };
    layout.yaxis2 = {
      overlaying: "y",
      side: "right",
      range: [Math.max(0, Math.floor(yieldLo / yieldStep) * yieldStep), Math.min(100, Math.ceil(yieldHi / yieldStep) * yieldStep)],
      tickmode: "linear",
      tick0: 0,
      dtick: yieldStep,
      tickformat: ".1f",
      ticksuffix: "%",
      showgrid: false,
      zeroline: false,
      linecolor: t.green,
      tickcolor: t.green,
      linewidth: style.axisLine,
      showline: true,
      showticklabels: !preview,
      tickfont: { size: style.tick, color: t.green, family: CHART_FONT },
      title: preview
        ? { text: "" }
        : {
            text: "Yield [%]",
            font: { size: style.axisTitle, color: t.green, family: CHART_FONT },
            standoff: 18,
          },
    };
    return { ...previewFigure(traces, layout, preview, data.groupLabel || "Group", "Fail [%]"),
      exportNotes: [`${spec.binCategory === "soft" ? "SBIN" : "HBIN"} · ${fmtInt(data.total)} tested dice · failure percentages use all tested dice`] };
  }

  const bars = data.bars;
  const labels = bars.map((b) => binLabel(spec.binCategory, b.code, b.name, false));
  const pcts = bars.map((b) => b.pct);
  const angle = labels.some((l) => l.length > 8) ? -38 : 0;
  traces.push({
    type: "bar",
    x: labels,
    y: pcts,
    marker: {
      // A global Pareto is one ranked list; categorical bin colours only add
      // noise. The grouped view keeps its stacked bin colours.
      color: t.blue,
      line: { width: 0 },
    },
    text:
      !preview && bars.length <= (spec.presentation ? 14 : 22)
        ? bars.map((b) => `${b.pct.toFixed(1)}%`)
        : undefined,
    textposition: "outside",
    cliponaxis: false,
    textfont: { size: scaledFont(style.tick, 0.72, spec.presentation), color: t.muted, family: CHART_FONT },
    customdata: bars.map((b) => [b.count, b.code, b.pass ? "pass" : "fail"]),
    hovertemplate:
      "<b>%{x}</b><br>%{y:.2f}% of tested dice · %{customdata[0]} dice<br>" +
      "bin %{customdata[1]} · %{customdata[2]}<extra></extra>",
  });

  const layout = baseLayout(t, preview ? "" : opts.title, spec.presentation);
  layout.margin = preview
    ? { l: 8, r: 8, t: 8, b: 8 }
    : {
        ...layout.margin,
        l: style.margin.l,
        r: style.margin.r,
        b: style.margin.b + (angle !== 0 ? Math.round(style.tick * 2.0) : 0),
      };
  layout.bargap = 0.42;
  layout.showlegend = false;
  layout.xaxis = {
    ...layout.xaxis,
    type: "category",
    tickangle: angle,
    showticklabels: !preview,
    tickfont: { size: style.tick, color: t.muted, family: CHART_FONT },
    showgrid: false,
    zeroline: false,
  };
  layout.yaxis = {
    ...layout.yaxis,
    title: preview
      ? { text: "" }
      : {
          text: "Fail [%]",
          font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
        },
    showticklabels: !preview,
    range: [0, Math.min(100, Math.max(1, ...pcts.map((v) => v * 1.25)))],
    ticksuffix: "%",
    rangemode: "tozero",
  };
  if (preview) {
    layout.xaxis.tickmode = "array";
    layout.xaxis.tickvals = labels;
    layout.xaxis.ticktext = bars.map((b) => b.name === "Others" ? "Others" : String(b.code));
    layout.xaxis.tickangle = -30;
  }
  return { ...previewFigure(traces, layout, preview, spec.binCategory === "soft" ? "SBIN" : "HBIN", "Fail [%]"),
    exportNotes: [`${spec.binCategory === "soft" ? "SBIN" : "HBIN"} · ${fmtInt(data.total)} tested dice · failure percentages use all tested dice`] };
}

/* ------------------------------------------------------------------ */
/* Histogram                                                           */
/* ------------------------------------------------------------------ */

function figureHistCore(data: HistResponse, opts: FigureOpts): Figure {
  const t = chartTheme(opts.theme);
  const spec = opts.spec;
  const style = chartStyle(opts.preview ? false : spec.presentation);
  const preview = opts.preview === true;
  const facet = opts.facetLabel;
  const grouped = data.groups.length > 0 && facet === undefined &&
    !(spec.splitPlots && data.groups.length === 1);
  const facetGroup = facet !== undefined ? data.groups.find((g) => g.label === facet) : undefined;
  const bins = facetGroup?.histogram ?? data;
  const nb = bins.counts.length;
  if (nb === 0) return { data: [], layout: baseLayout(t, preview ? "" : opts.title, spec.presentation) };
  const { edges } = bins;
  const width = edges[1] - edges[0];
  const mids = bins.counts.map((_, i) => (edges[i] + edges[i + 1]) / 2);
  const s = facetGroup ? facetGroup.histogram?.fitSummary ?? facetGroup.stats.summary : data.fitSummary ?? data.summary;
  const traces: any[] = [];

  const addBars = (
    counts: number[],
    color: string,
    name: string,
    showlegend: boolean,
    opacity: number
  ) => {
    traces.push({
      type: "bar",
      name,
      x: mids,
      y: counts,
      width: width * 0.93,
      showlegend,
      marker: {
        color,
        opacity,
        line: { color: t.paper, width: Math.max(0.5, style.line * 0.25) },
      },
      customdata: counts.map((_, i) => [edges[i], edges[i + 1]]),
      hovertemplate:
        `<b>%{y} dice</b><br>` +
        "%{customdata[0]:.5~g} – %{customdata[1]:.5~g}<extra></extra>",
    });
  };

  if (facetGroup) {
    addBars(facetGroup.histogram?.counts ?? facetGroup.counts, t.blue, facetGroup.label, false, 0.88);
  } else if (grouped) {
    for (const g of data.groups) {
      addBars(g.counts, categoricalColor(t, g.key, g.label), g.label, !preview, 0.52);
    }
  } else {
    addBars(data.counts, t.blue, "", false, 0.88);
  }

  if (spec.showNormal && s.sd > 0 && !grouped) {
    const lo = edges[0];
    const hi = edges[nb];
    const steps = 220;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const x = lo + ((hi - lo) * i) / steps;
      xs.push(x);
      ys.push(normalPdf(x, s.mean, s.sd) * s.n * width);
    }
    traces.push({
      type: "scatter",
      mode: "lines",
      x: xs,
      y: ys,
      line: { color: t.yellow, width: style.line * 1.8 },
      fill: "tozeroy",
      fillcolor: t.yellowFill,
      hoverinfo: "skip",
      showlegend: false,
    });
  }

  const lsl = spec.lsl ?? data.test.loSpec;
  const usl = spec.usl ?? data.test.hiSpec;
  const limits = preview || !spec.showLimits
    ? { shapes: [], annotations: [] }
    : limitLinesX(t, lsl, usl, style);
  const { shapes, annotations } = limits;
  if (grouped) {
    // Keep the horizontal legend above the plot and the limit labels inside it.
    for (const annotation of annotations) {
      annotation.yanchor = "top";
      annotation.yshift = -Math.max(3, Math.round(style.annotation * 0.3));
      annotation.bgcolor = t.paper;
    }
  }
  if (!preview && !grouped && !facetGroup && Number.isFinite(s.mean)) {
    shapes.push({
      type: "line",
      xref: "x",
      x0: s.mean,
      x1: s.mean,
      yref: "paper",
      y0: 0,
      y1: 1,
      line: { color: t.gray, width: Math.max(1, style.line * 0.7), dash: "dot" },
      layer: "below",
    });
  }

  const layout = baseLayout(t, preview ? "" : opts.title, spec.presentation);
  layout.margin = preview
    ? { l: 8, r: 8, t: 8, b: 8 }
    : {
        ...layout.margin,
        l: style.margin.l,
        r: style.margin.r,
        b: style.margin.b,
        t: layout.margin.t + (grouped ? Math.round(style.annotation * 1.2) : 0),
      };
  layout.bargap = 0.04;
  layout.barmode = grouped ? "overlay" : "group";
  layout.showlegend = grouped && !preview;
  if (layout.showlegend) {
    layout.legend = {
      orientation: "h",
      x: 0,
      xanchor: "left",
      y: 1.02,
      yanchor: "bottom",
      font: { size: scaledFont(style.annotation, 0.8, spec.presentation), color: t.text, family: CHART_FONT },
      bgcolor: "rgba(0,0,0,0)",
      borderwidth: 0,
      itemwidth: 30,
    };
  }
  layout.xaxis = {
    ...layout.xaxis,
    title: preview
      ? { text: "" }
      : {
          text: axisTitle(testLabel(data.test), data.test.units, scaledFont(style.axisTitle, 0.62, spec.presentation)),
          font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
        },
    showticklabels: !preview,
    showgrid: false,
    zeroline: false,
  };
  layout.yaxis = {
    ...layout.yaxis,
    title: preview
      ? { text: "" }
      : {
          text: "Count",
          font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
        },
    showticklabels: !preview,
    rangemode: spec.logY ? undefined : "tozero",
    type: spec.logY ? "log" : "linear",
  };
  if (bins.binRange) layout.xaxis.range = bins.binRange;
  layout.shapes = shapes;
  layout.annotations = annotations;
  return { ...previewFigure(traces, layout, preview, `${testLabel(data.test)}${data.test.units ? ` [${data.test.units}]` : ""}`, "Count"),
    exportNotes: [`${fmtInt(data.summary.n)} considered measurements${data.excluded ? ` · ${fmtInt(data.excluded)} excluded by statistical filtering` : ""}`] };
}

/* ------------------------------------------------------------------ */
/* Trend                                                               */
/* ------------------------------------------------------------------ */

function figureTrendCore(data: TrendResponse, opts: FigureOpts): Figure {
  const t = chartTheme(opts.theme), spec = opts.spec;
  const preview = opts.preview === true;
  const style = chartStyle(preview ? false : spec.presentation);
  let points = opts.facetLabel === undefined ? data.points
    : data.points.filter((p) => p.groupLabel === opts.facetLabel);
  const groupLabels = [...new Set(points.map((p) => p.groupLabel).filter(Boolean))];
  const hasGrouping = opts.facetLabel === undefined && groupLabels.length > 0;
  if (hasGrouping) points = groupLabels.flatMap((label) => points.filter((p) => p.groupLabel === label));
  const labels = points.map((p) => p.label), n = points.length;
  const traces: any[] = [];
  // Separate traces per outer block prevent lines/bands crossing group boundaries.
  const blocks = hasGrouping ? groupLabels : [opts.facetLabel ?? ""];
  let offset = 0;
  for (const label of blocks) {
    const block = hasGrouping ? points.filter((p) => p.groupLabel === label) : points;
    const color = hasGrouping ? categoricalColor(t, block[0].groupKey, label) : t.blue;
    const fill = hasGrouping ? categoricalFill(t, block[0].groupKey, label) : t.blueFill;
    const x = block.map((_, i) => offset + i);
    const safe = (v: number) => spec.logY && v <= 0 ? null : v;
    if (spec.showBand) {
      traces.push({ type: "scatter", mode: "lines", x, y: block.map((p) => safe(p.mean - p.sd)),
        line: { width: 0 }, hoverinfo: "skip", showlegend: false });
      traces.push({ type: "scatter", mode: "lines", x, y: block.map((p) => safe(p.mean + p.sd)),
        line: { width: 0 }, fill: "tonexty", fillcolor: fill, hoverinfo: "skip", showlegend: false });
    }
    traces.push({ type: "scatter", mode: "lines+markers", x, y: block.map((p) => safe(p.mean)),
      line: { color, width: style.line * 1.8 },
      marker: { size: style.marker, color, line: { color: t.paper, width: Math.max(1, style.line * 0.5) } },
      customdata: block.map((p) => [p.sd, p.n, p.label, p.groupLabel]),
      hovertemplate: `<b>%{customdata[2]}</b>${label ? " · %{customdata[3]}" : ""}<br>mean %{y:.5~g}${data.test.units ? " " + data.test.units : ""}<br>` +
        "sd %{customdata[0]:.4~g} · n %{customdata[1]}<extra></extra>", showlegend: false });
    offset += block.length;
  }
  const lsl = spec.lsl ?? data.test.loSpec;
  const usl = spec.usl ?? data.test.hiSpec;
  const { shapes, annotations } = spec.showLimits
    ? limitLines(t, lsl, usl, "y", style, spec.logY)
    : { shapes: [], annotations: [] };
  const short = labels.map(shortTick);
  const stride = n > (spec.presentation ? 30 : 40) ? 2 : 1;
  const angle = n > (spec.presentation ? 10 : 12) && short.some((s) => s.length > 5) ? -45 : 0;
  const ticks = tickSubset(labels, stride);
  const layout = baseLayout(t, preview ? "" : opts.title, spec.presentation);
  layout.margin = { ...layout.margin, l: style.margin.l, r: style.margin.r,
    b: style.margin.b + (angle !== 0 ? Math.round(style.tick * 2.2) : 0),
    t: layout.margin.t + (hasGrouping ? Math.round(style.annotation * (groupLabels.length > 8 ? 5 : 1.2)) : 0) };
  layout.showlegend = false;
  layout.xaxis = { ...layout.xaxis,
    title: { text: categoryTitle(spec.xAxis), font: { size: style.axisTitle, color: t.muted, family: CHART_FONT } },
    tickmode: "array", tickvals: ticks, ticktext: ticks.map((i) => short[i]), tickangle: angle,
    tickfont: { size: style.tick, color: t.muted, family: CHART_FONT },
    showgrid: false, zeroline: false, type: "linear", range: [-0.65, Math.max(0.65, n - 0.35)] };
  layout.yaxis = { ...layout.yaxis,
    title: { text: axisTitle(testLabel(data.test), data.test.units, scaledFont(style.axisTitle, 0.62, spec.presentation)),
      font: { size: style.axisTitle, color: t.muted, family: CHART_FONT } }, type: spec.logY ? "log" : "linear" };
  let min = Infinity, max = -Infinity;
  for (const p of points) {
    for (const v of spec.showBand ? [p.mean - p.sd, p.mean, p.mean + p.sd] : [p.mean]) {
      if (Number.isFinite(v) && (!spec.logY || v > 0)) { min = Math.min(min, v); max = Math.max(max, v); }
    }
  }
  const meanStats = summarize(points.map(p=>p.mean).filter(v=>!spec.logY||v>0));
  applyAxisRange(layout, "y", spec, meanStats, lsl, usl, min, max);
  if (hasGrouping) addGroupBlocks(t, points, spec, style, shapes, annotations);
  else if (addLabelBlocks(t, labels, shapes, annotations, style)) {
    layout.margin.t = Math.max(layout.margin.t, style.margin.t + Math.round(style.annotation * 1.1));
  }
  layout.shapes = shapes; layout.annotations = annotations;
  return { ...previewFigure(traces, layout, preview, categoryTitle(spec.xAxis), `${testLabel(data.test)}${data.test.units ? ` [${data.test.units}]` : ""}`),
    exportNotes: [`${fmtInt(points.reduce((n, p) => n + p.n, 0))} considered measurements · ${fmtInt(points.length)} category means · ${spec.showBand ? "band: ±1 SD" : "band hidden"}`] };
}

/* ------------------------------------------------------------------ */
/* Scatter                                                             */
/* ------------------------------------------------------------------ */

function pointArrays(points: ScatterPoint[], data: ScatterResponse, preview = false) {
  return {
    x: points.map((p) => p.x),
    y: points.map((p) => p.y),
    customdata: preview ? undefined : points.map((p) => [
      data.lots[p.lot] ?? `L${p.lot}`,
      data.wafers[p.wafer] ?? `W${p.wafer}`,
      p.hbin,
      p.sbin,
      p.xDie,
      p.yDie,
      p.z,
    ]),
  };
}

function scatterHover(
  data: ScatterResponse,
  seriesName: string,
  zMode: "none" | "continuous" | "category"
): string {
  const xu = data.xTest.units ? ` ${data.xTest.units}` : "";
  const yu = data.yTest.units ? ` ${data.yTest.units}` : "";
  const prefix = seriesName ? `<b>${seriesName}</b><br>` : "";
  const zLine =
    zMode === "continuous"
      ? `<b>${data.zColLabel || "Z"}</b> %{customdata[6]:.5~g}<br>`
      : "";
  return (
    prefix +
    `<b>${tidyName(data.xTest.name)}</b> %{x:.5~g}${xu}<br>` +
    `<b>${tidyName(data.yTest.name)}</b> %{y:.5~g}${yu}<br>` +
    zLine +
    `%{customdata[0]} · %{customdata[1]}<br>` +
    `die (%{customdata[4]}, %{customdata[5]}) · H%{customdata[2]} / S%{customdata[3]}` +
    `<extra></extra>`
  );
}

function figureScatterCore(data: ScatterResponse, opts: FigureOpts): Figure {
  const t = chartTheme(opts.theme);
  const spec = opts.spec;
  const style = chartStyle(opts.preview ? false : spec.presentation);
  const preview = opts.preview === true;
  const traces: any[] = [];
  const series =
    opts.facetKey === undefined
      ? data.series
      : data.series.filter((s) => s.key === opts.facetKey);
  const facet = opts.facetKey !== undefined;
  const traceType = preview ? "scatter" : "scattergl";
  const hasGroups = data.series.length > 1 || !!data.groupLabel;
  const showLegend = hasGroups && series.length > 1 && !facet && !preview;
  const symbols = ["circle", "square", "diamond", "triangle-up", "cross", "x", "star", "hexagon"];
  const groupedZ = data.zMode === "continuous" && !!data.groupLabel;

  if (data.zMode === "continuous") {
    const colorbar = groupedZ
      ? {
          orientation: "h",
          x: 0.5,
          xanchor: "center",
          y: -0.2,
          yanchor: "top",
          len: 0.55,
          thickness: spec.presentation ? 16 : 12,
          title: {
            text: data.zColLabel || "Z",
            side: "top",
            font: {
              size: scaledFont(style.axisTitle, 0.72, spec.presentation),
              color: t.muted,
              family: CHART_FONT,
            },
          },
          tickfont: {
            size: scaledFont(style.tick, 0.72, spec.presentation),
            color: t.muted,
            family: CHART_FONT,
          },
          outlinewidth: 0,
        }
      : {
          title: {
            text: data.zColLabel || "Z",
            side: "right",
            font: {
              size: scaledFont(style.axisTitle, 0.78, spec.presentation),
              color: t.muted,
              family: CHART_FONT,
            },
          },
          tickfont: {
            size: scaledFont(style.tick, 0.78, spec.presentation),
            color: t.muted,
            family: CHART_FONT,
          },
          thickness: spec.presentation ? 28 : 16,
          len: 0.82,
          x: 1.015,
          xpad: 8,
          outlinewidth: 0,
        };
    let colorbarShown = false;
    for (let i = 0; i < series.length; i++) {
      const s = series[i];
      const finite = s.points.filter((p) => p.z !== null && Number.isFinite(p.z));
      const missing = s.points.filter((p) => p.z === null || !Number.isFinite(p.z));
      if (finite.length) {
        const arr = pointArrays(finite, data, preview);
        traces.push({
          type: traceType,
          mode: "markers",
          // Plotly retains colourbar drawing state by trace identity. A change
          // of orientation needs a fresh identity to discard the old bar axes.
          uid: `scatter-z-${groupedZ ? "h" : "v"}-${s.key}`,
          name: s.name || data.groupLabel || undefined,
          x: arr.x,
          y: arr.y,
          customdata: arr.customdata,
          showlegend: showLegend,
          legendgroup: s.name || undefined,
          legendrank: i,
          marker: {
            size: style.marker * 2,
            color: finite.map((p) => p.z as number),
            colorscale: [
              [0, t.heat[0]],
              [0.5, t.heat[1]],
              [1, t.heat[2]],
            ],
            cmin: data.zMin ?? undefined,
            cmax: data.zMax ?? undefined,
            showscale: !preview && !colorbarShown,
            colorbar: !preview && !colorbarShown ? colorbar : undefined,
            opacity: 0.82,
            symbol: groupedZ && !facet ? symbols[i % symbols.length] : "circle",
            line: { width: 0 },
          },
          hovertemplate: scatterHover(data, s.name, "continuous"),
        });
        if (!preview) colorbarShown = true;
      }
      if (missing.length) {
        const arr = pointArrays(missing, data, preview);
        traces.push({
          type: traceType,
          mode: "markers",
          name: s.name || data.groupLabel || undefined,
          x: arr.x,
          y: arr.y,
          customdata: arr.customdata,
          showlegend: false,
          legendgroup: s.name || undefined,
          marker: {
            size: Math.max(3, style.marker * 0.7) * 2,
            color: t.gray,
            opacity: 0.45,
            line: { width: 0 },
          },
          hovertemplate: scatterHover(data, s.name ? `${s.name} · no Z` : "No Z data", "none"),
        });
      }
    }
  } else if (data.zMode === "category" || data.groupLabel) {
    // Draw large groups first so smaller categories stay visible when the
    // populations overlap (common when wafers track the same distribution).
    // `legendrank` keeps the natural, alphabetical legend order.
    const legendRank = new Map(series.map((s, i) => [s.key, i]));
    const drawOrder = [...series].sort((a, b) => b.points.length - a.points.length);
    for (const s of drawOrder) {
      if (!s.points.length) continue;
      const arr = pointArrays(s.points, data, preview);
      const rank = legendRank.get(s.key) ?? 0;
      traces.push({
        type: traceType,
        mode: "markers",
        name: s.name || "Unassigned",
        x: arr.x,
        y: arr.y,
        customdata: arr.customdata,
        showlegend: !facet,
        legendgroup: s.name,
        legendrank: rank,
        marker: {
          size: style.marker * 2,
          color: facet ? t.blue : categoricalColor(t, s.key, s.name),
          symbol: facet ? "circle" : symbols[rank % symbols.length],
          opacity: 0.85,
          line: {
            // The old paper-coloured ring read as a white halo in the small
            // split thumbnails. Keep outlines only in the combined plot.
            width: facet ? 0 : Math.max(0.8, style.line * 0.45),
            color: t.paper,
          },
        },
        hovertemplate: scatterHover(data, s.name, "none"),
      });
    }
  } else {
    const points = series[0]?.points ?? [];
    if (points.length) {
      const arr = pointArrays(points, data, preview);
      traces.push({
        type: traceType,
        mode: "markers",
        x: arr.x,
        y: arr.y,
        customdata: arr.customdata,
        showlegend: false,
        marker: {
          size: style.marker * 2,
          color: t.blue,
          opacity: 0.8,
          line: { width: 0 },
        },
        hovertemplate: scatterHover(data, "", "none"),
      });
    }
  }

  // Least-squares line through every considered measurement. Plotly draws WebGL
  // traces in their own canvas layer, so a normal line trace can end up under
  // the markers even when it is added last. A layout shape with
  // layer:"above" is composited over both SVG and WebGL traces.
  const statistics=(facet?data.groupStatistics?.[series[0]?.name]:data.statistics)??scatterStatistics(series.flatMap(s=>s.points));
  const annotations: any[] = [];
  let fitShape: any = null;
  if (spec.scatterFit && statistics.fit) {
      const {slope,intercept,r,xMin:lo,xMax:hi}=statistics.fit;
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
        fitShape = {
          type: "line",
          xref: "x",
          yref: "y",
          x0: lo,
          y0: intercept + slope * lo,
          x1: hi,
          y1: intercept + slope * hi,
          line: { color: t.red, width: style.line },
          layer: "above",
        };
        if (r !== null && Number.isFinite(r)) {
          annotations.push({
            xref: "paper",
            x: 0.995,
            xanchor: "right",
            yref: "paper",
            y: 0.02,
            yanchor: "bottom",
            text: `R² = ${(r * r).toFixed(3)}`,
            showarrow: false,
            font: { size: style.annotation, color: t.muted, family: CHART_FONT },
            bgcolor: t.paper,
            borderpad: Math.max(2, Math.round(style.annotation * 0.2)),
          });
        }
      }
  }

  const layout = baseLayout(t, preview ? "" : opts.title, spec.presentation);
  const horizontalColorbar = groupedZ && !preview;
  const colorbarSpace =
    data.zMode === "continuous" && !preview && !horizontalColorbar
      ? spec.presentation
        ? 96
        : 70
      : 0;
  const legendSpace = showLegend ? (spec.presentation ? 190 : 130) : 0;
  layout.margin = preview
    ? { l: 8, r: 8, t: 8, b: 8 }
    : {
        ...layout.margin,
        l: style.margin.l,
        r: style.margin.r + Math.max(colorbarSpace, legendSpace),
        b: style.margin.b + (horizontalColorbar ? Math.round(style.annotation * 3.2) : 0),
      };
  layout.showlegend = showLegend;
  layout.hovermode = "closest";
  layout.xaxis = {
    ...layout.xaxis,
    title: preview
      ? { text: "" }
      : {
          text: axisTitle(testLabel(data.xTest), data.xTest.units, scaledFont(style.axisTitle, 0.62, spec.presentation)),
          font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
        },
    showticklabels: !preview,
    showgrid: true,
    zeroline: false,
  };
  layout.yaxis = {
    ...layout.yaxis,
    title: preview
      ? { text: "" }
      : {
          text: axisTitle(testLabel(data.yTest), data.yTest.units, scaledFont(style.axisTitle, 0.62, spec.presentation)),
          font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
        },
    showticklabels: !preview,
    type: spec.logY ? "log" : "linear",
    showgrid: true,
    zeroline: false,
  };
  if (!preview) {
    const s=statistics.summary;
    if (s.n) {
      applyAxisRange(
        layout,
        "y",
        spec,
        s,
        spec.lsl ?? data.yTest.loSpec,
        spec.usl ?? data.yTest.hiSpec,
        s.min,
        s.max
      );
    }
  }
  if (showLegend) {
    layout.legend = {
      orientation: "v",
      x: 1.015,
      xanchor: "left",
      y: 1,
      yanchor: "top",
      font: {
        size: scaledFont(style.annotation, 0.78, spec.presentation),
        color: t.text,
        family: CHART_FONT,
      },
      title: {
        text: data.groupLabel || data.zColLabel,
        side: "top",
        font: {
          size: scaledFont(style.annotation, 0.9, spec.presentation),
          color: t.muted,
          family: CHART_FONT,
        },
      },
      bgcolor: "rgba(0,0,0,0)",
      borderwidth: 0,
      itemsizing: "constant",
      itemwidth: 30,
      tracegroupgap: 4,
    };
  }
  if (fitShape) layout.shapes = [...(layout.shapes ?? []), fitShape];
  if (annotations.length && !preview) layout.annotations = annotations;
  return { ...previewFigure(traces, layout, preview, `${testLabel(data.xTest)}${data.xTest.units ? ` [${data.xTest.units}]` : ""}`, `${testLabel(data.yTest)}${data.yTest.units ? ` [${data.yTest.units}]` : ""}`), rasterScatter: preview,
    exportNotes: [`${fmtInt(series.reduce((n, s) => n + s.points.length, 0))} displayed points · ${fmtInt(data.total)} considered measurements${data.excluded ? ` · ${fmtInt(data.excluded)} excluded` : ""}`,
      ...(data.truncated ? ["Sampled display. Correlation and the fitted line use all considered measurements."] : [])] };
}

/** Small helper used by the report to summarise a plot in text. */
export function describeBox(data: BoxResponse): string {
  const s = data.summary;
  return `${fmtInt(s.n)} dice · mean ${fmt(s.mean)} · sd ${fmt(s.sd)} · median ${fmt(s.median)}`;
}

export function describeHist(data: HistResponse): string {
  const s = data.summary;
  return `${fmtInt(s.n)} dice · mean ${fmt(s.mean)} · sd ${fmt(s.sd)}`;
}

function exportStyle(figure: Figure, opts: FigureOpts, test: import("../types").TestInfo | null, xLabel: string,
  total: number, facetLabel = opts.facetLabel, statistics?: string): Figure {
  return {...figure, exportStyle:{spec:opts.spec,test,xLabel,total,facetLabel,statistics}};
}

function capabilityFooter(summary: BoxResponse["summary"] | undefined, test: BoxResponse["test"], spec: PlotSpec) {
  if (!summary?.n) return "";
  const { cpk } = capability(summary.mean, summary.sd, spec.lsl ?? test.loSpec, spec.usl ?? test.hiSpec);
  return statisticsFooter(summary, cpk);
}
export function figureBox(data: BoxResponse, opts: FigureOpts): Figure {
  const summary = opts.facetLabel === undefined ? data.summary : data.groupStats?.[opts.facetLabel]?.summary;
  return exportStyle(figureBoxCore(data,opts),opts,data.test,categoryName(opts.spec.xAxis),summary?.n ?? data.summary.n,
    opts.facetLabel, opts.preview ? undefined : capabilityFooter(summary, data.test, opts.spec));
}
export function figureHist(data: HistResponse, opts: FigureOpts): Figure {
  const summary = opts.facetLabel === undefined ? data.summary : data.groups.find(g => g.label === opts.facetLabel)?.stats.summary;
  return exportStyle(figureHistCore(data,opts),opts,data.test,"Count",summary?.n ?? data.summary.n,
    opts.facetLabel, opts.preview ? undefined : capabilityFooter(summary, data.test, opts.spec));
}
export function figureTrend(data: TrendResponse, opts: FigureOpts): Figure {
  const points = opts.facetLabel === undefined ? data.points : data.points.filter(p => p.groupLabel === opts.facetLabel);
  const values = points.map(p => p.mean).filter(v => Number.isFinite(v) && (!opts.spec.logY || v > 0));
  const average = mean(values);
  return exportStyle(figureTrendCore(data,opts),opts,data.test,categoryName(opts.spec.xAxis),points.reduce((n,p)=>n+p.n,0),
    opts.facetLabel, opts.preview ? undefined : statisticsFooter({ n: values.length, mean: average, sd: stdDev(values, average) }));
}
export function figurePareto(data: ParetoResponse, opts: FigureOpts): Figure {
  return exportStyle(figureParetoCore(data,opts),opts,null,categoryName(opts.spec.xAxis),data.total);
}
export function figureScatter(data: ScatterResponse, opts: FigureOpts): Figure {
  const label = opts.facetKey === undefined ? opts.facetLabel : data.series.find(s=>s.key===opts.facetKey)?.name;
  return exportStyle(figureScatterCore(data,opts),opts,data.yTest,testLabel(data.xTest)+(data.xTest.units ? ` [${data.xTest.units}]` : ""),(label ? data.groupTotals?.[label] ?? data.series.find(s=>s.name===label)?.points.length ?? 0 : data.total),label);
}
