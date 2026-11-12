import { useRestorePlotSelection } from "../lib/usePlotMemory";
import { useEffect, useMemo, useRef, useState, useCallback, type ComponentType } from "react";
import { PLOT_LABELS, useStore } from "../store";
import type { PlotSpec, PlotType, PlotSelection } from "../types";
import type { PlotData, PlotDataState } from "../lib/usePlotData";
import {
  figureBox,
  figureHist,
  figurePareto,
  figureScatter,
  figureTrend,
  type Figure,
} from "../charts/figures";
import { PlotlyChart } from "./PlotlyChart";
import { PlotPreviewGrid } from "./PlotPreviewGrid";
import { usePlotSelection, usePlotViewKey } from "../lib/usePlotMemory";
import { statsFor } from "../lib/plotStats";
import { DetailStats } from "./DetailStats";
import { WaferMapView, type MapExportApi } from "./WaferMapView";
import { BinMapView, type BinMapExportApi } from "./BinMapView";
import { MapFacetView, type MapFacetExportApi } from "./MapFacetView";
import { ParetoFacetView, type ParetoFacetExportApi } from "./ParetoFacetView";
import { EmptyState } from "./EmptyState";
import { renderExportFigure, splitImageName, IMAGE_WIDTH, imageHeight } from "../charts/imageExport";
import { describeFilters } from "../lib/customFilters";
import type { Theme } from "../lib/theme";
import * as api from "../lib/api";
import { paintExportProgress, type ImageExportJob } from "../lib/exportJobs";
import { safeName } from "../lib/format";
import {
  IconArrowLeft,
  IconBox,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconHist,
  IconImage,
  IconMap,
  IconPareto,
  IconPlus,
  IconRefresh,
  IconScatter,
  IconTrend,
} from "./Icons";

const TABS: { type: PlotType; label: string; Icon: ComponentType<{ size?: number }> }[] = [
  { type: "box", label: "Box plot", Icon: IconBox },
  { type: "map", label: "Wafer map", Icon: IconMap },
  { type: "hist", label: "Histogram", Icon: IconHist },
  { type: "scatter", label: "Scatter", Icon: IconScatter },
  { type: "trend", label: "Trend", Icon: IconTrend },
  { type: "binmap", label: "Bin map", Icon: IconMap },
  { type: "pareto", label: "Pareto", Icon: IconPareto },
];

interface Facet {
  key?: number;
  label: string;
}

function useBoxRangeCount(spec: PlotSpec, figure: Figure | null, facet?: Facet) {
  const filter = useStore(s => s.filters);
  const dataVersion = useStore(s => s.dataVersion);
  const axis = figure?.layout.yaxis;
  const test = spec.type === "box" ? spec.test : null;
  const [lo, hi] = axis?.range ?? [];
  const lsl = axis?.type === "log" ? 10 ** lo : lo;
  const usl = axis?.type === "log" ? 10 ** hi : hi;
  const label = facet?.label;
  const groupBy = label === undefined ? undefined : spec.groupBy;
  const request = useMemo(() => test !== null && Number.isFinite(lsl) && Number.isFinite(usl)
    ? { test, filter, groupBy, lsl, usl } : null, [test, filter, groupBy, lsl, usl, dataVersion]);
  const [result, setResult] = useState<{ request: api.LimitCountsRequest; label?: string; count?: number }>();

  useEffect(() => {
    if (!request) return;
    let active = true;
    void api.limitCounts(request).then(counts => {
      const count = label === undefined ? counts.inLimits : counts.groups.find(group => group.label === label)?.inLimits;
      if (active) setResult({ request, label, count: count ?? undefined });
    }).catch(() => {});
    return () => { active = false; };
  }, [request, label]);
  return result?.request === request && result.label === label ? result.count : undefined;
}

function dataMatchesSpec(data: PlotData | null, spec: PlotSpec): boolean {
  return !!data && data.kind === spec.type;
}

function facetsFor(data: PlotData, spec: PlotSpec): Facet[] {
  if (!spec.splitPlots || spec.groupBy === "none") return [];
  if (data.kind === "box") {
    return [...new Set(data.data.groups.map((g) => g.groupLabel).filter(Boolean))].map(
      (label) => ({ label })
    );
  }
  if (data.kind === "trend") {
    return [...new Set(data.data.points.map((p) => p.groupLabel).filter(Boolean))].map((label) => ({ label }));
  }
  if (data.kind === "hist") {
    return data.data.groups.map((g) => ({ key: g.key, label: g.label }));
  }
  if (
    data.kind === "scatter" &&
    data.data.series.length > 1 &&
    (data.data.groupLabel !== "" || data.data.zMode === "category")
  ) {
    return data.data.series.map((s) => ({ key: s.key, label: s.name }));
  }
  return [];
}

function buildFigure(
  data: PlotData,
  spec: PlotSpec,
  theme: Theme,
  title?: string,
  facet?: Facet,
  preview = false
): Figure | null {
  switch (data.kind) {
    case "box":
      return figureBox(data.data, {
        theme,
        spec,
        title,
        facetLabel: facet?.label,
        preview,
      });
    case "pareto":
      return figurePareto(data.data, {
        theme,
        spec,
        title,
        facetKey: facet?.key,
        preview,
      });
    case "hist":
      return figureHist(data.data, {
        theme,
        spec,
        title,
        facetLabel: facet?.label,
        preview,
      });
    case "trend":
      return figureTrend(data.data, { theme, spec, title, facetLabel: facet?.label, preview });
    case "scatter":
      return figureScatter(data.data, {
        theme,
        spec,
        title,
        facetKey: facet?.key,
        preview,
      });
    default:
      return null;
  }
}

/**
 * Split views can contain dozens of facets. Building and mounting every
 * Plotly chart up front made the scatter split feel frozen, so facets are
 * created only when they approach the visible part of the scroll area.
 */
function LazyFacetChart({
  data,
  spec,
  theme,
  facet,
  preview = false,
  onOpen,
}: {
  data: PlotData;
  spec: PlotSpec;
  theme: Theme;
  facet: Facet;
  preview?: boolean;
  onOpen?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const root = el.closest(".facet-grid");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: root instanceof Element ? root : null, rootMargin: "320px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The facet label is already shown above the plot; do not repeat the title
  // inside the plot area.
  const figure = useMemo(
    () => (visible ? buildFigure(data, spec, theme, undefined, facet, preview) : null),
    [visible, data, spec, theme, facet, preview]
  );

  return (
    <div
      className={"facet-card" + (preview ? " preview" : "")}
      onClick={onOpen}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="facet-label">{facet.label}</div>
      <div className="facet-chart-body" ref={wrapRef}>
        {!figure && (
          <div className="facet-loading">
            <div className="spinner" />
            <span>Preparing…</span>
          </div>
        )}
        {figure && <PlotlyChart figure={figure} hostRef={plotRef} staticPlot={preview} />}
        {preview && onOpen && (
          <button
            className="facet-open"
            aria-label={`Open ${facet.label}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Mosaic of split-plot previews; clicking one opens the enlarged chart. */
function SplitPlotView({
  data,
  spec,
  theme,
  facets,
  onSelection,
}: {
  data: PlotData;
  spec: PlotSpec;
  theme: Theme;
  facets: Facet[];
  onSelection: (selection: PlotSelection | null) => void;
}) {
  const viewKey = usePlotViewKey(spec);
  const rangeRevision = useStore(s => s.rangeRevisions[spec.type] ?? 0);
  // Axis edits reset the zoom, while keeping the currently opened group.
  const selectionKey = usePlotViewKey({...spec,limitMode:"auto",limitK:3,yMin:null,yMax:null,lsl:null,usl:null,logY:false});
  const [selected, setSelected] = usePlotSelection(`split:${spec.type}`, selectionKey);
  useRestorePlotSelection(facets.map(f=>f.label),setSelected);
  const facet = selected !== null ? facets[selected] : undefined;
  useEffect(()=>{onSelection(facet??null);},[facet,onSelection]);
  useEffect(()=>()=>onSelection(null),[onSelection]);
  const detail = useMemo(
    () =>
      data && facet
        ? buildFigure(data, spec, theme, undefined, facet, false)
        : null,
    [data, spec, theme, facet]
  );
  const inLimits = useBoxRangeCount(spec, detail, facet);

  useEffect(() => {
    if (selected !== null && selected >= facets.length) setSelected(null);
  }, [facets.length, selected]);

  useEffect(() => {
    if (selected === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (target?.isContentEditable || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelected((i) => (i === null ? null : Math.max(0, i - 1)));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSelected((i) => (i === null ? null : Math.min(facets.length - 1, i + 1)));
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, facets.length]);

  if (facet && selected !== null) {
    return (
      <div className="facet-detail">
        <div className="facet-detail-head">
          <button className="btn map-detail-back" onClick={() => setSelected(null)} title="Back to all plots">
            <IconArrowLeft size={14} />
            All plots
          </button>
          <div className="facet-detail-title">{facet.label}</div>
          <DetailStats stats={statsFor(data, spec, facet, detail?.sampledMarkers, inLimits)} />
          <div className="map-detail-nav">
            <button
              className="btn icon"
              onClick={() => setSelected(Math.max(0, selected - 1))}
              disabled={selected <= 0}
              title="Previous plot (left arrow)"
            >
              <IconChevronLeft size={16} />
            </button>
            <span className="map-detail-count">
              {selected + 1} / {facets.length}
            </span>
            <button
              className="btn icon"
              onClick={() => setSelected(Math.min(facets.length - 1, selected + 1))}
              disabled={selected >= facets.length - 1}
              title="Next plot (right arrow)"
            >
              <IconChevronRight size={16} />
            </button>
          </div>
        </div>
        <div className="facet-detail-body">
          {detail ? (
            <PlotlyChart key={facet.key ?? facet.label} figure={detail} cacheKey={`${viewKey}:${rangeRevision}:${facet.key ?? facet.label}`} />
          ) : (
            <div className="chart-placeholder">
              <div className="spinner" />
              <span>Preparing plot…</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <PlotPreviewGrid>
      {facets.map((f, i) => (
        <LazyFacetChart
          key={f.key ?? f.label}
          data={data}
          spec={spec}
          theme={theme}
          facet={f}
          preview
          onOpen={() => setSelected(i)}
        />
      ))}
    </PlotPreviewGrid>
  );
}

export function ChartPanel({ data, loading, error }: PlotDataState) {
  const info = useStore((s) => s.info);
  const spec = useStore((s) => s.spec);
  const viewKey = usePlotViewKey(spec);
  const rangeRevision = useStore(s => s.rangeRevisions[spec.type] ?? 0);
  const theme = useStore((s) => s.theme);
  const filters = useStore((s) => s.filters);
  const setPlotType = useStore((s) => s.setPlotType);
  const patchSpec = useStore((s) => s.patchSpec);
  const addReport = useStore((s) => s.addReport);
  const selectedReportId = useStore(s => s.report.find(item => item.id === s.editingReportId)?.id);
  const updateReportItem = useStore(s => s.updateReportItem);
  const notify = useStore((s) => s.notify);
  const setError = useStore((s) => s.setError);

  const plotRef = useRef<HTMLDivElement>(null);
  const [selectionState,setSelectionState]=useState<{key:string;selection:PlotSelection|null}>({key:"",selection:null});
  const onSelection=useCallback((selection:PlotSelection|null)=>{setSelectionState({key:viewKey,selection});useStore.setState({plotSelection:selection});},[viewKey]);
  const opened=selectionState.key===viewKey?selectionState.selection:null;
  const exportingRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  const exportRevision = JSON.stringify([viewKey, spec, opened]);
  const revisionRef = useRef(exportRevision); revisionRef.current = exportRevision;
  const mapApi = useRef<MapExportApi | null>(null);
  const mapFacetApi = useRef<MapFacetExportApi | null>(null);
  const paretoFacetApi = useRef<ParetoFacetExportApi | null>(null);
  const binMapApi = useRef<BinMapExportApi | null>(null);
  const [titleDraft, setTitleDraft] = useState(spec.title);

  useEffect(() => setTitleDraft(spec.title), [spec.title]);

  // While a new plot type is loading, usePlotData still exposes the previous
  // response. Never render that stale kind: switching away from a wafer map
  // used to flash the old map for a frame.
  const currentData = dataMatchesSpec(data, spec) ? data : null;
  const facets = useMemo<Facet[]>(
    () => (currentData ? facetsFor(currentData, spec) : []),
    [currentData, spec]
  );
  const splitActive = facets.length > 0;
  const paretoSplitActive = spec.type === "pareto" && spec.groupBy !== "none";
  // Do not build the hidden full-size figure while a split view is active.
  // With tens of thousands of scatter points that construction is pure waste.
  const figure = useMemo<Figure | null>(
    () =>
      currentData && !splitActive && !paretoSplitActive
        ? buildFigure(currentData, spec, theme)
        : null,
    [currentData, spec, theme, splitActive, paretoSplitActive]
  );
  const mapSpec = useMemo(() => ({ ...spec, mapMode: "value" as const }), [spec]);
  const inLimits = useBoxRangeCount(spec, figure);

  useEffect(()=>{
    if(!useStore.getState().requestedPlotSelection||loading||!currentData)return;
    if(!["binmap"].includes(spec.type)&&!(spec.type==="map"&&spec.groupBy!=="none")&&!(spec.type==="pareto"&&spec.groupBy!=="none")&&!facets.length)
      useStore.setState({requestedPlotSelection:null,plotSelection:null});
  },[currentData,loading,spec,facets]);
  const stats = useMemo(() => {
    if (!currentData || opened) return [];
    const sampledMarkers = currentData.kind === "box" && spec.showPoints === "all" &&
      (figure?.sampledMarkers ?? currentData.data.groups.some(g => g.values.length < g.n));
    return statsFor(currentData, spec, undefined, sampledMarkers, inLimits);
  }, [currentData, spec, opened, figure, inLimits]);
  if (!info) return <EmptyState />;
  const isMap = spec.type === "map";
  const isBinMap = spec.type === "binmap";
  const mapSplitActive = isMap && spec.groupBy !== "none";
  const inGrid=(mapSplitActive||paretoSplitActive||splitActive||isBinMap)&&!opened;
  const canCopy=!inGrid||isBinMap;
  const makeJobs=(single:boolean):ImageExportJob[]=>{
    if(mapSplitActive)return mapFacetApi.current?.jobs("light",single)??[];
    if(paretoSplitActive)return (paretoFacetApi.current?.figures("light",single)??[]).map(image=>({label:image.label,render:format=>renderImage(image.figure,format)}));
    if(isBinMap)return binMapApi.current?.jobs("light",single)??[];
    if(isMap)return [{label:"",render:async format=>{const url=await mapApi.current?.toDataURL(format,"light",IMAGE_WIDTH,imageHeight("map"));if(!url)throw new Error("The map is not ready.");return url;}}];
    if(!currentData)return [];
    const entries: (Facet|undefined)[]=splitActive?(single?[opened??undefined]:facets):[undefined];
    return entries.map(facet=>({label:facet?.label??"",render:async format=>{
      const fig=buildFigure(currentData,spec,"light",facet?`${spec.title} · ${facet.label}`:spec.title,facet);
      if(!fig)throw new Error("The plot is not ready.");return renderImage(fig,format);
    }}));
  };

  const commitTitle = () => {
    const t = titleDraft.trim();
    if (t && t !== spec.title) patchSpec({ title: t });
    else setTitleDraft(spec.title);
  };

  const renderImage = (fig: Figure, format: "png" | "jpeg") =>
    renderExportFigure({ ...fig, exportFilter: filters, exportSubtitle: describeFilters(filters, info, spec.type !== "pareto") }, format);
  const assertUnchanged = () => {
    if (revisionRef.current !== exportRevision) throw new Error("The plot changed during export. Start the export again.");
  };
  const exportReady = () => {
    if (exportingRef.current || loading || error) return false;
    if (mapSplitActive) return mapFacetApi.current?.isReady() ?? false;
    if (paretoSplitActive) return paretoFacetApi.current?.isReady() ?? false;
    return !!currentData;
  };
  const copyImage = async () => {
    if(!canCopy)return;
    if (!exportReady()) { notify("Wait for the plot to finish loading."); return; }
    exportingRef.current=true;setExporting(true);
    try {
      await paintExportProgress();await document.fonts.ready;
      let url:string|null=null;
      if(isBinMap)url=binMapApi.current?.toDataURL("png","light")??null;
      else {const job=makeJobs(true)[0];if(job)url=await job.render("png");}
      if(!url)throw new Error("The chart is not ready yet.");
      assertUnchanged();

      if (api.isTauri) {
        // WebView2 blocks navigator.clipboard.write for images; use the native
        // clipboard plugin instead.
        const [{ Image }, { writeImage }] = await Promise.all([
          import("@tauri-apps/api/image"),
          import("@tauri-apps/plugin-clipboard-manager"),
        ]);
        const blob = await (await fetch(url)).blob();
        const image = await Image.fromBytes(new Uint8Array(await blob.arrayBuffer()));
        try {
          await writeImage(image);
        } finally {
          await image.close();
        }
        notify("Image copied to the clipboard.");
        return;
      }

      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        throw new Error("This system does not allow images on the clipboard.");
      }
      const blob = await (await fetch(url)).blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      notify("Image copied to the clipboard.");
    } catch (e) {
      setError(`Could not copy the image. ${String(e)}`);
    } finally { exportingRef.current = false; setExporting(false); }
  };

  const saveJpg=async()=>{
    if(!exportReady()){notify("Wait for the plot to finish loading.");return;}
    exportingRef.current=true;setExporting(true);
    const batch=inGrid;
    try{
      // Open the picker immediately. No chart construction/encoding precedes it.
      const name=opened?splitImageName(spec.title,opened.label,0,safeName,isBinMap?"wafer":spec.groupBy):`${safeName(spec.title||"plot")}.jpg`;
      const target=await (batch?api.pickFolder():api.pickSavePath(name,["jpg","jpeg"]));
      if(!target)return;
      assertUnchanged();
      const jobs=makeJobs(!batch);
      if(!jobs.length)throw new Error("The plots are not ready yet.");
      if(batch)useStore.getState().setBusy(true,0,`Saving ${jobs.length} images…`);
      for(const [index,job]of jobs.entries()){
        assertUnchanged();if(batch)useStore.getState().setProgress(index/jobs.length*100,`Rendering ${index+1} of ${jobs.length}: ${job.label||"plot"}…`);
        await paintExportProgress();await document.fonts.ready;
        const url=await job.render("jpeg");
        assertUnchanged();if(batch)useStore.getState().setProgress(index/jobs.length*100,`Saving ${index+1} of ${jobs.length}: ${job.label||"plot"}…`);
        const group=job.label==="Overview"?undefined:isBinMap?"wafer":spec.groupBy;
        const file=batch?splitImageName(spec.title,job.label,index,safeName,group):"";
        const path=batch?`${target.replace(/[\\/]+$/,"")}\\${file}`:target;
        await api.saveImage(path,url);
        if(batch)useStore.getState().setProgress((index+1)/jobs.length*100,`Saved ${index+1} of ${jobs.length}`);
      }
      notify(batch?`Saved ${jobs.length} images to ${api.fileName(target)}.`:`Saved ${api.fileName(target)}`);
    }catch(error){setError(`Could not save the images. ${String(error)}`);}
    finally{exportingRef.current=false;setExporting(false);if(batch)useStore.getState().setBusy(false);}
  };

  return (
    <>
      <div className="tabs">
        {TABS.map(({ type, label, Icon }) => (
          <button
            key={type}
            className={"tab" + (spec.type === type ? " active" : "")}
            onClick={() => setPlotType(type)}
            title={`${label} (Ctrl+${TABS.findIndex((t) => t.type === type) + 1})`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
        <div className="tabs-spacer" />
        {selectedReportId && (
          <button className="btn" onClick={() => updateReportItem(selectedReportId, opened)}
            disabled={loading || exporting || !!error} title="Save the current plot to the selected report item">
            <IconRefresh size={15} /> Update report item
          </button>
        )}
        <button className="btn" onClick={()=>addReport(opened??undefined)} disabled={loading||exporting||!!error} title={opened?"Add the opened plot to the report":"Add this plot to the report"}>
          <IconPlus size={15} /> Add to report
        </button>
      </div>

      <div className="chart-card">
        <div className="chart-head">
          <div className="chart-head-top">
            <input
              className="chart-title"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setTitleDraft(spec.title);
                  e.currentTarget.blur();
                }
              }}
              spellCheck={false}
              aria-label="Plot title"
            />
            <div className="chart-actions">
              <button className="btn icon" onClick={copyImage} disabled={!canCopy || loading || exporting || !!error} title="Copy image to clipboard">
                <IconCopy size={16} />
              </button>
              <button className="btn icon" onClick={saveJpg} disabled={loading || exporting || !!error} title="Save as JPG">
                <IconImage size={16} />
              </button>
            </div>
          </div>
          <div className="stats">
            <div className="stats-values">
              {stats.map((s) => (
                <div className="stat" key={s.k} title={s.title}>
                  <span className="stat-k">{s.k}</span>
                  <span className={"stat-v" + (s.tone ? ` tone-${s.tone}` : "")}>{s.v}</span>
                </div>
              ))}
            </div>
            <span className="plot-kind">{PLOT_LABELS[spec.type]}</span>
          </div>
        </div>

        <div className="chart-body">
          {error ? (
            <div className="chart-error">
              <div className="chart-error-title">Could not build this plot</div>
              <div className="chart-error-msg">{error}</div>
            </div>
          ) : mapSplitActive ? (
            <MapFacetView
              spec={spec}
              filter={filters}
              onReady={(apiRef) => (mapFacetApi.current = apiRef)}
              onSelection={onSelection}
            />
          ) : paretoSplitActive ? (
            <ParetoFacetView
              spec={spec}
              filter={filters}
              onReady={(apiRef) => (paretoFacetApi.current = apiRef)}
              onSelection={onSelection}
            />
          ) : currentData?.kind === "map" ? (
            <WaferMapView
              data={currentData.data}
              spec={mapSpec}
              onReady={(apiRef) => (mapApi.current = apiRef)}
            />
          ) : currentData?.kind === "binmap" ? (
            <BinMapView
              data={currentData.data}
              spec={spec}
              onReady={(apiRef) => (binMapApi.current = apiRef)}
              onSelection={onSelection}
            />
          ) : splitActive && currentData ? (
            <SplitPlotView data={currentData} spec={spec} theme={theme} facets={facets} onSelection={onSelection} />
          ) : figure || (!spec.splitPlots && ["box", "hist", "scatter", "trend", "pareto"].includes(spec.type)) ? (
            <>
              <PlotlyChart key={spec.type} figure={figure} hostRef={plotRef} cacheKey={`${viewKey}:${rangeRevision}`} />
              {!figure && <div className="chart-placeholder" style={{ position: "absolute", inset: 0 }}><div className="spinner" /><span>Preparing plot…</span></div>}
            </>
          ) : (
            <div className="chart-placeholder">
              <div className="spinner" />
              <span>Preparing plot…</span>
            </div>
          )}
          {loading && currentData && <div className="chart-busy" />}
        </div>
      </div>
    </>
  );
}
