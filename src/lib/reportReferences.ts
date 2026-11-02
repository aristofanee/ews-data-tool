import { defaultSpec, emptyFilter, type DatasetInfo, type PlotSpec, type ReportItem, type ReportReference, type ReportIssue, type TestIdentity, type WaferIdentity } from "../types";
import { testLabelWithUnits } from "./format";
import { categoryName } from "./categoryNames";

const builtins = ["lot", "wafer", "site", "hbin", "sbin"];
const types = ["box", "hist", "trend", "scatter", "pareto", "map", "binmap"];
export const referenceKey = (r: ReportReference) => JSON.stringify([r.kind, r.value]);
export const testIdentity = (t: TestIdentity): TestIdentity => ({number:t.number,name:t.name.trim(),units:t.units.trim()});
export const waferIdentity = (info: DatasetInfo, i: number): WaferIdentity => ({lot:info.lots[info.wafers[i].lot],name:info.wafers[i].name});
const unique = (indexes: number[]) => indexes.length === 1 ? indexes[0] : null;
const legacy = (index: number | null, label: string) => ({legacyIndex:index,label});
const datasetKeys=new WeakMap<DatasetInfo,string>();
const testIndexes=new WeakMap<DatasetInfo,Map<string,number[]>>();
function indexesForTests(info:DatasetInfo){
  const cached=testIndexes.get(info);if(cached)return cached;
  const index=new Map<string,number[]>();
  info.tests.forEach((test,i)=>{const key=JSON.stringify(testIdentity(test)),matches=index.get(key)??[];matches.push(i);index.set(key,matches);});
  testIndexes.set(info,index);return index;
}
function datasetKey(info:DatasetInfo):string{
  const cached=datasetKeys.get(info);if(cached)return cached;
  const text=JSON.stringify([info.files,info.tests.map(testIdentity),info.lots,info.wafers.map(w=>[w.lot,w.name])]);
  let a=2166136261,b=2246822507;
  for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b^text.charCodeAt(i),3266489909);}
  const key=`${a>>>0}:${b>>>0}:${text.length}`;datasetKeys.set(info,key);return key;
}
export function referenceLabel(r: ReportReference): string {
  if (typeof r.value !== "object") return r.kind==="category"?categoryName(String(r.value)):String(r.value);
  if ("legacyIndex" in r.value) return r.value.label;
  if ("category" in r.value) return `${categoryName(r.value.category)}: ${r.value.label}`;
  if ("lot" in r.value) return `${r.value.lot} / ${r.value.name}`;
  return `${r.value.number ?? ""} ${r.value.name}${r.value.units ? ` [${r.value.units}]` : ""}`.trim();
}
export function categoryChoices(spec: PlotSpec, field: string, info: DatasetInfo): string[] {
  if(field.startsWith("filterCategory:"))return (info.dataCategories??[]).map(c=>c.id);
  const custom=[...info.customColumns.map(c=>c.name),...(info.dataCategories??[]).map(c=>c.id)];
  if(field === "groupBy" && spec.type === "map") return ["lot","wafer",...custom];
  if(field === "groupBy" && spec.type === "pareto") return ["lot","wafer","site",...custom];
  return [...builtins,...custom];
}
export function splitChoices(info: DatasetInfo, spec: PlotSpec, filters: ReportItem["filters"]): string[] {
  const cat=spec.type==="binmap" ? "wafer" : spec.groupBy;
  const candidates=info.wafers.map((w,i)=>({w,i})).filter(({w,i})=>(!filters.lots.length||filters.lots.includes(w.lot))&&(!filters.wafers.length||filters.wafers.includes(i)));
  if(cat==="none")return ["All wafers (mean)"];
  if(cat==="wafer")return candidates.map(({i})=>{const w=waferIdentity(info,i);return `${w.lot} / ${w.name}`;});
  if(cat==="lot")return [...new Set(candidates.map(({w})=>info.lots[w.lot]))];
  if(cat==="site")return (info.sites??[]).filter(v=>!filters.sites?.length||filters.sites.includes(v)).map(v=>v===65535?"Unknown site":`Site ${v}`);
  if(cat==="hbin"||cat==="sbin")return info[cat==="hbin"?"hbins":"sbins"].filter(b=>!filters[cat==="hbin"?"hbins":"sbins"].length||filters[cat==="hbin"?"hbins":"sbins"].includes(b.code)).map(b=>`${cat.toUpperCase()} ${b.code}`);
  const row=info.dataCategories?.find(c=>c.id===cat);
  if(row)return row.values.flatMap((value,code)=>row.counts[code]>0&&(!filters.categories?.[cat]?.length||filters.categories[cat].includes(value))?[row.labels[code]]:[]);
  const col=info.customColumns.find(c=>c.name===cat);
  return col?[...new Set(candidates.map(({i})=>col.categories[col.waferValues[i]??0]||"Unassigned"))]:[];
}

/** Capture identities now; a legacy template without identities is never trusted by index. */
export function captureReferences(item: ReportItem, info: DatasetInfo | null, legacyTemplate=false): ReportReference[] {
  const refs:ReportReference[]=[],s=item.spec;
  const add=(field:string,kind:ReportReference["kind"],value:ReportReference["value"])=>refs.push({field,kind,value});
  if(!["pareto","binmap"].includes(s.type)){
    const test=info&&s.test!==null?info.tests[s.test]:null;
    add("test","test",!legacyTemplate&&test?testIdentity(test):legacy(s.test,legacyTemplate?`Legacy test ${s.test??"(missing)"} · ${s.title}`:"No test selected"));
  }
  if(s.type==="scatter")for(const field of ["scatterY",...(s.scatterZMode==="continuous"?["scatterZTest"]:[])] as const){
    const index=s[field as "scatterY"|"scatterZTest"],test=info&&index!==null?info.tests[index]:null;
    add(field,"test",!legacyTemplate&&test?testIdentity(test):legacy(index,`Missing ${field} test${index===null?"":` (${index})`}`));
  }
  for(const field of ["xAxis","groupBy"] as const){
    if(field==="xAxis"&&!["box","trend","pareto"].includes(s.type))continue;
    if(s[field]!=="none")add(field,"category",s[field]);
  }
  for(const [field,kind] of [["lots","lot"],["wafers","wafer"],["hbins","hbin"],["sbins","sbin"],["sites","site"]] as const){
    for(const [index,value]of(item.filters[field]??[]).entries()){
      const identity=kind==="lot"?!legacyTemplate&&info?.lots[value]!==undefined?info.lots[value]:legacy(value,`Legacy lot ${value}`)
        :kind==="wafer"?!legacyTemplate&&info?.wafers[value]?waferIdentity(info,value):legacy(value,`Legacy wafer ${value}`):value;
      add(`${field}:${index}`,kind,identity);
    }
  }
  for(const [category,values]of Object.entries(item.filters.categories??{})){
    if(!values.length)continue;
    add(`filterCategory:${encodeURIComponent(category)}`,"category",category);
    values.forEach((label,i)=>add(`categoryFilter:${encodeURIComponent(category)}:${i}`,"split",{category,label}));
  }
  if(item.selection){
    const category=s.type==="binmap"?"wafer":s.groupBy,label=item.selection.label;
    const wi=info?.wafers.findIndex((w,i)=>{const id=waferIdentity(info,i);return `${id.lot} / ${id.name}`===label;})??-1;
    if(category==="wafer"&&wi>=0&&!legacyTemplate)add("selection","wafer",waferIdentity(info!,wi));
    else if(category==="lot")add("selection","lot",label);
    else add("selection","split",{category,label});
  }
  return refs;
}

function resolve(r:ReportReference, info:DatasetInfo, item:ReportItem):number|string|null {
  const v=r.value;
  if(r.kind==="test"){
    if(typeof v!=="object"||!("units"in v))return null;
    if(r.explicit?.dataset===datasetKey(info)){
      const test=info.tests[r.explicit.index];
      if(test&&JSON.stringify(testIdentity(test))===JSON.stringify(testIdentity(v)))return r.explicit.index;
    }
    return unique(indexesForTests(info).get(JSON.stringify(testIdentity(v)))??[]);
  }
  if(r.kind==="wafer"){
    if(typeof v!=="object"||!("lot"in v))return null;
    return unique(info.wafers.flatMap((w,i)=>info.lots[w.lot]===v.lot&&w.name===v.name?[i]:[]));
  }
  if(r.kind==="lot")return typeof v==="string"?unique(info.lots.flatMap((l,i)=>l===v?[i]:[])):null;
  if(r.kind==="category")return typeof v==="string"&&categoryChoices(item.spec,r.field,info).includes(v)?v:null;
  if(r.kind==="split"){
    if(typeof v!=="object"||!("category"in v))return null;
    if(r.field.startsWith("categoryFilter:")){const c=info.dataCategories?.find(c=>c.id===v.category),i=c?.values.indexOf(v.label)??-1;return c&&i>=0&&c.counts[i]>0?v.label:null;}
    return v.category===(item.spec.type==="binmap"?"wafer":item.spec.groupBy)&&splitChoices(info,item.spec,item.filters).includes(v.label)?v.label:null;
  }
  if(typeof v!=="number")return null;
  return (r.kind==="site"?(info.sites??[]):info[r.kind==="hbin"?"hbins":"sbins"].map(b=>b.code)).includes(v)?v:null;
}

export function bindReportItem(source: ReportItem, info: DatasetInfo | null): { item:ReportItem; issues:ReportIssue[] } {
  const item=structuredClone(source),refs=item.references??captureReferences(item,info);item.references=refs;
  const issues:ReportIssue[]=[],pending:ReportReference[]=[];
  // Clear positional filters before rebuilding them; unresolved entries are never queried.
  for(const field of ["lots","wafers","hbins","sbins","sites"] as const)item.filters[field]=[];
  item.filters.categories={};
  const fail=(r:ReportReference)=>{if(!issues.some(i=>i.key===referenceKey(r)))issues.push({key:referenceKey(r),kind:r.kind,label:referenceLabel(r),reference:r});};
  for(const r of refs){
    if(r.field==="selection"){pending.push(r);continue;}
    const target=info?resolve(r,info,item):null;
    if(target===null){fail(r);if(r.kind==="test")(item.spec as any)[r.field]=null;continue;}
    if(r.field.startsWith("filterCategory:"))continue;
    if(r.field.startsWith("categoryFilter:")&&typeof r.value==="object"&&"category"in r.value){(item.filters.categories[r.value.category]??=[]).push(String(target));}
    else if(r.field.includes(":")){const field=r.field.split(":")[0] as "lots"|"wafers"|"hbins"|"sbins"|"sites";item.filters[field]!.push(Number(target));}
    else (item.spec as any)[r.field]=target;
  }
  if(item.spec.type==="scatter")item.spec.scatterX=item.spec.test;
  for(const r of pending){
    const target=info?resolve(r,info,item):null;
    let label:string|null=null;
    if(target!==null&&info){
      if(r.kind==="wafer"){const w=waferIdentity(info,Number(target));label=`${w.lot} / ${w.name}`;}
      else if(r.kind==="lot")label=info.lots[Number(target)];
      else label=String(target);
    }
    if(label===null||!info||!splitChoices(info,item.spec,item.filters).includes(label)){fail(r);continue;}
    item.selection={label,...(r.kind==="wafer"?{wafer:Number(target)}:{})};
  }
  if(item.runtimeError)issues.push({key:`runtime:${item.id}`,kind:"render",label:item.runtimeError});
  return {item,issues};
}

export function resolutionOptions(r:ReportReference, item:ReportItem, info:DatasetInfo):{value:string;label:string}[]{
  if(r.kind==="split"){
    if(r.field.startsWith("categoryFilter:")&&typeof r.value==="object"&&"category"in r.value){const category=r.value.category;const c=info.dataCategories?.find(c=>c.id===category);return c?c.values.flatMap((value,i)=>c.counts[i]>0?[{value:JSON.stringify(value),label:c.labels[i]}]:[]):[];}
    return splitChoices(info,item.spec,item.filters).map(label=>({value:label,label}));
  }
  if(r.kind==="test"){
    const indexes=indexesForTests(info);
    return info.tests.map((t,i)=>({value:String(i),label:testLabelWithUnits(t)+((indexes.get(JSON.stringify(testIdentity(t)))?.length??0)>1?` · entry ${i+1}`:"")}));
  }
  if(r.kind==="category")return categoryChoices(item.spec,r.field,info).map(value=>({value,label:categoryName(value)}));
  if(r.kind==="lot")return info.lots.map((label,i)=>({value:String(i),label})).filter(o=>r.field!=="selection"||splitChoices(info,item.spec,item.filters).includes(o.label));
  if(r.kind==="wafer")return info.wafers.map((_,i)=>{const w=waferIdentity(info,i);return {value:String(i),label:`${w.lot} / ${w.name}`};}).filter(o=>(!item.filters.lots.length||item.filters.lots.includes(info.wafers[Number(o.value)].lot))&&(r.field!=="selection"||splitChoices(info,item.spec,item.filters).includes(o.label)));
  if(r.kind==="site")return (info.sites??[]).map(code=>({value:String(code),label:code===65535?"Unknown site":String(code)}));
  return info[r.kind==="hbin"?"hbins":"sbins"].map(b=>({value:String(b.code),label:`${b.code}${b.name?` · ${b.name}`:""}`}));
}

/** Map one missing identity in every item that uses it, preserving independent settings. */
export function remapReference(items:ReportItem[],key:string,target:string,info:DatasetInfo):ReportItem[]{
  return items.map(original=>{
    const item=structuredClone(original);let changed=false;
    for(const r of item.references??[]){
      if(referenceKey(r)!==key)continue;
      const old=r.value;changed=true;
      if(r.kind==="split"){
        if(r.field.startsWith("categoryFilter:")&&typeof r.value==="object"&&"category"in r.value){r.value={...r.value,label:JSON.parse(target)};continue;}
        const category=item.spec.type==="binmap"?"wafer":item.spec.groupBy;
        if(category==="wafer"){
          const i=info.wafers.findIndex((w,i)=>{const id=waferIdentity(info,i);return `${id.lot} / ${id.name}`===target;});
          if(i<0)throw new Error("Choose a current wafer.");r.kind="wafer";r.value=waferIdentity(info,i);
        }else if(category==="lot"){r.kind="lot";r.value=target;}
        else {r.kind="split";r.value={category,label:target};}
      }else if(r.kind==="test"){
        r.value=testIdentity(info.tests[Number(target)]);
        r.explicit={dataset:datasetKey(info),index:Number(target)};
      }
      else if(r.kind==="wafer")r.value=waferIdentity(info,Number(target));
      else if(r.kind==="lot")r.value=info.lots[Number(target)];
      else if(r.kind==="category"){
        r.value=target;
        for(const other of item.references??[])if(other.kind==="split"&&typeof other.value==="object"&&"category"in other.value&&other.value.category===old)other.value.category=target;
      }else r.value=Number(target);
    }
    if(changed)item.runtimeError=undefined;
    return bindReportItem(item,info).item;
  });
}

/** Parse before any template labels or application state can be changed. */
export function validateTemplate(value:unknown):asserts value is import("../store").TemplateFile {
  const t=value as any;
  if(!t||t.app!=="EWS Data Tool"||![1,2].includes(t.version)||!Array.isArray(t.plots))throw new Error("This is not a supported EWS report template.");
  const filter=(f:any)=>f&&["lots","wafers","hbins","sbins"].every(k=>Array.isArray(f[k])&&f[k].every((v:any)=>Number.isInteger(v)&&v>=0))&&(!f.sites||Array.isArray(f.sites)&&f.sites.every((v:any)=>Number.isInteger(v)&&v>=0))&&(!f.categories||typeof f.categories==="object"&&!Array.isArray(f.categories)&&Object.values(f.categories).every(v=>Array.isArray(v)&&v.every(s=>typeof s==="string")))&&(!f.stat||["sigma","iqr"].includes(f.stat.kind)&&Number.isFinite(f.stat.k)&&f.stat.k>0&&typeof f.stat.perWafer==="boolean");
  if(t.filters&&!filter(t.filters))throw new Error("Invalid template filters.");
  for(const p of t.plots){
    if(!p?.spec||!types.includes(p.spec.type)||typeof p.spec.title!=="string"||p.filters&&!filter(p.filters))throw new Error("Invalid report item in template.");
    for(const field of ["test","scatterX","scatterY","scatterZTest"])if(p.spec[field]!=null&&(!Number.isInteger(p.spec[field])||p.spec[field]<0))throw new Error("Invalid test reference in template.");
    for(const field of ["xAxis","groupBy","title"])if(p.spec[field]!==undefined&&typeof p.spec[field]!=="string")throw new Error("Invalid plot category or title.");
    for(const field of ["logY","showLimits","splitPlots","showNormal","showBand","scatterFit"])if(p.spec[field]!==undefined&&typeof p.spec[field]!=="boolean")throw new Error("Invalid plot option.");
    for(const field of ["lsl","usl","yMin","yMax","limitK","top","bins","edgeExclusion"])if(p.spec[field]!=null&&!Number.isFinite(p.spec[field]))throw new Error("Invalid numeric plot option.");
    if(p.spec.limitMode!==undefined&&!["auto","manual","spec","sigma","iqr"].includes(p.spec.limitMode))throw new Error("Invalid limit mode.");
    if(p.spec.binCategory!==undefined&&!["hard","soft"].includes(p.spec.binCategory))throw new Error("Invalid bin category.");
    if(p.selection&&typeof p.selection.label!=="string")throw new Error("Invalid selected split in template.");
    if(p.references!==undefined&&(!Array.isArray(p.references)||p.references.some((r:any)=>!r||typeof r.field!=="string"||!["test","category","lot","wafer","split","hbin","sbin","site"].includes(r.kind)||r.value==null)))throw new Error("Invalid template identities.");
    if(p.references){
      const fields=new Set();
      for(const r of p.references){
        if(r.explicit&&(!Number.isInteger(r.explicit.index)||r.explicit.index<0||typeof r.explicit.dataset!=="string"))throw new Error("Invalid explicit test match.");
        if(fields.has(r.field))throw new Error("Duplicate template reference.");fields.add(r.field);
        const kind = r.field==="selection"?["wafer","lot","split"]
          :["test","scatterY","scatterZTest"].includes(r.field)?["test"]
          :["xAxis","groupBy"].includes(r.field)||r.field.startsWith("filterCategory:")?["category"]
          :r.field.startsWith("categoryFilter:")?["split"]
          :/^lots:\d+$/.test(r.field)?["lot"]:/^wafers:\d+$/.test(r.field)?["wafer"]:/^hbins:\d+$/.test(r.field)?["hbin"]:/^sbins:\d+$/.test(r.field)?["sbin"]:/^sites:\d+$/.test(r.field)?["site"]:[];
        if(!kind.includes(r.kind))throw new Error("Invalid reference field.");
        const v=r.value;
        const old=typeof v==="object"&&v&&"legacyIndex"in v&&(v.legacyIndex===null||Number.isInteger(v.legacyIndex)&&v.legacyIndex>=0)&&typeof v.label==="string";
        const valid=r.kind==="test"?old||v&&typeof v==="object"&&(v.number===null||Number.isFinite(v.number))&&typeof v.name==="string"&&typeof v.units==="string"
          :r.kind==="wafer"?old||v&&typeof v==="object"&&typeof v.lot==="string"&&typeof v.name==="string"
          :r.kind==="lot"?old||typeof v==="string"
          :r.kind==="category"?typeof v==="string"
          :r.kind==="split"?v&&typeof v==="object"&&typeof v.category==="string"&&typeof v.label==="string"
          :Number.isInteger(v)&&v>=0;
        if(!valid)throw new Error("Malformed template identity.");
      }
      const spec={...defaultSpec(p.spec.type,null,""),...p.spec};
      const required=captureReferences({id:"validate",spec,filters:p.filters??t.filters??emptyFilter(),selection:p.selection},null,true);
      if(required.some(r=>!fields.has(r.field)))throw new Error("Template identities are incomplete.");
    }
  }
  if(t.waferIdentities!==undefined&&(!Array.isArray(t.waferIdentities)||t.waferIdentities.some((w:any)=>!w||typeof w.lot!=="string"||typeof w.name!=="string")))throw new Error("Invalid template wafer identities.");
  if(t.customColumns!==undefined&&(!Array.isArray(t.customColumns)||t.customColumns.some((c:any)=>!c||typeof c.name!=="string"||!c.name.trim()||builtins.includes(c.name.toLowerCase())||!Array.isArray(c.categories)||!c.categories.every((v:any)=>typeof v==="string")||!Array.isArray(c.waferValues)||!c.waferValues.every((v:any)=>Number.isInteger(v)&&v>=0&&v<c.categories.length))))throw new Error("Invalid custom labels in template.");
  if(t.customColumns&&new Set(t.customColumns.map((c:any)=>c.name)).size!==t.customColumns.length)throw new Error("Duplicate custom columns in template.");
}

export function templatePlots(items:ReportItem[],info:DatasetInfo|null){
  // Explicit choices between indistinguishable tests are valid for this import;
  // the next import must resolve that ambiguity again rather than trust an index.
  return items.map(item=>({spec:{...item.spec,lsl:null,usl:null},filters:item.filters,selection:item.selection,references:(item.references??captureReferences(item,info)).map(({explicit,...ref})=>ref)}));
}
