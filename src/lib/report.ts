import Plotly from "plotly.js-dist-min";
import type { BinOverviewWafer, DatasetInfo, MapResponse, ReportItem } from "../types";
import type { Theme } from "./theme";
import * as api from "./api";
import { EXPORT_CONFIG } from "../charts/plotlyTheme";
import {
  figureBox,
  figureHist,
  figurePareto,
  figureScatter,
  figureTrend,
  type Figure,
} from "../charts/figures";
import { renderBinOverviewImage, renderMapImage, type MapOptions } from "../charts/waferMap";
import { safeName, testLabel, testLabelWithUnits, tidyName } from "./format";
import { useStore } from "../store";

export interface ReportResult {
  files: string[];
  indexHtml: string;
}

function join(dir: string, file: string): string {
  return dir.replace(/[\\/]+$/, "") + "\\" + file;
}

async function renderFigure(fig: Figure, width: number, height: number): Promise<string> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-30000px;top:0;width:${width}px;height:${height}px;`;
  document.body.appendChild(host);
  try {
    const layout = {
      ...fig.layout,
      width,
      height,
      autosize: false,
      margin: { ...fig.layout.margin },
    };
    await Plotly.newPlot(host, fig.data, layout, EXPORT_CONFIG);
    return await Plotly.toImage(host, {
      format: "jpeg",
      width,
      height,
      scale: 1.25,
      quality: 0.96,
    });
  } finally {
    try {
      Plotly.purge(host);
    } catch {
      /* ignore */
    }
    host.remove();
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildIndex(
  entries: { file: string; title: string; subtitle: string; cluster?: string }[],
  meta: { template: string; lots: string; wafers: number; generated: string }
): string {
  let lastCluster = "";
  const cards = entries
    .map((e) => {
      const head =
        e.cluster && e.cluster !== lastCluster
          ? `    <h2 class="cluster">${esc(e.cluster)}</h2>\n`
          : "";
      if (e.cluster) lastCluster = e.cluster;
      return `${head}    <figure>
      <img src="${esc(e.file)}" alt="${esc(e.title)}" loading="lazy">
      <figcaption><b>${esc(e.title)}</b><span>${esc(e.subtitle)}</span></figcaption>
    </figure>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EWS report · ${esc(meta.template)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 38px; background: #eef2f8; color: #0f172a;
         font-family: "Segoe UI Variable Text", "Segoe UI", Inter, system-ui, sans-serif; }
  header { max-width: 1440px; margin: 0 auto 26px; }
  .brand { display: flex; align-items: center; gap: 9px; color: #2563eb; font-size: 12px;
           font-weight: 600; letter-spacing: .04em; text-transform: uppercase; margin-bottom: 10px; }
  .brand i { width: 11px; height: 11px; border-radius: 3px; background: #2563eb; display: inline-block; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -.02em; }
  .meta { color: #64748b; font-size: 13px; }
  .grid { max-width: 1440px; margin: 0 auto; display: grid; gap: 22px;
          grid-template-columns: repeat(auto-fill, minmax(540px, 1fr)); }
  .cluster { grid-column: 1 / -1; margin: 8px 0 -8px; font-size: 14px; font-weight: 650;
             color: #334155; letter-spacing: -.01em; }
  figure { margin: 0; background: #fff; border: 1px solid #e3e8f1; border-radius: 12px;
           overflow: hidden; box-shadow: 0 1px 2px rgba(15,23,42,.06); }
  img { width: 100%; display: block; background: #fff; }
  figcaption { padding: 10px 14px 12px; border-top: 1px solid #eef2f8; }
  figcaption b { display: block; font-size: 13px; font-weight: 600; }
  figcaption span { color: #64748b; font-size: 11.5px; }
  footer { max-width: 1440px; margin: 26px auto 0; color: #94a3b8; font-size: 11px; }
  @media print { body { background: #fff; padding: 0; } figure { break-inside: avoid; box-shadow: none; } }
</style>
</head>
<body>
<header>
  <div class="brand"><i></i> EWS Data Tool</div>
  <h1>${esc(meta.template)}</h1>
  <div class="meta">${esc(meta.lots)} · ${meta.wafers} wafers · generated ${esc(meta.generated)}</div>
</header>
<div class="grid">
${cards}
</div>
<footer>Generated offline by EWS Data Tool.</footer>
</body>
</html>`;
}

export async function generateReport(opts: {
  items: ReportItem[];
  info: DatasetInfo;
  theme: Theme;
  folder: string;
  templateName: string;
  onProgress: (pct: number, msg: string) => void;
}): Promise<ReportResult> {
  const { items, info, folder, templateName, onProgress } = opts;
  // Reports are pasted into PowerPoint and viewed on a white page. Force the
  // light chart theme so a dark in-app theme never produces dark slides.
  const theme: Theme = "light";
  const entries: { file: string; title: string; subtitle: string; cluster?: string }[] = [];
  const files: string[] = [];
  const binNames: Record<number, string> = {};
  for (const b of info.hbins) binNames[b.code] = b.name;
  let imageNo = 0;

  const addImage = async (
    title: string,
    subtitle: string,
    dataUrl: string,
    cluster?: string
  ) => {
    if (!dataUrl) return;
    imageNo++;
    const file = `${String(imageNo).padStart(2, "0")}_${safeName(title)}.jpg`;
    await api.saveImage(join(folder, file), dataUrl);
    files.push(file);
    entries.push({ file, title, subtitle, cluster });
  };

  const mapImage = (md: MapResponse, title: string, spec: ReportItem["spec"]): string => {
    const mapOpts: MapOptions = {
      theme,
      palette: spec.palette,
      mode: spec.mapMode,
      lsl: spec.showLimits ? (spec.lsl ?? md.lsl) : null,
      usl: spec.showLimits ? (spec.usl ?? md.usl) : null,
      binNames,
      presentation: spec.presentation,
    };
    const subtitle =
      `${md.lotName} · Wafer ${md.wafer?.name ?? "?"}` +
      (md.test ? ` · ${testLabelWithUnits(md.test)}` : "") +
      ` · Yield ${md.yieldPct.toFixed(2)}%`;
    return renderMapImage(md, mapOpts, 2400, 1500, title, subtitle, "jpeg");
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const spec = item.spec;
    const pct = (i / Math.max(1, items.length)) * 92;
    onProgress(pct, `Rendering ${i + 1} of ${items.length} · ${spec.title}`);
    const test = spec.test !== null ? info.tests[spec.test] : null;

    if (spec.type === "binmap") {
      const d = await api.binOverview({ filter: item.filters });
      const base: MapOptions = {
        theme,
        palette: spec.palette,
        mode: "bin",
        lsl: null,
        usl: null,
        binNames,
        presentation: spec.presentation,
      };
      if (spec.splitPlots) {
        const lots = new Map<string, BinOverviewWafer[]>();
        for (const w of d.wafers) {
          const list = lots.get(w.lotName) ?? [];
          list.push(w);
          lots.set(w.lotName, list);
        }
        for (const [lot, wafers] of lots) {
          const title = `${spec.title} · ${lot}`;
          const pass = wafers.reduce((n, w) => n + w.pass, 0);
          const fail = wafers.reduce((n, w) => n + w.fail, 0);
          const tested = pass + fail;
          const subtitle = `${wafers.length} wafers · Yield ${tested ? ((pass * 100) / tested).toFixed(2) : "0.00"}%`;
          await addImage(
            title,
            subtitle,
            renderBinOverviewImage(wafers, base, 2400, 1500, title, subtitle, "jpeg"),
            spec.title
          );
        }
      } else {
        const pass = d.wafers.reduce((n, w) => n + w.pass, 0);
        const fail = d.wafers.reduce((n, w) => n + w.fail, 0);
        const tested = pass + fail;
        const subtitle = `${d.wafers.length} wafers · Yield ${tested ? ((pass * 100) / tested).toFixed(2) : "0.00"}%`;
        await addImage(
          spec.title,
          subtitle,
          renderBinOverviewImage(d.wafers, base, 2400, 1500, spec.title, subtitle, "jpeg")
        );
      }
      continue;
    }

    if (spec.type === "map") {
      const candidates = spec.splitPlots
        ? info.wafers
            .map((w, index) => ({ w, index }))
            .filter(({ w, index }) => {
              if (item.filters.wafers.length && !item.filters.wafers.includes(index)) return false;
              if (item.filters.lots.length && !item.filters.lots.includes(w.lot)) return false;
              return true;
            })
        : [{ index: spec.mapWafer ?? 0, w: info.wafers[spec.mapWafer ?? 0] }];
      for (const { index } of candidates) {
        const md = await api.waferMap({
          wafer: index,
          test: spec.test,
          mode: spec.mapMode,
          filter: item.filters,
        });
        if (!md.wafer || md.dice.length === 0) continue;
        const suffix = `${md.lotName} / ${md.wafer.name}`;
        const title = spec.splitPlots ? `${spec.title} · ${suffix}` : spec.title;
        await addImage(
          title,
          `${suffix} · Yield ${md.yieldPct.toFixed(2)}%`,
          mapImage(md, title, spec),
          spec.splitPlots ? spec.title : undefined
        );
      }
      continue;
    }

    let fig: Figure | null = null;
    let subtitle = "";
    let cluster: string | undefined;

    switch (spec.type) {
      case "box": {
        if (spec.test === null) continue;
        const d = await api.boxPlot({
          test: spec.test,
          groupBy: spec.groupBy,
          filter: item.filters,
          blockCol: spec.blockCol || undefined,
        });
        const baseSubtitle = `${testLabelWithUnits(test)} · ${d.summary.n.toLocaleString("en-US")} dice · ${spec.groupBy === "wafer" ? "by wafer" : "by lot"}`;
        if (spec.splitPlots) {
          const blocks = [...new Set(d.groups.map((g) => g.block))];
          for (const block of blocks) {
            const title = `${spec.title} · ${block}`;
            fig = figureBox(d, { theme, spec, title, facetLabel: block });
            await addImage(
              title,
              `${baseSubtitle} · ${block}`,
              await renderFigure(fig, 2400, 1500),
              spec.title
            );
          }
          continue;
        }
        fig = figureBox(d, { theme, spec, title: spec.title });
        subtitle = baseSubtitle;
        break;
      }
      case "pareto": {
        const d = await api.pareto({
          category: spec.binCategory,
          filter: item.filters,
          top: spec.top,
          groupBy: spec.paretoGroup === "none" ? null : spec.paretoGroup,
        });
        fig = figurePareto(d, { theme, spec, title: spec.title });
        subtitle =
          d.mode === "global"
            ? `${d.failTotal.toLocaleString("en-US")} failures · ${spec.binCategory} bins · yield ${d.yieldPct.toFixed(2)}%`
            : `${d.groups.length} ${d.groupLabel} groups · yield ${d.yieldPct.toFixed(2)}%`;
        break;
      }
      case "hist": {
        if (spec.test === null) continue;
        const d = await api.histogram({ test: spec.test, filter: item.filters, bins: spec.bins });
        fig = figureHist(d, { theme, spec, title: spec.title });
        subtitle = `${testLabelWithUnits(test)} · ${d.summary.n.toLocaleString("en-US")} dice`;
        break;
      }
      case "trend": {
        if (spec.test === null) continue;
        const d = await api.trend({ test: spec.test, by: spec.groupBy, filter: item.filters });
        fig = figureTrend(d, { theme, spec, title: spec.title });
        subtitle = `${testLabelWithUnits(test)} · ${d.points.length} points`;
        break;
      }
      case "scatter": {
        if (spec.scatterX === null || spec.scatterY === null) continue;
        const d = await api.scatter({
          xTest: spec.scatterX,
          yTest: spec.scatterY,
          zMode: spec.scatterZMode,
          zTest: spec.scatterZTest,
          zCol: spec.scatterZCol,
          filter: item.filters,
        });
        const z =
          d.zMode === "continuous"
            ? ` · Z ${d.zColLabel}`
            : d.zMode === "category"
              ? ` · ${d.zColLabel}`
              : "";
        const r = d.r !== null && Number.isFinite(d.r) ? ` · r ${d.r.toFixed(3)}` : "";
        const baseSubtitle = `${testLabel(d.xTest)} vs ${testLabel(d.yTest)}${z} · ${d.total.toLocaleString("en-US")} dice${r}`;
        if (spec.splitPlots && d.zMode === "category" && d.series.length > 1) {
          for (const s of d.series) {
            const title = `${spec.title} · ${s.name}`;
            fig = figureScatter(d, { theme, spec, title, facetKey: s.key });
            await addImage(
              title,
              `${baseSubtitle} · ${s.name}`,
              await renderFigure(fig, 2400, 1500),
              spec.title
            );
          }
          continue;
        }
        fig = figureScatter(d, { theme, spec, title: spec.title });
        subtitle = baseSubtitle;
        break;
      }
      default:
        continue;
    }

    if (fig) {
      await addImage(
        spec.title,
        subtitle,
        await renderFigure(fig, 2400, 1500),
        cluster
      );
    }
  }

  onProgress(95, "Writing report index…");
  const lotsLabel =
    info.lots.length === 1 ? info.lots[0] : `${info.lots.length} lots (${info.lots.slice(0, 4).join(", ")}${info.lots.length > 4 ? "…" : ""})`;
  const html = buildIndex(entries, {
    template: templateName || "EWS report",
    lots: lotsLabel,
    wafers: info.wafers.length,
    generated: new Date().toLocaleString(),
  });
  await api.saveText(join(folder, "index.html"), html);

  // Also drop the template next to the images so the report can be reproduced.
  const state = useStore.getState();
  const template = {
    app: "EWS Data Tool",
    version: 1,
    name: templateName || "EWS report",
    created: new Date().toISOString(),
    filters: state.filters,
    plots: items.map((r) => ({ spec: r.spec, filters: r.filters })),
    customColumns: state.info?.customColumns ?? [],
  };
  await api.saveText(join(folder, "report.json"), JSON.stringify(template, null, 2));

  onProgress(100, "Report complete");
  return { files, indexHtml: join(folder, "index.html") };
}
