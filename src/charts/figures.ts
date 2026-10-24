import type {
  BoxResponse,
  HistResponse,
  ParetoResponse,
  PlotSpec,
  TrendResponse,
} from "../types";
import { axisTitle, fmt, fmtInt } from "../lib/format";
import { normalPdf, quantileSorted } from "../lib/stats";
import type { Theme } from "../lib/theme";
import { baseLayout, chartTheme, CHART_FONT, type ChartTheme } from "./plotlyTheme";

export interface Figure {
  data: any[];
  layout: any;
}

export interface FigureOpts {
  theme: Theme;
  spec: PlotSpec;
  title?: string;
  /** Lot index for each box group, used to colour boxes by lot. */
  lotOf?: number[];
  lotNames?: string[];
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

/** Label each lot block above the plot and separate the blocks with a rule. */
function addLotBlocks(
  t: ChartTheme,
  labels: string[],
  shapes: any[],
  annotations: any[]
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
      yshift: 4,
      text: b.name,
      showarrow: false,
      font: { size: 10, color: t.muted, family: CHART_FONT },
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
      line: { color: t.axis, width: 1, dash: "dot" },
      layer: "below",
    });
  }
  return true;
}

interface LimitLines {
  shapes: any[];
  annotations: any[];
}

/** LSL/USL (red dashed) and control limits (yellow dotted) on a cartesian axis. */
export function limitLines(
  t: ChartTheme,
  lsl: number | null,
  usl: number | null,
  loLimit: number | null,
  hiLimit: number | null,
  yref = "y"
): LimitLines {
  const shapes: any[] = [];
  const annotations: any[] = [];
  const add = (
    v: number,
    label: string,
    color: string,
    dash: "dash" | "dot"
  ) => {
    shapes.push({
      type: "line",
      xref: "paper",
      x0: 0,
      x1: 1,
      yref,
      y0: v,
      y1: v,
      line: { color, width: 1.4, dash },
      layer: "below",
    });
    annotations.push({
      xref: "paper",
      x: 0.996,
      xanchor: "right",
      yref,
      y: v,
      yshift: 9,
      text: `${label} ${fmt(v)}`,
      showarrow: false,
      font: { size: 10, color, family: '"Segoe UI", sans-serif' },
      bgcolor: t.paper,
      borderpad: 2,
      opacity: 0.95,
    });
  };
  if (lsl !== null && Number.isFinite(lsl)) add(lsl, "LSL", t.red, "dash");
  if (usl !== null && Number.isFinite(usl)) add(usl, "USL", t.red, "dash");
  if (
    loLimit !== null &&
    Number.isFinite(loLimit) &&
    (lsl === null || Math.abs(loLimit - lsl) > 1e-12)
  ) {
    add(loLimit, "LCL", t.yellow, "dot");
  }
  if (
    hiLimit !== null &&
    Number.isFinite(hiLimit) &&
    (usl === null || Math.abs(hiLimit - usl) > 1e-12)
  ) {
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
  hiLimit: number | null
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
    shapes.push({
      type: "line",
      xref: "x",
      x0: v,
      x1: v,
      yref: "paper",
      y0: 0,
      y1: 1,
      line: { color, width: 1.4, dash },
      layer: "below",
    });
    annotations.push({
      xref: "x",
      x: v,
      xanchor: side,
      xshift: side === "left" ? 5 : -5,
      yref: "paper",
      y: 1,
      yanchor: "bottom",
      yshift: 5,
      text: `${label} ${fmt(v)}`,
      showarrow: false,
      font: { size: 10, color, family: CHART_FONT },
      bgcolor: t.paper,
      borderpad: 2,
      opacity: 0.95,
    });
  };
  if (lsl !== null && Number.isFinite(lsl)) add(lsl, "LSL", t.red, "dash", "left");
  if (usl !== null && Number.isFinite(usl)) add(usl, "USL", t.red, "dash", "right");
  if (
    loLimit !== null &&
    Number.isFinite(loLimit) &&
    (lsl === null || Math.abs(loLimit - lsl) > 1e-12)
  ) {
    add(loLimit, "LCL", t.yellow, "dot", "left");
  }
  if (
    hiLimit !== null &&
    Number.isFinite(hiLimit) &&
    (usl === null || Math.abs(hiLimit - usl) > 1e-12)
  ) {
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
  const units = data.test.units;
  const n = data.groups.length;
  const traces: any[] = [];

  data.groups.forEach((g, i) => {
    const lot = opts.lotOf?.[i] ?? 0;
    const second = lot % 2 === 1;
    const line = second ? t.yellow : t.blue;
    const fill = second ? t.yellowFill : t.blueFill;
    let idx: number[] = [];
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
      boxpoints: false,
      boxmean: true,
      width: 0.54,
      whiskerwidth: 0.55,
      fillcolor: fill,
      line: { color: line, width: 1.6 },
      marker: { size: 3, color: line },
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
            size: mode === "all" ? 3 : 4,
            color: second ? "rgba(234,166,0,0.62)" : `rgba(37,99,235,${ALPHA_POINT})`,
            line: { width: 0 },
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
    data.test.loLimit,
    data.test.hiLimit
  );

  const labels = data.groups.map((g) => g.label);
  const short = labels.map(shortTick);
  const stride = n > 40 ? 2 : 1;
  const angle = n > 12 && short.some((s) => s.length > 5) ? -45 : 0;
  const ticks = tickSubset(labels, stride);

  const layout = baseLayout(t, opts.title);
  layout.margin = { ...layout.margin, b: angle !== 0 ? 84 : 62 };
  layout.boxgap = 0.32;
  layout.boxgroupgap = 0.12;
  layout.xaxis = {
    ...layout.xaxis,
    tickmode: "array",
    tickvals: ticks,
    ticktext: ticks.map((i) => short[i]),
    tickangle: angle,
    tickfont: { size: n > 20 ? 9 : 10, color: t.muted },
    showgrid: false,
    zeroline: false,
    range: [-0.65, Math.max(0.65, n - 0.35)],
  };
  layout.yaxis = {
    ...layout.yaxis,
    title: { text: axisTitle(data.test.name, units), font: { size: 12, color: t.muted } },
    type: spec.logY ? "log" : "linear",
  };
  applyYRange(layout, spec, data.summary.min, data.summary.max);
  if (addLotBlocks(t, labels, shapes, annotations)) {
    layout.margin.t = Math.max(layout.margin.t, 40);
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
  const bars = data.bars;
  const labels = bars.map((b) => b.name);
  const counts = bars.map((b) => b.count);
  const cum = bars.map((b) => b.cumPct);
  const traces: any[] = [];

  traces.push({
    type: "bar",
    x: labels,
    y: counts,
    marker: {
      color: bars.map((b) => (b.pass ? t.gray : t.blue)),
      line: { width: 0 },
    },
    text: bars.length <= 16 ? bars.map((b) => fmtInt(b.count)) : undefined,
    textposition: "outside",
    cliponaxis: false,
    textfont: { size: 10, color: t.muted },
    customdata: bars.map((b) => [b.pct, b.code]),
    hovertemplate:
      "<b>%{x}</b><br>%{y} dice · %{customdata[0]:.2f}%<br>bin %{customdata[1]}<extra></extra>",
  });

  if (spec.cumulative && bars.length > 1) {
    traces.push({
      type: "scatter",
      mode: "lines+markers",
      x: labels,
      y: cum,
      yaxis: "y2",
      line: { color: t.yellow, width: 2.4 },
      marker: {
        size: 7,
        color: t.yellow,
        line: { color: t.paper, width: 1.5 },
      },
      hovertemplate: "cumulative %{y:.1f}%<extra></extra>",
      cliponaxis: false,
    });
  }

  const layout = baseLayout(t, opts.title);
  layout.margin = { ...layout.margin, r: 66, b: 84 };
  layout.bargap = 0.42;
  layout.xaxis = {
    ...layout.xaxis,
    tickangle: labels.some((l) => l.length > 8) ? -38 : 0,
    tickfont: { size: 10, color: t.muted },
    showgrid: false,
    zeroline: false,
  };
  layout.yaxis = {
    ...layout.yaxis,
    title: { text: "Dice", font: { size: 12, color: t.muted } },
    rangemode: "tozero",
  };
  if (spec.cumulative && bars.length > 1) {
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
      showline: true,
      tickfont: { size: 11, color: t.muted },
      title: { text: "Cumulative %", font: { size: 11, color: t.muted }, standoff: 8 },
    };
    layout.shapes = [
      {
        type: "line",
        xref: "paper",
        x0: 0,
        x1: 1,
        yref: "y2",
        y0: 80,
        y1: 80,
        line: { color: t.gray, width: 1, dash: "dot" },
        layer: "below",
      },
    ];
    layout.annotations = [
      {
        xref: "paper",
        x: 0.004,
        xanchor: "left",
        yref: "y2",
        y: 80,
        yshift: 9,
        text: "80%",
        showarrow: false,
        font: { size: 10, color: t.muted },
      },
    ];
  }
  return { data: traces, layout };
}

/* ------------------------------------------------------------------ */
/* Histogram                                                           */
/* ------------------------------------------------------------------ */

export function figureHist(data: HistResponse, opts: FigureOpts): Figure {
  const t = chartTheme(opts.theme);
  const spec = opts.spec;
  const s = data.summary;
  const nb = data.counts.length;
  if (nb === 0) return { data: [], layout: baseLayout(t, opts.title) };
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
        line: { color: t.paper, width: 0.6 },
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
      line: { color: t.yellow, width: 2.4 },
      fill: "tozeroy",
      fillcolor: t.yellowFill,
      hoverinfo: "skip",
    });
  }

  const { shapes, annotations } = limitLinesX(
    t,
    spec.showLimits ? (spec.lsl ?? data.test.loSpec) : null,
    spec.showLimits ? (spec.usl ?? data.test.hiSpec) : null,
    data.test.loLimit,
    data.test.hiLimit
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
      line: { color: t.gray, width: 1, dash: "dot" },
      layer: "below",
    });
  }

  const layout = baseLayout(t, opts.title);
  layout.bargap = 0.04;
  layout.xaxis = {
    ...layout.xaxis,
    title: { text: axisTitle(data.test.name, data.test.units), font: { size: 12, color: t.muted } },
    showgrid: false,
    zeroline: false,
  };
  layout.yaxis = {
    ...layout.yaxis,
    title: { text: "Count", font: { size: 12, color: t.muted } },
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
    line: { color: t.blue, width: 2.4 },
    marker: {
      size: 7,
      color: t.blue,
      line: { color: t.paper, width: 1.6 },
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
    data.test.loLimit,
    data.test.hiLimit
  );
  const short = labels.map(shortTick);
  const n = labels.length;
  const stride = n > 40 ? 2 : 1;
  const angle = n > 12 && short.some((s) => s.length > 5) ? -45 : 0;
  const ticks = tickSubset(labels, stride);

  const layout = baseLayout(t, opts.title);
  layout.margin = { ...layout.margin, b: angle !== 0 ? 96 : 62 };
  layout.xaxis = {
    ...layout.xaxis,
    tickmode: "array",
    tickvals: ticks.map((i) => labels[i]),
    ticktext: ticks.map((i) => short[i]),
    tickangle: angle,
    tickfont: { size: n > 20 ? 9 : 10, color: t.muted },
    showgrid: false,
    zeroline: false,
    type: "category",
  };
  layout.yaxis = {
    ...layout.yaxis,
    title: { text: axisTitle(data.test.name, data.test.units), font: { size: 12, color: t.muted } },
    type: spec.logY ? "log" : "linear",
  };
  const all = [...lo, ...hi].filter((v) => Number.isFinite(v));
  applyYRange(layout, spec, Math.min(...all), Math.max(...all));
  if (addLotBlocks(t, labels, shapes, annotations)) {
    layout.margin.t = Math.max(layout.margin.t, 40);
  }
  layout.shapes = shapes;
  layout.annotations = annotations;
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
