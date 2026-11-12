import type { DatasetInfo, ReportItem, TestInfo } from "../types";
import { scatterLimitsFor } from "../types";
import { categoryName, exportPlotTitle } from "../charts/imageExport";
import { fmt, testLabelWithUnits } from "./format";
import { referenceLabel } from "./reportReferences";
import { describeCustomFilter } from "./customFilters";

type DescribedTest=Pick<TestInfo,"number"|"name"|"units"> & Partial<Pick<TestInfo,"loSpec"|"hiSpec">>;
function testFor(item:ReportItem,info:DatasetInfo,field:"test"|"scatterY"|"scatterZTest"):DescribedTest|null{
  const index=item.spec[field];
  if(index!==null&&info.tests[index])return info.tests[index];
  const value=item.references?.find(r=>r.field===field)?.value;
  return typeof value==="object"&&"units"in value?value:null;
}
const shortList=(values:string[])=>values.slice(0,4).join(", ")+(values.length>4?` (+${values.length-4} more)`:"");

export function reportItemDescription(item:ReportItem,info:DatasetInfo):{title:string;subtitle:string}{
  const s=item.spec,f=item.filters;
  const main=testFor(item,info,"test"),test=s.type==="scatter"?testFor(item,info,"scatterY"):main;
  const x=s.type==="scatter"?testLabelWithUnits(main):s.type==="hist"?"Count":["map","binmap"].includes(s.type)?"WaferID":categoryName(s.xAxis);
  const details=[exportPlotTitle(s,test,x,item.selection?.label)];
  if(s.groupBy!=="none"&&!item.selection&&s.type!=="binmap")details.push(`Group by ${categoryName(s.groupBy)}`);
  if(s.splitPlots&&s.groupBy!=="none"&&!item.selection&&!["map","binmap","pareto"].includes(s.type))details.push("Separate plots");
  if(s.type==="scatter"&&s.scatterZMode==="continuous")details.push(`Z: ${testLabelWithUnits(testFor(item,info,"scatterZTest"))}`);
  if(s.logY)details.push("Log Y");
  if(s.type==="box")details.push(({all:"All points",outliers:"Outliers",none:"No points"})[s.showPoints]);
  if(s.type==="hist")details.push(s.bins===null?"Auto bins":`${s.bins} bins`);
  if(s.type==="pareto")details.push(`Top ${s.top} bins`);
  const filters:string[]=[];
  const referenced=(field:string)=>item.references?.filter(r=>r.field.startsWith(`${field}:`)).map(referenceLabel)??[];
  const lots=referenced("lots"),wafers=referenced("wafers");
  if(!lots.length)lots.push(...f.lots.map(i=>info.lots[i]??`Missing lot ${i}`));
  if(!wafers.length)wafers.push(...f.wafers.map(i=>{const w=info.wafers[i];return w?`${info.lots[w.lot]} / ${w.name}`:`Missing wafer ${i}`;}));
  if(lots.length)filters.push(`Lot: ${shortList(lots)}`);
  if(wafers.length)filters.push(`WaferID: ${shortList(wafers)}`);
  for(const [field,name]of[["hbins","HBIN"],["sbins","SBIN"],["sites","Site"]]as const){const values=referenced(field);if(!values.length)values.push(...(f[field]??[]).map(String));if(values.length)filters.push(`${name}: ${shortList(values.map(v=>v==="65535"?"Unknown":v))}`);}
  const categoryFilters:Record<string,string[]>={...f.categories};
  for(const ref of item.references??[])if(ref.field.startsWith("categoryFilter:")&&typeof ref.value==="object"&&"category"in ref.value){const v=ref.value;categoryFilters[v.category]=[...new Set([...(categoryFilters[v.category]??[]),v.label])];}
  for(const [id,values]of Object.entries(categoryFilters))if(values.length)filters.push(`${categoryName(id)}: ${shortList(values.map(v=>v||"Unassigned"))}`);
  if(f.stat)filters.push(`Filter: ${f.stat.kind==="sigma"?`±${f.stat.k}σ`:`${f.stat.k} IQR`} (${f.stat.perWafer?"per wafer":"pooled"})`);
  for (const [index, rule] of (f.custom ?? []).entries()) {
    const { title, detail } = describeCustomFilter(rule, info);
    const ref = rule.kind === "numeric" ? item.references?.find(r => r.field === `customTest:${index}`) : undefined;
    filters.push(`${ref ? referenceLabel(ref) : title} ${detail}`);
  }
  if(!filters.length)filters.push("All data");
  if(!["pareto","binmap"].includes(s.type)){
    const axes = s.type === "scatter"
      ? (["x", "y", ...(s.scatterZMode === "continuous" ? ["z" as const] : [])] as const)
        .map(axis => ({ label: `${axis.toUpperCase()} range`, limits: scatterLimitsFor(s, axis) }))
      : [{ label: "Range", limits: s }];
    for (const { label, limits } of axes) {
      if (limits.limitMode === "auto") continue;
      const range = limits.limitMode === "manual" ? `Custom (${limits.yMin === null ? "Auto" : fmt(limits.yMin)} to ${limits.yMax === null ? "Auto" : fmt(limits.yMax)})`
        : limits.limitMode === "sigma" ? `Mean ±${limits.limitK}σ` : limits.limitMode === "iqr" ? `Q1/Q3 ±${limits.limitK} IQR` : "USL/LSL";
      filters.push(`${label}: ${range}`);
    }
  }
  return {title:details.join(" · "),subtitle:filters.join(" · ")};
}
