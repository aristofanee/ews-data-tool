# Plot polish and site support

Implemented in source, without rebuilding the Windows release installer.

- Tester site is retained per die from STDF PIR/PRR, kept with the latest
  retest, and preserved through CSV import/export. Site 0 is valid; unknown
  sites remain unknown. Site is an X/group category for box, histogram, trend,
  scatter and Pareto. It is not a wafer-level map grouping.
- Pareto rates use all tested dice in each lot/wafer/group scope, including
  when bin filters hide some failures. Global, grouped, split and Others
  percentages share this denominator. Bin 1 is the pass bin.
- Pareto and bin-map labels combine HBIN/SBIN number and optional description.
  Bin-map tooltips use the matching hard/soft descriptions independently.
  Number 1 and yield are green; failure palettes contain no green.
- Value-map Group by starts with None. It still represents the unsplit mean
  map; only the selector wording/order changed.
- Box queries retain every outlier, while sampling regular markers. Both
  marker modes retain the same outliers. Double click uses reset consistently
  instead of alternating reset and autoscale.
- Both map galleries share cards, square wafer previews, bottom labels,
  green yield, and lot sections. Known physical wafer circles fit the available
  canvas rather than being shrunk by grid coordinates clipped outside them.
  Demo geometry now matches the synthetic coordinate span.
- The individual-wafer mosaic uses one backend batch query with shared base
  and outlier masks. Batch and individual results are compared in Rust tests
  for pooled and per-wafer outlier filtering.
- Map responses use an LRU cache bounded by 600,000 dice, including concurrent
  request deduplication. Imports and label mutations invalidate it before and
  after completion; old responses cannot populate a newer generation.
- Gallery thumbnails render lazily and reuse bitmaps with a separate 32 MiB
  LRU budget. Enlarged maps are remembered across tab changes. Changes to the
  test, filters, grouping or active limits reset the value-map detail view.
  Cached data is never shown under a different query while a refresh loads.

## Checks

Run `cargo test --manifest-path src-tauri/Cargo.toml --lib --offline` and
`npm run build`. The three reference-STDF tests require external fixtures and
are explicitly ignored by default. The synthetic benchmark is also opt-in.

`node tools/verify-plot-polish.mjs` starts its own temporary preview and
headless Edge session. It verifies:

- 1,569 synthetic outliers remain represented in All mode;
- all four demo sites are available;
- global/grouped Pareto denominators, numeric labels and non-green failures;
- concurrent identical cache requests share one load;
- three consecutive double clicks restore identical axis ranges;
- None appears first in the map selector;
- both 50-map galleries have equal square previews and two lot sections;
- enlarged value/bin maps survive tab round trips;
- selecting another test resets the enlarged value map;
- no uncaught browser errors.

Screenshots are saved as `shots/polish-value-maps.png`,
`shots/polish-bin-maps.png` and `shots/polish-bin-detail.png`.

One synthetic debug-build benchmark (112,500 dice, 32 tests) measured 25
individual value maps with per-wafer sigma filtering at 799 ms versus 278 ms
for the equivalent batch. These backend observations exclude parsing, IPC and
canvas rendering; they are not production-file latency guarantees.
