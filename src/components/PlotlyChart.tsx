import { useEffect, useMemo, useRef } from "react";
import Plotly from "plotly.js-dist-min";
import type { Figure } from "../charts/figures";
import { PLOTLY_CONFIG } from "../charts/plotlyTheme";
import { rasterScatterPreview } from "../charts/scatterPreview";

interface Props {
  figure: Figure;
  hostRef?: { current: HTMLDivElement | null };
  /** Thumbnails must not pan, zoom, hover or show a mode bar. */
  staticPlot?: boolean;
  cacheKey?: string;
}

const views = new Map<string, { axes: Record<string, { range: number[]; autorange: unknown }>; visible: unknown[] }>();

export function PlotlyChart({ figure, hostRef, staticPlot: isStatic = false, cacheKey }: Props) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const targetRef = hostRef ?? ownRef;
  const config = useMemo(
    () =>
      isStatic
        ? {
            ...PLOTLY_CONFIG,
            staticPlot: true,
            displayModeBar: false,
            scrollZoom: false,
            doubleClick: false,
            showTips: false,
          }
        : PLOTLY_CONFIG,
    [isStatic]
  );

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    let alive = true;
    const graph = el as any;
    const saved = cacheKey ? views.get(cacheKey) : undefined;
    const capture = () => {
      if (!cacheKey || isStatic || !graph._fullLayout) return;
      const axes: Record<string, { range: number[]; autorange: unknown }> = {};
      for (const [key, axis] of Object.entries(graph._fullLayout) as [string, any][]) {
        if (/^[xy]axis\d*$/.test(key) && Array.isArray(axis.range)) axes[key] = { range: [...axis.range], autorange: axis.autorange };
      }
      views.delete(cacheKey);
      views.set(cacheKey, { axes, visible: (graph.data ?? []).map((trace: any) => trace.visible ?? true) });
      while (views.size > 40) views.delete(views.keys().next().value!);
    };
    // Establish the original default first, then restore the view through a
    // relayout, so double click still resets to the actual plot default.
    const rendered = isStatic && figure.rasterScatter
      ? rasterScatterPreview(figure, el.clientWidth, el.clientHeight) : figure;
    void Plotly.react(el, rendered.data, structuredClone(rendered.layout), config).then(async () => {
      if (!alive || isStatic || !cacheKey) return;
      if (saved) {
        const update: Record<string, unknown> = {};
        for (const [key, axis] of Object.entries(saved.axes)) {
          update[`${key}.range`] = axis.range; update[`${key}.autorange`] = axis.autorange;
        }
        await Plotly.relayout(el, update);
        if (!alive) return;
        if (saved.visible.length === figure.data.length) await Plotly.restyle(el, { visible: saved.visible });
      }
      if (!alive) return;
      graph.on?.("plotly_relayout", capture);
      graph.on?.("plotly_restyle", capture);
    }).catch((error: unknown) => { if (alive) console.error("Unable to render plot", error); });
    return () => {
      alive = false;
      capture();
      graph.removeListener?.("plotly_relayout", capture);
      graph.removeListener?.("plotly_restyle", capture);
    };
  }, [figure, targetRef, config, cacheKey, isStatic]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          Plotly.Plots.resize(el);
        } catch {
          /* the plot may be mid-purge */
        }
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [targetRef]);

  useEffect(() => {
    const el = targetRef.current;
    return () => {
      if (el) {
        try {
          Plotly.purge(el);
        } catch {
          /* ignore */
        }
      }
    };
  }, [targetRef]);

  return <div className="plotly-host" ref={targetRef} />;
}
