# Image export audit — v0.4.3 baseline

Audited 2026-11-01 using synthetic demo data, Edge and the actual chart-card
clipboard route. No production source files were changed. The system clipboard
was intercepted, not overwritten. Images and measurements are in
`shots/image-export-audit/`; reproduce with `node tools/audit-image-exports.mjs`.

## Confirmed defects

1. **Copy exports the wrong selected split.** Open wafer 03 in Box Plot,
   Pareto or Wafer Map, then Copy: the result contains wafer 01. ChartPanel
   selects `facets[0]`, `figures()[0]` or `toDataURLs()[0]`, independently of
   the enlarged selection. The map path additionally renders all 50 images
   to copy just one. Save-all is an intentional separate behavior and should
   remain available.
   Sources: `src/components/ChartPanel.tsx:591–607`, facet export APIs.

2. **Split image filenames can collide and overwrite files.** Labels `A/B`
   and `A:B` both become `A_B`; non-ASCII removal and 80-character truncation
   create more collisions. Split Save JPG builds the same destination twice;
   native `save_binary` uses `std::fs::write`, which replaces existing content.
   This is confirmed by name transformation and source inspection; the audit
   did not overwrite any user files. Report images have numeric prefixes and
   avoid this particular within-report collision.
   Sources: `src/components/ChartPanel.tsx:651,664,686`,
   `src/lib/format.ts:74–85`, `src-tauri/src/commands.rs:507–513`.

3. **JPEG quality is not honored for Plotly exports.** `quality: 0.96` is
   passed to Plotly.toImage, but the installed Plotly encoder calls
   `canvas.toDataURL("image/jpeg")` with no quality argument. Quality 0.1 and
   0.96 produced identical output. Maps explicitly use 0.95, so quality differs
   by renderer. A shared PNG render followed by controlled JPEG encoding would
   make the quality setting effective; PNG should remain lossless.
   Sources: `ChartPanel.tsx:518–519`, `src/lib/report.ts:51–52`, installed
   `plotly.min.js` SVG-to-image encoder, `waferMap.ts:873`.

4. **Long titles are clipped.** The test title extended to x=4742 in a
   2400px logical canvas. There is no wrapping or reserved extra header height.
   Canvas map title/subtitle drawing also uses single-line `fillText` without
   width fitting. The generated `box-long-title.png` demonstrates the loss.
   Sources: `src/charts/plotlyTheme.ts:baseLayout`, `waferMap.ts:865–868`.

5. **The bin-map overview has no color legend or HBIN/SBIN label.** The
   50-wafer image renders every miniature with `showLegend:false` and adds no
   shared legend. The default title/subtitle are just Bin map / wafer count /
   yield. A standalone reader cannot identify the failure colors or bin type.
   Reports add HBIN/SBIN to their subtitle but still omit the shared legend.
   Source: `src/charts/waferMap.ts:877–960`.

6. **Sampled display context is dropped.** The app warns that scatter points
   are sampled (and that Box Plot regular markers can be sampled). The image
   contains no equivalent note or displayed/considered counts. Demo scatter
   export contains 28,343 points; its only annotation is R². The on-screen
   scatter description also explains that correlation uses all considered
   points while the fitted line uses the displayed subset. That distinction
   is absent from the exported image.
   Sources: `ChartPanel.tsx:768–774`, `src/charts/figures.ts:figureScatter`.

7. **Two lots can become indistinguishable in the box-plot image.** With
   X=wafer and Group=None, wafer ticks shorten to 01…25, then repeat for the
   second lot, with no lot headings. The audit image contains only LSL/USL
   annotations. Trend already adds lot headings in this situation. This also
   affects the interactive figure, not only export.
   Source: `src/charts/figures.ts:figureBox`, `shortTick`, `addLabelBlocks`.

## Inconsistencies and choices to resolve

- **Three export routes differ:** card Copy/Save, Plotly toolbar camera, and
  report rendering. Card and report Plotly rendering are duplicated. The
  camera uses the live figure (without the editable card title), current theme
  and view, fixed `ews-plot` filename, and scale 1.5. Card/report force light
  theme and rebuild the full figure at scale 1.25. Dark-mode camera settings
  were inspected at runtime; background was #0f1726 and no chart title was set.
- **Dimensions differ:** card/report Plotly output is 3000×1875 because
  2400×1500 is multiplied by 1.25. Maps are 2400×1500. The camera requests
  3600×2250. Same aspect ratio, inconsistent actual pixel dimensions.
- **Typography differs:** ordinary Plotly titles/axes stay near screen pixel
  sizes on a much larger logical canvas. Maps apply a separate 1.55 scale to
  map content and use different header metrics. At equal displayed image
  widths, Plotly text is noticeably smaller. Review fonts as output-relative
  sizes without changing the already approved interactive graph fonts.
- **Current view versus full plot:** Copy/Save rebuild default ranges and
  restore hidden traces. Measured screen X range [10,15] became [-0.65,49.65],
  and a hidden trace reappeared. Maps similarly create a fresh renderer,
  losing viewport zoom/pan. This is a product choice rather than inherently
  wrong. The two export buttons should have explicit, consistent semantics.
- **Standalone context:** chart-card statistics, lot/filter scope and exclusion
  counts generally do not appear in Plotly image output. Report captions help
  only while images remain inside the HTML report.
- **Dense bin legends:** individual maps show only the first 12 bins and a
  '+ more bins' count; remaining bin colors are not identified. Long software
  descriptions have no overall vertical fit/pagination policy. This is source
  inspected; not an assertion that the five-bin demo clips its legend.
- **Loading guards:** card actions stay enabled while queries change; map and
  Pareto export API refs retain old entries while the view is loading. There
  is a stale-data export risk; this was source inspected, not reproduced in
  the deterministic output run.

## Recommended order

1. Correct selected-split identity, unique filenames and readiness guards.
2. Introduce one image-export renderer/configuration shared by Copy, Save,
   camera and report. Separate logical layout size from final pixel size.
3. Add effective PNG/JPEG encoding, safe title/subtitle layout and essential
   image context (bin type, legends, sampling and lot identity).
4. Review normal and slide-sized output at actual slide dimensions for each
   chart, including long labels and large bin populations.
5. Build report-builder features on the resulting shared export pipeline.

No blank WebGL marker layers or runtime errors appeared in the audited demo
exports. This audit does not certify every production dataset or GPU.
