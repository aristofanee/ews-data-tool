import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import type { DatasetInfo } from "../types";
import { resolutionOptions, referenceKey } from "../lib/reportReferences";
import { reportResolutionTree, type ResolutionMemory, type ResolutionNode } from "../lib/reportResolution";
import { IconAlert } from "./Icons";

function ResolutionCard({node,info}:{node:ResolutionNode;info:DatasetInfo}){
  const [target,setTarget]=useState("");
  const {issue,items,blocked}=node;
  const resolve=useStore(s=>s.resolveReportReference),remove=useStore(s=>s.removeReportReference),setError=useStore(s=>s.setError);
  const candidates=useMemo(()=>{
    if(!issue?.reference||blocked)return [];
    const sets=items.map(item=>{
      const ref=item.references?.find(r=>referenceKey(r)===issue.key);
      return new Set(ref?resolutionOptions(ref,item,info).map(o=>o.value):[]);
    });
    return resolutionOptions(issue.reference,items[0],info).filter(o=>sets.every(set=>set.has(o.value)));
  },[issue,items,info,blocked]);
  return <section className={`report-resolution${issue?"":" resolved"}${blocked?" blocked":""}`} data-issue-kind={node.kind} data-blocked={blocked}>
    <div className="report-resolution-title">
      {issue?<IconAlert size={16}/>:<span aria-label="Resolved">✓</span>}
      <strong>{node.label}</strong>
      {!issue&&node.replacement!==node.label&&<span className="report-resolution-replacement">→ {node.replacement}</span>}
    </div>
    {issue&&<div className="muted">Used by {items.length} report item{items.length===1?"":"s"}</div>}
    {issue?.reference&&!blocked&&<>
      <select className="input" aria-label={`Replacement for ${issue.label}`} value={target} onChange={e=>setTarget(e.target.value)}>
        <option value="">Choose a replacement…</option>
        {candidates.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      <button className="btn" disabled={!target||!candidates.some(c=>c.value===target)} onClick={()=>{try{resolve(issue.key,target);}catch(error){setError(String(error));}}}>Apply to {items.length} item{items.length===1?"":"s"}</button>
    </>}
    {issue&&!issue.reference&&!blocked&&<button className="btn" onClick={()=>items.forEach(item=>useStore.getState().setReportItemError(item.id))}>Retry on next export</button>}
    {issue&&<button className="link-btn danger-text" onClick={()=>remove(issue.key)}>Remove all {items.length} affected item{items.length===1?"":"s"}</button>}
    {node.children.length>0&&<div className="report-resolution-children">{node.children.map(child=><ResolutionCard key={child.id} node={child} info={info}/>)}</div>}
  </section>;
}

export function ReportResolver({onBack}:{onBack:()=>void}){
  const report=useStore(s=>s.report),info=useStore(s=>s.info);
  const [memory,setMemory]=useState<ResolutionMemory>({itemIds:[],nodes:[]});
  const snapshot=useMemo(()=>reportResolutionTree(report,info,memory),[report,info,memory]);
  // Record relationships only when report/data changes, not on the memory render.
  useEffect(()=>{setMemory(snapshot.memory);},[report,info]);
  return <div className="report-resolver">
    <button className="btn" onClick={onBack}>← Report items</button>
    {!snapshot.roots.length&&<p role="status">All report references are resolved.</p>}
    {info&&snapshot.roots.map(node=><ResolutionCard key={node.id} node={node} info={info}/>)}
    {!info&&<p>Import data to resolve this template.</p>}
  </div>;
}
