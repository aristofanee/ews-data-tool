import { useEffect, useMemo, useRef, useState } from "react";
import type { MapResponse, PlotSpec } from "../types";
import { renderMapImage, WaferMapRenderer, type MapHit, type MapOptions } from "../charts/waferMap";
import { useStore } from "../store";
import type { Theme } from "../lib/theme";
import { fmt, fmtInt, tidyName } from "../lib/format";

export interface MapExportApi {
  toDataURL: (
    format?: "jpeg" | "png",
    theme?: Theme,
    width?: number,
    height?: number
  ) => string;
}

interface Props {
  data: MapResponse;
  spec: PlotSpec;
  onReady?: (api: MapExportApi | null) => void;
}

export function WaferMapView({ data, spec, onReady }: Props) {
  const theme = useStore((s) => s.theme);
  const info = useStore((s) => s.info);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WaferMapRenderer | null>(null);
  const [hover, setHover] = useState<MapHit | null>(null);
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const binNames = useMemo(() => {
    const map: Record<number, string> = {};
    for (const b of info?.hbins ?? []) map[b.code] = b.name;
    return map;
  }, [info]);

  const opts = useMemo<MapOptions>(
    () => ({
      theme,
      palette: spec.palette,
      mode: spec.mapMode,
      lsl: spec.showLimits ? (spec.lsl ?? data.lsl) : null,
      usl: spec.showLimits ? (spec.usl ?? data.usl) : null,
      binNames,
      presentation: spec.presentation,
    }),
    [
      theme,
      spec.palette,
      spec.mapMode,
      spec.showLimits,
      spec.lsl,
      spec.usl,
      spec.presentation,
      data.lsl,
      data.usl,
      binNames,
    ]
  );

  const dataRef = useRef(data);
  dataRef.current = data;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const specRef = useRef(spec);
  specRef.current = spec;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const r = new WaferMapRenderer(canvas);
    rendererRef.current = r;
    r.resize();
    r.draw();

    const ro = new ResizeObserver(() => {
      if (r.resize()) r.draw();
    });
    ro.observe(wrap);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      r.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.18 : 1 / 1.18);
      setZoom(r.getZoom());
      setHover(null);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    readyRef.current?.({
      toDataURL: (format = "jpeg", themeOverride, width = 1600, height = 1000) => {
        const d = dataRef.current;
        const sp = specRef.current;
        const test = d.test ? tidyName(d.test.name) : "";
        const subtitle =
          `${d.lotName} · Wafer ${d.wafer?.name ?? "?"}` +
          (test ? ` · ${test}` : "") +
          ` · Yield ${d.yieldPct.toFixed(2)}%`;
        const opts = themeOverride
          ? { ...optsRef.current, theme: themeOverride }
          : optsRef.current;
        return renderMapImage(d, opts, width, height, sp.title, subtitle, format);
      },
    });

    return () => {
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      rendererRef.current = null;
      readyRef.current?.(null);
    };
  }, []);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.resize();
    r.setData(data, opts);
    setZoom(r.getZoom());
  }, [data, opts]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = rendererRef.current;
    if (!r) return;
    const drag = dragRef.current;
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      if (drag.moved) {
        r.panBy(dx, dy);
        drag.x = e.clientX;
        drag.y = e.clientY;
        setZoom(r.getZoom());
        setHover(null);
        return;
      }
    }
    const hit = r.hitTest(e.clientX, e.clientY);
    r.setHover(hit?.die ?? null);
    setHover(hit);
  };

  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onLeave = () => {
    dragRef.current = null;
    rendererRef.current?.setHover(null);
    setHover(null);
  };

  const onDoubleClick = () => {
    rendererRef.current?.resetView();
    setZoom(1);
    setHover(null);
  };

  const emptyCount = useMemo(
    () =>
      spec.mapMode === "value"
        ? data.dice.reduce((n, d) => (Number.isFinite(d.v) ? n : n + 1), 0)
        : 0,
    [data, spec.mapMode]
  );

  const units = data.test?.units ?? "";
  const outOfSpec =
    hover &&
    spec.mapMode === "value" &&
    Number.isFinite(hover.die.v) &&
    ((opts.lsl !== null && hover.die.v < opts.lsl) || (opts.usl !== null && hover.die.v > opts.usl));

  const wrapW = wrapRef.current?.clientWidth ?? 900;
  const wrapH = wrapRef.current?.clientHeight ?? 600;

  return (
    <div className="map-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={onLeave}
        onDoubleClick={onDoubleClick}
      />
      {hover && (
        <div
          className="map-tip"
          style={{
            left: Math.min(hover.sx + 18, wrapW - 216),
            top: Math.min(hover.sy + 18, wrapH - 128),
          }}
        >
          <div className="map-tip-head">
            Die ({hover.die.x}, {hover.die.y})
          </div>
          {spec.mapMode === "value" ? (
            <div className="map-tip-value">
              {fmt(hover.die.v)} <span>{units}</span>
            </div>
          ) : (
            <div className="map-tip-value">
              Bin {hover.die.hbin}
              <span>{binNames[hover.die.hbin] ?? ""}</span>
            </div>
          )}
          <div className="map-tip-row">
            HBIN {hover.die.hbin} · {binNames[hover.die.hbin] ?? "—"}
          </div>
          <div className="map-tip-row">SBIN {hover.die.sbin}</div>
          {outOfSpec && <div className="map-tip-flag">Out of spec</div>}
        </div>
      )}
      <div className="map-hint">
        Scroll to zoom · drag to pan · double-click to reset
        {emptyCount > 0 ? ` · ${fmtInt(emptyCount)} dice without data` : ""}
        {zoom > 1.01 ? ` · ${zoom.toFixed(1)}×` : ""}
      </div>
    </div>
  );
}
