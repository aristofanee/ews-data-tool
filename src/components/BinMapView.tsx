import { useEffect, useMemo, useRef } from "react";
import type { BinOverviewResponse, BinOverviewWafer, MapResponse, PlotSpec } from "../types";
import {
  renderBinOverviewImage,
  renderMapImage,
  type MapOptions,
} from "../charts/waferMap";
import { useStore } from "../store";
import type { Theme } from "../lib/theme";
import { MapGallery, useMapSelection } from "./MapGallery";
import { MapDetailView } from "./MapDetailView";

export interface BinMapExportApi {
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

export function BinMapView({ data, spec, onReady }: Props) {
  const theme = useStore((s) => s.theme);
  const info = useStore((s) => s.info);
  const dataVersion = useStore((s) => s.dataVersion);
  const filters = useStore((s) => s.filters);
  const [selected, setSelected] = useMapSelection("bin", [dataVersion, filters, spec.test, spec.binCategory]);

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
      showLegend: false,
    }),
    [theme, spec.palette, binNames, binPass, spec.binCategory]
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

  useEffect(() => {
    readyRef.current?.({
      toDataURL: (format = "jpeg", themeOverride, width = 2400, height = 1500) => {
        const d = dataRef.current;
        const sp = specRef.current;
        const o = themeOverride ? { ...optsRef.current, theme: themeOverride } : optsRef.current;
        const idx = selectedRef.current;
        if (idx !== null && mapsRef.current[idx]) {
          const md = mapsRef.current[idx];
          const subtitle = `${md.lotName} · Wafer ${md.wafer?.name ?? "?"} · Yield ${md.yieldPct.toFixed(2)}%`;
          return renderMapImage(
            md,
            { ...o, mode: "bin" },
            width,
            height,
            sp.title,
            subtitle,
            format
          );
        }
        const totalPass = d.wafers.reduce((n, w) => n + w.pass, 0);
        const totalFail = d.wafers.reduce((n, w) => n + w.fail, 0);
        const tested = totalPass + totalFail;
        const yieldPct = tested ? (totalPass * 100) / tested : 0;
        const subtitle = `${d.wafers.length} wafers · Yield ${yieldPct.toFixed(2)}%`;
        return renderBinOverviewImage(d.wafers, o, width, height, sp.title, subtitle, format);
      },
    });
    return () => readyRef.current?.(null);
  }, []);

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
