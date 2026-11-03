# Workstation feedback fixes — 2026-11-03

Included in v0.5.2.

- Mean-map export counts now describe the plotted mean coordinates. Previously
  the source measurements were compared against the mean map's colour range,
  so a mean could be inside while every contributing source value was outside.
  Total and In Limits both use finite plotted means, with inclusive boundaries.
  Physical wafer yield and measurement-based test yield remain source statistics.
- Preserve WCR POS_X (L/R) and POS_Y (U/D) through STDF parsing, dataset merge,
  metadata-only reference import and the frontend. The renderer applies those
  directions to die placement, hover outlines and hit testing, including exports
  and thumbnails. Unknown directions retain the previous right/up convention.
  Raw die coordinates and measurement values are unchanged.
- Sort the custom-label editor naturally by lot and wafer identity. Checkbox
  assignments retain the original dataset index; the dataset is not reordered.
- Report replacement fields use the same searchable combobox implementation as
  Scatter Y/Z. Filtering, keyboard navigation and current-selection restoration
  are shared; dependent repair fields remain nested and blocked as appropriate.
  Popup text width is measured once per opening rather than on every scroll.
- Double-click reset detects the second mouse press before Plotly's drag handlers
  can suppress the later dblclick event. Rebuilding default auto ranges is
  explicit, so re-rendering a panned plot cannot turn that pan into its default.
- Map pan/zoom events are coalesced to one drawing frame. Die paths, coordinate
  bounds and legend rasters are reused. Interactive maps keep a full-resolution
  viewport raster with 128 CSS pixels of overscan per side; small pans translate
  that raster while the legend stays fixed. Crossing its boundary or changing
  zoom rebuilds it. Exports use their original resolution with no overscan.

The raster cache uses a bounded extra margin rather than allocating an image of
the complete wafer at high zoom. No source dice are sampled or removed, and no
rendering resolution is reduced. Panning snaps bitmap translations to physical
pixels, differing from the logical pointer position by at most half a pixel.

## Validation

- Native metadata tests verify L/D directions survive metadata-only import into
  CSV data without changing rows, measurements, bins or source provenance.
- `verify-scatter-z-search.mjs`: existing Scatter dropdown behaviour preserved.
- `verify-report-resolution.mjs`: nested mappings and report generation work
  through searchable replacement controls.
- `verify-workpc-fixes.mjs`: plotted mean counts, mirrored die colours and hit
  testing, natural wafer ordering with correctly indexed assignments, repeated
  middle-button-pan/double-click-reset on Box Plot, Histogram, Scatter, Trend
  and Pareto, including a re-render while panned.
- The 50,000-die, 1920 × 1000 CSS-pixel map test at 125% scaling coalesces 30 pan
  updates into one frame without repainting geometry. A local headless-browser
  run measured about 14 ms for cached pans versus 543 ms with forced rebuilding
  and a readback to synchronize rendering. These are synthetic timings, not a
  claim about the work laptop's frame rate; its real-data performance still needs
  confirmation there.
- Export-range regression checks cover source/mean counts and lot-overview image
  dimensions and legends. Production frontend build and native suite also run.
