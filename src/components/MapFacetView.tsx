import { useRestorePlotSelection } from "../lib/usePlotMemory";
import { IMAGE_WIDTH, imageHeight } from "../charts/imageExport";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Filter, MapResponse, PlotSpec, PlotSelection } from "../types";
import * as api from "../lib/api";
import { useStore } from "../store";
import type { Theme } from "../lib/theme";
import {
  mapColorLimits,
  renderMapImage,
  mapExportFooter,
  type MapOptions,
} from "../charts/waferMap";
import { dataGroups, type DataGroup } from "../lib/grouping";
import { WaferMapView } from "./WaferMapView";
import { MapGallery, useMapSelection } from "./MapGallery";
import { MapDetailView } from "./MapDetailView";
import type { ImageExportJob } from "../lib/exportJobs";
import { mapGeneration } from "../lib/mapCache";

export interface MapFacetExportApi {
  isReady: () => boolean;
  jobs: (theme?: Theme, selectedOnly?: boolean) => ImageExportJob[];
  toDataURLs: (
    format?: "jpeg" | "png",
    theme?: Theme,
    width?: number,
    height?: number,
    selectedOnly?: boolean
  ) => Promise<{ label: string; url: string }[]>;
}

interface Props {
  spec: PlotSpec;
  filter: Filter;
  onReady?: (api: MapFacetExportApi | null) => void;
  onSelection?: (selection: PlotSelection | null) => void;
}

interface Entry {
  md: MapResponse;
  label: string;
}

/**
 * One value map per selected group. A single group renders as a full map;
 * several groups render as a mosaic of clickable previews. The previews are
 * static (no legend, hover or zoom) so the grid scrolls normally.
 */
export function MapFacetView({ spec, filter, onReady, onSelection }: Props) {
  const info = useStore((s) => s.info);
  const theme = useStore((s) => s.theme);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dataVersion = useStore((s) => s.dataVersion);
  const requestKey = JSON.stringify([mapGeneration(), dataVersion, filter, spec.test, spec.groupBy, spec.lsl, spec.usl]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [selected, setSelected] = useMapSelection("value", [dataVersion, filter, spec.test, spec.groupBy, spec.lsl, spec.usl]);

  useRestorePlotSelection(entries.map(e=>e.label),setSelected,!loading&&loadedKey===requestKey);
  const groups = useMemo<DataGroup[]>(
    () => (info ? dataGroups(info, filter, spec.groupBy || "none") : []),
    [info, filter, spec.groupBy]
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const out: Entry[] = [];
        const batch = spec.groupBy === "wafer" ? await api.waferMaps({
          wafer: null, test: spec.test, mode: "value", filter, lsl: spec.lsl, usl: spec.usl,
        }) : null;
        for (const group of groups) {
          if (!alive) return;
          const md = batch?.find((m) => m.wafer?.name === info?.wafers[group.wafer!]?.name && m.wafer?.lot === info?.wafers[group.wafer!]?.lot) ?? await api.waferMap({
            lsl: spec.lsl,
            usl: spec.usl,
            wafer: group.wafer,
            test: spec.test,
            mode: "value",
            filter: group.filter,
          });
          if (md.dice.length === 0) continue;
          out.push({ md, label: group.label });
        }
        if (alive) {
          setEntries(out);
          setLoadedKey(requestKey);
          setLoading(false);
        }
      } catch (e) {
        if (alive) {
          setError(String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [groups, spec.test, spec.lsl, spec.usl, requestKey]);

  useEffect(() => {
    if (!loading && selected !== null && selected >= entries.length) setSelected(null);
  }, [entries.length, selected, loading]);

  const binNames = useMemo(() => {
    const out: Record<number, string> = {};
    for (const b of info?.[spec.binCategory === "soft" ? "sbins" : "hbins"] ?? []) {
      out[b.code] = b.name;
    }
    return out;
  }, [info, spec.binCategory]);

  const binPass = useMemo(
    () =>
      (info?.[spec.binCategory === "soft" ? "sbins" : "hbins"] ?? [])
        .filter((b) => b.pass)
        .map((b) => b.code),
    [info, spec.binCategory]
  );

  const validRef = useRef(false);
  validRef.current = !loading && !error && loadedKey === requestKey;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const groupsRef = useRef(groups); groupsRef.current=groups;
  const filterRef = useRef(filter); filterRef.current=filter;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const specRef = useRef(spec);
  specRef.current = spec;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const binNamesRef = useRef(binNames);
  binNamesRef.current = binNames;
  const binPassRef = useRef(binPass);
  binPassRef.current = binPass;

  useEffect(() => {
    const entry=entries[selected ?? (entries.length===1 ? 0 : -1)];
    onSelection?.(entry ? {label:entry.label,wafer:groups.find(g=>g.label===entry.label)?.wafer??undefined} : null);
  }, [selected,entries,groups,onSelection]);
  useEffect(() => () => onSelection?.(null), [onSelection]);

  useEffect(() => {
    const jobs=(themeOverride?:Theme,selectedOnly=false):ImageExportJob[]=>{
      if (!validRef.current) throw new Error("The maps are still loading.");
      const sp={...specRef.current}, exportGroups=groupsRef.current, exportFilter=filterRef.current;
      const entries=selectedOnly?entriesRef.current.slice(selectedRef.current??0,(selectedRef.current??0)+1):entriesRef.current;
      const theme=themeOverride??themeRef.current, binNames=binNamesRef.current, binPass=binPassRef.current;
      return entries.map(({md,label})=>({label,render:async(format)=>{
        await document.fonts.ready;
        const limits=mapColorLimits(sp,md);
        const opts:MapOptions={exportSpec:sp,exportGroupLabel:label,theme,palette:sp.palette,mode:"value",
          lsl:sp.showLimits?(sp.lsl??md.lsl):null,usl:sp.showLimits?(sp.usl??md.usl):null,
          binNames,binCategory:sp.binCategory,binPass,...limits,presentation:false};
        const group=exportGroups.find(g=>g.label===label);
        const footer=await mapExportFooter(md,opts,group?.filter??exportFilter);
        return renderMapImage(md,{...opts,exportFooter:footer},IMAGE_WIDTH,imageHeight("map"),`${sp.title} · ${label}`,"",format);
      }}));
    };
    readyRef.current?.({isReady:()=>validRef.current,jobs,
      toDataURLs:async(format="jpeg",themeOverride,_width,_height,selectedOnly=false)=>{
        const out:{label:string;url:string}[]=[];
        for(const job of jobs(themeOverride,selectedOnly))out.push({label:job.label,url:await job.render(format)});
        return out;
      }});
    return ()=>readyRef.current?.(null);
  },[]);

  if (error) return <div className="chart-placeholder">{error}</div>;
  if (loading || loadedKey !== requestKey) return <div className="chart-placeholder">Loading {groups.length} wafer maps…</div>;
  if (entries.length === 0) return <div className="chart-placeholder">No wafers match the current filters.</div>;

  const labels = entries.map((e) => e.label);

  if (selected !== null && entries[selected]) {
    return (
      <MapDetailView
        maps={entries.map((e) => e.md)}
        labels={labels}
        index={selected}
        spec={spec}
        mode="value"
        onIndex={setSelected}
        onBack={() => setSelected(null)}
      />
    );
  }

  if (entries.length === 1) {
    const entry = entries[0];
    return (
      <WaferMapView
        data={entry.md}
        spec={{ ...spec, mapMode: "value", title: `${spec.title} · ${entry.label}` }}
      />
    );
  }

  return <MapGallery entries={entries.map(({ md, label }) => ({ md, label,
    lot: !md.isMean ? md.lotName : spec.groupBy === "lot" ? label : "Grouped maps" }))}
    spec={spec} mode="value" onOpen={setSelected} />;
}
