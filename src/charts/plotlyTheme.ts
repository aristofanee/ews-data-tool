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
  };
}

export function axisStyle(t: ChartTheme): any {
  return {
    gridcolor: t.grid,
    zerolinecolor: t.grid,
    zerolinewidth: 1,
    linecolor: t.axis,
    linewidth: 1,
    showline: true,
    mirror: false,
    ticks: "outside" as const,
    ticklen: 4,
    tickwidth: 1,
    tickcolor: t.axis,
    automargin: true,
    tickfont: { size: 11, color: t.muted, family: CHART_FONT },
    title: { font: { size: 12, color: t.muted, family: CHART_FONT }, standoff: 10 },
  };
}

export function baseLayout(t: ChartTheme, title?: string): any {
  return {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: CHART_FONT, size: 12, color: t.text },
    margin: { l: 68, r: 30, t: title ? 54 : 22, b: 58 },
    title: title
      ? {
          text: title,
          x: 0.006,
          xanchor: "left",
          y: 0.985,
          yanchor: "top",
          font: { family: CHART_FONT, size: 16, color: t.text },
        }
      : undefined,
    hoverlabel: {
      bgcolor: t.hoverBg,
      bordercolor: t.hoverBg,
      font: { color: t.hoverText, size: 12, family: CHART_FONT },
      align: "left",
    },
    hovermode: "closest" as const,
    showlegend: false,
    xaxis: axisStyle(t),
    yaxis: axisStyle(t),
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
