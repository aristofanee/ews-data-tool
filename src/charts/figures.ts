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
import { normalPdf, quantileSorted } from "../lib/stats";
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
  data: any[];
  layout: any;
  rasterScatter?: boolean;
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
  return ({ wafer: "Wafer", lot: "Lot", site: "Site", hbin: "HBIN", sbin: "SBIN" } as Record<string, string>)[value] ?? value;
}

/** Small charts retain meaningful axes while using consistent compact type. */
function previewFigure(data: any[], layout: any, preview: boolean, xTitle: string, yTitle: string): Figure {
  if (!preview) return { data, layout };
  const compact = (text: string, max = 36) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
  layout.margin = { l: 62, r: layout.yaxis2 ? 54 : 24, t: 22, b: 62 };
  layout.showlegend = false;
  layout.font = { ...layout.font, size: 11 };
  for (const [key, title] of [["xaxis", xTitle], ["yaxis", yTitle], ["yaxis2", "Yield [%]"]]) {
    if (!layout[key]) continue;
    layout[key] = { ...layout[key], showticklabels: true, automargin: true,
      tickfont: { ...layout[key].tickfont, size: 10 }, nticks: 4,
      title: { text: compact(title), font: { size: 11, color: key === "yaxis2" ? layout[key].tickfont?.color : layout.font.color, family: CHART_FONT }, standoff: 8 },
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
      if ((i - b.start) % stride === 0) keep.push(i);
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

interface AxisStats {
  mean: number;
  sd: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
}

/** Resolve the inspector range mode into an explicit [lo, hi] pair. */
export function limitRange(
  spec: PlotSpec,
  stats: AxisStats,
  lsl: number | null,
  usl: number | null,
  fallbackLo: number,
  fallbackHi: number
): [number, number] | null {
  const finite = (v: number) => Number.isFinite(v);
  if (spec.limitMode === "manual") {
    const lo = spec.yMin ?? fallbackLo;
    const hi = spec.yMax ?? fallbackHi;
    return finite(lo) && finite(hi) && hi > lo ? [lo, hi] : null;
  }
  if (spec.limitMode === "sigma" && finite(stats.mean) && finite(stats.sd) && stats.sd > 0) {
    return [stats.mean - spec.limitK * stats.sd, stats.mean + spec.limitK * stats.sd];
  }
  if (spec.limitMode === "iqr" && finite(stats.q1) && finite(stats.q3)) {
    const iqr = stats.q3 - stats.q1;
    if (iqr > 0) return [stats.q1 - spec.limitK * iqr, stats.q3 + spec.limitK * iqr];
  }
  if (spec.limitMode === "spec") {
    const lo = lsl ?? fallbackLo;
    const hi = usl ?? fallbackHi;
    if (finite(lo) && finite(hi) && hi > lo) return [lo, hi];
  }
  return null;
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

export function figureBox(data: BoxResponse, opts: FigureOpts): Figure {
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
        const stride = Math.max(1, Math.ceil(ys.length / 2500));
        const lo = summary.q1 - 1.5 * (summary.q3 - summary.q1);
        const hi = summary.q3 + 1.5 * (summary.q3 - summary.q1);
        for (let k = 0; k < ys.length; k++) {
          if (k % stride === 0 || ys[k] < lo || ys[k] > hi) pick.push(k);
        }
      }
      if (pick.length > 0) {
        const px = pick.map(
          (k) => xPos + (pseudo(idx[k] + xIndex * 977) - 0.5) * width * 0.72
        );
        const py = pick.map((k) => ys[k]);
        const cd = pick.map((k) => [g.xs[idx[k]], g.ys[idx[k]]]);
        traces.push({
          type: mode === "all" ? "scattergl" : "scatter",
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
            `${g.xLabel}${hasGrouping ? " · " + g.groupLabel : ""}<extra></extra>`,
        });
      }
    }
  }

  const lsl = spec.showLimits ? (spec.lsl ?? data.test.loSpec) : null;
  const usl = spec.showLimits ? (spec.usl ?? data.test.hiSpec) : null;
  const limits = preview
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
  if (hasGrouping) {
    let start = 0;
    for (const label of groupLabels) {
      const length = groups.filter((g) => g.groupLabel === label).length;
      const heading = spec.groupBy === "wafer" ? shortTick(label) : label;
      const dense = groupLabels.length > 8;
      limits.annotations.push({ xref: "x", x: start + (length - 1) / 2,
        yref: "paper", y: 1.02, xanchor: "center", yanchor: "bottom",
        text: heading, textangle: dense && heading.length > 3 ? (groupLabels.length > 20 ? -75 : -55) : 0,
        showarrow: false, font: { size: dense ? Math.min(11, style.annotation) : style.annotation, color: t.text, family: CHART_FONT } });
      if (start > 0) limits.shapes.push({ type: "line", xref: "x", x0: start - 0.5, x1: start - 0.5,
        yref: "paper", y0: 0, y1: 1, line: { color: t.axis, width: 1, dash: "dot" } });
      start += length;
    }
  }
  layout.xaxis = {
    ...layout.xaxis,
    title: preview
      ? { text: "" }
      : {
          text: categoryTitle(spec.xAxis),
          font: { size: style.axisTitle * 0.82, color: t.muted, family: CHART_FONT },
        },
    tickmode: "array",
    tickvals: ticks,
    ticktext: ticks.map((i) => short[i]),
    tickangle: angle,
    showticklabels: !preview,
    tickfont: {
      size: Math.round(style.tick * (n > (spec.presentation ? 28 : 20) ? 0.78 : 1)),
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
          text: axisTitle(testLabel(data.test), units, style.axisTitle * 0.62),
          font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
        },
    showticklabels: !preview,
    type: spec.logY ? "log" : "linear",
  };
  if (!preview) {
    applyAxisRange(
      layout,
      "y",
      spec,
      data.summary,
      lsl,
      usl,
      data.summary.min,
      data.summary.max
    );
  }
  layout.shapes = limits.shapes;
  layout.annotations = limits.annotations;
  return previewFigure(traces, layout, preview, categoryTitle(spec.xAxis), `${testLabel(data.test)}${units ? ` [${units}]` : ""}`);
}

/* ------------------------------------------------------------------ */
/* Pareto                                                              */
/* ------------------------------------------------------------------ */

export function figurePareto(data: ParetoResponse, opts: FigureOpts): Figure {
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
        name: binLabel(spec.binCategory, s.code, s.name),
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
      y: groups.map((g) => g.yieldPct),
      yaxis: "y2",
      line: { color: t.green, width: style.line * 2.2 },
      marker: {
        size: style.marker,
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
      font: { size: Math.round(style.annotation * 0.8), color: t.text, family: CHART_FONT },
      bgcolor: "rgba(0,0,0,0)",
      borderwidth: 0,
      itemwidth: 30,
    };
    layout.xaxis = {
      ...layout.xaxis,
      title: preview
        ? { text: "" }
        : {
            text: data.groupLabel || "Group",
            font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
          },
      tickangle: angle,
      showticklabels: !preview,
      tickfont: { size: Math.round(style.tick * 0.82), color: t.muted, family: CHART_FONT },
      showgrid: false,
      zeroline: false,
    };
    const failPeak = Math.max(0, ...groups.map((_, i) => data.series.reduce((n, series) => n + (series.pcts[i] ?? 0), 0)));
    const yields = groups.map((g) => g.yieldPct);
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
      linecolor: t.axis,
      linewidth: style.axisLine,
      showline: true,
      showticklabels: !preview,
      tickfont: { size: Math.round(style.tick * 0.82), color: t.green, family: CHART_FONT },
      title: preview
        ? { text: "" }
        : {
            text: "Yield [%]",
            font: { size: Math.round(style.axisTitle * 0.82), color: t.green, family: CHART_FONT },
            standoff: 18,
          },
    };
    return previewFigure(traces, layout, preview, data.groupLabel || "Group", "Fail [%]");
  }

  const bars = data.bars;
  const labels = bars.map((b) => binLabel(spec.binCategory, b.code, b.name));
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
    textfont: { size: Math.round(style.tick * 0.72), color: t.muted, family: CHART_FONT },
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
    tickangle: angle,
    showticklabels: !preview,
    tickfont: { size: Math.round(style.tick * 0.82), color: t.muted, family: CHART_FONT },
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
    layout.xaxis.ticktext = bars.map((b) => b.name === "Others" ? "Others" : `${spec.binCategory === "soft" ? "SBIN" : "HBIN"} ${b.code}`);
    layout.xaxis.tickangle = -30;
  }
  return previewFigure(traces, layout, preview, spec.binCategory === "soft" ? "SBIN" : "HBIN", "Fail [%]");
}

/* ------------------------------------------------------------------ */
/* Histogram                                                           */
/* ------------------------------------------------------------------ */

export function figureHist(data: HistResponse, opts: FigureOpts): Figure {
  const t = chartTheme(opts.theme);
  const spec = opts.spec;
  const style = chartStyle(opts.preview ? false : spec.presentation);
  const s = data.summary;
  const nb = data.counts.length;
  const preview = opts.preview === true;
  if (nb === 0) return { data: [], layout: baseLayout(t, preview ? "" : opts.title, spec.presentation) };
  const width = data.edges[1] - data.edges[0];
  const mids = data.counts.map((_, i) => (data.edges[i] + data.edges[i + 1]) / 2);
  const facet = opts.facetLabel;
  const grouped = data.groups.length > 0 && facet === undefined;
  const facetGroup = facet !== undefined ? data.groups.find((g) => g.label === facet) : undefined;
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
      customdata: counts.map((_, i) => [data.edges[i], data.edges[i + 1]]),
      hovertemplate:
        `<b>%{y} dice</b><br>` +
        "%{customdata[0]:.5~g} – %{customdata[1]:.5~g}<extra></extra>",
    });
  };

  if (facetGroup) {
    addBars(facetGroup.counts, t.blue, facetGroup.label, false, 0.88);
  } else if (grouped) {
    for (const g of data.groups) {
      addBars(g.counts, categoricalColor(t, g.key, g.label), g.label, !preview, 0.52);
    }
  } else {
    addBars(data.counts, t.blue, "", false, 0.88);
  }

  if (spec.showNormal && s.sd > 0 && !grouped && !facetGroup) {
    const lo = data.edges[0];
    const hi = data.edges[nb];
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

  const lsl = spec.showLimits ? (spec.lsl ?? data.test.loSpec) : null;
  const usl = spec.showLimits ? (spec.usl ?? data.test.hiSpec) : null;
  const limits = preview
    ? { shapes: [], annotations: [] }
    : limitLinesX(t, lsl, usl, style);
  const { shapes, annotations } = limits;
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
      font: { size: Math.round(style.annotation * 0.8), color: t.text, family: CHART_FONT },
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
          text: axisTitle(testLabel(data.test), data.test.units, style.axisTitle * 0.62),
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
  if (!preview) {
    applyAxisRange(
      layout,
      "x",
      spec,
      s,
      lsl,
      usl,
      data.edges[0],
      data.edges[nb]
    );
  }
  layout.shapes = shapes;
  layout.annotations = annotations;
  return previewFigure(traces, layout, preview, `${testLabel(data.test)}${data.test.units ? ` [${data.test.units}]` : ""}`, "Count");
}

/* ------------------------------------------------------------------ */
/* Trend                                                               */
/* ------------------------------------------------------------------ */

export function figureTrend(data: TrendResponse, opts: FigureOpts): Figure {
  const t = chartTheme(opts.theme);
  const spec = opts.spec;
  const style = chartStyle(spec.presentation);
  const labels = data.points.map((p) => p.label);
  const means = data.points.map((p) => p.mean);
  const lo = data.points.map((p) => p.mean - p.sd);
  const hi = data.points.map((p) => p.mean + p.sd);
  const traces: any[] = [];

  if (spec.showBand) {
    traces.push({
      type: "scatter",
      mode: "lines",
      x: labels,
      y: lo,
      line: { width: 0 },
      hoverinfo: "skip",
      showlegend: false,
    });
    traces.push({
      type: "scatter",
      mode: "lines",
      x: labels,
      y: hi,
      line: { width: 0 },
      fill: "tonexty",
      fillcolor: t.blueFill,
      hoverinfo: "skip",
      showlegend: false,
    });
  }

  traces.push({
    type: "scatter",
    mode: "lines+markers",
    x: labels,
    y: means,
    line: { color: t.blue, width: style.line * 1.8 },
    marker: {
      size: style.marker,
      color: t.blue,
      line: { color: t.paper, width: Math.max(1, style.line * 0.5) },
    },
    customdata: data.points.map((p) => [p.sd, p.n]),
    hovertemplate:
      `<b>%{x}</b><br>mean %{y:.5~g}${data.test.units ? " " + data.test.units : ""}<br>` +
      "sd %{customdata[0]:.4~g} · n %{customdata[1]}<extra></extra>",
  });

  const lsl = spec.showLimits ? (spec.lsl ?? data.test.loSpec) : null;
  const usl = spec.showLimits ? (spec.usl ?? data.test.hiSpec) : null;
  const { shapes, annotations } = limitLines(t, lsl, usl, "y", style, spec.logY);
  const short = labels.map(shortTick);
  const n = labels.length;
  const stride = n > (spec.presentation ? 30 : 40) ? 2 : 1;
  const angle = n > (spec.presentation ? 10 : 12) && short.some((s) => s.length > 5) ? -45 : 0;
  const ticks = tickSubset(labels, stride);

  const layout = baseLayout(t, opts.title, spec.presentation);
  layout.margin = {
    ...layout.margin,
    l: style.margin.l,
    r: style.margin.r,
    b: style.margin.b + (angle !== 0 ? Math.round(style.tick * 2.2) : 0),
  };
  layout.xaxis = {
    ...layout.xaxis,
    tickmode: "array",
    tickvals: ticks.map((i) => labels[i]),
    ticktext: ticks.map((i) => short[i]),
    tickangle: angle,
    tickfont: {
      size: Math.round(style.tick * (n > (spec.presentation ? 28 : 20) ? 0.78 : 1)),
      color: t.muted,
      family: CHART_FONT,
    },
    showgrid: false,
    zeroline: false,
    type: "category",
  };
  layout.yaxis = {
    ...layout.yaxis,
    title: {
      text: axisTitle(testLabel(data.test), data.test.units, style.axisTitle * 0.62),
      font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
    },
    type: spec.logY ? "log" : "linear",
  };
  const all = [...lo, ...hi].filter((v) => Number.isFinite(v));
  let min = Infinity;
  let max = -Infinity;
  for (const v of all) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const meanStats = {
    mean: data.points.reduce((a, p) => a + p.mean, 0) / Math.max(1, data.points.length),
    sd: Math.sqrt(
      data.points.reduce((a, p) => a + p.sd * p.sd, 0) / Math.max(1, data.points.length)
    ),
    min,
    max,
    q1: min,
    q3: max,
  };
  applyAxisRange(layout, "y", spec, meanStats, lsl, usl, meanStats.min, meanStats.max);
  if (addLabelBlocks(t, labels, shapes, annotations, style)) {
    layout.margin.t = Math.max(
      layout.margin.t,
      style.margin.t + Math.round(style.annotation * 1.1)
    );
  }
  layout.shapes = shapes;
  layout.annotations = annotations;
  return { data: traces, layout };
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

export function figureScatter(data: ScatterResponse, opts: FigureOpts): Figure {
  const t = chartTheme(opts.theme);
  const spec = opts.spec;
  const style = chartStyle(opts.preview ? false : spec.presentation);
  const preview = opts.preview === true;
  const traces: any[] = [];
  const series =
    opts.facetKey === undefined
      ? data.series
      : data.series.filter((s) => s.key === opts.facetKey);
  const totalPoints = series.reduce((n, s) => n + s.points.length, 0);
  const traceType = totalPoints > 12000 ? "scattergl" : "scatter";
  const facet = opts.facetKey !== undefined;
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
              size: Math.round(style.axisTitle * 0.72),
              color: t.muted,
              family: CHART_FONT,
            },
          },
          tickfont: {
            size: Math.round(style.tick * 0.72),
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
              size: Math.round(style.axisTitle * 0.78),
              color: t.muted,
              family: CHART_FONT,
            },
          },
          tickfont: {
            size: Math.round(style.tick * 0.78),
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
          name: s.name || data.groupLabel || undefined,
          x: arr.x,
          y: arr.y,
          customdata: arr.customdata,
          showlegend: showLegend,
          legendgroup: s.name || undefined,
          legendrank: i,
          marker: {
            size: style.marker,
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
            size: Math.max(3, style.marker * 0.7),
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
          size: style.marker,
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
          size: style.marker,
          color: t.blue,
          opacity: 0.8,
          line: { width: 0 },
        },
        hovertemplate: scatterHover(data, "", "none"),
      });
    }
  }

  // Least-squares line through every visible point. Plotly draws WebGL
  // traces in their own canvas layer, so a normal line trace can end up under
  // the markers even when it is added last. A layout shape with
  // layer:"above" is composited over both SVG and WebGL traces.
  const allPoints = series.flatMap((s) => s.points);
  const annotations: any[] = [];
  let fitShape: any = null;
  if (spec.scatterFit && allPoints.length >= 2) {
    let sx = 0;
    let sy = 0;
    for (const p of allPoints) {
      sx += p.x;
      sy += p.y;
    }
    const mx = sx / allPoints.length;
    const my = sy / allPoints.length;
    let sxx = 0;
    let sxy = 0;
    for (const p of allPoints) {
      const dx = p.x - mx;
      sxx += dx * dx;
      sxy += dx * (p.y - my);
    }
    if (sxx > 0) {
      const slope = sxy / sxx;
      const intercept = my - slope * mx;
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of allPoints) {
        if (p.x < lo) lo = p.x;
        if (p.x > hi) hi = p.x;
      }
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
        fitShape = {
          type: "line",
          xref: "x",
          yref: "y",
          x0: lo,
          y0: intercept + slope * lo,
          x1: hi,
          y1: intercept + slope * hi,
          line: { color: t.red, width: Math.max(2.5, style.line * 2.2) },
          layer: "above",
        };
        if (data.r !== null && Number.isFinite(data.r)) {
          annotations.push({
            xref: "paper",
            x: 0.995,
            xanchor: "right",
            yref: "paper",
            y: 0.02,
            yanchor: "bottom",
            text: `R² = ${(data.r * data.r).toFixed(3)}`,
            showarrow: false,
            font: { size: style.annotation, color: t.muted, family: CHART_FONT },
            bgcolor: t.paper,
            borderpad: Math.max(2, Math.round(style.annotation * 0.2)),
          });
        }
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
          text: axisTitle(testLabel(data.xTest), data.xTest.units, style.axisTitle * 0.62),
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
          text: axisTitle(testLabel(data.yTest), data.yTest.units, style.axisTitle * 0.62),
          font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
        },
    showticklabels: !preview,
    type: spec.logY ? "log" : "linear",
    showgrid: true,
    zeroline: false,
  };
  if (!preview) {
    const ys = data.series
      .flatMap((s) => s.points.map((p) => p.y))
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
    if (ys.length) {
      const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
      const sd = Math.sqrt(ys.reduce((a, b) => a + (b - mean) * (b - mean), 0) / ys.length);
      applyAxisRange(
        layout,
        "y",
        spec,
        {
          mean,
          sd,
          min: ys[0],
          max: ys[ys.length - 1],
          q1: quantileSorted(ys, 0.25),
          q3: quantileSorted(ys, 0.75),
        },
        null,
        null,
        ys[0],
        ys[ys.length - 1]
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
        size: Math.round(style.annotation * 0.78),
        color: t.text,
        family: CHART_FONT,
      },
      title: {
        text: data.groupLabel || data.zColLabel,
        side: "top",
        font: {
          size: Math.round(style.annotation * 0.9),
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
  return { ...previewFigure(traces, layout, preview, `${testLabel(data.xTest)}${data.xTest.units ? ` [${data.xTest.units}]` : ""}`, `${testLabel(data.yTest)}${data.yTest.units ? ` [${data.yTest.units}]` : ""}`), rasterScatter: preview };
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
