import { binYieldText } from "./theme";
import type { DatasetInfo, MapResponse, ReportItem } from "../types";
import type { Theme } from "./theme";
import * as api from "./api";
import { renderExportFigure, imageScope, IMAGE_WIDTH, BIN_OVERVIEW_WIDTH, imageHeight } from "../charts/imageExport";
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
  mapExportFooter,
  type MapOptions,
} from "../charts/waferMap";
import { safeName, testLabel, testLabelWithUnits } from "./format";
import { dataGroups } from "./grouping";
import { bindReportItem, splitChoices, templatePlots } from "./reportReferences";
import { paintExportProgress } from "./exportJobs";

export interface ReportResult {
  files: string[];
  indexHtml: string;
  folder: string;
  skipped: {id:string;title:string;reason:string}[];
}

function join(dir: string, file: string): string {
  return dir.replace(/[\\/]+$/, "") + "\\" + file;
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
          grid-template-columns: repeat(auto-fill, minmax(min(540px, 100%), 1fr)); }
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
  <div class="meta">Selected scope: ${esc(meta.lots)} · ${meta.wafers} wafer${meta.wafers===1?"":"s"} · generated ${esc(meta.generated)}</div>
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
  onItemError?: (id:string,error:string)=>void;
}): Promise<ReportResult> {
  await document.fonts.ready;
  const { templateName, onProgress }=opts;
  const items=structuredClone(opts.items),info=structuredClone(opts.info);
  const skipped:ReportResult["skipped"]=[];
  const valid:ReportItem[]=[];
  for(const source of items){
    const {item,issues}=bindReportItem(source,info);
    if(issues.length){skipped.push({id:item.id,title:item.spec.title,reason:issues.map(i=>`${i.kind}: ${i.label}`).join("; ")});continue;}
    valid.push(item);
  }
  if(!valid.length)return {files:[],indexHtml:"",folder:opts.folder,skipped};
  const run=`${safeName(templateName||"EWS report").slice(0,80)}_${new Date().toISOString().replace(/[:.]/g,"-")}_${crypto.randomUUID().slice(0,8)}`;
  const folder=await api.createReportFolder(opts.folder,run);
  await api.saveText(join(folder,"report-status.json"),JSON.stringify({status:"incomplete",created:new Date().toISOString()},null,2));
  class WriteError extends Error {}
  const scope=new Set<number>();
  const scopeFor=(item:ReportItem)=>info.wafers.flatMap((w,i)=>{
    const f=item.filters;
    if(f.wafers.length&&!f.wafers.includes(i)||f.lots.length&&!f.lots.includes(w.lot))return [];
    if(item.selection){
      const cat=item.spec.type==="binmap"?"wafer":item.spec.groupBy,label=item.selection.label;
      if(cat==="wafer"&&`${info.lots[w.lot]} / ${w.name}`!==label)return [];
      if(cat==="lot"&&info.lots[w.lot]!==label)return [];
      const col=info.customColumns.find(c=>c.name===cat);
      if(col&&(col.categories[col.waferValues[i]??0]||"Unassigned")!==label)return [];
    }
    return [i];
  });
  // Reports are pasted into PowerPoint and viewed on a white page. Force the
  // light chart theme so a dark in-app theme never produces dark slides.
  const theme: Theme = "light";
  const entries: { file: string; title: string; subtitle: string; cluster?: string }[] = [];
  const files: string[] = [];
  // Metadata gives a lightweight upper bound; queries refine it as empty groups
  // are discovered, without buffering every report's measurement arrays.
  const expected=valid.map(item=>{
    const s=item.spec;if(item.selection)return 1;
    if(s.type==="binmap")return Math.max(1,new Set(scopeFor(item).map(i=>info.wafers[i].lot)).size);
    if(["map","pareto"].includes(s.type))return s.groupBy==="none"?1:Math.max(1,dataGroups(info,item.filters,s.groupBy).length);
    return s.splitPlots&&s.groupBy!=="none"?Math.max(1,splitChoices(info,s,item.filters).length):1;
  });
  let workDone=0,currentItem=0;
  const totalImages=()=>Math.max(1,expected.reduce((n,count)=>n+count,0));
  const imageProgress=(message:string)=>onProgress(workDone/totalImages()*94,message);
  const expectImages=(count:number)=>{expected[currentItem]=count;};
  const beginImage=async(title:string)=>{
    imageProgress(`Rendering JPG ${workDone+1} of ${totalImages()} · ${title}`);
    await paintExportProgress();
  };
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
    if (!dataUrl) throw new Error("The image renderer returned no image.");
    imageNo++;
    const file = `${String(imageNo).padStart(2, "0")}_${safeName(title)}.jpg`;
    imageProgress(`Saving JPG ${workDone+1} of ${totalImages()} · ${title}`);
    await paintExportProgress();
    try { await api.saveImage(join(folder, file), dataUrl); } catch(error) { throw new WriteError(String(error)); }
    files.push(file);
    entries.push({ file, title, subtitle, cluster });
    workDone++;
    imageProgress(`Saved JPG ${workDone} of ${totalImages()}`);
  };

  const mapImage = async (md: MapResponse, title: string, spec: ReportItem["spec"], filters: ReportItem["filters"],groupLabel?:string): Promise<string> => {
    await beginImage(title);
    const limits = mapColorLimits(spec, md);
    const mapOpts: MapOptions = {
      exportSpec: spec, exportGroupLabel: spec.groupBy !== "none" ? groupLabel : undefined,
      exportNotes: [imageScope(info, filters)],
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
      ` · Yield ${binYieldText(md.yieldPct, md.dice, 2, md.unknownBins)}`;
    const footer=await mapExportFooter(md,mapOpts,filters);
    return renderMapImage(md, {...mapOpts,exportFooter:footer}, IMAGE_WIDTH, imageHeight("map"), title, subtitle, "jpeg");
  };

  for (let i = 0; i < valid.length; i++) {
    const item = valid[i];
    currentItem=i;
    const beforeWork=workDone;
    const before=entries.length;
    let itemFailed=false;
    try {
    const spec = item.spec;
    const renderFigure = async(fig: Figure) => {
      await beginImage(fig.exportStyle?.facetLabel?`${spec.title} · ${fig.exportStyle.facetLabel}`:spec.title);
      return renderExportFigure({ ...fig, exportFilter: item.filters }, "jpeg");
    };
    imageProgress(`Preparing JPG ${workDone+1} of ${totalImages()} · ${spec.title}`);
    await paintExportProgress();
    const test = spec.test !== null ? info.tests[spec.test] : null;

    if(item.selection){
      const selected=item.selection, title=`[${selected.label}] ${spec.title}`;
      let image:string|undefined, figure:Figure|undefined;
      if(spec.type==="map"){
        const group=dataGroups(info,item.filters,spec.groupBy).find(g=>g.label===selected.label);
        if(!group)throw new Error(`Map group “${selected.label}” is not present in this dataset.`);
        const md=await api.waferMap({wafer:group.wafer,test:spec.test,mode:"value",filter:group.filter,lsl:spec.lsl,usl:spec.usl});
        image=await mapImage(md,`${spec.title} · ${group.label}`,spec,group.filter,group.label);
      }else if(spec.type==="binmap"){
        const d=await api.binOverview({filter:item.filters,category:spec.binCategory});
        const w=d.wafers.find(w=>`${w.lotName} / ${w.wafer.name}`===selected.label);
        if(!w)throw new Error(`Wafer “${selected.label}” is not present in this dataset.`);
        const md:MapResponse={wafer:w.wafer,lotName:w.lotName,dice:w.dice,test:null,lsl:null,usl:null,vmin:NaN,vmax:NaN,
          pass:w.pass,fail:w.fail,yieldPct:w.yieldPct,isMean:false,waferCount:1,excluded:0};
        await beginImage(title);
        image=renderMapImage(md,{theme,palette:spec.palette,mode:"bin",lsl:null,usl:null,binNames:binNamesFor(spec.binCategory),binCategory:spec.binCategory,
          exportSpec:{...spec,groupBy:"wafer"},exportGroupLabel:selected.label},IMAGE_WIDTH,imageHeight("binmap"),title,"","jpeg");
      }else if(spec.type==="pareto"){
        const group=dataGroups(info,item.filters,spec.groupBy).find(g=>g.label===selected.label);
        if(!group)throw new Error(`Pareto group “${selected.label}” is not present in this dataset.`);
        const d=await api.pareto({category:spec.binCategory,filter:group.wafer!==null?{...group.filter,wafers:[group.wafer]}:group.filter,top:spec.top,groupBy:spec.xAxis==="none"?null:spec.xAxis});
        figure=figurePareto(d,{theme,spec,title,facetLabel:selected.label});
      }else if(spec.type==="scatter"){
        if(spec.scatterX===null||spec.scatterY===null)throw new Error("Select both scatter tests.");
        const d=await api.scatter({xTest:spec.scatterX,yTest:spec.scatterY,zMode:spec.scatterZMode,zTest:spec.scatterZTest,groupBy:spec.groupBy,filter:item.filters});
        const series=d.series.find(s=>s.name===selected.label);
        if(!series)throw new Error(`Scatter group “${selected.label}” is not present in this dataset.`);
        figure=figureScatter(d,{theme,spec,title,facetKey:series.key});
      }else{
        if(spec.test===null)throw new Error("Select a test.");
        if(spec.type==="box"){
          const d=await api.boxPlot({test:spec.test,xAxis:spec.xAxis,groupBy:spec.groupBy,filter:item.filters});
          if(!d.groups.some(g=>g.groupLabel===selected.label))throw new Error(`Missing group “${selected.label}”.`);
          if(!d.summary.n)throw new Error("No measurements for this report item.");
          figure=figureBox(d,{theme,spec,title,facetLabel:selected.label});
        }else if(spec.type==="hist"){
          const d=await api.histogram({test:spec.test,bins:spec.bins,groupBy:spec.groupBy,filter:item.filters});
          if(!d.groups.some(g=>g.label===selected.label))throw new Error(`Missing group “${selected.label}”.`);
          figure=figureHist(d,{theme,spec,title,facetLabel:selected.label});
        }else if(spec.type==="trend"){
          const d=await api.trend({test:spec.test,by:spec.xAxis,groupBy:spec.groupBy,filter:item.filters});
          if(!d.points.some(p=>p.groupLabel===selected.label))throw new Error(`Missing group “${selected.label}”.`);
          figure=figureTrend(d,{theme,spec,title,facetLabel:selected.label});
        }
      }
      if(!image&&figure)image=await renderFigure(figure);
      if(!image)throw new Error("The selected plot could not be rendered.");
      await addImage(title,selected.label,image);
      continue;
    }

    if (spec.type === "binmap") {
      const d = await api.binOverview({ filter: item.filters, category: spec.binCategory });
      const base: MapOptions = {
        exportSpec: spec,
        exportNotes: [imageScope(info, item.filters)],
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
      const lots = [...new Set(d.wafers.map(w=>w.lotName))];
      expectImages(lots.length);
      for (const lot of lots) {
        const wafers=d.wafers.filter(w=>w.lotName===lot);
        const title=`${spec.title} · Lot ${lot}`;
        await beginImage(title);
        await addImage(title, `${lot} · ${wafers.length} wafers`,
          renderBinOverviewImage(wafers, base, BIN_OVERVIEW_WIDTH, Math.round(BIN_OVERVIEW_WIDTH*9/16), title, "", "jpeg"),
          lots.length>1 ? spec.title : undefined);
      }
      continue;
    }

    if (spec.type === "map") {
      const groups=dataGroups(info,item.filters,spec.groupBy||"none");
      expectImages(groups.length);
      for (const group of groups) {
        const md = await api.waferMap({
          lsl: spec.lsl,
          usl: spec.usl,
          wafer: group.wafer,
          test: spec.test,
          mode: "value",
          filter: group.filter,
        });
        if (md.dice.length === 0) {expected[currentItem]--;continue;}
        const title = groups.length > 1 ? `${spec.title} · ${group.label}` : spec.title;
        await addImage(
          title,
          `${group.label} · Yield ${binYieldText(md.yieldPct, md.dice, 2, md.unknownBins)}`,
          await mapImage(md, title, spec, group.filter,group.label),
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
        if (spec.test === null) throw new Error("No test selected.");
        const d = await api.boxPlot({
          test: spec.test,
          xAxis: spec.xAxis,
          groupBy: spec.groupBy,
          filter: item.filters,
        });
        if(!d.summary.n)throw new Error("No measurements for this report item.");
        const baseSubtitle = `${testLabelWithUnits(test)} · ${d.summary.n.toLocaleString("en-US")} dice · X ${spec.xAxis}${spec.groupBy !== "none" ? ` · group ${spec.groupBy}` : ""}`;
        if (spec.splitPlots && spec.groupBy !== "none") {
          const blocks = [...new Set(d.groups.map((g) => g.groupLabel).filter(Boolean))];
          expectImages(blocks.length);
          for (const block of blocks) {
            const title = `${spec.title} · ${block}`;
            fig = figureBox(d, { theme, spec, title, facetLabel: block });
            await addImage(
              title,
              `${baseSubtitle} · ${block}`,
              await renderFigure(fig),
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
          expectImages(groups.length);
          for (const group of groups) {
            const d = await api.pareto({
              category: spec.binCategory,
              filter: group.wafer!==null ? {...group.filter,wafers:[group.wafer]} : group.filter,
              top: spec.top,
              groupBy: xGroup,
            });
            if (d.total === 0) {expected[currentItem]--;continue;}
            const title = `${spec.title} · ${group.label}`;
            fig = figurePareto(d, { theme, spec, title, facetLabel: group.label });
            const detail =
              d.mode === "global"
                ? `${d.failTotal.toLocaleString("en-US")} failures`
                : `${d.groups.length} ${d.groupLabel} groups`;
            await addImage(
              title,
              `${group.label} · ${detail} · yield ${d.unknownTotal ? "N/A (unknown bins)" : d.yieldPct.toFixed(2) + "%"}`,
              await renderFigure(fig),
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
        if(!d.total)throw new Error("No tested dice for this report item.");
        fig = figurePareto(d, { theme, spec, title: spec.title });
        subtitle =
          d.mode === "global"
            ? `${d.failTotal.toLocaleString("en-US")} failures · ${spec.binCategory === "soft" ? "SBIN" : "HBIN"} · yield ${d.unknownTotal ? "N/A (unknown bins)" : d.yieldPct.toFixed(2) + "%"}`
            : `${d.groups.length} ${d.groupLabel} groups · yield ${d.unknownTotal ? "N/A (unknown bins)" : d.yieldPct.toFixed(2) + "%"}`;
        break;
      }
      case "hist": {
        if (spec.test === null) throw new Error("No test selected.");
        const d = await api.histogram({
          test: spec.test,
          filter: item.filters,
          bins: spec.bins,
          groupBy: spec.groupBy,
        });
        if(!d.summary.n)throw new Error("No measurements for this report item.");
        const baseSubtitle = `${testLabelWithUnits(test)} · ${d.summary.n.toLocaleString("en-US")} dice`;
        expectImages(spec.splitPlots&&spec.groupBy!=="none"&&d.groups.length>1?d.groups.length:1);
        if (spec.splitPlots && spec.groupBy !== "none" && d.groups.length > 1) {
          for (const g of d.groups) {
            const title = `${spec.title} · ${g.label}`;
            fig = figureHist(d, { theme, spec, title, facetLabel: g.label });
            await addImage(
              title,
              `${baseSubtitle} · ${g.label}`,
              await renderFigure(fig),
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
        if (spec.test === null) throw new Error("No test selected.");
        const d = await api.trend({ test: spec.test, by: spec.xAxis, groupBy: spec.groupBy, filter: item.filters });
        if(!d.points.length)throw new Error("No measurements for this report item.");
        expectImages(spec.splitPlots&&spec.groupBy!=="none"?new Set(d.points.map(p=>p.groupLabel).filter(Boolean)).size:1);
        if (spec.splitPlots && spec.groupBy !== "none") {
          for (const block of [...new Set(d.points.map((p) => p.groupLabel).filter(Boolean))]) {
            const title = `${spec.title} · ${block}`;
            fig = figureTrend(d, { theme, spec, title, facetLabel: block });
            await addImage(title, `${testLabelWithUnits(test)} · ${block}`,
              await renderFigure(fig), spec.title);
          }
          continue;
        }
        fig = figureTrend(d, { theme, spec, title: spec.title });
        subtitle = `${testLabelWithUnits(test)} · X ${spec.xAxis} · ${d.points.length} points`;
        break;
      }
      case "scatter": {
        if (spec.scatterX === null || spec.scatterY === null) throw new Error("Select both scatter tests.");
        const d = await api.scatter({
          xTest: spec.scatterX,
          yTest: spec.scatterY,
          zMode: spec.scatterZMode,
          zTest: spec.scatterZTest,
          zCol: null,
          groupBy: spec.groupBy === "none" ? null : spec.groupBy,
          filter: item.filters,
        });
        if(!d.total)throw new Error("No paired measurements for this report item.");
        expectImages(spec.splitPlots&&spec.groupBy!=="none"&&d.series.length>1?d.series.length:1);
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
              await renderFigure(fig),
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
        await renderFigure(fig),
        cluster
      );
    }
    } catch(error) {
      itemFailed=true;
      if(error instanceof WriteError)throw error;
      const partial=entries.splice(before);
      if(partial.length){
        try {await api.removeReportImages(folder,partial.map(e=>e.file));} catch(cleanupError) {throw new WriteError(String(cleanupError));}
        files.splice(before);
      }
      const reason=error instanceof Error?error.message:String(error);
      skipped.push({id:item.id,title:item.spec.title,reason});opts.onItemError?.(item.id,reason);
    } finally {
      expectImages(workDone-beforeWork);
      if(!itemFailed&&entries.length>before)scopeFor(item).forEach(i=>scope.add(i));
      if(!itemFailed&&entries.length===before&&!skipped.some(s=>s.id===item.id)){
        const reason="No data for the selected test, split and filters.";
        skipped.push({id:item.id,title:item.spec.title,reason});opts.onItemError?.(item.id,reason);
      }
    }
  }

  onProgress(95, "Writing report index…");
  const selectedLots=[...new Set([...scope].map(i=>info.lots[info.wafers[i].lot]))];
  const lotsLabel=selectedLots.join(", ")||"No plotted population";
  const html=buildIndex(entries,{template:templateName||"EWS report",lots:lotsLabel,wafers:scope.size,generated:new Date().toLocaleString()});
  const template={app:"EWS Data Tool",version:2,name:templateName||"EWS report",created:new Date().toISOString(),
    filters:valid[0]?.filters,plots:templatePlots(items,info)};
  await api.saveText(join(folder,"report.json"),JSON.stringify(template,null,2));
  await api.saveText(join(folder,"index.html"),html);
  await api.saveText(join(folder,"report-status.json"),JSON.stringify({status:"complete",images:files,skipped,selectedScope:{lots:selectedLots,wafers:scope.size}},null,2));

  onProgress(100, "Report complete");
  return { files, indexHtml: join(folder, "index.html"), folder, skipped };
}
