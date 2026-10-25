import type { Theme } from "../lib/theme";

export const CHART_FONT = '"Segoe UI Variable Text", "Segoe UI", Inter, system-ui, sans-serif';

export interface ChartTheme {
  paper: string;
  text: string;
  muted: string;
  grid: string;
  axis: string;
  blue: string;
  blueSoft: string;
  blueFill: string;
  yellow: string;
  yellowFill: string;
  red: string;
  green: string;
  gray: string;
  hoverBg: string;
  hoverText: string;
  /** Categorical palette used for splits, lots and other labels. */
  palette: string[];
  paletteFill: string[];
  grayFill: string;
  /** Continuous Z scale. */
  heat: [string, string, string];
}

export function chartTheme(theme: Theme): ChartTheme {
  if (theme === "dark") {
    return {
      paper: "#0f1726",
      text: "#e7eefb",
      muted: "#93a4c0",
      grid: "#1d2b42",
      axis: "#34455f",
      blue: "#60a5fa",
      blueSoft: "#93c5fd",
      blueFill: "rgba(96,165,250,0.16)",
      yellow: "#fbbf24",
      yellowFill: "rgba(251,191,36,0.15)",
      red: "#fb7185",
      green: "#34d399",
      gray: "#64748b",
      hoverBg: "#e9effb",
      hoverText: "#0b1220",
      palette: ["#60a5fa", "#fbbf24", "#34d399", "#fb7185", "#a78bfa", "#22d3ee", "#fb923c", "#94a3b8"],
      paletteFill: [
        "rgba(96,165,250,0.20)",
        "rgba(251,191,36,0.18)",
        "rgba(52,211,153,0.18)",
        "rgba(251,113,133,0.18)",
        "rgba(167,139,250,0.18)",
        "rgba(34,211,238,0.18)",
        "rgba(251,146,60,0.18)",
        "rgba(148,163,184,0.18)",
      ],
      grayFill: "rgba(148,163,184,0.16)",
      heat: ["#60a5fa", "#c4b5fd", "#fbbf24"],
    };
  }
  return {
    paper: "#ffffff",
    text: "#0f172a",
    muted: "#64748b",
    grid: "#edf1f7",
    axis: "#cbd5e1",
    blue: "#2563eb",
    blueSoft: "#60a5fa",
    blueFill: "rgba(37,99,235,0.13)",
    yellow: "#eaa600",
    yellowFill: "rgba(245,179,1,0.18)",
    red: "#e11d48",
    green: "#0f9f6e",
    gray: "#94a3b8",
    hoverBg: "#0f172a",
    hoverText: "#f8fafc",
    palette: ["#2563eb", "#eaa600", "#0f9f6e", "#e11d48", "#7c3aed", "#0891b2", "#ea580c", "#64748b"],
    paletteFill: [
      "rgba(37,99,235,0.15)",
      "rgba(234,166,0,0.18)",
      "rgba(15,159,110,0.15)",
      "rgba(225,29,72,0.14)",
      "rgba(124,58,237,0.14)",
      "rgba(8,145,178,0.14)",
      "rgba(234,88,12,0.14)",
      "rgba(100,116,139,0.14)",
    ],
    grayFill: "rgba(148,163,184,0.16)",
    heat: ["#2563eb", "#8b5cf6", "#f5b301"],
  };
}

export function categoricalColor(t: ChartTheme, code: number, name?: string): string {
  if (name === "Unassigned" || name === "Mixed" || name === "Other") return t.gray;
  return t.palette[Math.abs(code) % t.palette.length];
}

export function categoricalFill(t: ChartTheme, code: number, name?: string): string {
  if (name === "Unassigned" || name === "Mixed" || name === "Other") return t.grayFill;
  return t.paletteFill[Math.abs(code) % t.paletteFill.length];
}

export interface ChartStyle {
  title: number;
  axisTitle: number;
  tick: number;
  annotation: number;
  hover: number;
  line: number;
  axisLine: number;
  marker: number;
  point: number;
  margin: { l: number; r: number; t: number; b: number };
}

/**
 * Presentation sizing is deliberately generous: a 1800x1100 JPG is often
 * placed 4-6 inches wide in a 2x3 slide grid. These sizes keep labels readable
 * after that reduction. Users can turn it off for dense exploratory charts.
 */
export function chartStyle(presentation: boolean): ChartStyle {
  if (presentation) {
    return {
      title: 46,
      axisTitle: 36,
      tick: 32,
      annotation: 26,
      hover: 26,
      line: 3,
      axisLine: 2,
      marker: 10,
      point: 7,
      margin: { l: 132, r: 46, t: 104, b: 116 },
    };
  }
  return {
    title: 16,
    axisTitle: 12,
    tick: 11,
    annotation: 10,
    hover: 12,
    line: 1.4,
    axisLine: 1,
    marker: 4,
    point: 3,
    margin: { l: 68, r: 30, t: 54, b: 58 },
  };
}

export function axisStyle(t: ChartTheme, style: ChartStyle): any {
  return {
    gridcolor: t.grid,
    zerolinecolor: t.grid,
    zerolinewidth: style.axisLine,
    linecolor: t.axis,
    linewidth: style.axisLine,
    showline: true,
    mirror: false,
    ticks: "outside" as const,
    ticklen: Math.max(4, Math.round(style.tick * 0.22)),
    tickwidth: style.axisLine,
    tickcolor: t.axis,
    automargin: true,
    tickfont: { size: style.tick, color: t.muted, family: CHART_FONT },
    title: {
      font: { size: style.axisTitle, color: t.muted, family: CHART_FONT },
      standoff: Math.round(style.axisTitle * 0.8),
    },
  };
}

export function baseLayout(t: ChartTheme, title?: string, presentation = false): any {
  const style = chartStyle(presentation);
  return {
    // Explicit colours are essential: JPEG has no alpha channel, and a
    // transparent Plotly background is encoded as solid black.
    paper_bgcolor: t.paper,
    plot_bgcolor: t.paper,
    font: { family: CHART_FONT, size: style.tick, color: t.text },
    margin: {
      ...style.margin,
      t: title ? style.margin.t : Math.max(22, Math.round(style.margin.t * 0.45)),
    },
    title: title
      ? {
          text: title,
          x: 0.006,
          xanchor: "left",
          y: 0.985,
          yanchor: "top",
          yref: "container",
          font: { family: CHART_FONT, size: style.title, color: t.text },
        }
      : undefined,
    hoverlabel: {
      bgcolor: t.hoverBg,
      bordercolor: t.hoverBg,
      font: { color: t.hoverText, size: style.hover, family: CHART_FONT },
      align: "left",
    },
    hovermode: "closest" as const,
    showlegend: false,
    xaxis: axisStyle(t, style),
    yaxis: axisStyle(t, style),
    modebar: {
      bgcolor: "rgba(0,0,0,0)",
      color: t.muted,
      activecolor: t.blue,
    },
  };
}

export const PLOTLY_CONFIG = {
  responsive: true,
  displaylogo: false,
  scrollZoom: true,
  modeBarButtonsToRemove: [
    "select2d",
    "lasso2d",
    "autoScale2d",
    "toggleSpikelines",
    "hoverClosestCartesian",
    "hoverCompareCartesian",
  ],
  toImageButtonOptions: {
    format: "jpeg",
    filename: "ews-plot",
    width: 1800,
    height: 1100,
    scale: 1,
  },
};

export const EXPORT_CONFIG = {
  staticPlot: true,
  displayModeBar: false,
  responsive: false,
};
