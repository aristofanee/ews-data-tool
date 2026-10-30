# Scatter split preview performance

Small split counts could be slower than the combined chart: a combined
28,343-point scatter used WebGL, but four site facets fell below the 12,000
point threshold individually and created 28,343 SVG point elements.

Static scatter previews now rasterize the existing marker population on a
double-resolution canvas. Plotly still renders the axes, labels and fit
lines. This does not add sampling, and avoids retaining WebGL contexts for
each thumbnail. Continuous Z interpolation, missing-Z grey markers and log-Y
coordinates are supported. Each preview auto range includes all its finite
plottable points with 6% padding. Enlarged and export figures use their
original traces and hover metadata. Preview-only hover metadata allocation
is skipped.

In headless Edge at 1920 × 1100 with the demo dataset, the four-site split
went from 553 ms to 161–174 ms, with SVG marker elements reduced from
28,343 to zero. The two-lot split already used WebGL and remained fast
(63 ms before, 73–104 ms after). These are local observations rather than
guarantees for customer datasets.

Validation: production frontend build; `verify-scatter-preview-performance`
(known-position/color pixel checks, log exclusion, unchanged source data,
continuous-Z/log previews, axes and enlarged hover metadata);
`verify-preview-regression` (50 facets, scrolling, sizes and labels);
`verify-cache-zip-round` (remembered selections and zoom). Browser scripts
run from `tools` with Node. The startup status text “Open a file to begin”
was removed.
