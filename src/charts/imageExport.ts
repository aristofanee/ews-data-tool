import Plotly from "plotly.js-dist-min";
import type { Figure } from "./figures";
import type { DatasetInfo, Filter, PlotSpec, Summary, TestInfo, PlotType } from "../types";
import { EXPORT_CONFIG, CHART_FONT } from "./plotlyTheme";
import * as api from "../lib/api";
import { emptyFilter } from "../types";
import { fmt, testLabelWithUnits } from "../lib/format";
import { graphFontOffset } from "../lib/demoFonts";
import { drawExportBoundaryLimits } from "./limitLineClipping";

export type ImageFormat = "png" | "jpeg";
export const IMAGE_WIDTH = 2400, IMAGE_HEIGHT = 1500;
export const BIN_OVERVIEW_WIDTH = 4800;
export const SQUARE_IMAGE_HEIGHT = 2100;
export const imageHeight = (type: PlotType) => ["map", "binmap", "scatter"].includes(type) ? SQUARE_IMAGE_HEIGHT : IMAGE_HEIGHT;
export interface ExportPlotStyle {
  spec: PlotSpec; test: TestInfo | null; xLabel: string; total: number; facetLabel?: string;
  statistics?: string;
}
export { categoryName } from "../lib/categoryNames";
import { categoryName } from "../lib/categoryNames";
export function exportPlotTitle(spec: PlotSpec, test: Pick<TestInfo,"number"|"name"|"units"> | null, xLabel: string, groupLabel?: string): string {
  const kind = ({box:"Box plot",map:"Map",binmap:"BinMap",hist:"Histogram",scatter:"Scatter",trend:"Trend",pareto:"Pareto"})[spec.type];
  const measured = spec.type === "pareto" || spec.type === "binmap" ? (spec.binCategory === "soft" ? "SBIN" : "HBIN") : testLabelWithUnits(test);
  const prefix = groupLabel ? `[${categoryName(spec.groupBy === "none" ? "wafer" : spec.groupBy)} ${groupLabel}] ` : "";
  return `${prefix}${measured} vs ${xLabel} · ${kind}`;
}
export function limitFooter(total: number, inside: number | null, lsl: number | null = null, usl: number | null = null, spec?: PlotSpec): string {
  const text=`Total: ${total.toLocaleString("en-US")}`;
  if (inside===null) return text;
  const count=`${text} - In Limits: ${inside.toLocaleString("en-US")}`;
  if (!spec || spec.limitMode==="auto" || spec.limitMode==="manual") return count;
  const used=spec.limitMode==="sigma" ? `Mean ±${spec.limitK}σ` : spec.limitMode==="iqr" ? `Q1/Q3 ±${spec.limitK} IQR` :
    lsl!==null&&usl!==null ? "USL/LSL" : usl!==null ? "USL" : lsl!==null ? "LSL" : "";
  return used ? `${count} - Limits Used: ${used}` : count;
}
export const JPEG_QUALITY = 0.96;

export function statisticsFooter(summary: Pick<Summary, "n" | "mean" | "sd">, cpk: number | null = null): string {
  if (!summary.n || !Number.isFinite(summary.mean) || !Number.isFinite(summary.sd)) return "";
  const suffix = cpk !== null && Number.isFinite(cpk) ? ` - Cpk: ${fmt(cpk, 2)}` : "";
  return `Mean: ${fmt(summary.mean)} - SD: ${fmt(summary.sd)}${suffix}`;
}

/** Wrap every character, including identifiers with no spaces, without clipping. */
export function wrapImageText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && ctx.measureText(`${line}${word}`).width > width) { lines.push(line); line = ""; }
      for (const char of word) {
        if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ""; }
        line += char;
      }
      line += " ";
    }
    if (line.trim()) lines.push(line.trim());
  }
  return lines;
}

/** One layout coordinate system for all chart/map exports; final dimensions are exact. */
export function imageFrame(width: number, height: number, title: string, subtitle = "", presentation = false, notes: string[] = [], statistics = "") {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Image canvas unavailable");
  const scale = width / 1200, logicalHeight = height / scale;
  ctx.scale(scale, scale); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 1200, logicalHeight);
  const padding = 24, available = 1200 - padding * 2;
  const titleSize = presentation ? 30 : 18 + graphFontOffset();
  const textSize = presentation ? 17 : 12 + graphFontOffset();
  let y = 16;
  ctx.fillStyle = "#000000"; ctx.textBaseline = "top";
  ctx.font = `400 ${titleSize}px ${CHART_FONT}`;
  for (const line of wrapImageText(ctx, title, available)) { ctx.fillText(line, padding, y); y += titleSize * 1.3; }
  ctx.font = `${textSize}px ${CHART_FONT}`; ctx.fillStyle = "#000000";
  for (const line of wrapImageText(ctx, subtitle, available)) { ctx.fillText(line, padding, y); y += textSize * 1.4; }
  const top = Math.ceil(y + 12);
  ctx.font = `400 ${Math.min(textSize, 15)}px ${CHART_FONT}`;
  const leftWidth = statistics ? available - ctx.measureText(statistics).width - 24 : available;
  const foot = notes.flatMap(note => wrapImageText(ctx, note, leftWidth));
  const lineHeight = Math.min(textSize, 15) * 1.4;
  const rows = Math.max(foot.length, statistics ? 1 : 0);
  const bottom = rows ? rows * lineHeight + 20 : 12;
  const contentHeight = Math.floor(logicalHeight - top - bottom);
  if (contentHeight < 180) throw new Error("The image title or notes are too long to leave space for the plot. Shorten the title.");
  const drawNotes = (values: string[]) => {
    ctx.fillStyle="#ffffff";ctx.fillRect(0,logicalHeight-bottom,1200,bottom);
    ctx.font=`400 ${Math.min(textSize,15)}px ${CHART_FONT}`;ctx.fillStyle="#000000";ctx.textAlign="left";ctx.textBaseline="top";
    const y = logicalHeight - bottom + 4;
    values.flatMap(note => wrapImageText(ctx, note, leftWidth)).forEach((line, i) => ctx.fillText(line, padding, y + i * lineHeight));
    if (statistics) {
      ctx.textAlign = "right";
      ctx.fillText(statistics, 1200 - padding, y);
      ctx.textAlign = "left";
    }
  };
  drawNotes(notes);
  return { canvas, ctx, scale, top, contentHeight, drawNotes };
}

export function encodeImage(canvas: HTMLCanvasElement, format: ImageFormat, quality = JPEG_QUALITY): string {
  return canvas.toDataURL(format === "png" ? "image/png" : "image/jpeg", quality);
}

/** All Plotly outputs render losslessly first; JPEG quality is applied by our encoder. */
export async function renderExportFigure(fig: Figure, format: ImageFormat = "jpeg", width = IMAGE_WIDTH, height?: number): Promise<string> {
  await document.fonts.ready;
  const layout = structuredClone(fig.layout), data = structuredClone(fig.data);
  const style = fig.exportStyle;
  height ??= style ? imageHeight(style.spec.type) : IMAGE_HEIGHT;
  const title = style ? exportPlotTitle(style.spec, style.test, style.xLabel, style.facetLabel)
    : String(layout.title?.text ?? "").replace(/<br\s*\/?>/gi, "\n");
  let notes: string[] = [];
  if (style) {
    notes = [limitFooter(style.total,null)];
    if (style.spec.groupBy !== "none" && !style.facetLabel && style.spec.type !== "scatter") {
      const size = layout.font?.size ?? 18;
      const text = categoryName(style.spec.groupBy);
      if (style.spec.type === "hist") {
        if (layout.showlegend && layout.legend) {
          layout.legend.title = { text, side: "top", font: { size, color: "#000000", weight: 400 } };
        }
      } else {
        layout.annotations = [...(layout.annotations ?? []), {xref:"paper",yref:"paper",x:0.5,y:1,
          yshift:size * 2.8,text,showarrow:false,
          xanchor:"center",yanchor:"bottom",font:{size,color:"#000000"}}];
        layout.margin = {...layout.margin,t:(layout.margin?.t ?? 54)+size*3.4};
      }
    }
  }
  // Stronger export-only typography; preserve data, limit and yield colors.
  layout.font = {...layout.font,color:"#000000",weight:400};
  for (const [key, axis] of Object.entries(layout) as [string, any][]) {
    if (!/^[xy]axis\d*$/.test(key)) continue;
    const color = style?.spec.type === "pareto" && key === "yaxis2" ? axis.tickfont?.color : "#000000";
    axis.tickfont = {...axis.tickfont,color,weight:400};
    axis.title = {...axis.title,font:{...axis.title?.font,color,weight:400}};
    axis.linecolor = color; axis.tickcolor = color;
  }
  if (layout.legend) layout.legend.font = {...layout.legend.font,color:"#000000",weight:400};
  for (const annotation of layout.annotations ?? []) {
    annotation.text = annotation.text?.replace(/<\/?b>/gi, "");
    annotation.font = {...annotation.font,weight:400};
    if (!/LSL|USL/.test(annotation.text ?? "")) annotation.font = {...annotation.font,color:"#000000",weight:400};
  }
  // Reserve room for the final counts, which are resolved against the rendered axis.
  const footerSpace = style?.statistics ? [limitFooter(style.total, style.total,
    style.spec.lsl ?? style.test?.loSpec ?? null, style.spec.usl ?? style.test?.hiSpec ?? null, style.spec)] : notes;
  const frame = imageFrame(width, height, title, "", layout.meta?.ewsPresentation === true, footerSpace, style?.statistics);
  if (footerSpace !== notes) frame.drawNotes(notes);
  layout.title = undefined;
  layout.width = 1200; layout.height = frame.contentHeight; layout.autosize = false;
  layout.margin = { ...layout.margin, t: Math.max(24, (layout.margin?.t ?? 54) - 25) };
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-30000px;top:0;width:1200px;height:${frame.contentHeight}px;`;
  document.body.appendChild(host);
  try {
    const declaredRange=Array.isArray(layout[style?.spec.type==="hist"?"xaxis":"yaxis"]?.range);
    await Plotly.newPlot(host, data, layout, EXPORT_CONFIG);
    if (style && ["box","hist","trend","scatter"].includes(style.spec.type)) {
      const key=style.spec.type==="hist"?"xaxis":"yaxis";
      const axis=(host as any)._fullLayout[key];
      const test=style.spec.type==="scatter" ? style.spec.scatterY : style.spec.test;
      if (test!==null && axis?.range?.length===2) {
        const range=axis.range.map((v:number)=>axis.type==="log"?10**v:v).sort((a:number,b:number)=>a-b);
        const counts=await api.limitCounts({test,pairedTest:style.spec.type==="scatter"?style.spec.scatterX:null,filter:fig.exportFilter??emptyFilter(),
          lsl:range[0],usl:range[1],groupBy:style.spec.groupBy});
        const count=style.facetLabel?counts.groups.find(g=>g.label===style.facetLabel):counts;
        const lsl=style.spec.lsl??style.test?.loSpec??null, usl=style.spec.usl??style.test?.hiSpec??null;
        const close=(a:number,b:number)=>a===b||Math.abs(a-b)<=1e-6*Math.max(Math.abs(a),Math.abs(b),Number.MIN_VALUE);
        const matchesSpec=style.spec.limitMode!=="spec"||((lsl===null||close(range[0],lsl))&&(usl===null||close(range[1],usl)));
        frame.drawNotes([limitFooter(count?.total??0,count?.inLimits??0,lsl,usl,
          declaredRange&&matchesSpec?style.spec:{...style.spec,limitMode:"auto"})]);
      }
    }
    const url = await Plotly.toImage(host, { format: "png", width: 1200, height: frame.contentHeight, scale: frame.scale });
    const image = new Image(); image.src = url; await image.decode();
    frame.ctx.drawImage(image, 0, frame.top, 1200, frame.contentHeight);
    drawExportBoundaryLimits(host,frame.ctx,frame.top);
    return encodeImage(frame.canvas, format);
  } finally { Plotly.purge(host); host.remove(); }
}

/** Include an ordinal so distinct labels cannot collide after filename sanitizing. */
export function splitImageName(title: string, label: string, index: number, safeName: (s: string) => string, groupBy?: string): string {
  const prefix=groupBy ? `${categoryName(groupBy).toUpperCase()}_${label}` : label;
  return `[${safeName(prefix)}]${safeName(title)}_${String(index+1).padStart(3,"0")}.jpg`;
}

/** Snapshot provenance, separate from individual split identities in the title. */
export function imageScope(info: DatasetInfo, filter: Filter): string {
  const wafers = info.wafers.filter((w, i) => (!filter.wafers.length || filter.wafers.includes(i)) && (!filter.lots.length || filter.lots.includes(w.lot)));
  const lots = [...new Set(wafers.map(w => info.lots[w.lot]))];
  const parts = [`Input scope: ${lots.join(", ") || "no lots"} · ${wafers.length} wafers`];
  for (const [name, values] of [["HBIN", filter.hbins], ["SBIN", filter.sbins], ["Site", filter.sites ?? []]] as [string, number[]][]) {
    if (values.length) parts.push(`${name}: ${values.map(v => v === 65535 ? "unknown" : v).join(", ")}`);
  }
  if (filter.stat) parts.push(`${filter.stat.kind.toUpperCase()} filter k=${filter.stat.k} (${filter.stat.perWafer ? "per wafer" : "pooled"})`);
  return parts.join(" · ");
}
