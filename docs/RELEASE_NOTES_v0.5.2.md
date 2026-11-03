# EWS Data Tool v0.5.2

- Mean-map export counts now count plotted mean coordinates against the colour range.
- Import STDF positive X/Y directions for wafer maps, including metadata-only imports into CSV datasets.
- Sort wafers naturally in the custom-label editor without changing assignments.
- Search report repair replacements using the same searchable controls as Scatter.
- Fix double-click reset after middle-button plot panning.
- Improve large-map panning through cached full-resolution rendering and frame coalescing.
- Fix map legends and thumbnails being softened by fractional display scaling.

Validation: native tests, browser regression checks and Windows/WebView2 smoke test with synthetic data. Existing CSV precision and mixed-column inference limitations remain documented in the general audit.
