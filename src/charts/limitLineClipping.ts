/** Keep the complete stroke when a spec line sits exactly on an axis boundary.
 * Only those boundary lines bypass Plotly's shape clip. Data clipping and the
 * numeric range stay unchanged, and zoomed-outside limit lines remain clipped.
 */
export function restoreBoundaryLimitLines(host: HTMLElement) {
  const layout = (host as any)._fullLayout;
  if (!layout) return;
  for (const group of host.querySelectorAll<SVGGElement>(".shapelayer .shape-group")) {
    const shape = layout.shapes?.[Number(group.getAttribute("data-index"))];
    if (shape?.name !== "ews-spec-limit") continue;
    const vertical = shape.xref === "x" && shape.x0 === shape.x1;
    const axis = layout[vertical ? "xaxis" : "yaxis"];
    const value = vertical ? shape.x0 : shape.y0;
    const position = axis?.type === "log" ? Math.log10(value) : value;
    const range: number[] | undefined = axis?.range;
    const boundary = range?.some(v => Math.abs(v - position) <= Math.max(Math.abs(v), Math.abs(position), Number.MIN_VALUE) * 1e-12);
    const clip = group.getAttribute("clip-path");
    if (clip && clip !== "none") group.dataset.limitClip = clip;
    if (boundary) group.setAttribute("clip-path", "none");
    else if (group.dataset.limitClip) group.setAttribute("clip-path", group.dataset.limitClip);
  }
}

/** Composite boundary strokes above the rasterized axis borders in exports. */
export function drawExportBoundaryLimits(host:HTMLElement,ctx:CanvasRenderingContext2D,top:number){
  const layout=(host as any)._fullLayout;if(!layout)return;
  ctx.save();ctx.translate(0,top);
  for(const group of host.querySelectorAll<SVGGElement>('.shapelayer .shape-group')){
    const shape=layout.shapes?.[Number(group.getAttribute('data-index'))];
    if(shape?.name!=='ews-spec-limit')continue;
    const vertical=shape.xref==='x'&&shape.x0===shape.x1,axis=layout[vertical?'xaxis':'yaxis'];
    const value=vertical?shape.x0:shape.y0,position=axis?.type==='log'?Math.log10(value):value;
    if(!axis?.range?.some((v:number)=>Math.abs(v-position)<=Math.max(Math.abs(v),Math.abs(position),Number.MIN_VALUE)*1e-12))continue;
    const path=group.querySelector<SVGPathElement>('path'),d=path?.getAttribute('d');if(!path||!d)continue;
    const style=getComputedStyle(path);
    ctx.strokeStyle=style.stroke;ctx.lineWidth=parseFloat(style.strokeWidth)||1;
    ctx.globalAlpha=(parseFloat(style.opacity)||1)*(shape.opacity??1);
    ctx.setLineDash(style.strokeDasharray==='none'?[]:style.strokeDasharray.split(/[ ,]+/).map(parseFloat).filter(Number.isFinite));
    ctx.stroke(new Path2D(d));
  }
  ctx.restore();
}
