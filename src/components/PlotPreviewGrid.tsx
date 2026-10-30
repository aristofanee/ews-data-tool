import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Explicit track heights avoid grid/percentage-canvas intrinsic-size cycles.
 * Card size depends on the viewport, never on how many plots are present. */
export function PlotPreviewGrid({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      if (width < 1) return;
      const gap = parseFloat(getComputedStyle(el).columnGap) || 16;
      const columns = Math.max(1, Math.floor((width + gap) / (520 + gap)));
      const cardWidth = Math.min(800, (width - gap * (columns - 1)) / columns);
      el.style.gridTemplateColumns = `repeat(${columns}, ${cardWidth}px)`;
      el.style.gridAutoRows = `${Math.ceil(cardWidth * 3 / 4)}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <div className="facet-grid" ref={ref}>{children}</div>;
}
