# Preview sizing, scatter axes and sampling explanation

The reported Site / Wafer ID box split was reproduced with 50 previews at a
2560 x 1100 viewport. The old CSS auto-row layout produced 120 intersecting card
pairs: row tracks shrank independently of the aspect-ratio-sized cards.

`PlotPreviewGrid` now measures the available width with ResizeObserver and
sets explicit column widths and 4:3 row heights. Width targets are 520 to 800
pixels per card, with a smaller fallback when the viewport cannot fit 520.
The number of plots does not affect these dimensions. Plotly hosts fill an
absolutely positioned chart area inside each card, avoiding percentage-height
intrinsic sizing cycles. Box, histogram, scatter and Pareto share this grid.

On the reproduced wide layout, cards increased from about 376 x 282 pixels to
626 x 470 pixels, and intersecting pairs dropped from 120 to zero. Resizing to
1920 and 1560 pixels was also checked for overlaps and contained chart canvases.
Off-screen plots still render lazily.

Scatter figures now use the same compact preview-axis helper as box,
histogram and Pareto figures. Both variable titles, units and ticks are shown.
Full-size figures and report exports keep their existing presentation sizing.

The vague large-N note is replaced by Rendering / Sampled display, with
Considered dice and Displayed points in the scatter statistics. A tooltip
provides the actual counts and states the calculation scopes:

- The backend draws normally at most 30,000 scatter points across all groups,
  using a stride through the considered X/Y measurement pairs.
- Correlation uses every considered finite X/Y pair after filtering.
- The frontend fit line uses the sampled points returned for display.
- Sampling changes rendering only; it does not discard imported measurements.

Box sampling help is separate: regular markers may be sampled, all outliers
are retained and box statistics use the complete considered population.

`node tools/verify-preview-regression.mjs` reproduces the original 50-box case,
checks geometry at three widths, verifies 50 scatter/Pareto cards, visible
scatter axes and the sampling explanation, and scrolls to the final lazy
scatter preview. It saves screenshots with the `shots/preview-` prefix.
