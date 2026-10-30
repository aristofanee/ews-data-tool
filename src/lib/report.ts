import Plotly from "plotly.js-dist-min";
import type { DatasetInfo, MapResponse, ReportItem } from "../types";
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
import {
  mapColorLimits,
  renderBinOverviewImage,
  renderMapImage,
  type MapOptions,
} from "../charts/waferMap";
import { safeName, testLabel, testLabelWithUnits, tidyName } from "./format";
import { dataGroups } from "./grouping";
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
  const binNamesFor = (category: "hard" | "soft") => {
    const out: Record<number, string> = {};
    for (const b of category === "soft" ? info.sbins : info.hbins) out[b.code] = b.name;
    return out;
  };
  const binPassFor = (category: "hard" | "soft") =>
    (category === "soft" ? info.sbins : info.hbins)
      .filter((b) => b.pass)
      .map((b) => b.code);
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
    const limits = mapColorLimits(spec, md);
    const mapOpts: MapOptions = {
      theme,
      palette: spec.palette,
      mode: "value",
      lsl: spec.showLimits ? (spec.lsl ?? md.lsl) : null,
      usl: spec.showLimits ? (spec.usl ?? md.usl) : null,
      binNames: binNamesFor(spec.binCategory),
      binCategory: spec.binCategory,
      binPass: binPassFor(spec.binCategory),
      vmin: limits.vmin,
      vmax: limits.vmax,
      presentation: spec.presentation,
    };
    const scope = md.isMean
      ? `All wafers (mean) · ${md.waferCount} wafer${md.waferCount === 1 ? "" : "s"}`
      : `${md.lotName} · Wafer ${md.wafer?.name ?? "?"}`;
    const subtitle =
      scope +
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
      const d = await api.binOverview({ filter: item.filters, category: spec.binCategory });
      const base: MapOptions = {
        theme,
        palette: spec.palette,
        mode: "bin",
        lsl: null,
        usl: null,
        binNames: binNamesFor(spec.binCategory),
        binCategory: spec.binCategory,
        binPass: binPassFor(spec.binCategory),
        presentation: spec.presentation,
      };
      const pass = d.wafers.reduce((n, w) => n + w.pass, 0);
      const fail = d.wafers.reduce((n, w) => n + w.fail, 0);
      const tested = pass + fail;
      const subtitle = `${d.wafers.length} wafers · ${spec.binCategory === "soft" ? "SBIN" : "HBIN"} · Yield ${tested ? ((pass * 100) / tested).toFixed(2) : "0.00"}%`;
      await addImage(
        spec.title,
        subtitle,
        renderBinOverviewImage(d.wafers, base, 2400, 1500, spec.title, subtitle, "jpeg")
      );
      continue;
    }

    if (spec.type === "map") {
      const candidates = info.wafers
        .map((w, index) => ({ w, index }))
        .filter(({ w, index }) => {
          if (item.filters.wafers.length && !item.filters.wafers.includes(index)) return false;
          if (item.filters.lots.length && !item.filters.lots.includes(w.lot)) return false;
          return true;
        });
      const category = spec.groupBy || "none";
      type Group = { label: string; wafer: number | null; filter: typeof item.filters };
      let groups: Group[] = [];
      if (category === "none") {
        groups = [{ label: "All wafers (mean)", wafer: null, filter: item.filters }];
      } else if (category === "wafer") {
        groups = candidates.map(({ w, index }) => ({
          label: `${info.lots[w.lot] ?? `Lot ${w.lot}`} / ${w.name}`,
          wafer: index,
          filter: item.filters,
        }));
      } else if (category === "lot") {
        const byLot = new Map<number, number[]>();
        for (const { w, index } of candidates) {
          const list = byLot.get(w.lot) ?? [];
          list.push(index);
          byLot.set(w.lot, list);
        }
        groups = [...byLot.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([lot, indices]) => ({
            label: info.lots[lot] ?? `Lot ${lot}`,
            wafer: null,
            filter: { ...item.filters, lots: [lot], wafers: indices },
          }));
      } else {
        const col = info.customColumns.find((c) => c.name === category);
        const byCode = new Map<number, number[]>();
        if (col) {
          for (const { index } of candidates) {
            const code = col.waferValues[index] ?? 0;
            const list = byCode.get(code) ?? [];
            list.push(index);
            byCode.set(code, list);
          }
        }
        groups = [...byCode.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([code, indices]) => ({
            label: col?.categories[code] || "Unassigned",
            wafer: null,
            filter: { ...item.filters, wafers: indices },
          }));
      }
      for (const group of groups) {
        const md = await api.waferMap({
          lsl: spec.lsl,
          usl: spec.usl,
          wafer: group.wafer,
          test: spec.test,
          mode: "value",
          filter: group.filter,
        });
        if (md.dice.length === 0) continue;
        const title = groups.length > 1 ? `${spec.title} · ${group.label}` : spec.title;
        await addImage(
          title,
          `${group.label} · Yield ${md.yieldPct.toFixed(2)}%`,
          mapImage(md, title, spec),
          groups.length > 1 ? spec.title : undefined
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
          xAxis: spec.xAxis,
          groupBy: spec.groupBy,
          filter: item.filters,
        });
        const baseSubtitle = `${testLabelWithUnits(test)} · ${d.summary.n.toLocaleString("en-US")} dice · X ${spec.xAxis}${spec.groupBy !== "none" ? ` · group ${spec.groupBy}` : ""}`;
        if (spec.splitPlots && spec.groupBy !== "none") {
          const blocks = [...new Set(d.groups.map((g) => g.groupLabel).filter(Boolean))];
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
        // X axis reproduces the old grouped-column Pareto; Group by creates
        // one separate global Pareto per lot/wafer/custom group.
        const xGroup = spec.xAxis === "none" ? null : spec.xAxis;
        if (spec.groupBy !== "none") {
          const groups = dataGroups(info, item.filters, spec.groupBy);
          for (const group of groups) {
            const d = await api.pareto({
              category: spec.binCategory,
              filter: group.filter,
              top: spec.top,
              groupBy: xGroup,
            });
            if (d.total === 0) continue;
            const title = `${spec.title} · ${group.label}`;
            fig = figurePareto(d, { theme, spec, title });
            const detail =
              d.mode === "global"
                ? `${d.failTotal.toLocaleString("en-US")} failures`
                : `${d.groups.length} ${d.groupLabel} groups`;
            await addImage(
              title,
              `${group.label} · ${detail} · yield ${d.yieldPct.toFixed(2)}%`,
              await renderFigure(fig, 2400, 1500),
              spec.title
            );
          }
          continue;
        }
        const d = await api.pareto({
          category: spec.binCategory,
          filter: item.filters,
          top: spec.top,
          groupBy: xGroup,
        });
        fig = figurePareto(d, { theme, spec, title: spec.title });
        subtitle =
          d.mode === "global"
            ? `${d.failTotal.toLocaleString("en-US")} failures · ${spec.binCategory === "soft" ? "SBIN" : "HBIN"} · yield ${d.yieldPct.toFixed(2)}%`
            : `${d.groups.length} ${d.groupLabel} groups · yield ${d.yieldPct.toFixed(2)}%`;
        break;
      }
      case "hist": {
        if (spec.test === null) continue;
        const d = await api.histogram({
          test: spec.test,
          filter: item.filters,
          bins: spec.bins,
          groupBy: spec.groupBy,
        });
        const baseSubtitle = `${testLabelWithUnits(test)} · ${d.summary.n.toLocaleString("en-US")} dice`;
        if (spec.splitPlots && spec.groupBy !== "none" && d.groups.length > 1) {
          for (const g of d.groups) {
            const title = `${spec.title} · ${g.label}`;
            fig = figureHist(d, { theme, spec, title, facetLabel: g.label });
            await addImage(
              title,
              `${baseSubtitle} · ${g.label}`,
              await renderFigure(fig, 2400, 1500),
              spec.title
            );
          }
          continue;
        }
        fig = figureHist(d, { theme, spec, title: spec.title });
        subtitle = baseSubtitle;
        break;
      }
      case "trend": {
        if (spec.test === null) continue;
        const d = await api.trend({ test: spec.test, by: spec.xAxis, filter: item.filters });
        fig = figureTrend(d, { theme, spec, title: spec.title });
        subtitle = `${testLabelWithUnits(test)} · X ${spec.xAxis} · ${d.points.length} points`;
        break;
      }
      case "scatter": {
        if (spec.scatterX === null || spec.scatterY === null) continue;
        const d = await api.scatter({
          xTest: spec.scatterX,
          yTest: spec.scatterY,
          zMode: spec.scatterZMode,
          zTest: spec.scatterZTest,
          zCol: null,
          groupBy: spec.groupBy === "none" ? null : spec.groupBy,
          filter: item.filters,
        });
        const zParts: string[] = [];
        if (d.zMode === "continuous") zParts.push(`Z ${d.zColLabel}`);
        if (d.groupLabel) zParts.push(d.groupLabel);
        const z = zParts.length ? ` · ${zParts.join(" · ")}` : "";
        const r = d.r !== null && Number.isFinite(d.r) ? ` · r ${d.r.toFixed(3)}` : "";
        const baseSubtitle = `${testLabel(d.xTest)} vs ${testLabel(d.yTest)}${z} · ${d.total.toLocaleString("en-US")} dice${r}`;
        if (spec.splitPlots && spec.groupBy !== "none" && d.series.length > 1) {
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
