import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import type { Figure } from "../charts/figures";
import { PLOTLY_CONFIG } from "../charts/plotlyTheme";
import { rasterScatterPreview } from "../charts/scatterPreview";
import { restoreBoundaryLimitLines } from "../charts/limitLineClipping";
import { renderWithSvgFallback } from "../charts/plotlyFallback";
import { isTauri } from "../lib/api";
import { DEFAULT_X_LABEL_DENSITY, useStore } from "../store";

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
  const [contextLost, setContextLost] = useState(false);
  const svgFallback = useRef(false);
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
    const restoreLimitLines = () => restoreBoundaryLimitLines(el);
    const labels = isStatic ? undefined : figure.indexedXLabels;
    const tickFont = figure.layout.xaxis?.tickfont;
    const tickAngle = Math.abs(figure.layout.xaxis?.tickangle ?? 0) * Math.PI / 180;
    const measure = labels?.length ? document.createElement("canvas").getContext("2d") : null;
    if (measure) measure.font = `${tickFont.size}px ${tickFont.family}`;
    const labelWidths = measure && labels?.map(label =>
      Math.cos(tickAngle) * measure.measureText(label).width + Math.sin(tickAngle) * tickFont.size + 8);
    let tickFrame = 0;
    // Category positions stay fixed while the label stride follows the visible range.
    const updateTicks = () => {
      if (!labels || !labelWidths) return;
      cancelAnimationFrame(tickFrame);
      tickFrame = requestAnimationFrame(() => {
        const axis = graph._fullLayout?.xaxis;
        if (!alive || !axis?._length || !axis.range) return;
        const [low, high] = axis.range;
        const start = Math.max(0, Math.ceil(low));
        const end = Math.min(labels.length - 1, Math.floor(high));
        let widest = 0;
        for (let i = start; i <= end; i++) widest = Math.max(widest, labelWidths[i]);
        const density = (isTauri ? DEFAULT_X_LABEL_DENSITY : useStore.getState().demoXLabelDensity) / 100;
        const stride = Math.max(1, Math.ceil((high - low) * widest / (axis._length * density)));
        const ticks: number[] = [];
        for (let i = start; i <= end; i += stride) ticks.push(i);
        if (ticks.length === axis.tickvals?.length && ticks.every((tick, i) => tick === axis.tickvals[i])) return;
        void Plotly.relayout(el, {
          "xaxis.tickvals": ticks,
          "xaxis.ticktext": ticks.map(i => labels[i]),
        }).catch(console.error);
      });
    };
    const unsubscribeDensity = !isTauri && labelWidths ? useStore.subscribe((state, previous) => {
      if (state.demoXLabelDensity !== previous.demoXLabelDensity && graph._fullLayout) updateTicks();
    }) : undefined;
    const saved = cacheKey ? views.get(cacheKey) : undefined;
    const defaults: Record<string, unknown> = {};
    const reset = () => {
      // Plotly can retain and mutate the supplied range arrays during zoom.
      void Plotly.relayout(el, structuredClone(defaults));
    };
    let press: MouseEvent | null = null;
    let lastClick: MouseEvent | null = null;
    let resetFrame = 0;
    const nearby = (a: MouseEvent, b: MouseEvent) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) <= 6;
    const resetFromPointer = (event: MouseEvent) => {
      if (!event.isTrusted || event.button !== 0 || !(event.target instanceof Element) || !event.target.closest(".nsewdrag")) return;
      press = event;
    };
    const finishClick = (event: MouseEvent) => {
      const click = event.button === 0 && press && nearby(press, event);
      press = null;
      if (click && lastClick && event.timeStamp - lastClick.timeStamp <= 500 && nearby(lastClick, event)) {
        lastClick = null;
        // Let Plotly finish its drag before restoring the axes.
        resetFrame = requestAnimationFrame(reset);
      } else {
        lastClick = click ? event : null;
      }
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
    const layout=structuredClone(rendered.layout);
    for(const [key,axis]of Object.entries(layout)as[string,any][]){
      if (!/^[xy]axis\d*$/.test(key)) continue;
      axis.autorange = !Array.isArray(axis.range);
      defaults[key + ".autorange"] = axis.autorange;
      if (!axis.autorange) defaults[key + ".range"] = [...axis.range];
    }
    const onContextLost = () => setContextLost(true);
    void renderWithSvgFallback(el, rendered.data, layout,
      (data, nextLayout) => Plotly.react(el, data, nextLayout, config),
      contextLost || svgFallback.current, () => alive).then(async (usedFallback) => {
      if (!alive) return;
      svgFallback.current ||= usedFallback;
      if (!isStatic && !usedFallback) el.addEventListener("webglcontextlost", onContextLost, true);
      restoreLimitLines();
      graph.on?.("plotly_afterplot", restoreLimitLines);
      graph.on?.("plotly_afterplot", updateTicks);
      updateTicks();
      if (!isStatic) {
        // Plotly can suppress native click counts after handling a drag.
        el.addEventListener("mousedown", resetFromPointer, true);
        window.addEventListener("mouseup", finishClick, true);
      }
      if (isStatic || !cacheKey) { el.style.visibility = "visible"; return; }
      if (saved) {
        const update: Record<string, unknown> = {};
        for (const [key, axis] of Object.entries(saved.axes)) {
          update[`${key}.range`] = [...axis.range]; update[`${key}.autorange`] = axis.autorange;
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
      unsubscribeDensity?.();
      el.removeEventListener("webglcontextlost", onContextLost, true);
      cancelAnimationFrame(resetFrame);
      cancelAnimationFrame(tickFrame);
      el.removeEventListener('mousedown',resetFromPointer,true);
      window.removeEventListener("mouseup", finishClick, true);
      graph.removeListener?.("plotly_afterplot", restoreLimitLines);
      graph.removeListener?.("plotly_afterplot", updateTicks);
      capture();
      graph.removeListener?.("plotly_relayout", capture);
      graph.removeListener?.("plotly_restyle", capture);
    };
  }, [figure, targetRef, config, cacheKey, isStatic, contextLost]);

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
