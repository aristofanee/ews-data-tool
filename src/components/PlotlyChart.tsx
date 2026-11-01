import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import Plotly from "plotly.js-dist-min";
import type { Figure } from "../charts/figures";
import { PLOTLY_CONFIG } from "../charts/plotlyTheme";
import { rasterScatterPreview } from "../charts/scatterPreview";

interface Props {
  figure: Figure | null;
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
        : { ...PLOTLY_CONFIG, doubleClick: false },
    [isStatic]
  );

  useEffect(() => {
    const el = targetRef.current;
    if (!el || isStatic) return;
    const pan = (e: MouseEvent) => {
      if (e.button !== 1 || !(e.target instanceof Element) || !e.target.closest(".nsewdrag")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // Let Plotly prepare its native pan gesture (log/multiple axes included).
      // Restore the selected mode immediately after preparation, so the next
      // left drag still zooms/selects normally and no relayout is needed here.
      const layout = (el as any)._fullLayout;
      if (!layout) return;
      const mode = layout.dragmode;
      try {
        layout.dragmode = "pan";
        e.target.dispatchEvent(new MouseEvent("mousedown", {
          bubbles: true, cancelable: true, view: window, button: 0, buttons: 1,
          clientX: e.clientX, clientY: e.clientY,
        }));
      } finally { layout.dragmode = mode; }
    };
    const suppressAutoScroll = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
    el.addEventListener("mousedown", pan, true);
    el.addEventListener("auxclick", suppressAutoScroll);
    return () => {
      el.removeEventListener("mousedown", pan, true);
      el.removeEventListener("auxclick", suppressAutoScroll);
    };
  }, [targetRef, isStatic]);

  useLayoutEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    el.style.visibility = "hidden";
    if (!figure) return;
    let alive = true;
    const graph = el as any;
    const saved = cacheKey ? views.get(cacheKey) : undefined;
    const defaults: Record<string, unknown> = {};
    const reset = () => {
      void Plotly.relayout(el, defaults);
    };
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
      if (!alive) return;
      if (!isStatic) {
        for (const [key, axis] of Object.entries(graph._fullLayout) as [string, any][]) {
          if (/^[xy]axis\d*$/.test(key) && Array.isArray(axis.range)) {
            defaults[`${key}.range`] = [...axis.range]; defaults[`${key}.autorange`] = false;
          }
        }
        graph.on?.("plotly_doubleclick", reset);
      }
      if (isStatic || !cacheKey) { el.style.visibility = "visible"; return; }
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
      el.style.visibility = "visible";
      graph.on?.("plotly_relayout", capture);
      graph.on?.("plotly_restyle", capture);
    }).catch((error: unknown) => { if (alive) console.error("Unable to render plot", error); });
    return () => {
      alive = false;
      graph.removeListener?.("plotly_doubleclick", reset);
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

  return <div className="plotly-host" ref={targetRef} style={{ visibility: figure ? "visible" : "hidden" }} />;
}
