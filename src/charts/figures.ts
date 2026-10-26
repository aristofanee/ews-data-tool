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
}

export interface FigureOpts {
  theme: Theme;
  spec: PlotSpec;
  title?: string;
  /** Render only one split/block/category. */
  facetKey?: number;
  facetLabel?: string;
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

interface Block {
  start: number;
  end: number;
  name: string;
  code: number;
}

/** Contiguous runs of the same custom block (split/lot) in a box chart. */
function boxBlocks(groups: { block: string; blockCode: number }[]): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < groups.length; i++) {
    const name = groups[i].block || "Unassigned";
    const code = groups[i].blockCode;
    const last = blocks[blocks.length - 1];
    if (last && last.name === name && last.code === code) last.end = i;
    else blocks.push({ start: i, end: i, name, code });
  }
  return blocks;
}

function addBoxBlocks(
  t: ChartTheme,
  groups: { block: string; blockCode: number }[],
  shapes: any[],
  annotations: any[],
  style: ChartStyle
): boolean {
  const blocks = boxBlocks(groups);
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
      font: {
        size: style.annotation,
        color: categoricalColor(t, b.code, b.name),
        family: CHART_FONT,
      },
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

/**
 * Spec and control limits frequently come from the same STDF value but via
 * different f32 fields. They can differ by a few ULPs, which is invisible on
 * screen but used to draw two overlapping lines. Treat them as identical when
 * they are within 1 ppm of each other.
 */
function sameLimit(a: number | null, b: number | null): boolean {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= 1e-6 * scale;
}

/** LSL/USL (red dashed) and control limits (yellow dotted) on a cartesian axis. */
export function limitLines(
  t: ChartTheme,
  lsl: number | null,
  usl: number | null,
  loLimit: number | null,
  hiLimit: number | null,
  yref = "y",
  style: ChartStyle = chartStyle(false)
): LimitLines {
  const shapes: any[] = [];
  const annotations: any[] = [];
  const add = (v: number, label: string, color: string, dash: "dash" | "dot") => {
    // Plotly draws axis gridlines over "below" shapes. That cuts a horizontal
    // limit line down the middle, so each dash looks like two parallel lines.
    // Draw the limit above the gridline instead; the line is thin and dashed,
    // so it still leaves the data readable.
    shapes.push({
      type: "line",
      xref: "paper",
      x0: 0,
      x1: 1,
      yref,
      y0: v,
      y1: v,
      line: { color, width: style.line, dash },
      layer: "above",
    });
    annotations.push({
      xref: "paper",
      x: 0.996,
      xanchor: "right",
      yref,
      y: v,
      yshift: Math.round(style.annotation * 0.85),
      text: `${label} ${fmt(v)}`,
      showarrow: false,
      font: { size: style.annotation, color, family: CHART_FONT },
      opacity: 1,
    });
  };
  if (lsl !== null && Number.isFinite(lsl)) add(lsl, "LSL", t.red, "dash");
  if (usl !== null && Number.isFinite(usl)) add(usl, "USL", t.red, "dash");
  if (loLimit !== null && Number.isFinite(loLimit) && !sameLimit(loLimit, lsl)) {
    add(loLimit, "LCL", t.yellow, "dot");
  }
  if (hiLimit !== null && Number.isFinite(hiLimit) && !sameLimit(hiLimit, usl)) {
    add(hiLimit, "UCL", t.yellow, "dot");
  }
  return { shapes, annotations };
}

/** LSL/USL (red dashed) and control limits (yellow dotted) on a value x-axis. */
export function limitLinesX(
  t: ChartTheme,
  lsl: number | null,
  usl: number | null,
  loLimit: number | null,
  hiLimit: number | null,
  style: ChartStyle = chartStyle(false)
): LimitLines {
  const shapes: any[] = [];
  const annotations: any[] = [];
  const add = (
    v: number,
    label: string,
    color: string,
    dash: "dash" | "dot",
    side: "left" | "right"
  ) => {
    // See limitLines(): draw above the gridlines so a vertical gridline
    // cannot split each dash into two parallel lines.
    shapes.push({
      type: "line",
      xref: "x",
      x0: v,
      x1: v,
      yref: "paper",
      y0: 0,
      y1: 1,
      line: { color, width: style.line, dash },
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
      font: { size: style.annotation, color, family: CHART_FONT },
      opacity: 1,
    });
  };
  if (lsl !== null && Number.isFinite(lsl)) add(lsl, "LSL", t.red, "dash", "left");
  if (usl !== null && Number.isFinite(usl)) add(usl, "USL", t.red, "dash", "right");
  if (loLimit !== null && Number.isFinite(loLimit) && !sameLimit(loLimit, lsl)) {
    add(loLimit, "LCL", t.yellow, "dot", "left");
  }
  if (hiLimit !== null && Number.isFinite(hiLimit) && !sameLimit(hiLimit, usl)) {
    add(hiLimit, "UCL", t.yellow, "dot", "right");
  }
  return { shapes, annotations };
}

function applyYRange(layout: any, spec: PlotSpec, lo: number, hi: number) {
  if (spec.yMin === null && spec.yMax === null) return;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
  const pad = (hi - lo) * 0.06 || Math.abs(hi || 1) * 0.05;
  layout.yaxis.range = [spec.yMin ?? lo - pad, spec.yMax ?? hi + pad];
}

/* ------------------------------------------------------------------ */
/* Box plot                                                            */
/* ------------------------------------------------------------------ */

export function figureBox(data: BoxResponse, opts: FigureOpts): Figure {
  const t = chartTheme(opts.theme);
  const spec = opts.spec;
  const style = chartStyle(spec.presentation);
  const units = data.test.units;
  const groups =
    opts.facetLabel === undefined
      ? data.groups
      : data.groups.filter((g) => g.block === opts.facetLabel);
  const n = groups.length;
  const traces: any[] = [];

  groups.forEach((g, i) => {
    const line = categoricalColor(t, g.blockCode, g.block);
    const fill = categoricalFill(t, g.blockCode, g.block);
    const idx: number[] = [];
    for (let k = 0; k < g.values.length; k++) {
      if (!spec.logY || g.values[k] > 0) idx.push(k);
    }
    if (idx.length === 0) return;
    const ys = idx.map((k) => g.values[k]);
    const xs = new Array(idx.length).fill(i);

    traces.push({
      type: "box",
      name: g.label,
      x: xs,
      y: ys,
      showlegend: false,
      // Ask Plotly to calculate outlier fences for the whiskers. The points
      // themselves are drawn by the scatter trace below, so hide this copy.
      boxpoints: "outliers",
      boxmean: true,
      width: spec.presentation ? 0.62 : 0.54,
      whiskerwidth: 0.55,
      fillcolor: fill,
      line: { color: line, width: style.line },
      marker: { size: 0, opacity: 0, color: line },
      hoveron: "boxes",
      hovertemplate:
        `<b>${g.label}</b><br>` +
        `median %{median:.5~g}<br>` +
        `q1 %{q1:.5~g} · q3 %{q3:.5~g}<br>` +
        `n ${g.n.toLocaleString("en-US")}<extra></extra>`,
    });

    const mode = spec.showPoints;
    if (mode !== "none") {
      let pick: number[] = [];
      if (mode === "outliers") {
        const sorted = [...ys].sort((a, b) => a - b);
        const q1 = quantileSorted(sorted, 0.25);
        const q3 = quantileSorted(sorted, 0.75);
        const iqr = q3 - q1;
        const lo = q1 - 1.5 * iqr;
        const hi = q3 + 1.5 * iqr;
        for (let k = 0; k < ys.length; k++) {
          if (ys[k] < lo || ys[k] > hi) pick.push(k);
        }
        if (pick.length > 4000) pick = pick.filter((_, j) => j % 2 === 0);
      } else {
        const stride = Math.max(1, Math.ceil(ys.length / 2500));
        for (let k = 0; k < ys.length; k += stride) pick.push(k);
      }
      if (pick.length > 0) {
        const px = pick.map((k) => i + (pseudo(idx[k] + i * 977) - 0.5) * 0.42);
        const py = pick.map((k) => ys[k]);
        const cd = pick.map((k) => [g.xs[idx[k]], g.ys[idx[k]]]);
        traces.push({
          type: mode === "all" ? "scattergl" : "scatter",
          mode: "markers",
          name: g.label,
          x: px,
          y: py,
          customdata: cd,
          showlegend: false,
          marker: {
            // Outliers use a thin orthogonal cross; ordinary "All" points
            // stay as small dots so dense boxes remain readable.
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
            `${g.label}<extra></extra>`,
        });
      }
    }
  });

  const { shapes, annotations } = limitLines(
    t,
    spec.showLimits ? (spec.lsl ?? data.test.loSpec) : null,
    spec.showLimits ? (spec.usl ?? data.test.hiSpec) : null,
    spec.showControlLimits ? data.test.loLimit : null,
    spec.showControlLimits ? data.test.hiLimit : null,
    "y",
    style
  );

  const labels = groups.map((g) => g.label);
  const short = labels.map(shortTick);
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
  layout.boxgap = 0.32;
  layout.boxgroupgap = 0.12;
  layout.xaxis = {
    ...layout.xaxis,
    tickmode: "array",
    tickvals: ticks,
    ticktext: ticks.map((i) => short[i]),
    tickangle: angle,
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
    title: {
      text: axisTitle(testLabel(data.test), units, style.axisTitle * 0.62),
      font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
    },
    type: spec.logY ? "log" : "linear",
  };
  applyYRange(layout, spec, data.summary.min, data.summary.max);
  if (addBoxBlocks(t, groups, shapes, annotations, style)) {
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
/* Pareto                                                              */
/* ------------------------------------------------------------------ */

export function figurePareto(data: ParetoResponse, opts: FigureOpts): Figure {
  const t = chartTheme(opts.theme);
  const spec = opts.spec;
  const style = chartStyle(spec.presentation);
  const traces: any[] = [];

  if (data.mode === "grouped") {
    const groups = data.groups;
    const labels = groups.map((g) => g.label);
    const angle = labels.some((l) => l.length > 8) ? -38 : 0;
    for (const s of data.series) {
      traces.push({
        type: "bar",
        name: s.name,
        x: labels,
        y: s.counts,
        customdata: s.pcts,
        marker: {
          color: categoricalColor(t, s.code, s.name),
          line: { width: 0 },
        },
        hovertemplate:
          `<b>${s.name}</b><br>%{y} dice · %{customdata:.2f}% of group<extra></extra>`,
      });
    }
    traces.push({
      type: "scatter",
      mode: "lines+markers",
      name: "Good yield",
      x: labels,
      y: groups.map((g) => g.yieldPct),
      yaxis: "y2",
      line: { color: t.green, width: style.line * 2.2 },
      marker: {
        size: style.marker,
        color: t.green,
        line: { color: t.paper, width: Math.max(1, style.line * 0.5) },
      },
      hovertemplate: "Good yield %{y:.1f}%<extra></extra>",
      cliponaxis: false,
    });

    const layout = baseLayout(t, opts.title, spec.presentation);
    layout.margin = {
      ...layout.margin,
      l: style.margin.l,
      r: style.margin.r + Math.round(style.axisTitle * 1.4),
      b: style.margin.b + (angle !== 0 ? Math.round(style.tick * 2.0) : 0),
      t: layout.margin.t + Math.round(style.annotation * 1.2),
    };
    layout.barmode = "stack";
    layout.bargap = 0.35;
    layout.showlegend = data.series.length > 0;
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
      title: {
        text: data.groupLabel || "Group",
        font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
      },
      tickangle: angle,
      tickfont: { size: Math.round(style.tick * 0.82), color: t.muted, family: CHART_FONT },
      showgrid: false,
      zeroline: false,
    };
    layout.yaxis = {
      ...layout.yaxis,
      title: {
        text: "Dice",
        font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
      },
      rangemode: "tozero",
    };
    layout.yaxis2 = {
      overlaying: "y",
      side: "right",
      range: [0, 105],
      tickmode: "array",
      tickvals: [0, 20, 40, 60, 80, 100],
      ticktext: ["0%", "20%", "40%", "60%", "80%", "100%"],
      showgrid: false,
      zeroline: false,
      linecolor: t.axis,
      linewidth: style.axisLine,
      showline: true,
      tickfont: { size: Math.round(style.tick * 0.82), color: t.muted, family: CHART_FONT },
      title: {
        text: "Good yield %",
        font: { size: Math.round(style.axisTitle * 0.82), color: t.muted, family: CHART_FONT },
        standoff: Math.round(style.axisTitle * 0.5),
      },
    };
    return { data: traces, layout };
  }

  const bars = data.bars;
  const labels = bars.map((b) => b.name || `Bin ${b.code}`);
  const counts = bars.map((b) => b.count);
  const angle = labels.some((l) => l.length > 8) ? -38 : 0;
  traces.push({
    type: "bar",
    x: labels,
    y: counts,
    marker: {
      color: bars.map((b) => (b.pass ? t.green : b.code === 0xffff ? t.gray : t.blue)),
      line: { width: 0 },
    },
    text:
      bars.length <= (spec.presentation ? 14 : 22)
        ? bars.map((b) => `${b.pct.toFixed(1)}%`)
        : undefined,
    textposition: "outside",
    cliponaxis: false,
    textfont: { size: Math.round(style.tick * 0.72), color: t.muted, family: CHART_FONT },
    customdata: bars.map((b) => [b.pct, b.code, b.pass ? "pass" : "fail"]),
    hovertemplate:
      "<b>%{x}</b><br>%{y} dice · %{customdata[0]:.2f}%<br>" +
      "bin %{customdata[1]} · %{customdata[2]}<extra></extra>",
  });

  const layout = baseLayout(t, opts.title, spec.presentation);
  layout.margin = {
    ...layout.margin,
    l: style.margin.l,
    r: style.margin.r,
    b: style.margin.b + (angle !== 0 ? Math.round(style.tick * 2.0) : 0),
  };
  layout.bargap = 0.42;
  layout.xaxis = {
    ...layout.xaxis,
    tickangle: angle,
    tickfont: { size: Math.round(style.tick * 0.82), color: t.muted, family: CHART_FONT },
    showgrid: false,
    zeroline: false,
  };
  layout.yaxis = {
    ...layout.yaxis,
    title: {
      text: "Dice",
      font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
    },
    rangemode: "tozero",
  };
  return { data: traces, layout };
}

/* ------------------------------------------------------------------ */
/* Histogram                                                           */
/* ------------------------------------------------------------------ */

export function figureHist(data: HistResponse, opts: FigureOpts): Figure {
  const t = chartTheme(opts.theme);
  const spec = opts.spec;
  const style = chartStyle(spec.presentation);
  const s = data.summary;
  const nb = data.counts.length;
  if (nb === 0) return { data: [], layout: baseLayout(t, opts.title, spec.presentation) };
  const width = data.edges[1] - data.edges[0];
  const mids = data.counts.map((_, i) => (data.edges[i] + data.edges[i + 1]) / 2);
  const traces: any[] = [
    {
      type: "bar",
      x: mids,
      y: data.counts,
      width: width * 0.93,
      marker: {
        color: t.blue,
        opacity: 0.88,
        line: { color: t.paper, width: Math.max(0.5, style.line * 0.25) },
      },
      customdata: data.counts.map((_, i) => [data.edges[i], data.edges[i + 1]]),
      hovertemplate:
        "<b>%{y} dice</b><br>" +
        "%{customdata[0]:.5~g} – %{customdata[1]:.5~g}<extra></extra>",
    },
  ];

  if (spec.showNormal && s.sd > 0) {
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
    });
  }

  const { shapes, annotations } = limitLinesX(
    t,
    spec.showLimits ? (spec.lsl ?? data.test.loSpec) : null,
    spec.showLimits ? (spec.usl ?? data.test.hiSpec) : null,
    spec.showControlLimits ? data.test.loLimit : null,
    spec.showControlLimits ? data.test.hiLimit : null,
    style
  );
  // mean marker
  if (Number.isFinite(s.mean)) {
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

  const layout = baseLayout(t, opts.title, spec.presentation);
  layout.margin = { ...layout.margin, l: style.margin.l, r: style.margin.r, b: style.margin.b };
  layout.bargap = 0.04;
  layout.xaxis = {
    ...layout.xaxis,
    title: {
      text: axisTitle(testLabel(data.test), data.test.units, style.axisTitle * 0.62),
      font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
    },
    showgrid: false,
    zeroline: false,
  };
  layout.yaxis = {
    ...layout.yaxis,
    title: {
      text: "Count",
      font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
    },
    rangemode: "tozero",
  };
  applyYRange(layout, spec, 0, Math.max(...data.counts) * 1.08);
  layout.shapes = shapes;
  layout.annotations = annotations;
  return { data: traces, layout };
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

  const { shapes, annotations } = limitLines(
    t,
    spec.showLimits ? (spec.lsl ?? data.test.loSpec) : null,
    spec.showLimits ? (spec.usl ?? data.test.hiSpec) : null,
    spec.showControlLimits ? data.test.loLimit : null,
    spec.showControlLimits ? data.test.hiLimit : null,
    "y",
    style
  );
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
  applyYRange(layout, spec, Math.min(...all), Math.max(...all));
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

function pointArrays(points: ScatterPoint[], data: ScatterResponse) {
  return {
    x: points.map((p) => p.x),
    y: points.map((p) => p.y),
    customdata: points.map((p) => [
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
  const style = chartStyle(spec.presentation);
  const traces: any[] = [];
  const series =
    opts.facetKey === undefined
      ? data.series
      : data.series.filter((s) => s.key === opts.facetKey);
  const totalPoints = series.reduce((n, s) => n + s.points.length, 0);
  const traceType = totalPoints > 12000 ? "scattergl" : "scatter";
  const showLegend =
    data.zMode === "category" && series.length > 1 && opts.facetKey === undefined;

  if (data.zMode === "continuous") {
    const points = series[0]?.points ?? [];
    const finite = points.filter((p) => p.z !== null && Number.isFinite(p.z));
    const missing = points.filter((p) => p.z === null || !Number.isFinite(p.z));
    if (finite.length) {
      const arr = pointArrays(finite, data);
      traces.push({
        type: traceType,
        mode: "markers",
        x: arr.x,
        y: arr.y,
        customdata: arr.customdata,
        showlegend: false,
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
          showscale: true,
          opacity: 0.82,
          line: { width: 0 },
          colorbar: {
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
          },
        },
        hovertemplate: scatterHover(data, "", "continuous"),
      });
    }
    if (missing.length) {
      const arr = pointArrays(missing, data);
      traces.push({
        type: traceType,
        mode: "markers",
        x: arr.x,
        y: arr.y,
        customdata: arr.customdata,
        showlegend: false,
        marker: {
          size: Math.max(3, style.marker * 0.7),
          color: t.gray,
          opacity: 0.45,
          line: { width: 0 },
        },
        hovertemplate: scatterHover(data, "No Z data", "none"),
      });
    }
  } else if (data.zMode === "category") {
    // Draw large groups first so smaller categories stay visible when the
    // populations overlap (common when wafers track the same distribution).
    // `legendrank` keeps the natural, alphabetical legend order.
    const legendRank = new Map(series.map((s, i) => [s.key, i]));
    const drawOrder = [...series].sort((a, b) => b.points.length - a.points.length);
    const symbols = ["circle", "square", "diamond", "triangle-up", "cross", "x", "star", "hexagon"];
    for (const s of drawOrder) {
      if (!s.points.length) continue;
      const arr = pointArrays(s.points, data);
      const rank = legendRank.get(s.key) ?? 0;
      traces.push({
        type: traceType,
        mode: "markers",
        name: s.name || "Unassigned",
        x: arr.x,
        y: arr.y,
        customdata: arr.customdata,
        showlegend: true,
        legendgroup: s.name,
        legendrank: rank,
        marker: {
          size: style.marker,
          color: categoricalColor(t, s.key, s.name),
          symbol: symbols[rank % symbols.length],
          opacity: 0.85,
          line: { width: Math.max(0.8, style.line * 0.45), color: t.paper },
        },
        hovertemplate: scatterHover(data, s.name, "none"),
      });
    }
  } else {
    const points = series[0]?.points ?? [];
    if (points.length) {
      const arr = pointArrays(points, data);
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
      const xs = allPoints.map((p) => p.x);
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
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

  const layout = baseLayout(t, opts.title, spec.presentation);
  const colorbarSpace =
    data.zMode === "continuous" ? (spec.presentation ? 96 : 70) : 0;
  const legendSpace = showLegend ? (spec.presentation ? 190 : 130) : 0;
  layout.margin = {
    ...layout.margin,
    l: style.margin.l,
    r: style.margin.r + Math.max(colorbarSpace, legendSpace),
    b: style.margin.b,
  };
  layout.showlegend = showLegend;
  layout.hovermode = "closest";
  layout.xaxis = {
    ...layout.xaxis,
    title: {
      text: axisTitle(testLabel(data.xTest), data.xTest.units, style.axisTitle * 0.62),
      font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
    },
    showgrid: true,
    zeroline: false,
  };
  layout.yaxis = {
    ...layout.yaxis,
    title: {
      text: axisTitle(testLabel(data.yTest), data.yTest.units, style.axisTitle * 0.62),
      font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
    },
    showgrid: true,
    zeroline: false,
  };
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
        text: data.zColLabel,
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
  if (annotations.length) layout.annotations = annotations;
  return { data: traces, layout };
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
