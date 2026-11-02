import { useMemo, useState } from "react";
import { ReportResolver } from "./ReportResolver";
import { bindReportItem } from "../lib/reportReferences";
import { reportItemDescription } from "../lib/reportDescription";
import { PLOT_LABELS, useStore } from "../store";
import type { ReportItem } from "../types";
import * as api from "../lib/api";
import { generateReport } from "../lib/report";
import { tidyName } from "../lib/format";
import { useLoadTemplate, useSaveTemplate } from "../lib/useData";
import {
  IconAlert,
  IconBox,
  IconChevronDown,
  IconChevronUp,
  IconHist,
  IconLayers,
  IconMap,
  IconOpen,
  IconPareto,
  IconReport,
  IconSave,
  IconScatter,
  IconTrash,
  IconTrend,
  IconX,
} from "./Icons";

function iconFor(type: ReportItem["spec"]["type"]) {
  const p = { size: 15 };
  switch (type) {
    case "box":
      return <IconBox {...p} />;
    case "map":
      return <IconMap {...p} />;
    case "binmap":
      return <IconMap {...p} />;
    case "pareto":
      return <IconPareto {...p} />;
    case "hist":
      return <IconHist {...p} />;
    case "trend":
      return <IconTrend {...p} />;
    case "scatter":
      return <IconScatter {...p} />;
  }
}

export function ReportDrawer() {
  const open = useStore((s) => s.reportOpen);
  const setOpen = useStore((s) => s.setReportOpen);
  const report = useStore((s) => s.report);
  const info = useStore((s) => s.info);
  const spec = useStore((s) => s.spec);
  const filters = useStore((s) => s.filters);
  const theme = useStore((s) => s.theme);
  const templateName = useStore((s) => s.templateName);
  const setTemplateName = useStore((s) => s.setTemplateName);
  const addReportItems = useStore((s) => s.addReportItems);
  const removeReport = useStore((s) => s.removeReport);
  const moveReport = useStore((s) => s.moveReport);
  const clearReport = useStore((s) => s.clearReport);
  const setBusy = useStore((s) => s.setBusy);
  const setProgress = useStore((s) => s.setProgress);
  const setError = useStore((s) => s.setError);
  const notify = useStore((s) => s.notify);
  const saveTemplate = useSaveTemplate();
  const loadTemplate = useLoadTemplate();

  const [resolving,setResolving]=useState(false);
  const bound=useMemo(()=>report.map(item=>bindReportItem(item,info)),[report,info]);
  const failed=bound.filter(b=>b.issues.length).length;
  const ready=report.length-failed;
  const editing=useStore(s=>s.editingReportId);
  const [generating,setGenerating]=useState(false);

  if (!open) return null;

  const addAllTests = () => {
    if (!info) return;
    if (spec.type !== "box" && spec.type !== "hist" && spec.type !== "trend") {
      notify("Switch to a box plot, histogram or trend first.");
      return;
    }
    const tests = info.tests.map((t, i) => ({ t, i })).filter(({ t }) => t.count > 0);
    if (tests.length > 20 && !window.confirm(`Add ${tests.length} plots (one per test) to the report?`)) return;
    addReportItems(
      tests.map(({ t, i }) => ({
        spec: { ...spec, test: i, title: `${tidyName(t.name)} · ${PLOT_LABELS[spec.type]}` },
        filters,
      }))
    );
  };

  const editItem = (it: ReportItem) => {
    if(bindReportItem(it,info).issues.length){setResolving(true);return;}
    useStore.getState().activateReport(it.id);
  };

  const generate = async () => {
    if (!info) return;
    if (!report.length) {
      notify("Add at least one plot to the report.");
      return;
    }
    if(generating)return;
    setGenerating(true);
    try {
      const dest=await api.pickFolder();
      if(!dest)return;
      setBusy(true, 0, "Preparing report…");
      const res = await generateReport({
        items: report,
        info,
        theme,
        folder: dest,
        templateName: templateName || "EWS report",
        onProgress: (pct, msg) => setProgress(pct, msg),
        onItemError:(id,error)=>useStore.getState().setReportItemError(id,error),
      });
      notify(res.indexHtml?`Report ready · ${res.files.length} JPGs${res.skipped.length?` · ${res.skipped.length} items skipped`:""}`:"No images exported. Resolve the report errors first.");
    } catch (e) {
      setError(`Report generation failed. ${String(e)}`);
    } finally {setBusy(false);setGenerating(false);}
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={() => setOpen(false)} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <div className="drawer-title">
              <IconReport size={17} /> Report builder
            </div>
            <div className="drawer-sub">
              {report.length} plot{report.length === 1 ? "" : "s"} ·{" "}
              {templateName ? <b>{templateName}</b> : "untitled template"}
            </div>
          </div>
          <button className="btn icon ghost" onClick={() => setOpen(false)} title="Close">
            <IconX size={16} />
          </button>
        </div>

        <div className="drawer-tools">
          <div className="template-row">
            <input
              className="input"
              placeholder="Report / template name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
            <button className="btn icon" onClick={saveTemplate} title="Save template">
              <IconSave size={15} />
            </button>
            <button className="btn icon" onClick={loadTemplate} title="Load template">
              <IconOpen size={15} />
            </button>
          </div>
          <div className="batch-row">
            {editing&&report.some(r=>r.id===editing)&&<button className="btn" onClick={()=>useStore.getState().updateReportItem(editing)}>Update loaded item</button>}
            {(spec.type === "box" || spec.type === "hist" || spec.type === "trend") && (
              <button className="btn" onClick={addAllTests} title="One plot per test">
                <IconLayers size={14} /> All tests
              </button>
            )}
          </div>
        </div>

        <div className="report-validation-summary">
          <span>{ready} ready · {failed} with errors</span>
          <button className="link-btn" onClick={()=>setResolving(!resolving)}>{resolving?"Show items":`Resolve errors${failed?` (${failed})`:""}`}</button>
        </div>
        {resolving?<ReportResolver onBack={()=>setResolving(false)}/>:<div className="report-list">
          {report.length === 0 && (
            <div className="report-empty">
              <div className="report-empty-icon">
                <IconReport size={26} />
              </div>
              <b>No plots yet</b>
            </div>
          )}
          {bound.map(({item:it,issues}, i) => {
            const description=info?reportItemDescription(it,info):{title:it.spec.title,subtitle:""};
            return (
            <div className={`report-item${issues.length?" invalid":""}`} key={it.id} data-report-id={it.id}>
              <button className="ri-main" onClick={() => editItem(it)} title={issues.length?"Resolve this report item":"Load this plot into the viewer"}>
                <span className="ri-icon">{issues.length?<IconAlert size={16}/>:iconFor(it.spec.type)}</span>
                <span className="ri-text">
                  <span className="ri-title" title={description.title}>{description.title}</span>
                  <span className="ri-sub" title={description.subtitle}>{description.subtitle}</span>
                  {issues.length>0&&<span className="ri-error">{issues.map(issue=>`${issue.kind}: ${issue.label}`).join(" · ")}</span>}
                </span>
              </button>
              <div className="ri-actions">
                <button
                  className="mini"
                  onClick={() => moveReport(it.id, -1)}
                  disabled={i === 0}
                  title="Move up"
                >
                  <IconChevronUp size={12} />
                </button>
                <button
                  className="mini"
                  onClick={() => moveReport(it.id, 1)}
                  disabled={i === report.length - 1}
                  title="Move down"
                >
                  <IconChevronDown size={12} />
                </button>
                <button className="mini danger" onClick={() => removeReport(it.id)} title="Remove">
                  <IconTrash size={12} />
                </button>
              </div>
            </div>
          );})}
        </div>}

        <div className="drawer-foot">
          <div className="foot-actions">
            <button className="link-btn" onClick={clearReport} disabled={!report.length}>
              Clear
            </button>
            <button className="btn primary wide" onClick={generate} disabled={!ready||generating}>
              <IconReport size={15} /> Generate report ({ready} ready)
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
