import { useEffect } from "react";
import Plotly from "plotly.js-dist-min";
import type { Figure } from "../charts/figures";
import { PLOTLY_CONFIG } from "../charts/plotlyTheme";

interface Props {
  figure: Figure;
  hostRef: { current: HTMLDivElement | null };
}

export function PlotlyChart({ figure, hostRef }: Props) {
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    Plotly.react(el, figure.data, figure.layout, PLOTLY_CONFIG);
  }, [figure, hostRef]);

  useEffect(() => {
    const el = hostRef.current;
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
  }, [hostRef]);

  useEffect(() => {
    const el = hostRef.current;
    return () => {
      if (el) {
        try {
          Plotly.purge(el);
        } catch {
          /* ignore */
        }
      }
    };
  }, [hostRef]);

  return <div className="plotly-host" ref={hostRef} />;
}
