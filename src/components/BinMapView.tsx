import { useRestorePlotSelection } from "../lib/usePlotMemory";
import { IMAGE_WIDTH, BIN_OVERVIEW_WIDTH, imageHeight } from "../charts/imageExport";
import { useEffect, useMemo, useRef } from "react";
import type { BinOverviewResponse, BinOverviewWafer, MapResponse, PlotSpec, PlotSelection } from "../types";
import {
  renderBinOverviewImage,
  renderMapImage,
  type MapOptions,
} from "../charts/waferMap";
import { useStore } from "../store";
import type { Theme } from "../lib/theme";
import { MapGallery, useMapSelection } from "./MapGallery";
import type { ImageExportJob } from "../lib/exportJobs";
import { MapDetailView } from "./MapDetailView";

export interface BinMapExportApi {
  jobs: (theme?: Theme, selectedOnly?: boolean) => ImageExportJob[];
  toDataURL: (
    format?: "jpeg" | "png",
    theme?: Theme,
    width?: number,
    height?: number
  ) => string;
}

interface Props {
  data: BinOverviewResponse;
  spec: PlotSpec;
  onReady?: (api: BinMapExportApi | null) => void;
  onSelection?: (selection:PlotSelection|null)=>void;
}

const binMaps = new WeakMap<BinOverviewWafer, MapResponse>();
function asMap(w: BinOverviewWafer): MapResponse {
  const cached = binMaps.get(w);
  if (cached) return cached;
  const md: MapResponse = {
    wafer: w.wafer,
    lotName: w.lotName,
    dice: w.dice,
    test: null,
    lsl: null,
    usl: null,
    vmin: Number.NaN,
    vmax: Number.NaN,
    pass: w.pass,
    fail: w.fail,
    yieldPct: w.yieldPct,
    isMean: false,
    waferCount: 1,
    excluded: 0,
  };
  binMaps.set(w, md);
  return md;
}

export function BinMapView({ data, spec, onReady, onSelection }: Props) {
  const fontRevision = useStore((s) => s.demoFontRevision);
  const theme = useStore((s) => s.theme);
  const info = useStore((s) => s.info);
  const dataVersion = useStore((s) => s.dataVersion);
  const filters = useStore((s) => s.filters);
  const [selected, setSelected] = useMapSelection("bin", [dataVersion, filters, spec.test]);
  useRestorePlotSelection(data.wafers.map(w=>`${w.lotName} / ${w.wafer.name}`),setSelected);

  const maps = useMemo(() => data.wafers.map(asMap), [data.wafers]);

  useEffect(() => {
    if (selected !== null && selected >= maps.length) setSelected(null);
  }, [maps.length, selected]);

  const binNames = useMemo(() => {
    const map: Record<number, string> = {};
    for (const b of info?.[spec.binCategory === "soft" ? "sbins" : "hbins"] ?? []) {
      map[b.code] = b.name;
    }
    return map;
  }, [info, spec.binCategory]);

  const binPass = useMemo(
    () =>
      (info?.[spec.binCategory === "soft" ? "sbins" : "hbins"] ?? [])
        .filter((b) => b.pass)
        .map((b) => b.code),
    [info, spec.binCategory]
  );

  const opts = useMemo<MapOptions>(
    () => ({
      theme,
      palette: spec.palette,
      mode: "bin",
      lsl: null,
      usl: null,
      binNames,
      binCategory: spec.binCategory,
      binPass,
      presentation: false,
      fontRevision,
      showLegend: false,
    }),
    [theme, spec.palette, binNames, binPass, spec.binCategory, fontRevision]
  );


  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const dataRef = useRef(data);
  dataRef.current = data;
  const specRef = useRef(spec);
  specRef.current = spec;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const mapsRef = useRef(maps);
  mapsRef.current = maps;

  useEffect(()=>{
    const md=selected!==null?maps[selected]:undefined;
    const wafer=md?info?.wafers.findIndex(w=>w.lot===md.wafer?.lot&&w.name===md.wafer?.name):undefined;
    onSelection?.(md?{label:`${md.lotName} / ${md.wafer?.name}`,wafer}:null);
  },[selected,maps,info,onSelection]);
  useEffect(()=>()=>onSelection?.(null),[onSelection]);

  useEffect(()=>{
    const single=(md:MapResponse,sp:PlotSpec,o:MapOptions,format:"jpeg"|"png",subtitle:string,width=IMAGE_WIDTH,height=imageHeight("binmap"))=>
      renderMapImage(md,{...o,exportSpec:{...sp,groupBy:"wafer"},exportGroupLabel:`${md.lotName} / ${md.wafer?.name}`,mode:"bin"},width,height,sp.title,subtitle,format);
    const overview=(d:BinOverviewResponse,sp:PlotSpec,o:MapOptions,format:"jpeg"|"png",subtitle:string)=>
      renderBinOverviewImage(d.wafers,{...o,exportSpec:sp},BIN_OVERVIEW_WIDTH,Math.round(BIN_OVERVIEW_WIDTH*9/16),sp.title,subtitle,format);
    const filterSubtitle = () => {
      const { filters, info } = useStore.getState();
      return describeFilters(filters, info, false);
    };
    readyRef.current?.({
      toDataURL:(format="jpeg",themeOverride,width=IMAGE_WIDTH,height=imageHeight("binmap"))=>{
        const d=dataRef.current,sp=specRef.current,o={...optsRef.current,theme:themeOverride??optsRef.current.theme};
        const idx=selectedRef.current;
        const subtitle = filterSubtitle();
        return idx!==null&&mapsRef.current[idx]?single(mapsRef.current[idx],sp,o,format,subtitle,width,height):overview(d,sp,o,format,subtitle);
      },
      jobs:(themeOverride,selectedOnly=false)=>{
        const d=dataRef.current,sp={...specRef.current},maps=mapsRef.current,o={...optsRef.current,theme:themeOverride??optsRef.current.theme};
        const index=selectedRef.current;
        const subtitle = filterSubtitle();
        const entries=selectedOnly&&index!==null?[maps[index]]:maps;
        const jobs:ImageExportJob[]=entries.filter(Boolean).map(md=>({label:`${md.lotName} / ${md.wafer?.name}`,render:async(format)=>{await document.fonts.ready;return single(md,sp,o,format,subtitle);}}));
        if(!selectedOnly)jobs.unshift({label:"Overview",render:async(format)=>{await document.fonts.ready;return overview(d,sp,o,format,subtitle);}});
        return jobs;
      }
    });
    return ()=>readyRef.current?.(null);
  },[]);

  if (selected !== null && maps[selected]) {
    return (
      <MapDetailView
        maps={maps}
        labels={data.wafers.map((w) => `${w.lotName} / ${w.wafer.name}`)}
        index={selected}
        spec={spec}
        mode="bin"
        onIndex={setSelected}
        onBack={() => setSelected(null)}
      />
    );
  }

  return <MapGallery entries={data.wafers.map((w, i) => ({ md: maps[i],
    label: `${w.lotName} / ${w.wafer.name}`, lot: w.lotName }))}
    spec={spec} mode="bin" onOpen={setSelected} />;
}
import { describeFilters } from "../lib/customFilters";
