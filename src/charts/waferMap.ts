import type { MapDie, MapResponse } from "../types";
import { fmt } from "../lib/format";
import type { Theme } from "../lib/theme";
import { binColor, paletteColor } from "../lib/theme";

export interface MapOptions {
  theme: Theme;
  palette: string;
  mode: "value" | "bin";
  lsl: number | null;
  usl: number | null;
  binNames?: Record<number, string>;
}

export interface MapHit {
  die: MapDie;
  sx: number;
  sy: number;
}

interface MapColors {
  bg: string;
  wafer: string;
  outline: string;
  empty: string;
  text: string;
  muted: string;
}

const FONT = '"Segoe UI Variable Text", "Segoe UI", Inter, system-ui, sans-serif';

function mapColors(theme: Theme): MapColors {
  return theme === "dark"
    ? {
        bg: "#0f1726",
        wafer: "#0a1322",
        outline: "#34455f",
        empty: "#1b2940",
        text: "#dbe4f3",
        muted: "#8fa1bd",
      }
    : {
        bg: "#ffffff",
        wafer: "#f8fafc",
        outline: "#cbd5e1",
        empty: "#dbe3ee",
        text: "#0f172a",
        muted: "#64748b",
      };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Custom canvas wafer map. A canvas (rather than a charting library) gives us
 * exact die geometry, a notch, crisp 1-pixel gaps and instant hover feedback
 * for 4,500+ dice.
 */
export class WaferMapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private data: MapResponse | null = null;
  private opts: MapOptions | null = null;

  private cell = 1;
  private cx = 0;
  private cy = 0;
  private dieCx = 0;
  private dieCy = 0;
  private radiusDie = 1;
  private zoom = 1;
  private panX = 0;
  private panY = 0;

  private byKey = new Map<string, MapDie>();
  private hover: MapDie | null = null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private scale = 1;
  private colorCache = new Map<number, string>();
  private colorPalette = "";

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
  }

  resize(): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.w === rect.width && this.h === rect.height && this.dpr === dpr) return false;
    this.w = rect.width;
    this.h = rect.height;
    this.dpr = dpr;
    this.scale = 1;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    return true;
  }

  /** Size the backing store explicitly (used for off-screen report rendering). */
  setSize(width: number, height: number, scale = 1): void {
    this.w = width;
    this.h = height;
    this.dpr = 1;
    this.scale = scale;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  setData(data: MapResponse, opts: MapOptions): void {
    const prev = this.data ? `${this.data.lotName}/${this.data.wafer?.name ?? ""}` : null;
    const next = `${data.lotName}/${data.wafer?.name ?? ""}`;
    this.data = data;
    this.opts = opts;
    this.byKey.clear();
    for (const d of data.dice) this.byKey.set(`${d.x},${d.y}`, d);
    if (prev !== next) this.resetView();
    this.draw();
  }

  setOptions(opts: MapOptions): void {
    this.opts = opts;
    this.draw();
  }

  resetView(): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.hover = null;
    this.draw();
  }

  setHover(die: MapDie | null): void {
    if (this.hover === die) return;
    this.hover = die;
    this.draw();
  }

  getZoom(): number {
    return this.zoom;
  }

  panBy(dx: number, dy: number): void {
    if (this.zoom <= 1) return;
    this.panX += dx;
    this.panY += dy;
    this.clampPan();
    this.draw();
  }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const z2 = clamp(this.zoom * factor, 1, 8);
    if (Math.abs(z2 - this.zoom) < 1e-4) return;
    const wx = (px - this.cx - this.panX) / this.zoom;
    const wy = (py - this.cy - this.panY) / this.zoom;
    this.zoom = z2;
    if (z2 === 1) {
      this.panX = 0;
      this.panY = 0;
    } else {
      this.panX = px - this.cx - wx * z2;
      this.panY = py - this.cy - wy * z2;
      this.clampPan();
    }
    this.draw();
  }

  private clampPan(): void {
    const max = Math.max(0, this.radiusDie * this.cell * (this.zoom - 1) * 1.1);
    this.panX = clamp(this.panX, -max, max);
    this.panY = clamp(this.panY, -max, max);
  }

  hitTest(clientX: number, clientY: number): MapHit | null {
    if (!this.data) return null;
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const gx = (px - this.cx - this.panX) / this.zoom / this.cell + this.dieCx;
    const gy = -(py - this.cy - this.panY) / this.zoom / this.cell + this.dieCy;
    const x = Math.round(gx);
    const y = Math.round(gy);
    if (Math.abs(gx - x) > 0.5 || Math.abs(gy - y) > 0.5) return null;
    const die = this.byKey.get(`${x},${y}`);
    if (!die) return null;
    return { die, sx: px, sy: py };
  }

  private colorFor(t: number): string {
    if (!this.opts) return "#999";
    if (this.colorPalette !== this.opts.palette) {
      this.colorCache.clear();
      this.colorPalette = this.opts.palette;
    }
    const q = Math.round(clamp(t, 0, 1) * 255);
    let c = this.colorCache.get(q);
    if (!c) {
      c = paletteColor(this.opts.palette, q / 255);
      this.colorCache.set(q, c);
    }
    return c;
  }

  draw(): void {
    if (!this.data || !this.opts) return;
    const { ctx, dpr } = this;
    const w = this.w / this.scale;
    const h = this.h / this.scale;
    if (w < 2 || h < 2) return;
    const t = mapColors(this.opts.theme);
    const data = this.data;
    const mode = this.opts.mode;

    ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, w, h);

    // Die coordinates are not necessarily centred on (0, 0): older STDF
    // writers often use positive-only grid coordinates. Centre the map on the
    // die bounding box, not on the coordinate origin.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const d of data.dice) {
      if (d.x < minX) minX = d.x;
      if (d.x > maxX) maxX = d.x;
      if (d.y < minY) minY = d.y;
      if (d.y > maxY) maxY = d.y;
    }
    if (!Number.isFinite(minX)) {
      minX = -1;
      maxX = 1;
      minY = -1;
      maxY = 1;
    }
    this.dieCx = (minX + maxX) / 2;
    this.dieCy = (minY + maxY) / 2;
    const span = Math.max((maxX - minX + 1) / 2, (maxY - minY + 1) / 2) + 0.5;

    const cbarW = mode === "bin" ? Math.min(196, Math.max(120, w * 0.3)) : 108;
    const pad = 14;
    const availW = Math.max(80, w - cbarW - pad * 2);
    const availH = Math.max(80, h - pad * 2);
    const area = Math.min(availW, availH);
    const cell = area / (span * 2 + 1);
    const cx = pad + availW / 2;
    const cy = pad + availH / 2;

    this.cell = cell;
    this.cx = cx;
    this.cy = cy;
    this.radiusDie = span;

    const R = span * cell;

    // Wafer outline
    ctx.save();
    ctx.translate(cx + this.panX, cy + this.panY);
    ctx.scale(this.zoom, this.zoom);
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = t.wafer;
    ctx.fill();
    ctx.lineWidth = 1.5 / this.zoom;
    ctx.strokeStyle = t.outline;
    ctx.stroke();

    // Dice, clipped to the wafer
    ctx.save();
    ctx.clip();
    const gap = Math.max(0.35, cell * 0.055);
    const size = Math.max(0.5, cell - gap);
    const lo = Number.isFinite(data.vmin) ? data.vmin : 0;
    const hi = Number.isFinite(data.vmax) ? data.vmax : 1;
    const vspan = hi > lo ? hi - lo : 1;
    for (const d of data.dice) {
      let color: string;
      if (mode === "bin") {
        color = binColor(d.hbin, d.hbin === 1);
      } else if (!Number.isFinite(d.v)) {
        color = t.empty;
      } else {
        color = this.colorFor((d.v - lo) / vspan);
      }
      ctx.fillStyle = color;
      ctx.fillRect(
        (d.x - this.dieCx) * cell - size / 2,
        -(d.y - this.dieCy) * cell - size / 2,
        size,
        size
      );
    }
    ctx.restore();

    // Hover highlight
    if (this.hover) {
      const s = Math.max(cell, 4 / this.zoom);
      ctx.lineWidth = 2 / this.zoom;
      ctx.strokeStyle = this.opts.theme === "dark" ? "#ffffff" : "#0f172a";
      ctx.strokeRect(
        (this.hover.x - this.dieCx) * cell - s / 2,
        -(this.hover.y - this.dieCy) * cell - s / 2,
        s,
        s
      );
      ctx.lineWidth = 1 / this.zoom;
      ctx.strokeStyle = "#f5b301";
      ctx.strokeRect(
        (this.hover.x - this.dieCx) * cell - s / 2 - 1.5 / this.zoom,
        -(this.hover.y - this.dieCy) * cell - s / 2 - 1.5 / this.zoom,
        s + 3 / this.zoom,
        s + 3 / this.zoom
      );
    }
    ctx.restore();

    // Notch at 6 o'clock
    const notchW = Math.max(3, cell * 1.5);
    const notchD = Math.max(3, cell * 1.2);
    ctx.beginPath();
    ctx.moveTo(cx + this.panX - notchW, cy + this.panY + R * this.zoom);
    ctx.lineTo(cx + this.panX + notchW, cy + this.panY + R * this.zoom);
    ctx.lineTo(cx + this.panX, cy + this.panY + (R - notchD) * this.zoom);
    ctx.closePath();
    ctx.fillStyle = t.bg;
    ctx.fill();
    ctx.strokeStyle = t.outline;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    const barX = w - cbarW + 10;

    if (mode === "value") {
      this.drawColorbar(t, barX, pad + 8, Math.min(16, cbarW * 0.16), Math.min(area, h - pad * 2 - 20), lo, hi);
    } else {
      this.drawBinLegend(t, barX, pad + 10, cbarW - 14);
    }

    // Zoom hint
    if (this.zoom > 1.01) {
      ctx.font = `10px ${FONT}`;
      ctx.fillStyle = t.muted;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(`${this.zoom.toFixed(1)}×  ·  double-click to reset`, pad, 4);
    }
  }

  private drawColorbar(
    t: MapColors,
    x: number,
    y: number,
    width: number,
    height: number,
    lo: number,
    hi: number
  ): void {
    const ctx = this.ctx;
    const barH = Math.max(80, height - 26);
    const barY = y + 22;
    const grad = ctx.createLinearGradient(0, barY + barH, 0, barY);
    for (let i = 0; i <= 24; i++) {
      grad.addColorStop(i / 24, this.colorFor(i / 24));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x, barY, width, barH);
    ctx.strokeStyle = t.outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, barY + 0.5, width - 1, barH - 1);

    const units = this.data?.test?.units || "value";
    ctx.font = `600 10px ${FONT}`;
    ctx.fillStyle = t.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(units.length > 14 ? units.slice(0, 13) + "…" : units, x, barY - 7);

    ctx.font = `10px ${FONT}`;
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const f = i / 4;
      const yy = barY + barH * (1 - f);
      const v = lo + (hi - lo) * f;
      ctx.strokeStyle = t.muted;
      ctx.beginPath();
      ctx.moveTo(x + width, yy);
      ctx.lineTo(x + width + 4, yy);
      ctx.stroke();
      ctx.fillStyle = t.text;
      ctx.textAlign = "left";
      ctx.fillText(fmt(v, 3), x + width + 7, yy);
    }

    const mark = (v: number, label: string) => {
      if (!Number.isFinite(v) || hi <= lo) return;
      const f = (v - lo) / (hi - lo);
      if (f < 0 || f > 1) return;
      const yy = barY + barH * (1 - f);
      ctx.strokeStyle = "#e11d48";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 2, yy);
      ctx.lineTo(x + width + 2, yy);
      ctx.stroke();
      ctx.font = `700 9px ${FONT}`;
      ctx.fillStyle = "#e11d48";
      ctx.textAlign = "right";
      ctx.fillText(label, x - 5, yy);
    };
    if (this.opts) {
      mark(this.opts.lsl ?? NaN, "LSL");
      mark(this.opts.usl ?? NaN, "USL");
    }
  }

  private drawBinLegend(t: MapColors, x: number, y: number, width: number): void {
    const ctx = this.ctx;
    const counts = new Map<number, number>();
    for (const d of this.data?.dice ?? []) {
      counts.set(d.hbin, (counts.get(d.hbin) ?? 0) + 1);
    }
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const shown = entries.slice(0, 9);
    const rest = entries.slice(9);

    ctx.font = `600 10px ${FONT}`;
    ctx.fillStyle = t.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("HARD BIN", x, y);
    let yy = y + 16;
    ctx.font = `10px ${FONT}`;
    for (const [code, count] of shown) {
      const name = this.opts?.binNames?.[code] || (code === 1 ? "Pass" : `Bin ${code}`);
      ctx.fillStyle = binColor(code, code === 1);
      ctx.fillRect(x, yy, 10, 10);
      ctx.fillStyle = t.text;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const label = `${code}  ${name}`;
      const maxChars = Math.max(8, Math.floor((width - 46) / 5.4));
      ctx.fillText(label.length > maxChars ? label.slice(0, maxChars - 1) + "…" : label, x + 15, yy + 5);
      ctx.fillStyle = t.muted;
      ctx.textAlign = "right";
      ctx.fillText(fmtCount(count), x + width, yy + 5);
      yy += 18;
    }
    if (rest.length > 0) {
      const total = rest.reduce((a, [, c]) => a + c, 0);
      ctx.fillStyle = t.muted;
      ctx.textAlign = "left";
      ctx.fillText(`+ ${rest.length} more bins`, x + 15, yy + 5);
      ctx.textAlign = "right";
      ctx.fillText(fmtCount(total), x + width, yy + 5);
    }
    ctx.textBaseline = "alphabetic";
  }
}

function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Render a print-ready wafer map with a title block. Used by “Save JPG” and by
 * the batch report generator, so the exported image matches what is on screen.
 */
export function renderMapImage(
  data: MapResponse,
  opts: MapOptions,
  width: number,
  height: number,
  title: string,
  subtitle: string,
  format: "jpeg" | "png" = "jpeg"
): string {
  const headerH = Math.round(height * 0.13);
  const map = document.createElement("canvas");
  const renderer = new WaferMapRenderer(map);
  renderer.setSize(width, height - headerH, 1.55);
  renderer.setData(data, opts);
  renderer.draw();

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) return "";
  const t = mapColors(opts.theme);
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, width, height);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = t.text;
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText(title, 42, 50);
  ctx.fillStyle = t.muted;
  ctx.font = `15px ${FONT}`;
  ctx.fillText(subtitle, 42, 78);
  ctx.fillStyle = "#2563eb";
  ctx.fillRect(42, 94, 74, 4);

  ctx.drawImage(map, 0, headerH);
  return out.toDataURL(format === "png" ? "image/png" : "image/jpeg", 0.95);
}
