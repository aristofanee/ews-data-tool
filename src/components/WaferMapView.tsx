import { useEffect, useMemo, useRef, useState } from "react";
import type { MapResponse, PlotSpec } from "../types";
import {
  mapColorLimits,
  renderMapImage,
  WaferMapRenderer,
  type MapHit,
  type MapOptions,
} from "../charts/waferMap";
import { useStore } from "../store";
import type { Theme } from "../lib/theme";
import { fmtMap, tidyName } from "../lib/format";
import { binLabel } from "../lib/theme";

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
  /** When set, a click that is not a pan opens the enlarged map. */
  onOpen?: () => void;
  /**
   * Mosaic thumbnail mode: no legend, hover or zoom. Wheel/trackpad gestures
   * fall through to the scroll container, and a click opens the detail view.
   */
  preview?: boolean;
}

export function WaferMapView({ data, spec, onReady, onOpen, preview = false }: Props) {
  const theme = useStore((s) => s.theme);
  const info = useStore((s) => s.info);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WaferMapRenderer | null>(null);
  const [hover, setHover] = useState<MapHit | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

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

  const limits = useMemo(
    () => (spec.mapMode === "value" ? mapColorLimits(spec, data) : {}),
    [spec, data]
  );

  const opts = useMemo<MapOptions>(
    () => ({
      theme,
      palette: spec.palette,
      mode: spec.mapMode,
      lsl: spec.showLimits ? (spec.lsl ?? data.lsl) : null,
      usl: spec.showLimits ? (spec.usl ?? data.usl) : null,
      binNames,
      binCategory: spec.binCategory,
      binPass,
      vmin: limits.vmin,
      vmax: limits.vmax,
      presentation: preview ? false : spec.presentation,
      showLegend: preview ? false : undefined,
    }),
    [
      theme,
      spec.palette,
      spec.mapMode,
      spec.showLimits,
      spec.lsl,
      spec.usl,
      spec.presentation,
      spec.binCategory,
      preview,
      data,
      binNames,
      binPass,
      limits,
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
  const previewRef = useRef(preview);
  previewRef.current = preview;

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
      // In a mosaic preview the wheel belongs to the scroll container. Do not
      // preventDefault here or the page cannot scroll past the thumbnails.
      // A ctrl+wheel pinch is still swallowed so it cannot browser-zoom the
      // whole app while the pointer happens to be over a thumbnail.
      if (previewRef.current) {
        if (e.ctrlKey) e.preventDefault();
        return;
      }
      e.preventDefault();
      // Chromium/WebView2 reports trackpad pinch gestures as wheel events
      // with ctrlKey set. Use a continuous exponential factor so both a pinch
      // and a high-resolution wheel feel smooth instead of jumping 18%.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      r.zoomAt(e.clientX, e.clientY, Math.min(2, Math.max(0.5, factor)));
      setHover(null);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    readyRef.current?.({
      toDataURL: (format = "jpeg", themeOverride, width = 1600, height = 1000) => {
        const d = dataRef.current;
        const sp = specRef.current;
        const test = d.test ? tidyName(d.test.name) : "";
        const scope = d.isMean
          ? `All wafers (mean) · ${d.waferCount} wafer${d.waferCount === 1 ? "" : "s"}`
          : `${d.lotName} · Wafer ${d.wafer?.name ?? "?"}`;
        const subtitle =
          scope + (test ? ` · ${test}` : "") + ` · Yield ${d.yieldPct.toFixed(2)}%`;
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
        if (!preview) {
          r.panBy(dx, dy);
          drag.x = e.clientX;
          drag.y = e.clientY;
          setHover(null);
        }
        return;
      }
    }
    if (preview) return;
    const hit = r.hitTest(e.clientX, e.clientY);
    r.setHover(hit?.die ?? null);
    setHover(hit);
  };

  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const moved = dragRef.current?.moved ?? false;
    endDrag(e);
    if (!moved && onOpen) onOpen();
  };

  const onLeave = () => {
    dragRef.current = null;
    rendererRef.current?.setHover(null);
    setHover(null);
  };

  const onDoubleClick = () => {
    if (preview) return;
    rendererRef.current?.resetView();
    setHover(null);
  };

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
        className={`map-canvas${preview ? " preview" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
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
              {fmtMap(hover.die.v)} <span>{units}</span>
            </div>
          ) : (
            <div className="map-tip-value">
              {spec.binCategory === "soft" ? "SBIN" : "HBIN"}{" "}
              {spec.binCategory === "soft" ? hover.die.sbin : hover.die.hbin}
              <span>
                {binNames[spec.binCategory === "soft" ? hover.die.sbin : hover.die.hbin] ?? ""}
              </span>
            </div>
          )}
          <div className="map-tip-row">
            {binLabel("hard", hover.die.hbin, info?.hbins.find((b) => b.code === hover.die.hbin)?.name)}
          </div>
          <div className="map-tip-row">{binLabel("soft", hover.die.sbin, info?.sbins.find((b) => b.code === hover.die.sbin)?.name)}</div>
          {outOfSpec && <div className="map-tip-flag">Out of spec</div>}
        </div>
      )}

    </div>
  );
}
