import type { BinOverviewWafer, MapDie, MapResponse, PlotSpec, Filter } from "../types";
import { fmtMap } from "../lib/format";
import { quantileSorted } from "../lib/stats";
import type { Theme } from "../lib/theme";
import { binColor, binLabel, paletteColor, binYieldText } from "../lib/theme";
import * as api from "../lib/api";
import { graphFontOffset } from "../lib/demoFonts";
import { imageFrame, encodeImage, wrapImageText, exportPlotTitle, limitFooter } from "./imageExport";

export interface MapOptions {
  showDieGrid?: boolean;
  exportInk?: boolean;
  exportFooter?: string;
  exportSpec?: PlotSpec;
  exportGroupLabel?: string;
  /** Standalone export provenance; ignored by the interactive renderer. */
  exportNotes?: string[];
  fontRevision?: number;
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

class LegendBounds {
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

  private cellW = 1;
  private cellH = 1;
  private cx = 0;
  private cy = 0;
  private dieCx = 0;
  private dieCy = 0;
  private signX = 1;
  private signY = 1;
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
  private legendLeft = Infinity;
  private legendCanvas: HTMLCanvasElement | null = null;
  private colorCache = new Map<number, string>();
  private colorPalette = "";
  /**
   * Static map layer. Hovering only blits this cached bitmap and draws the
   * highlight, so pointer movement stays cheap even for 50k-die maps.
   */
  private baseCanvas: HTMLCanvasElement | null = null;
  private baseCtx: CanvasRenderingContext2D | null = null;
  private baseDirty = true;
  private paths: Map<string,Path2D> | null = null;
  private legendDirty = true;
  private legendBox: {left:number;top:number;right:number;bottom:number} | null = null;
  private bounds: [number,number,number,number] | null = null;
  private frame: number | null = null;
  private interactive = false;
  private cachePad = 0;
  private cachePanX = 0;
  private cachePanY = 0;
  private cachePadPixels = 0;

  private invalidateDrawing():void {this.baseDirty=true;this.paths=null;this.legendDirty=true;}
  private scheduleDraw():void {
    if(this.frame!==null)return;
    this.frame=requestAnimationFrame(()=>{this.frame=null;this.draw();});
  }
  dispose():void {if(this.frame!==null)cancelAnimationFrame(this.frame);this.frame=null;}

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
  }

  resize(): boolean {
    this.interactive=true;
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
    this.invalidateDrawing();
    return true;
  }

  /** Size the backing store explicitly (used for off-screen report rendering). */
  setSize(width: number, height: number, scale = 1): void {
    this.interactive=false;
    this.w = width;
    this.h = height;
    this.dpr = 1;
    this.scale = scale;
    this.canvas.width = width;
    this.canvas.height = height;
    this.invalidateDrawing();
  }

  setData(data: MapResponse, opts: MapOptions): void {
    const prev = this.data ? `${this.data.lotName}/${this.data.wafer?.name ?? ""}` : null;
    const next = `${data.lotName}/${data.wafer?.name ?? ""}`;
    this.data = data;
    this.opts = opts;
    this.byKey.clear();
    this.bounds=null;
    this.binCounts = null;
    for (const d of data.dice) this.byKey.set(`${d.x},${d.y}`, d);
    this.invalidateDrawing();
    if (prev !== next) this.resetView();
    this.draw();
  }

  setOptions(opts: MapOptions): void {
    this.opts = opts;
    this.invalidateDrawing();
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
    // Reuse an exact-resolution raster around the viewport until panning
    // reaches its edge. No die paths need repainting for a small movement.
    if(Math.abs(this.panX-this.cachePanX)>this.cachePad||Math.abs(this.panY-this.cachePanY)>this.cachePad)this.baseDirty=true;
    this.scheduleDraw();
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
    this.scheduleDraw();
  }

  private clampPan(): void {
    const max = Math.max(0, this.radiusPx * (this.zoom - 1) * 1.1);
    this.panX = clamp(this.panX, -max, max);
    this.panY = clamp(this.panY, -max, max);
  }

  hitTest(clientX: number, clientY: number): MapHit | null {
    if (!this.data) return null;
    const rect = this.canvas.getBoundingClientRect();
    if ((clientX - rect.left) / this.scale >= this.legendLeft) return null;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const gx = (px - this.cx - this.panX) / this.zoom / (this.cellW*this.signX) + this.dieCx;
    const gy = -(py - this.cy - this.panY) / this.zoom / (this.cellH*this.signY) + this.dieCy;
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
    const pixels=this.dpr*this.scale;
    ctx.drawImage(this.baseCanvas,Math.round((this.panX-this.cachePanX)*pixels)-this.cachePadPixels,Math.round((this.panY-this.cachePanY)*pixels)-this.cachePadPixels);
    this.drawLegend();
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
    this.cachePad=this.interactive?128:0;
    this.cachePanX=this.panX;this.cachePanY=this.panY;
    const padPixels=Math.ceil(this.cachePad*this.dpr*this.scale),cacheWidth=this.canvas.width+padPixels*2,cacheHeight=this.canvas.height+padPixels*2;
    this.cachePadPixels=padPixels;
    if (base.width !== cacheWidth || base.height !== cacheHeight) {
      base.width = cacheWidth;
      base.height = cacheHeight;
    }
    const { dpr } = this;
    const t = mapColors(this.opts.theme);
    const data = this.data;
    const mode = this.opts.mode;
    const pres = this.opts.presentation === true;

    ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, padPixels, padPixels);
    ctx.clearRect(-this.cachePad, -this.cachePad, w+this.cachePad*2, h+this.cachePad*2);
    ctx.fillStyle = t.bg;
    ctx.fillRect(-this.cachePad, -this.cachePad, w+this.cachePad*2, h+this.cachePad*2);

    // Die coordinates are not necessarily centred on (0, 0): older STDF
    // writers often use positive-only grid coordinates. Centre the map on the
    // die bounding box, not on the coordinate origin.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    if(!this.bounds)for (const d of data.dice) {
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
    if(this.bounds)[minX,maxX,minY,maxY]=this.bounds;else this.bounds=[minX,maxX,minY,maxY];
    const wf = data.wafer;
    this.signX=wf?.posX==="L"?-1:1;
    this.signY=wf?.posY==="D"?-1:1;
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
          ? Math.min(290, Math.max(190, w * 0.34))
          : 164;
    const pad = !showLegend ? 4 : pres ? 20 : 14;
    if(this.legendDirty)this.legendLeft = showLegend ? w - cbarW : Infinity;
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
    const gap = this.opts.showDieGrid === false ? -0.5 / this.scale : Math.max(0.3, Math.min(cellW, cellH) * 0.055);
    const dw = Math.max(0.5, cellW - gap);
    const dh = Math.max(0.5, cellH - gap);
    const lo = Number.isFinite(this.opts?.vmin) ? (this.opts!.vmin as number) : Number.isFinite(data.vmin) ? data.vmin : 0;
    const hi = Number.isFinite(this.opts?.vmax) ? (this.opts!.vmax as number) : Number.isFinite(data.vmax) ? data.vmax : 1;
    const vspan = hi > lo ? hi - lo : 1;
    // Group dice by colour and fill one path per colour. Setting fillStyle and
    // calling fillRect 50k times is dramatically slower in WebView2 than
    // filling a handful of batched paths, and a 256-colour palette means at
    // most 256 fills per redraw.
    if(!this.paths){
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
        (d.x - centerX) * cellW * this.signX - dw / 2,
        -(d.y - centerY) * cellH * this.signY - dh / 2,
        dw,
        dh
      );
    }
    this.paths=paths;
    }
    for (const [color, path] of this.paths) {
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

    if(this.legendDirty){
    this.legendBox=null;
    const barX = w - cbarW + (pres ? 14 : 10);
    const legendColors = this.opts.exportInk ? {...mapColors("light"),text:"#000000",muted:"#000000",outline:"#000000"} : mapColors("light");
    const bounds = new LegendBounds();
    let legendCtx: CanvasRenderingContext2D | null = null;
    if (showLegend) {
      this.legendCanvas ??= document.createElement("canvas");
      if (this.legendCanvas.width !== this.canvas.width || this.legendCanvas.height !== this.canvas.height) {
        this.legendCanvas.width = this.canvas.width; this.legendCanvas.height = this.canvas.height;
      }
      legendCtx = this.legendCanvas.getContext("2d");
      legendCtx?.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, 0, 0);
      legendCtx?.clearRect(0, 0, w, h);
    }

    if (legendCtx && mode === "value") {
      this.drawColorbar(
        legendCtx,
        legendColors,
        barX,
        pad + 8,
        26,
        Math.min(availH, h - pad * 2 - 20),
        lo,
        hi,
        pres, bounds
      );
    } else if (legendCtx) {
      // Keep the bin counts off the canvas edge. The bin legend uses the full
      // reserved width, unlike the colour bar whose labels sit inside it.
      const legendRightPad = pres ? 24 : 20;
      this.drawBinLegend(legendCtx, legendColors, barX, pad + 24, cbarW - 14 - legendRightPad, pres, bounds);
    }
    if (legendCtx && this.legendCanvas && Number.isFinite(bounds.left)) {
      const padding = 16;
      this.legendLeft = bounds.left - padding;
      this.legendBox={left:Math.max(0,bounds.left-padding),top:Math.max(0,bounds.top-padding),right:Math.min(w,bounds.right+padding),bottom:Math.min(h,bounds.bottom+padding)};
    }
    this.legendDirty=false;
    }

    this.baseDirty = false;
  }

  private drawLegend():void {
    if(this.legendBox&&this.legendCanvas){
      const ctx=this.ctx,pixels=this.dpr*this.scale;
      // Text is already rasterized at device resolution. Copy integral physical
      // pixels directly; a CSS-sized drawImage can resample the glyphs again at
      // 125% scaling, especially when the available canvas size is fractional.
      const box=this.legendBox,left=Math.max(0,Math.floor(box.left*pixels)),top=Math.max(0,Math.floor(box.top*pixels));
      const right=Math.min(this.canvas.width,Math.ceil(box.right*pixels)),bottom=Math.min(this.canvas.height,Math.ceil(box.bottom*pixels));
      const width=right-left,height=bottom-top;
      if(width<=0||height<=0)return;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.fillStyle='#ffffff';ctx.fillRect(left,top,width,height);
      ctx.drawImage(this.legendCanvas,left,top,width,height,left,top,width,height);
    }
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
    if (Number.isFinite(this.legendLeft)) {
      ctx.beginPath(); ctx.rect(0, 0, this.legendLeft, this.h / this.scale); ctx.clip();
    }
    ctx.translate(this.cx + this.panX, this.cy + this.panY);
    ctx.scale(this.zoom, this.zoom);

    const hw = Math.max(cellW, (pres ? 6 : 4) / this.zoom);
    const hh = Math.max(cellH, (pres ? 6 : 4) / this.zoom);
    const hx = (this.hover.x - this.dieCx) * cellW * this.signX;
    const hy = -(this.hover.y - this.dieCy) * cellH * this.signY;
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
    pres = false, bounds = new LegendBounds()
  ): void {
    const k = pres ? 1.55 : 1;
    const textSize = Math.round(10 * k + (pres ? 0 : 2 + graphFontOffset()));
    // Reserve separate vertical bands for the units and the upper tick.
    // The old 7px gap let their bounding boxes overlap after larger fonts.
    const barY = y + textSize * 2 + 12;
    const barH = Math.max(20, height - (barY - y) - textSize / 2);
    bounds.include(x - 1, barY - 1, width + 2, barH + 2);
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
    ctx.font = `${this.opts?.exportInk ? "400" : "600"} ${textSize}px ${FONT}`;
    ctx.fillStyle = t.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    // Fit to the actual reserved legend width, not a character count.
    const maxUnitsWidth = Math.max(20, this.w / this.scale - x - 24);
    let unitsLabel = units;
    while (unitsLabel.length > 1 && ctx.measureText(unitsLabel).width > maxUnitsWidth) unitsLabel = unitsLabel.slice(0, -1);
    if (unitsLabel !== units) { unitsLabel = unitsLabel.slice(0, -1) + "…"; }
    bounds.text(ctx, unitsLabel, x, y + textSize);

    ctx.font = `${this.opts?.exportInk ? "400 " : ""}${textSize}px ${FONT}`;
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
      ctx.strokeStyle = "#e11d48";
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.moveTo(x - 2 * k, yy);
      ctx.lineTo(x + width + 2 * k, yy);
      ctx.stroke();
      ctx.font = `${this.opts?.exportInk ? "400" : "700"} ${Math.round(9 * k + (pres ? 0 : 2) + (pres ? 0 : graphFontOffset()))}px ${FONT}`;
      ctx.fillStyle = "#e11d48";
      ctx.textAlign = "right";
      bounds.include(x - 2 * k, yy - k, width + 4 * k, 2 * k);
      bounds.text(ctx, label, x - 5 * k, yy);
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
    pres = false, bounds = new LegendBounds()
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

    ctx.font = `${this.opts?.exportInk ? "400" : "600"} ${Math.round(10 * k + (pres ? 0 : 2) + (pres ? 0 : graphFontOffset()))}px ${FONT}`;
    ctx.fillStyle = t.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    bounds.text(ctx, soft ? "SBIN" : "HBIN", x, y);
    let yy = y + 25;
    const lineHeight = Math.max(21, 13 * k + (pres ? 0 : graphFontOffset()));
    ctx.font = `${Math.round(10 * k + (pres ? 0 : 2) + (pres ? 0 : graphFontOffset()))}px ${FONT}`;
    for (const [code, count] of shown) {
      const pass = this.opts?.binPass
        ? this.opts.binPass.includes(code)
        : code === 1;
      ctx.fillStyle = binColor(code, pass);
      ctx.fillRect(x, yy, 10 * k, 10 * k);
      bounds.include(x, yy, 10 * k, 10 * k);
      ctx.fillStyle = t.text;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const label = binLabel(soft ? "soft" : "hard", code, this.opts?.binNames?.[code], false);
      const maxWidth = width - 55 * k;
      const lines: string[] = [];
      let line = "";
      for (const word of label.split(/\s+/)) {
        if (line && ctx.measureText(`${line} ${word}`).width > maxWidth) { lines.push(line); line = word; }
        else line = line ? `${line} ${word}` : word;
      }
      if (line) lines.push(line);
      lines.forEach((text, i) => bounds.text(ctx, text, x + 15 * k, yy + 5 * k + i * lineHeight, maxWidth));
      ctx.fillStyle = t.muted;
      ctx.textAlign = "right";
      bounds.text(ctx, fmtCount(count), x + width, yy + 5 * k);
      yy += Math.max(18 * 1.55, lines.length * lineHeight + 5 * 1.55);
    }
    if (rest.length > 0) {
      const total = rest.reduce((a, [, c]) => a + c, 0);
      ctx.fillStyle = t.muted;
      ctx.textAlign = "left";
      bounds.text(ctx, `+ ${rest.length} more bins`, x + 15 * k, yy + 5 * k);
      ctx.textAlign = "right";
      bounds.text(ctx, fmtCount(total), x + width, yy + 5 * k);
    }
    ctx.textBaseline = "alphabetic";
  }
}

function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Full, non-truncated legend layout shared by individual and overview bin exports. */
function exportBinLegend(ctx: CanvasRenderingContext2D, dice: MapDie[], opts: MapOptions, maxHeight: number, availableWidth = 1152, maxColumns = 6) {
  const counts = new Map<number, number>();
  for (const die of dice) {
    const code = opts.binCategory === "soft" ? die.sbin : die.hbin;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const entries = [...counts].sort((a, b) => a[0] - b[0]);
  const category = opts.binCategory === "soft" ? "soft" : "hard";
  for (let size = opts.presentation ? 18 : 15; size >= 11; size--) {
    ctx.font = `${size}px ${FONT}`;
    let best: { height: number; columns: number; rows: number; cells: { code: number; count: number; lines: string[]; h: number }[]; rowHeights: number[] } | undefined;
    for (let columns = 1; columns <= Math.min(maxColumns, Math.max(1, entries.length)); columns++) {
      const rows = Math.ceil(entries.length / columns), cellW = availableWidth / columns;
      const cells = entries.map(([code, count]) => {
        const lines = wrapImageText(ctx, binLabel(category, code, opts.binNames?.[code], false), cellW - 78);
        return { code, count, lines, h: Math.max(size + 8, lines.length * (size + 4) + 8) };
      });
      const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...cells.slice(row * columns, (row + 1) * columns).map(c => c.h)));
      const height = 28 + rowHeights.reduce((n, h) => n + h, 0);
      if (height <= maxHeight && (!best || height + columns * 7 < best.height + best.columns * 7)) best = { height, columns, rows, cells, rowHeights };
    }
    if (best) {
      const layout = best;
      return { height: layout.height, draw: (top: number, left = 24) => {
        ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = "#000000";
        ctx.font = `400 ${size}px ${FONT}`; ctx.fillText(category === "soft" ? "SBIN" : "HBIN", left, top);
        ctx.font = `${size}px ${FONT}`;
        let y = top + 28;
        for (let row = 0; row < layout.rows; row++) {
          for (let col = 0; col < layout.columns; col++) {
            const cell = layout.cells[row * layout.columns + col]; if (!cell) continue;
            const cellW = availableWidth / layout.columns, x = left + col * cellW;
            ctx.fillStyle = binColor(cell.code); ctx.fillRect(x, y + 2, 11, 11);
            ctx.fillStyle = "#000000"; ctx.textAlign = "left";
            cell.lines.forEach((line, i) => ctx.fillText(line, x + 18, y + i * (size + 4)));
            ctx.fillStyle = "#000000"; ctx.textAlign = "right"; ctx.fillText(fmtCount(cell.count), x + cellW - 12, y);
          }
          y += layout.rowHeights[row];
        }
        ctx.textAlign = "left";
      } };
    }
  }
  throw new Error("The complete bin legend cannot fit in this image. Filter to fewer bins or wafers before exporting.");
}

function rightBinLegend(ctx: CanvasRenderingContext2D, dice: MapDie[], opts: MapOptions, height: number) {
  for (const width of [220, 280, 340, 420]) {
    try {
      return { legend: exportBinLegend(ctx, dice, opts, height, width, Math.max(1, Math.floor(width / 200))), width };
    } catch { /* Try a wider complete legend before rejecting the export. */ }
  }
  throw new Error("The complete bin legend cannot fit. Filter to fewer bins before exporting.");
}

/** Count plotted coordinates against their colour range; mean maps contain means. */
export async function mapExportFooter(data: MapResponse, opts: MapOptions, filter: Filter): Promise<string> {
  const spec=opts.exportSpec;
  const total=data.isMean?data.dice.filter(d=>Number.isFinite(d.v)).length:data.testTotal??data.dice.filter(d=>Number.isFinite(d.v)).length;
  if (opts.mode==="bin" || !spec || spec.test===null) return limitFooter(opts.mode==="bin"?data.dice.length:total,null);
  const lo=opts.vmin??data.vmin, hi=opts.vmax??data.vmax;
  if (!Number.isFinite(lo)||!Number.isFinite(hi)) return limitFooter(total,null);
  if(data.isMean){const inside=data.dice.filter(d=>Number.isFinite(d.v)&&d.v>=lo&&d.v<=hi).length;
    const explicit=Number.isFinite(opts.vmin)||Number.isFinite(opts.vmax);
    return limitFooter(total,inside,spec.lsl??data.lsl,spec.usl??data.usl,explicit?spec:{...spec,limitMode:"auto"});}
  const grouped=!data.isMean&&!!data.wafer;
  const counts=await api.limitCounts({test:spec.test,filter,lsl:lo,usl:hi,groupBy:grouped?"wafer":null});
  const label=`${data.lotName} / ${data.wafer?.name}`;
  const count=grouped?counts.groups.find(g=>g.label===label)||counts.groups.find(g=>g.label===data.wafer?.name):counts;
  const explicit=Number.isFinite(opts.vmin)||Number.isFinite(opts.vmax);
  return limitFooter(count?.total??0,count?.inLimits??0,spec.lsl??data.lsl,spec.usl??data.usl,
    explicit?spec:{...spec,limitMode:"auto"});
}

/** Standalone maps share the same header, pixel size and encoder as Plotly. */
export function renderMapImage(data: MapResponse, opts: MapOptions, width: number, height: number,
  title: string, _subtitle: string, format: "jpeg" | "png" = "jpeg"): string {
  const bin = opts.mode === "bin";
  const spec = opts.exportSpec;
  const group = opts.exportGroupLabel ?? (!data.isMean && data.wafer ? `${data.lotName} / ${data.wafer.name}` : undefined);
  if (spec) title = exportPlotTitle(spec, data.test, "WaferID", group);
  const numericTotal = (data.testPass ?? 0) + (data.testFail ?? 0);
  const total = bin ? data.dice.length : data.testTotal ?? (numericTotal || data.dice.filter(d=>Number.isFinite(d.v)).length);

  const frame = imageFrame(width, height, title, "", opts.presentation, [opts.exportFooter??limitFooter(total,null)]);
  const right = bin ? rightBinLegend(frame.ctx, data.dice, opts, frame.contentHeight) : null;
  const mapWidth = right ? 1152 - right.width - 16 : 1200;
  const mapHeight = frame.contentHeight;
  const map = document.createElement("canvas"), renderer = new WaferMapRenderer(map);
  renderer.setSize(Math.round(mapWidth * frame.scale), Math.round(mapHeight * frame.scale), frame.scale);
  renderer.setData(data, { ...opts, theme: "light", exportInk: true, showLegend: bin ? false : true });
  frame.ctx.drawImage(map, right ? 24 : 0, frame.top, mapWidth, mapHeight);
  right?.legend.draw(frame.top, 24 + mapWidth + 16);
  return encodeImage(frame.canvas, format);
}

/** All wafers plus a shared, complete bin legend; no category is silently dropped. */
export function renderBinOverviewImage(wafers: BinOverviewWafer[], opts: MapOptions, width: number, height: number,
  title: string, _subtitle: string, format: "jpeg" | "png" = "jpeg"): string {
  if (opts.exportSpec) title = exportPlotTitle(opts.exportSpec, null, "WaferID");
  // An overview is always a 16:9 image; enlarged individual wafers remain square.
  height = Math.round(width * 9 / 16);
  const lots = [...new Set(wafers.map(w=>w.lotName))];
  if (opts.exportSpec && lots.length === 1) title = exportPlotTitle({...opts.exportSpec,groupBy:"lot"}, null, "WaferID", lots[0]);
  const frame = imageFrame(width, height, title, "", opts.presentation,
    []);
  if (!wafers.length) return encodeImage(frame.canvas, format);
  const {legend, width:legendW} = rightBinLegend(frame.ctx, wafers.flatMap(w=>w.dice), opts, frame.contentHeight);
  const areaW = 1152 - legendW - 16, gap = 6, n = wafers.length;
  const multiLot = lots.length > 1;
  let best: {cols:number;rows:number;cellW:number;cellH:number;labelH:number;labels:string[][];diameter:number} | undefined;
  frame.ctx.font = `400 11px ${FONT}`;
  for (let cols=1;cols<=Math.min(n,30);cols++) {
    const rows=Math.ceil(n/cols), cellW=(areaW-gap*(cols-1))/cols, cellH=(frame.contentHeight-gap*(rows-1))/rows;
    if (cellW<40) continue;
    const labels=wafers.map(w=>wrapImageText(frame.ctx,multiLot?`${w.lotName} / ${w.wafer.name}`:w.wafer.name,cellW));
    const labelH=Math.max(...labels.map(lines=>lines.length*13+15));
    const diameter=Math.min(cellW,cellH-labelH);
    if (!best || diameter>best.diameter) best={cols,rows,cellW,cellH,labelH,labels,diameter};
  }
  if (!best || best.diameter<20) throw new Error("Too many wafers to label clearly in one image. Filter to fewer wafers before exporting.");
  const {cols,cellW,cellH,labelH,labels}=best;
  wafers.forEach((w,i)=>{
    const x=24+(i%cols)*(cellW+gap), y=frame.top+Math.floor(i/cols)*(cellH+gap), mapH=cellH-labelH;
    const map=document.createElement("canvas"), renderer=new WaferMapRenderer(map);
    renderer.setSize(Math.round(cellW*frame.scale),Math.round(mapH*frame.scale),frame.scale);
    const data: MapResponse={wafer:w.wafer,lotName:w.lotName,dice:w.dice,test:null,lsl:null,usl:null,
      vmin:NaN,vmax:NaN,pass:w.pass,fail:w.fail,yieldPct:w.yieldPct,isMean:false,waferCount:1,excluded:0};
    renderer.setData(data,{...opts,theme:"light",exportInk:true,mode:"bin",showLegend:false,showDieGrid:false,presentation:false});
    frame.ctx.textAlign="left";frame.ctx.textBaseline="top";frame.ctx.fillStyle="#000000";frame.ctx.font=`400 11px ${FONT}`;
    labels[i].forEach((line,j)=>frame.ctx.fillText(line,x,y+j*13));
    frame.ctx.font=`10px ${FONT}`;frame.ctx.fillStyle="#000000";
    frame.ctx.fillText(binYieldText(w.yieldPct,w.dice,1),x,y+labels[i].length*13);
    frame.ctx.drawImage(map,x,y+labelH,cellW,mapH);
  });
  legend.draw(frame.top,24+areaW+16);
  return encodeImage(frame.canvas,format);
}
