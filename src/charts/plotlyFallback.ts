import Plotly from "plotly.js-dist-min";
import type { Figure } from "./figures";

/** Plotly can report failed WebGL initialization without rejecting the render. */
export async function renderWithSvgFallback(
  host: HTMLElement,
  data: Figure["data"],
  layout: Figure["layout"],
  render: (data: Figure["data"], layout: Figure["layout"]) => Promise<unknown>,
  forceSvg = false,
  isCurrent = () => true,
): Promise<boolean> {
  if (!data.some(trace => trace.type === "scattergl")) {
    await render(data, layout);
    return false;
  }
  if (!forceSvg) {
    const fallbackLayout = structuredClone(layout);
    try {
      await render(data, layout);
      if (!host.querySelector(".no-webgl")) return false;
    } catch (error) {
      if (!isCurrent()) throw error;
    }
    if (!isCurrent()) return false;
    Plotly.purge(host);
    layout = fallbackLayout;
  }
  await render(data.map(trace => trace.type === "scattergl" ? { ...trace, type: "scatter" } : trace), layout);
  return true;
}
