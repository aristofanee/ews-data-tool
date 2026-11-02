import type { DatasetInfo, ReportIssue, ReportItem, ReportReference } from "../types";
import { bindReportItem, referenceKey, referenceLabel } from "./reportReferences";

interface RememberedNode { id:string; slots:string[]; parents:string[]; rank:number; label:string; kind:string }
export interface ResolutionMemory { itemIds:string[]; nodes:RememberedNode[] }
export interface ResolutionNode extends RememberedNode {
  issue?:ReportIssue;
  items:ReportItem[];
  replacement:string;
  blocked:boolean;
  children:ResolutionNode[];
}
const slot=(id:string,field:string)=>`${id}:${field}`;
const rank=(field:string)=>field==="selection"?2:field.startsWith("wafers:")||field.startsWith("categoryFilter:")?1:field==="runtime"?3:0;
const title=(issue:ReportIssue)=>{
  const value=issue.reference?.value;
  return typeof value==="object"&&"category"in value?value.label||"Unassigned":issue.label;
};

function dependencies(item:ReportItem,ref:ReportReference):string[]{
  const refs=item.references??[];
  if(ref.field.startsWith("categoryFilter:")&&typeof ref.value==="object"&&"category"in ref.value){const category=ref.value.category;return refs.filter(r=>r.field.startsWith("filterCategory:")&&r.value===category).map(r=>slot(item.id,r.field));}
  if(ref.field==="selection")return refs.filter(r=>r.field==="groupBy"||/^(lots|wafers|categoryFilter|filterCategory):/.test(r.field)||
    r.field.startsWith(`${item.spec.groupBy==="site"?"sites":item.spec.groupBy==="hbin"?"hbins":item.spec.groupBy==="sbin"?"sbins":"_"}:`)).map(r=>slot(item.id,r.field));
  if(ref.field.startsWith("wafers:"))return refs.filter(r=>r.field.startsWith("lots:")&&
    (typeof ref.value!=="object"||!("lot"in ref.value)||r.value===ref.value.lot)).map(r=>slot(item.id,r.field));
  return [];
}

/** Preserve resolved parents while their dependent errors are still being fixed. */
export function reportResolutionTree(report:ReportItem[],info:DatasetInfo|null,previous:ResolutionMemory):{roots:ResolutionNode[];memory:ResolutionMemory}{
  const bound=report.map(r=>bindReportItem(r,info));
  const ids=report.map(r=>r.id),sameImport=ids.some(id=>previous.itemIds.includes(id));
  const history=sameImport?previous.nodes.filter(n=>n.slots.some(s=>ids.some(id=>s.startsWith(`${id}:`)))):[];
  const groups=new Map<string,{issue:ReportIssue;items:ReportItem[];slots:string[]}>();
  for(const {item,issues}of bound)for(const issue of issues){
    if(groups.has(issue.key))continue;
    const items=bound.map(b=>b.item).filter(r=>issue.reference?r.references?.some(ref=>referenceKey(ref)===issue.key):r.id===item.id);
    const slots=items.flatMap(r=>issue.reference?(r.references??[]).filter(ref=>referenceKey(ref)===issue.key).map(ref=>slot(r.id,ref.field)):[slot(r.id,"runtime")]);
    groups.set(issue.key,{issue,items,slots});
  }
  const active=new Map<string,{issue:ReportIssue;items:ReportItem[];node:RememberedNode}>();
  for(const [key,group]of groups){
    const old=history.find(n=>n.slots.some(s=>group.slots.includes(s)));
    const parents=group.items.flatMap(item=>(item.references??[]).filter(ref=>group.slots.includes(slot(item.id,ref.field))).flatMap(ref=>dependencies(item,ref)));
    const node:RememberedNode={id:old?.id??key,slots:group.slots,parents:[...new Set([...(old?.parents??[]),...parents])],rank:Math.min(...group.slots.map(s=>rank(s.slice(s.indexOf(":")+1)))),label:old?.label??title(group.issue),kind:group.issue.kind};
    active.set(node.id,{issue:group.issue,items:group.items,node});
  }
  const activeSlots=new Set([...active.values()].flatMap(g=>g.node.slots));
  const remembered=new Map(history.filter(n=>active.has(n.id)||!n.slots.some(s=>activeSlots.has(s))).map(n=>[n.id,n]));
  for(const [id,group]of active)remembered.set(id,group.node);
  const nodes=new Map<string,ResolutionNode>();
  for(const [id,node]of remembered){
    const current=active.get(id);
    const items=current?.items??bound.map(b=>b.item).filter(item=>node.slots.some(s=>s.startsWith(`${item.id}:`)));
    const replacements=items.flatMap(item=>(item.references??[]).filter(ref=>node.slots.includes(slot(item.id,ref.field))).map(referenceLabel));
    nodes.set(id,{...node,issue:current?.issue,items,replacement:[...new Set(replacements)].join(", "),blocked:false,children:[]});
  }
  const bySlot=new Map<string,ResolutionNode>();
  for(const node of nodes.values())for(const s of node.slots)bySlot.set(s,node);
  const roots:ResolutionNode[]=[];
  for(const node of nodes.values()){
    // Strictly lower ranks keep shared identities from introducing dependency cycles.
    const parents=[...new Set(node.parents.map(s=>bySlot.get(s)).filter((p):p is ResolutionNode=>!!p&&p.id!==node.id&&p.rank<node.rank))];
    const upstreamBlocked=(parent:ResolutionNode,seen=new Set<string>()):boolean=>{
      if(seen.has(parent.id))return false;seen.add(parent.id);
      return !!parent.issue||parent.parents.some(s=>{const p=bySlot.get(s);return !!p&&p.rank<parent.rank&&upstreamBlocked(p,seen);});
    };
    node.blocked=parents.some(p=>upstreamBlocked(p));
    parents.sort((a,b)=>Number(upstreamBlocked(b))-Number(upstreamBlocked(a))||b.rank-a.rank);
    if(parents[0])parents[0].children.push(node);else roots.push(node);
  }
  const prune=(node:ResolutionNode):boolean=>{node.children=node.children.filter(prune);return !!node.issue||node.children.length>0;};
  return {roots:roots.filter(prune),memory:{itemIds:ids,nodes:[...remembered.values()]}};
}
