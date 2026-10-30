import type { BinOverviewWafer, MapDie, MapResponse, PlotSpec } from "../types";
import { fmtMap } from "../lib/format";
import { quantileSorted } from "../lib/stats";
import type { Theme } from "../lib/theme";
import { binColor, binLabel, paletteColor } from "../lib/theme";

export interface MapOptions {
  theme: Theme;
  palette: string;
  mode: "value" | "bin";
  lsl: number | null;
  usl: number | null;
  binNames?: Record<number, string>;
  binCategory?: "hard" | "soft";
  /** Codes that count as passing for the selected bin category. */
  binPass?: number[];
  /** Optional explicit colour-scale limits. */
  vmin?: number;
  vmax?: number;
  /** Larger map labels and legend for slide-sized output. */
  presentation?: boolean;
  /** Hide the colour/bin legend for small bin-overview thumbnails. */
  showLegend?: boolean;
}

export interface MapHit {
  die: MapDie;
  sx: number;
  sy: number;
}

/**
 * Resolve the colour-scale limits for a value map. Auto leaves the range to
 * the renderer; the other modes mirror the Limits section used by charts.
 */
export function mapColorLimits(
  spec: PlotSpec,
  data: MapResponse
): { vmin?: number; vmax?: number } {
  if (spec.limitMode === "auto") return {};
  if (spec.limitMode === "manual") {
    return {
      vmin: spec.yMin ?? undefined,
      vmax: spec.yMax ?? undefined,
    };
  }
  const values = data.dice
    .map((d) => d.v)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!values.length) return {};
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
  if (spec.limitMode === "sigma" && sd > 0) {
    return { vmin: mean - spec.limitK * sd, vmax: mean + spec.limitK * sd };
  }
  if (spec.limitMode === "iqr") {
    const q1 = quantileSorted(values, 0.25);
    const q3 = quantileSorted(values, 0.75);
    const iqr = q3 - q1;
    if (iqr > 0) return { vmin: q1 - spec.limitK * iqr, vmax: q3 + spec.limitK * iqr };
  }
  if (spec.limitMode === "spec") {
    return {
      vmin: spec.lsl ?? data.lsl ?? undefined,
      vmax: spec.usl ?? data.usl ?? undefined,
    };
  }
  return {};
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
  private cellW = 1;
  private cellH = 1;
  private cx = 0;
  private cy = 0;
  private dieCx = 0;
  private dieCy = 0;
  private radiusPx = 1;
  private zoom = 1;
  private panX = 0;
  private panY = 0;

  private byKey = new Map<string, MapDie>();
  private binCounts: Map<number, number> | null = null;
  private hover: MapDie | null = null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private scale = 1;
  private colorCache = new Map<number, string>();
  private colorPalette = "";
  /**
   * Static map layer. Hovering only blits this cached bitmap and draws the
   * highlight, so pointer movement stays cheap even for 50k-die maps.
   */
  private baseCanvas: HTMLCanvasElement | null = null;
  private baseCtx: CanvasRenderingContext2D | null = null;
  private baseDirty = true;

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
    this.baseDirty = true;
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
    this.baseDirty = true;
  }

  setData(data: MapResponse, opts: MapOptions): void {
    const prev = this.data ? `${this.data.lotName}/${this.data.wafer?.name ?? ""}` : null;
    const next = `${data.lotName}/${data.wafer?.name ?? ""}`;
    this.data = data;
    this.opts = opts;
    this.byKey.clear();
    this.binCounts = null;
    for (const d of data.dice) this.byKey.set(`${d.x},${d.y}`, d);
    this.baseDirty = true;
    if (prev !== next) this.resetView();
    this.draw();
  }

  setOptions(opts: MapOptions): void {
    this.opts = opts;
    this.baseDirty = true;
    this.draw();
  }

  resetView(): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.hover = null;
    this.baseDirty = true;
    this.draw();
  }

  setHover(die: MapDie | null): void {
    // hitTest returns the same MapDie object while the pointer stays over one
    // die. The React tooltip still follows the pointer, but the canvas only
    // needs to be repainted when the highlighted die actually changes.
    const sameDie = (this.hover ?? null) === die;
    this.hover = die;
    if (!sameDie) this.draw();
  }

  getZoom(): number {
    return this.zoom;
  }

  panBy(dx: number, dy: number): void {
    if (this.zoom <= 1) return;
    this.hover = null;
    this.panX += dx;
    this.panY += dy;
    this.clampPan();
    this.baseDirty = true;
    this.draw();
  }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const z2 = clamp(this.zoom * factor, 1, 8);
    if (Math.abs(z2 - this.zoom) < 1e-4) return;
    this.hover = null;
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
    this.baseDirty = true;
    this.draw();
  }

  private clampPan(): void {
    const max = Math.max(0, this.radiusPx * (this.zoom - 1) * 1.1);
    this.panX = clamp(this.panX, -max, max);
    this.panY = clamp(this.panY, -max, max);
  }

  hitTest(clientX: number, clientY: number): MapHit | null {
    if (!this.data) return null;
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const gx = (px - this.cx - this.panX) / this.zoom / this.cellW + this.dieCx;
    const gy = -(py - this.cy - this.panY) / this.zoom / this.cellH + this.dieCy;
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
    const w = this.w / this.scale;
    const h = this.h / this.scale;
    if (w < 2 || h < 2) return;
    if (this.baseDirty || !this.baseCanvas) this.renderBase();
    if (!this.baseCanvas) return;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.baseCanvas, 0, 0);
    this.drawHover();
  }

  private renderBase(): void {
    if (!this.data || !this.opts) return;
    const w = this.w / this.scale;
    const h = this.h / this.scale;
    if (w < 2 || h < 2) return;
    if (!this.baseCanvas) {
      this.baseCanvas = document.createElement("canvas");
      this.baseCtx = this.baseCanvas.getContext("2d");
    }
    const base = this.baseCanvas;
    const ctx = this.baseCtx;
    if (!base || !ctx) return;
    if (base.width !== this.canvas.width || base.height !== this.canvas.height) {
      base.width = this.canvas.width;
      base.height = this.canvas.height;
    }
    const { dpr } = this;
    const t = mapColors(this.opts.theme);
    const data = this.data;
    const mode = this.opts.mode;
    const pres = this.opts.presentation === true;
    const k = pres ? 1.55 : 1;

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
    const wf = data.wafer;
    const dieWmm = wf?.dieWMm && wf.dieWMm > 0 ? wf.dieWMm : null;
    const dieHmm = wf?.dieHMm && wf.dieHMm > 0 ? wf.dieHMm : null;
    const hasDieDims = dieWmm !== null && dieHmm !== null;
    // WCR CENTER_X/CENTER_Y are die-grid coordinates. Some writers put a
    // placeholder such as 128/128 in a file whose dice only span 4..45; using
    // it would draw the whole map off-canvas. Trust the WCR centre only when
    // it is at least near the dice we actually have. Without physical die
    // dimensions the renderer fits a legacy coordinate grid around the dice,
    // so the bounding-box centre is always the right anchor there.
    const bboxCx = (minX + maxX) / 2;
    const bboxCy = (minY + maxY) / 2;
    const spanX = Math.max(1, maxX - minX + 1);
    const spanY = Math.max(1, maxY - minY + 1);
    let centerX = bboxCx;
    let centerY = bboxCy;
    const wcrCx = wf?.centerX;
    const wcrCy = wf?.centerY;
    if (
      hasDieDims &&
      wcrCx != null &&
      wcrCy != null &&
      wcrCx >= minX - spanX &&
      wcrCx <= maxX + spanX &&
      wcrCy >= minY - spanY &&
      wcrCy <= maxY + spanY
    ) {
      centerX = wcrCx;
      centerY = wcrCy;
    }
    this.dieCx = centerX;
    this.dieCy = centerY;

    const showLegend = this.opts.showLegend !== false;
    const cbarW =
      !showLegend
        ? 0
        : mode === "bin"
          ? Math.min(pres ? 290 : 196, Math.max(pres ? 190 : 120, w * (pres ? 0.34 : 0.3)))
          : pres
            ? 164
            : 108;
    const pad = !showLegend ? 4 : pres ? 20 : 14;
    const availW = Math.max(40, w - cbarW - pad * 2);
    const availH = Math.max(40, h - pad * 2);
    const cx = pad + availW / 2;
    const cy = pad + availH / 2;

    let cellW: number;
    let cellH: number;
    let R: number;
    if (hasDieDims) {
      // WCR gives physical die dimensions. Use their true aspect ratio and the
      // wafer diameter. The renderer clips to that circle, so coordinates
      // outside it must not shrink the visible wafer and create blank space.
      const halfGridW = Math.max(Math.abs(minX - centerX), Math.abs(maxX - centerX) + 1) * dieWmm;
      const halfGridH = Math.max(Math.abs(minY - centerY), Math.abs(maxY - centerY) + 1) * dieHmm;
      const diameter = wf?.diameterMm && wf.diameterMm > 0 ? wf.diameterMm : null;
      const radiusMm = diameter
        ? diameter / 2
        : Math.max(halfGridW, halfGridH) + Math.max(dieWmm, dieHmm) * 0.5;
      const worldW = diameter ?? Math.max(radiusMm * 2, halfGridW * 2, dieWmm * 2);
      const worldH = diameter ?? Math.max(radiusMm * 2, halfGridH * 2, dieHmm * 2);
      const fit = Math.min(availW / worldW, availH / worldH);
      cellW = dieWmm * fit;
      cellH = dieHmm * fit;
      R = radiusMm * fit;
    } else {
      // Legacy files without WCR geometry: fall back to the coordinate grid.
      // A 1:1 cell keeps the map usable even when no physical dimensions exist.
      const cols = maxX - minX + 1;
      const rows = maxY - minY + 1;
      const span = Math.max(cols, rows) + 1;
      const cell = Math.min(availW / span, availH / span);
      cellW = cell;
      cellH = cell;
      R = Math.max((cols / 2) * cell, (rows / 2) * cell) + cell * 0.6;
    }

    this.cell = Math.min(cellW, cellH);
    this.cellW = cellW;
    this.cellH = cellH;
    this.cx = cx;
    this.cy = cy;
    this.radiusPx = R;

    ctx.save();
    ctx.translate(cx + this.panX, cy + this.panY);
    ctx.scale(this.zoom, this.zoom);

    // One continuous wafer path (circle + notch) is used for both filling and
    // clipping. The notch is therefore real wafer geometry, not a triangle
    // pasted over the outline, and scales with the wafer radius.
    ctx.beginPath();
    this.traceWaferPath(ctx, R);
    ctx.fillStyle = t.wafer;
    ctx.fill();

    ctx.save();
    // Clip the dice to a plain circle. Clipping every fillRect through the
    // notch path below makes Skia fall back to a slow per-rect mask and can
    // turn a 50k-die redraw into seconds. The notch is cut out again after the
    // dice have been drawn.
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.clip();
    const gap = Math.max(0.3, Math.min(cellW, cellH) * 0.055);
    const dw = Math.max(0.5, cellW - gap);
    const dh = Math.max(0.5, cellH - gap);
    const lo = Number.isFinite(this.opts?.vmin) ? (this.opts!.vmin as number) : Number.isFinite(data.vmin) ? data.vmin : 0;
    const hi = Number.isFinite(this.opts?.vmax) ? (this.opts!.vmax as number) : Number.isFinite(data.vmax) ? data.vmax : 1;
    const vspan = hi > lo ? hi - lo : 1;
    // Group dice by colour and fill one path per colour. Setting fillStyle and
    // calling fillRect 50k times is dramatically slower in WebView2 than
    // filling a handful of batched paths, and a 256-colour palette means at
    // most 256 fills per redraw.
    const paths = new Map<string, Path2D>();
    for (const d of data.dice) {
      let color: string;
      if (mode === "bin") {
        const category = this.opts?.binCategory === "soft" ? d.sbin : d.hbin;
        const pass = this.opts?.binPass
          ? this.opts.binPass.includes(category)
          : category === 1;
        color = binColor(category, pass);
      } else if (!Number.isFinite(d.v)) {
        color = t.empty;
      } else {
        color = this.colorFor((d.v - lo) / vspan);
      }
      let path = paths.get(color);
      if (!path) {
        path = new Path2D();
        paths.set(color, path);
      }
      path.rect(
        (d.x - centerX) * cellW - dw / 2,
        -(d.y - centerY) * cellH - dh / 2,
        dw,
        dh
      );
    }
    for (const [color, path] of paths) {
      ctx.fillStyle = color;
      ctx.fill(path);
    }
    ctx.restore();

    // Cut the flat/notch back out of the dice. The wafer fill already has the
    // notch; the plain circle clip above let dice paint over it.
    if (this.data?.wafer?.flat) {
      ctx.beginPath();
      this.traceNotchCutout(ctx, R);
      ctx.fillStyle = t.bg;
      ctx.fill();
    }

    // Redraw the outline on top so dice never cover it.
    ctx.beginPath();
    this.traceWaferPath(ctx, R);
    ctx.lineWidth = (pres ? 2.6 : 1.5) / this.zoom;
    ctx.strokeStyle = t.outline;
    ctx.stroke();
    ctx.restore();

    const barX = w - cbarW + (pres ? 14 : 10);

    if (showLegend && mode === "value") {
      this.drawColorbar(
        ctx,
        t,
        barX,
        pad + 8,
        Math.min(pres ? 26 : 16, cbarW * 0.16),
        Math.min(availH, h - pad * 2 - 20),
        lo,
        hi,
        pres
      );
    } else if (showLegend) {
      // Keep the bin counts off the canvas edge. The bin legend uses the full
      // reserved width, unlike the colour bar whose labels sit inside it.
      const legendRightPad = pres ? 24 : 20;
      this.drawBinLegend(ctx, t, barX, pad + 10, cbarW - 14 - legendRightPad, pres);
    }

    this.baseDirty = false;
  }

  private drawHover(): void {
    if (!this.hover || !this.data || !this.opts) return;
    const ctx = this.ctx;
    const { dpr } = this;
    const t = mapColors(this.opts.theme);
    const pres = this.opts.presentation === true;
    const R = this.radiusPx;
    const cellW = this.cellW;
    const cellH = this.cellH;

    ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, 0, 0);
    ctx.save();
    ctx.translate(this.cx + this.panX, this.cy + this.panY);
    ctx.scale(this.zoom, this.zoom);

    const hw = Math.max(cellW, (pres ? 6 : 4) / this.zoom);
    const hh = Math.max(cellH, (pres ? 6 : 4) / this.zoom);
    const hx = (this.hover.x - this.dieCx) * cellW;
    const hy = -(this.hover.y - this.dieCy) * cellH;
    ctx.lineWidth = (pres ? 3 : 2) / this.zoom;
    ctx.strokeStyle = this.opts.theme === "dark" ? "#ffffff" : "#0f172a";
    ctx.strokeRect(hx - hw / 2, hy - hh / 2, hw, hh);
    ctx.lineWidth = (pres ? 1.6 : 1) / this.zoom;
    ctx.strokeStyle = "#f5b301";
    ctx.strokeRect(
      hx - hw / 2 - (pres ? 2.5 : 1.5) / this.zoom,
      hy - hh / 2 - (pres ? 2.5 : 1.5) / this.zoom,
      hw + (pres ? 5 : 3) / this.zoom,
      hh + (pres ? 5 : 3) / this.zoom
    );

    // The highlight is painted above the cached dice layer, so restore the
    // notch and outline just as the base render does.
    if (this.data.wafer?.flat) {
      ctx.beginPath();
      this.traceNotchCutout(ctx, R);
      ctx.fillStyle = t.bg;
      ctx.fill();
    }
    ctx.beginPath();
    this.traceWaferPath(ctx, R);
    ctx.lineWidth = (pres ? 2.6 : 1.5) / this.zoom;
    ctx.strokeStyle = t.outline;
    ctx.stroke();
    ctx.restore();
  }

  /** Build a circle with a real notch/flat cut out of its outline. */
  private traceWaferPath(ctx: CanvasRenderingContext2D, radius: number): void {
    const flat = this.data?.wafer?.flat;
    if (!flat) {
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      return;
    }
    const theta =
      flat === "U"
        ? -Math.PI / 2
        : flat === "L"
          ? Math.PI
          : flat === "R"
            ? 0
            : Math.PI / 2;
    const halfGap = Math.asin(Math.min(0.92, 0.055));
    const start = theta + halfGap;
    const end = theta - halfGap + Math.PI * 2;
    const depth = radius * 0.035;
    ctx.moveTo(Math.cos(start) * radius, Math.sin(start) * radius);
    ctx.arc(0, 0, radius, start, end, false);
    ctx.lineTo(Math.cos(theta) * (radius - depth), Math.sin(theta) * (radius - depth));
    ctx.closePath();
  }

  /**
   * The region outside the flat/notch but inside the wafer circle. Filling it
   * with the page background restores the notch after the dice have been drawn
   * through the fast circular clip.
   */
  private traceNotchCutout(ctx: CanvasRenderingContext2D, radius: number): void {
    const flat = this.data?.wafer?.flat;
    if (!flat) return;
    const theta =
      flat === "U"
        ? -Math.PI / 2
        : flat === "L"
          ? Math.PI
          : flat === "R"
            ? 0
            : Math.PI / 2;
    const halfGap = Math.asin(Math.min(0.92, 0.055));
    const start = theta + halfGap;
    const end = theta - halfGap + Math.PI * 2;
    const depth = radius * 0.035;
    ctx.moveTo(Math.cos(end) * radius, Math.sin(end) * radius);
    ctx.arc(0, 0, radius, end, start, false);
    ctx.lineTo(Math.cos(theta) * (radius - depth), Math.sin(theta) * (radius - depth));
    ctx.closePath();
  }

  private drawColorbar(
    ctx: CanvasRenderingContext2D,
    t: MapColors,
    x: number,
    y: number,
    width: number,
    height: number,
    lo: number,
    hi: number,
    pres = false
  ): void {
    const k = pres ? 1.55 : 1;
    const barH = Math.max(80, height - (pres ? 40 : 26));
    const barY = y + (pres ? 34 : 22);
    const grad = ctx.createLinearGradient(0, barY + barH, 0, barY);
    for (let i = 0; i <= 24; i++) {
      grad.addColorStop(i / 24, this.colorFor(i / 24));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x, barY, width, barH);
    ctx.strokeStyle = t.outline;
    ctx.lineWidth = k;
    ctx.strokeRect(x + 0.5, barY + 0.5, width - 1, barH - 1);

    const units = this.data?.test?.units || "value";
    const maxUnits = pres ? 11 : 14;
    ctx.font = `600 ${Math.round(10 * k)}px ${FONT}`;
    ctx.fillStyle = t.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(units.length > maxUnits ? units.slice(0, maxUnits - 1) + "…" : units, x, barY - 7 * k);

    ctx.font = `${Math.round(10 * k)}px ${FONT}`;
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
      ctx.fillText(fmtMap(v), x + width + 7 * k, yy);
    }

    const mark = (v: number, label: string) => {
      if (!Number.isFinite(v) || hi <= lo) return;
      const f = (v - lo) / (hi - lo);
      if (f < 0 || f > 1) return;
      const yy = barY + barH * (1 - f);
      ctx.strokeStyle = "#e11d48";
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.moveTo(x - 2 * k, yy);
      ctx.lineTo(x + width + 2 * k, yy);
      ctx.stroke();
      ctx.font = `700 ${Math.round(9 * k)}px ${FONT}`;
      ctx.fillStyle = "#e11d48";
      ctx.textAlign = "right";
      ctx.fillText(label, x - 5 * k, yy);
    };
    if (this.opts) {
      mark(this.opts.lsl ?? NaN, "LSL");
      mark(this.opts.usl ?? NaN, "USL");
    }
  }

  private drawBinLegend(
    ctx: CanvasRenderingContext2D,
    t: MapColors,
    x: number,
    y: number,
    width: number,
    pres = false
  ): void {
    const k = pres ? 1.55 : 1;
    const soft = this.opts?.binCategory === "soft";
    if (!this.binCounts) {
      const counts = new Map<number, number>();
      for (const d of this.data?.dice ?? []) {
        const code = soft ? d.sbin : d.hbin;
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
      this.binCounts = counts;
    }
    const entries = [...this.binCounts.entries()].sort((a, b) => b[1] - a[1]);
    const shown = entries.slice(0, 12);
    const rest = entries.slice(12);

    ctx.font = `600 ${Math.round(10 * k)}px ${FONT}`;
    ctx.fillStyle = t.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(soft ? "SBIN" : "HBIN", x, y);
    let yy = y + 16 * k;
    ctx.font = `${Math.round(10 * k)}px ${FONT}`;
    for (const [code, count] of shown) {
      const pass = this.opts?.binPass
        ? this.opts.binPass.includes(code)
        : code === 1;
      ctx.fillStyle = binColor(code, pass);
      ctx.fillRect(x, yy, 10 * k, 10 * k);
      ctx.fillStyle = t.text;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const label = binLabel(soft ? "soft" : "hard", code, this.opts?.binNames?.[code]);
      const maxWidth = width - 55 * k;
      const lines: string[] = [];
      let line = "";
      for (const word of label.split(/\s+/)) {
        if (line && ctx.measureText(`${line} ${word}`).width > maxWidth) { lines.push(line); line = word; }
        else line = line ? `${line} ${word}` : word;
      }
      if (line) lines.push(line);
      lines.forEach((text, i) => ctx.fillText(text, x + 15 * k, yy + 5 * k + i * 13 * k, maxWidth));
      ctx.fillStyle = t.muted;
      ctx.textAlign = "right";
      ctx.fillText(fmtCount(count), x + width, yy + 5 * k);
      yy += Math.max(18, lines.length * 13 + 5) * k;
    }
    if (rest.length > 0) {
      const total = rest.reduce((a, [, c]) => a + c, 0);
      ctx.fillStyle = t.muted;
      ctx.textAlign = "left";
      ctx.fillText(`+ ${rest.length} more bins`, x + 15 * k, yy + 5 * k);
      ctx.textAlign = "right";
      ctx.fillText(fmtCount(total), x + width, yy + 5 * k);
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
  const pres = opts.presentation === true;
  const k = pres ? 1.5 : 1;
  const headerH = Math.round(height * (pres ? 0.17 : 0.13));
  const map = document.createElement("canvas");
  const renderer = new WaferMapRenderer(map);
  renderer.setSize(width, height - headerH, pres ? 1.75 : 1.55);
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
  ctx.font = `600 ${Math.round(30 * k)}px ${FONT}`;
  ctx.fillText(title, 42, Math.round(50 * k));
  ctx.fillStyle = t.muted;
  ctx.font = `${Math.round(15 * k)}px ${FONT}`;
  ctx.fillText(subtitle, 42, Math.round(78 * k));
  ctx.fillStyle = "#2563eb";
  ctx.fillRect(42, Math.round(94 * k), Math.round(74 * k), Math.round(4 * k));

  ctx.drawImage(map, 0, headerH);
  return out.toDataURL(format === "png" ? "image/png" : "image/jpeg", 0.95);
}

/** Composite export for the Bin map tab: all selected wafers in one image. */
export function renderBinOverviewImage(
  wafers: BinOverviewWafer[],
  opts: MapOptions,
  width: number,
  height: number,
  title: string,
  subtitle: string,
  format: "jpeg" | "png" = "jpeg"
): string {
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) return "";
  const t = mapColors(opts.theme);
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, width, height);

  const pres = opts.presentation === true;
  const headerH = Math.round(height * (pres ? 0.14 : 0.12));
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = t.text;
  ctx.font = `600 ${Math.round(pres ? 32 : 26)}px ${FONT}`;
  ctx.fillText(title, 42, Math.round(pres ? 54 : 46));
  ctx.fillStyle = t.muted;
  ctx.font = `${Math.round(pres ? 17 : 14)}px ${FONT}`;
  ctx.fillText(subtitle, 42, Math.round(pres ? 84 : 72));
  ctx.fillStyle = "#2563eb";
  ctx.fillRect(42, Math.round(pres ? 102 : 86), Math.round(pres ? 82 : 64), 4);

  const n = wafers.length;
  if (!n) return out.toDataURL(format === "png" ? "image/png" : "image/jpeg", 0.95);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const margin = Math.round(pres ? 34 : 24);
  const gap = Math.round(pres ? 22 : 14);
  const labelH = Math.round(pres ? 46 : 34);
  const cellW = (width - margin * 2 - gap * (cols - 1)) / cols;
  const cellH = (height - headerH - margin - gap * (rows - 1)) / rows;
  const multiLot = new Set(wafers.map((w) => w.lotName)).size > 1;

  wafers.forEach((w, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (cellW + gap);
    const y = headerH + row * (cellH + gap);
    const mapH = Math.max(10, cellH - labelH);
    const mapCanvas = document.createElement("canvas");
    const renderer = new WaferMapRenderer(mapCanvas);
    renderer.setSize(Math.round(cellW), Math.round(mapH), pres ? 1.5 : 1.25);
    const data: MapResponse = {
      wafer: w.wafer,
      lotName: w.lotName,
      dice: w.dice,
      test: null,
      lsl: null,
      usl: null,
      vmin: Number.NaN,
      vmax: Number.NaN,
      pass: w.pass,
      fail: w.fail,
      yieldPct: w.yieldPct,
      isMean: false,
      waferCount: 1,
      excluded: 0,
    };
    renderer.setData(data, { ...opts, mode: "bin", showLegend: false, presentation: false });
    renderer.draw();

    const label = multiLot ? `${w.lotName} / ${w.wafer.name}` : w.wafer.name;
    ctx.fillStyle = t.text;
    ctx.font = `600 ${Math.round(pres ? 18 : 14)}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(label, x + 2, y + Math.round(pres ? 20 : 15));
    ctx.fillStyle = binColor(1);
    ctx.font = `${Math.round(pres ? 15 : 12)}px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(`${w.yieldPct.toFixed(1)}%`, x + cellW - 2, y + Math.round(pres ? 20 : 15));
    ctx.drawImage(mapCanvas, x, y + labelH, cellW, mapH);
  });

  return out.toDataURL(format === "png" ? "image/png" : "image/jpeg", 0.95);
}
