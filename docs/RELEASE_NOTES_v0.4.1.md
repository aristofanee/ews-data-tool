# EWS Data Tool v0.4.1

CSV product metadata support and improvements for laptop plotting workflows.

## Downloads

- `EWS-Data-Tool-0.4.1-x64-setup.exe`: Windows x64 installer, per-user installation.
- `EWS-Data-Tool-0.4.1-portable.exe`: portable application; requires WebView2.
- `EWS-Data-Tool-0.4.1-Windows-x64.zip`: builds, notes and checksums.

## CSV imports

- Read pre-header wafer diameter, die width/height in mm, notch position,
  integer centre coordinates and soft-bin descriptions. The preamble uses
  the same delimiter as the data table.
- Support confirmed for DIE_X, DIE_Y, SITE, WAFER_ID, LOT_ID and post-header
  HighL/LowL aliases, with column-aligned units and limits.
- Missing/invalid bins appear as grey Unknown bins, not bin 1. Unknown bins
  are excluded from Pareto failure bars/counts. Affected bin yields show N/A;
  LSL/USL test yield remains independent.
- The desktop **Metadata** button fills missing geometry and bin descriptions
  from one same-product STDF or .Z reference file. Existing metadata is kept;
  conflicting reference geometry is rejected. Measurements, die bins and
  test limits/units are not transferred from the reference.
- UTF-8 CSV parsing avoids a whole-file text copy; cached lot/wafer indices
  avoid repeated name scans. CSV parser errors propagate instead of silently
  ending the import.

## Plotting

- New imports reset plot settings, filters, report contents and presentation
  settings. Normal fonts are the default; slide-sized fonts remain optional.
- Larger graph text adopts the reviewed +5px setting. X/Y axis text sizes
  match; plot-box header sizes stay fixed. The browser demo includes a live
  font slider for further tuning.
- Smaller preview cards on laptop viewports, preserving larger desktop cards.
- Keep the enlarged wafer/Pareto group open when switching HBIN/SBIN.
- Pareto defaults to the top 10 bins.
- Trackpad pinch events are captured over map overlays as well as the canvas.
- Scatter X follows the main selected test; only Y has a separate selector.
- HBIN descriptions are hidden in graphs; SBIN descriptions remain visible.

## Validation and limits

- Native suite: 40 passed; six external-fixture/benchmark tests intentionally
  skipped. Coverage includes CSV preambles, aliases, missing bins, limits/units,
  exact measurements, metadata extraction and preservation of existing data.
- Browser checks passed for laptop layout, reset behavior, scatter selection,
  HBIN/SBIN switching, pinch events and the reviewed font sizes.
- TypeScript/Vite and optimized Tauri/NSIS builds passed. The built Windows
  executable passed WebView2/native IPC checks for ZIP/.Z import, retests,
  CSV metadata and reference-STDF metadata import, with no page errors.

CSV testing here uses synthetic/public data. Interspersed metadata, extended
long-format metadata, fractional wafer-centre coordinates and nested/encrypted
ZIPs are unsupported. Physical trackpad behavior still needs validation on
the work laptop. Processing is local; WebView2 is required.
