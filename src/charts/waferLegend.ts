import { fmtMap } from "../lib/format";
import { graphFontOffset } from "../lib/demoFonts";
import { paletteColor, type Theme } from "../lib/theme";

export interface WaferColorLegend {
  theme: Theme;
  palette: string;
  units: string;
  lo: number;
  hi: number;
  lsl: number | null;
  usl: number | null;
  showSpecTicks?: boolean;
  presentation?: boolean;
}

export const SCATTER_COLOR_LEGEND_WIDTH = 196;

function colorLegendTextSize(presentation = false) {
  return Math.round(presentation ? 15.5 : 12 + graphFontOffset());
}

export interface MapColors {
  bg: string;
  wafer: string;
  outline: string;
  empty: string;
  text: string;
  muted: string;
  limit: string;
}

export const FONT = '"Segoe UI Variable Text", "Segoe UI", Inter, system-ui, sans-serif';

export class LegendBounds {
  left = Infinity; top = Infinity; right = -Infinity; bottom = -Infinity;
  include(x: number, y: number, width: number, height: number) {
    this.left = Math.min(this.left, x); this.top = Math.min(this.top, y);
    this.right = Math.max(this.right, x + width); this.bottom = Math.max(this.bottom, y + height);
  }
  text(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) {
    const m = ctx.measureText(text), factor = maxWidth ? Math.min(1, maxWidth / Math.max(1, m.width)) : 1;
    this.include(x - m.actualBoundingBoxLeft * factor, y - m.actualBoundingBoxAscent,
      (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * factor, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
    if (maxWidth === undefined) ctx.fillText(text, x, y); else ctx.fillText(text, x, y, maxWidth);
  }
}

export function mapColors(theme: Theme): MapColors {
  return theme === "dark"
    ? {
        bg: "#0f1726",
        wafer: "#0a1322",
        outline: "#34455f",
        empty: "#1b2940",
        text: "#dbe4f3",
        muted: "#8fa1bd",
        limit: "#fb7185",
      }
    : {
        bg: "#ffffff",
        wafer: "#f8fafc",
        outline: "#cbd5e1",
        empty: "#dbe3ee",
        text: "#0f172a",
        muted: "#64748b",
        limit: "#e11d48",
      };
}

export function drawWaferColorbar(
  ctx: CanvasRenderingContext2D,
  t: MapColors,
  x: number,
  y: number,
  width: number,
  height: number,
  options: WaferColorLegend, bounds: LegendBounds, maxUnitsWidth: number, exportInk = false
): void {
  const { lo, hi } = options;
  const pres = options.presentation;
  const k = pres ? 1.55 : 1;
  const textSize = colorLegendTextSize(pres);
  // Reserve separate vertical bands for the units and the upper tick.
  // The old 7px gap let their bounding boxes overlap after larger fonts.
  const barY = y + textSize * 2 + 12;
  const barH = Math.max(20, height - (barY - y) - textSize / 2);
  bounds.include(x - 1, barY - 1, width + 2, barH + 2);
  const grad = ctx.createLinearGradient(0, barY + barH, 0, barY);
  for (let i = 0; i <= 24; i++) {
    grad.addColorStop(i / 24, paletteColor(options.palette, i / 24));
  }
  ctx.fillStyle = grad;
  ctx.fillRect(x, barY, width, barH);
  if (!exportInk) {
    ctx.strokeStyle = t.outline;
    ctx.lineWidth = k;
    ctx.strokeRect(x + 0.5, barY + 0.5, width - 1, barH - 1);
  }

  const units = options.units || "value";
  ctx.font = `${exportInk ? "400" : "600"} ${textSize}px ${FONT}`;
  ctx.fillStyle = t.muted;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  // Fit to the actual reserved legend width, not a character count.
  let unitsLabel = units;
  while (unitsLabel.length > 1 && ctx.measureText(unitsLabel).width > maxUnitsWidth) unitsLabel = unitsLabel.slice(0, -1);
  if (unitsLabel !== units) { unitsLabel = unitsLabel.slice(0, -1) + "…"; }
  bounds.text(ctx, unitsLabel, x, y + textSize);

  ctx.font = `${exportInk ? "400 " : ""}${textSize}px ${FONT}`;
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const f = i / 4;
    const yy = barY + barH * (1 - f);
    const v = lo + (hi - lo) * f;
    ctx.strokeStyle = t.muted;
    ctx.beginPath();
    ctx.moveTo(x + width, yy);
    ctx.lineTo(x + width + 4 * k, yy);
    ctx.stroke();
    ctx.fillStyle = t.text;
    ctx.textAlign = "left";
    bounds.include(x + width, yy - 1, 4 * k, 2);
    bounds.text(ctx, fmtMap(v), x + width + 7 * k, yy);
  }

  const mark = (v: number, label: string) => {
    if (!Number.isFinite(v) || hi <= lo) return;
    const f = (v - lo) / (hi - lo);
    if (f < 0 || f > 1) return;
    const yy = barY + barH * (1 - f);
    ctx.strokeStyle = t.limit;
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.moveTo(x - 2 * k, yy);
    ctx.lineTo(x + width + 2 * k, yy);
    ctx.stroke();
    ctx.font = `${exportInk ? "400" : "700"} ${Math.round(9 * k + (pres ? 0 : 2) + (pres ? 0 : graphFontOffset()))}px ${FONT}`;
    ctx.fillStyle = t.limit;
    ctx.textAlign = "right";
    bounds.include(x - 2 * k, yy - k, width + 4 * k, 2 * k);
    bounds.text(ctx, label, x - 5 * k, yy);
  };
  if (options.showSpecTicks !== false) {
    mark(options.usl ?? NaN, "USL");
    mark(options.lsl ?? NaN, "LSL");
  }
}


export function scatterColorLegendPlacement(host: HTMLElement, legend: WaferColorLegend) {
  const hostTop = host.getBoundingClientRect().top;
  const plot = (host as HTMLElement & { _fullLayout?: { _size?: { t: number; h: number } } })._fullLayout?._size;
  const plotTop = plot?.t ?? 0;
  const plotBottom = plot ? plot.t + plot.h : host.clientHeight;
  const toolbar = host.querySelector(".modebar");
  const toolbarBottom = toolbar ? Math.max(0, Math.ceil(toolbar.getBoundingClientRect().bottom - hostTop)) : 0;
  const groupTitle = host.querySelector<SVGTextElement>(".legendtitletext");
  const matrix = groupTitle?.getScreenCTM();
  const textSize = colorLegendTextSize(legend.presentation);
  const unitsBaseline = (legend.presentation ? 20 : 14) + 8 + textSize;
  const titleBaseline = groupTitle && matrix
    ? new DOMPoint(0, Number(groupTitle.getAttribute("y"))).matrixTransform(matrix).y - hostTop
    : null;
  const top = titleBaseline !== null
    ? Math.max(0, Math.round(titleBaseline - unitsBaseline))
    : Math.max(toolbarBottom, plotTop - 8);
  return {
    top,
    height: Math.max(0, Math.floor(Math.min(host.clientHeight, plotBottom) - top)),
    clipTop: Math.max(0, toolbarBottom - top),
  };
}

export function drawScatterColorLegend(canvas: HTMLCanvasElement, height: number, scale: number,
  legend: WaferColorLegend, exportInk = false) {
  const width = SCATTER_COLOR_LEGEND_WIDTH;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(scale, scale);
  const colours = exportInk ? { ...mapColors("light"), text: "#000000", muted: "#000000" }
    : mapColors(legend.theme);
  const bounds = new LegendBounds();
  const pad = legend.presentation ? 20 : 14;
  drawWaferColorbar(ctx, colours, 42, pad + 8, 26, height - pad * 2 - 20,
    legend, bounds, width - 42 - 24, exportInk);
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = colours.bg;
  ctx.fillRect(bounds.left - 16, bounds.top - 16, bounds.right - bounds.left + 32, bounds.bottom - bounds.top + 32);
}
