import type { Figure } from "./figures";

/** Rasterize static scatter markers without dropping points. Plotly still
 * draws axes and fit lines; enlarged/export figures retain interactive data.
 * This avoids thousands of SVG nodes per facet and WebGL context limits. */
export function rasterScatterPreview(figure: Figure, width: number, height: number): Figure {
  const layout = structuredClone(figure.layout);
  const logY = layout.yaxis?.type === "log";
  const yValue = (y: number) => logY ? (y > 0 ? Math.log10(y) : NaN) : y;
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const trace of figure.data) {
    for (let i = 0; i < trace.x.length; i++) {
      const x = trace.x[i], y = yValue(trace.y[i]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
      ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
    }
  }
  if (!Number.isFinite(xmin)) return figure;
  const padded = (lo: number, hi: number) => {
    const pad = (hi - lo || Math.abs(lo) || 1) * 0.06;
    return [lo - pad, hi + pad];
  };
  const xr = layout.xaxis.range ?? padded(xmin, xmax);
  const yr = layout.yaxis.range ?? padded(ymin, ymax);
  layout.xaxis = { ...layout.xaxis, range: xr, autorange: false };
  layout.yaxis = { ...layout.yaxis, range: yr, autorange: false };
  const margin = layout.margin;
  const w = Math.max(100, width - margin.l - margin.r);
  const h = Math.max(100, height - margin.t - margin.b);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * 2); canvas.height = Math.ceil(h * 2);
  const ctx = canvas.getContext("2d");
  if (!ctx) return figure;
  ctx.scale(2, 2);
  for (const trace of figure.data) {
    const marker = trace.marker;
    ctx.globalAlpha = marker.opacity ?? 1;
    const numeric = Array.isArray(marker.color);
    // Continuous scatter scales use hex RGB stops. Prepare them once per trace.
    const stops: [number, number[]][] = numeric ? marker.colorscale.map(([at, hex]: [number, string]) =>
      [at, [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))]) : [];
    const color = (z: number) => {
      const t = marker.cmax > marker.cmin ? Math.max(0, Math.min(1, (z - marker.cmin) / (marker.cmax - marker.cmin))) : 0.5;
      let j = 1;
      while (j < stops.length - 1 && t > stops[j][0]) j++;
      const [a, c0] = stops[j - 1], [b, c1] = stops[j];
      const f = (t - a) / (b - a);
      return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * f)).join(",")})`;
    };
    if (!numeric) ctx.fillStyle = marker.color;
    for (let i = 0; i < trace.x.length; i++) {
      const x = trace.x[i], y = yValue(trace.y[i]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (numeric) ctx.fillStyle = color(marker.color[i]);
      ctx.beginPath();
      ctx.arc((x - xr[0]) / (xr[1] - xr[0]) * w, (yr[1] - y) / (yr[1] - yr[0]) * h, marker.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  layout.images = [...(layout.images ?? []), { source: canvas.toDataURL("image/png"),
    xref: "paper", yref: "paper", x: 0, y: 1, sizex: 1, sizey: 1,
    xanchor: "left", yanchor: "top", sizing: "stretch", layer: "above" }];
  // Keep a cartesian trace so Plotly creates axes even for an image-only plot.
  return { data: [{ type: "scatter", mode: "markers", x: [], y: [], showlegend: false, hoverinfo: "skip" }], layout };
}
