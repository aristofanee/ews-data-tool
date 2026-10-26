import { useEffect, useMemo, useRef, useState } from "react";
import type { BinOverviewResponse, BinOverviewWafer, MapResponse, PlotSpec } from "../types";
import {
  renderBinOverviewImage,
  renderMapImage,
  WaferMapRenderer,
  type MapOptions,
} from "../charts/waferMap";
import { useStore } from "../store";
import type { Theme } from "../lib/theme";
import { fmtInt } from "../lib/format";
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

function asMap(w: BinOverviewWafer): MapResponse {
  return {
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
}

function BinThumb({
  wafer,
  opts,
  onOpen,
}: {
  wafer: BinOverviewWafer;
  opts: MapOptions;
  onOpen: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const renderer = new WaferMapRenderer(canvas);
    const draw = () => {
      renderer.resize();
      renderer.setData(asMap(wafer), opts);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [wafer, opts]);

  return (
    <div className="binmap-tile">
      <button className="binmap-open" onClick={onOpen} title={`Open ${wafer.lotName} / ${wafer.wafer.name}`}>
        <div className="binmap-canvas-wrap" ref={wrapRef}>
          <canvas ref={canvasRef} className="binmap-canvas" />
        </div>
        <div className="binmap-label">
          <span className="binmap-name">
            {wafer.lotName} / {wafer.wafer.name}
          </span>
          <span className="binmap-yield">{wafer.yieldPct.toFixed(1)}%</span>
        </div>
        <div className="binmap-meta">
          {fmtInt(wafer.pass)} pass · {fmtInt(wafer.fail)} fail
        </div>
      </button>
    </div>
  );
}

export function BinMapView({ data, spec, onReady }: Props) {
  const theme = useStore((s) => s.theme);
  const info = useStore((s) => s.info);
  const [selected, setSelected] = useState<number | null>(null);

  const maps = useMemo(() => data.wafers.map(asMap), [data.wafers]);

  useEffect(() => {
    if (selected !== null && selected >= maps.length) setSelected(null);
  }, [maps.length, selected]);

  const binNames = useMemo(() => {
    const map: Record<number, string> = {};
    for (const b of info?.hbins ?? []) map[b.code] = b.name;
    return map;
  }, [info]);

  const opts = useMemo<MapOptions>(
    () => ({
      theme,
      palette: spec.palette,
      mode: "bin",
      lsl: null,
      usl: null,
      binNames,
      presentation: false,
      showLegend: false,
    }),
    [theme, spec.palette, binNames]
  );

  const groups = useMemo(() => {
    const out = new Map<string, { w: BinOverviewWafer; index: number }[]>();
    data.wafers.forEach((w, index) => {
      const list = out.get(w.lotName) ?? [];
      list.push({ w, index });
      out.set(w.lotName, list);
    });
    return [...out.entries()];
  }, [data.wafers]);

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
        index={selected}
        spec={spec}
        mode="bin"
        onIndex={setSelected}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="binmap-wrap">
      {groups.map(([lot, wafers]) => (
        <section className="binmap-group" key={lot}>
          {groups.length > 1 && <h4 className="binmap-lot">{lot}</h4>}
          <div className="binmap-grid">
            {wafers.map(({ w, index }) => (
              <BinThumb
                key={`${w.wafer.lot}-${w.wafer.name}`}
                wafer={w}
                opts={opts}
                onOpen={() => setSelected(index)}
              />
            ))}
          </div>
        </section>
      ))}
      {groups.length === 0 && <div className="chart-placeholder">No wafers match the current filters.</div>}
    </div>
  );
}
