# EWS Data Tool v0.4.0

Import correctness, compressed-input performance and plotting improvements
for validation with production wafer-sort data.

## Downloads

- `EWS-Data-Tool-0.4.0-x64-setup.exe`: Windows x64 per-user installer.
- `EWS-Data-Tool-0.4.0-portable.exe`: standalone executable; requires WebView2.
- `SHA256SUMS.txt`: SHA-256 checksums for both executables.

## Import and data correctness

- Open ZIP archives containing STDF or Unix-compressed `.Z` files, including
  folders, without extracting them manually. Stored/Deflate ZIP compression
  is supported; unrelated members are skipped. Invalid members and CRC errors
  abort the import while preserving the previously loaded dataset.
- Faster `.Z` decoding removes adapter copies and reads whole LZW codes.
  A public-fixture debug benchmark measured about 34% lower decoder time;
  production-file and release-build results may differ.
- STDF parser allocations and per-file merge work are reduced.
- Interleaved multisite records are matched by tester head and site. Tester
  Site is available for grouping and survives CSV export/import.
- Retested dice with the same lot, wafer and X/Y keep the latest complete
  attempt everywhere, including CSV exports. Earlier measurements are not
  used to fill missing values in the latest attempt. A warning reports the
  replaced attempts. Later records/files, and later ZIP members, win.
- Test identity includes test number, name and units to avoid merging
  unrelated measurements.
- Box statistics use the full considered population despite display sampling;
  all detected outliers remain available in both point display modes.
- Wafer yield is HBIN 1 divided by all tested dice. Test yield uses considered
  finite measurements inside LSL/USL. Pareto percentages use all tested dice
  in the selected scope rather than only failures.

## Plotting and interface

- Site grouping, numeric HBIN/SBIN labels plus available descriptions,
  brighter yield/bin-1 green and non-green failure-bin colors.
- Group-first contiguous box plots with headers, corrected outlier display
  and double-click reset, and independent Pareto Fail/Yield axes.
- Consistent larger previews with readable axes and no overlapping rows.
  Scatter previews use canvas markers without additional point sampling.
  Enlarged plots retain hover and zoom interactions.
- Matching wafer/bin map sizing, titles and lot grouping; batch map queries
  and lazy previews improve large collections.
- Bounded query caches and remembered enlarged plots, zoom and legend
  visibility across tabs. Changed query settings use a fresh view.
- Slide-sized fonts are global. Simplified home page and attached wafer notch.

## CSV and reports

CSV export preserves the latest imported attempts and tester Site; statistical
plot filters do not remove measurements from exports. Existing lot/wafer/bin
selection filters still apply. Existing report and image export workflows
remain available; this release primarily improves import and visualization.

## Limits and testing focus

- ZIP encryption, nested ZIPs, gzip and ATDF are unsupported.
- Conflicting per-lot limit sets are flagged; separate per-lot limits are not
  modeled. Templates use test/wafer indices, so different input ordering may
  require adjustments.
- Only synthetic/public fixtures were used here. Validate die counts, latest
  retests, tester Site, limits/scaling, yields, ZIP import time and plotting
  responsiveness against known production results on the work PC.
- All data processing remains local. WebView2 must be installed on the test PC.

## Verification

- TypeScript/Vite production build and optimized Tauri/NSIS build passed.
- Native suite: 37 passed, six intentionally skipped external-fixture or
  performance tests. Browser capability/yield and cached-view checks passed.
- The built 0.4.0 Windows executable passed WebView2/native IPC checks using
  a synthetic Deflate ZIP containing two nested `.Z` members and one raw STDF.
  Three attempts became two dice with the latest retest retained; Site values,
  exact values/mean, 50% failure/yield rates and CSV roundtrip were verified.
  A failed subsequent import preserved the loaded dataset. Chart startup and
  reload hydration passed with no page errors.
