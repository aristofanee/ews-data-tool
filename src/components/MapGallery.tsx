import { useEffect, useMemo, useRef } from "react";
import type { MapResponse, PlotSpec } from "../types";
import { mapColorLimits, WaferMapRenderer, type MapOptions } from "../charts/waferMap";
import { useStore } from "../store";
import { fmtInt } from "../lib/format";
export { usePlotSelection as useMapSelection } from "../lib/usePlotMemory";

// Retain only small thumbnail bitmaps, never enlarged canvases. Data identity
// comes from the response cache, so changing test/filter/theme cannot reuse
// a stale image. About 32 MiB maximum, evicted in least-recently-used order.
const images = new Map<string, HTMLCanvasElement>();
const identities = new WeakMap<object, number>();
let nextIdentity = 0;
let bytes = 0;
function identity(data: object) {
  if (!identities.has(data)) identities.set(data, ++nextIdentity);
  return identities.get(data)!;
}

function MapThumb({ data, opts }: { data: MapResponse; opts: MapOptions }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let visible = false;
    let frame = 0;
    const draw = () => {
      if (!visible) return;
      const rect = canvas.getBoundingClientRect();
      const width = Math.round(rect.width), height = Math.round(rect.height);
      if (width < 2 || height < 2) return;
      const key = JSON.stringify([identity(data), opts, width, height]);
      let cached = images.get(key);
      if (!cached) {
        cached = document.createElement("canvas");
        const renderer = new WaferMapRenderer(cached);
        renderer.setSize(width, height);
        renderer.setData(data, opts);
        const size = width * height * 4;
        while (images.size && bytes + size > 32 * 1024 * 1024) {
          const oldest = images.keys().next().value!;
          const old = images.get(oldest)!;
          bytes -= old.width * old.height * 4; images.delete(oldest);
        }
        if (size <= 32 * 1024 * 1024) { images.set(key, cached); bytes += size; }
      } else { images.delete(key); images.set(key, cached); }
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d")?.drawImage(cached, 0, 0);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) schedule(); });
    observer.observe(canvas);
    const resize = new ResizeObserver(schedule); resize.observe(canvas);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); };
  }, [data, opts]);
  return <canvas className="binmap-canvas" ref={ref} />;
}

export interface GalleryMap { md: MapResponse; label: string; lot: string }

export function MapGallery({ entries, spec, mode, onOpen }: {
  entries: GalleryMap[]; spec: PlotSpec; mode: "value" | "bin"; onOpen: (index: number) => void;
}) {
  const theme = useStore((s) => s.theme);
  const groups = useMemo(() => {
    const out = new Map<string, { entry: GalleryMap; index: number }[]>();
    entries.forEach((entry, index) => {
      const list = out.get(entry.lot) ?? [];
      list.push({ entry, index }); out.set(entry.lot, list);
    });
    return [...out.entries()];
  }, [entries]);
  const opts = useMemo<MapOptions>(() => ({ theme, mode, palette: spec.palette,
    lsl: spec.lsl, usl: spec.usl, binCategory: spec.binCategory, showLegend: false,
    presentation: false }), [theme, mode, spec.palette, spec.lsl, spec.usl, spec.binCategory]);
  return <div className="binmap-wrap map-gallery">
    {groups.map(([lot, maps]) => <section className="binmap-group" key={lot}>
      {lot && <h4 className="binmap-lot">{lot}</h4>}
      <div className="binmap-grid">
        {maps.map(({ entry: { md, label }, index }) => <div className="binmap-tile" key={label}>
          <button className="binmap-open" onClick={() => onOpen(index)} title={`Open ${label}`}>
            <div className="binmap-canvas-wrap"><MapThumb data={md} opts={mode === "value" ? { ...opts, ...mapColorLimits(spec, md) } : opts} /></div>
            <div className="binmap-label"><span className="binmap-name">{label}</span>
              <span className="binmap-yield">{md.yieldPct.toFixed(1)}%</span></div>
            <div className="binmap-meta">{fmtInt(md.pass)} bin 1 · {fmtInt(md.fail)} other bins</div>
          </button>
        </div>)}
      </div>
    </section>)}
  </div>;
}
