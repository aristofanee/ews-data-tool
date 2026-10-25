# EWS Data Tool v0.2.0

A fast, offline Windows desktop app for wafer-sort (EWS) data. Import STDF or
CSV files (including Unix-compressed `.Z`), explore six plot types, label wafers
with custom columns, then generate a PowerPoint-ready JPG report from a reusable
template.

## Downloads

- **`EWS-Data-Tool-0.2.0-x64-setup.exe`** — Windows 11 x64 installer (NSIS,
  per-user install, no administrator rights required).
- **`EWS-Data-Tool-0.2.0-portable.exe`** — portable single executable; run it
  directly. WebView2 is required and is included with Windows 11.
- **`SHA256SUMS.txt`** — SHA-256 checksums for both binaries.

## What's new

- **Compressed STDF import** — `.Z` (Unix `compress`/LZW) files open through the
  normal file picker, in addition to `.stdf`, `.std` and CSV/TXT.
- **Scatter plots** — choose X and Y tests, optional Z colour from a test
  (continuous colour bar) or a category column, and an optional fit line with
  Pearson r / R².
- **Custom wafer labels** — create a column such as `Split`, assign labels to
  selected wafers, edit or delete assignments. Use the column to block/colour
  box plots or as a scatter category. A text `Split` column added in Excel and
  imported from CSV is picked up automatically as a wafer-level custom column.
- **OCR wafer grouping** — use the STDF WIR wafer ID (with its lot) as a scatter
  or box grouping key.
- **Presentation sizing** — larger fonts, thicker lines and stronger markers so
  roughly six plots stay legible on a slide. The toggle is on by default and can
  be turned off for dense on-screen exploration.
- **PowerPoint-ready exports** — JPG and clipboard images are rendered on a light
  background at 1800×1100 with the title baked in, even when the app is in dark
  mode. Batch report JPGs are always light and include titles/subtitles.
- **Fixed program icon** — regenerated from a high-contrast blue/yellow SVG; the
  black-box placeholder is gone.
- **Templates and reports** — templates and `report.json` now persist custom
  label columns; CSV export includes them as extra columns.

## Verified with real STDF data

The release was exercised against three reference STDF files, with the first
opened as `demofile.stdf.Z` (2 lots, 3 wafers, 4,807 dice, 89 tests):

- `.Z` import produced the same 4,807 dice and 89 tests as the uncompressed
  reference files.
- Custom `Split` labels: `Split A` on two wafers and `Split B` on one; box-plot
  block annotations and scatter category legend verified.
- Scatter modes verified: no Z, continuous colour bar, OCR wafer categories
  (`lot / wafer`) and custom `Split` categories.
- Presentation toggle changed axis tick text from 11 px to 32 px.
- Dark-theme label modal and chart inspected; exported clipboard image was
  1800×1100 with a light background and title.
- Batch report: **5 JPGs + `index.html` + `report.json`**, all light; report.json
  contained the custom columns.
- JPG export, clipboard copy, template-style custom-column restore and CSV export
  (4,807 rows including `Split`) verified.
- Re-importing that CSV restored `Split` as a custom column with the same
  `Split A` / `Split B` wafer assignments.
- Delete-column confirmation and backend cleanup verified.
- Rust test suite: 11 tests passing, including `.Z`, wide/long CSV, Excel-style
  text `Split` columns and custom-column merge remapping.

## Requirements

- Windows 11 x64.
- Microsoft Edge WebView2 runtime (preinstalled on Windows 11; the installer
  can bootstrap it if missing).
- No network connection is needed after installation.

## Known limitations

- ATDF (ASCII STDF) is not supported yet; non-CSV files are sent to the STDF V4
  parser.
- CSV units are auto-detected from headers such as `name [unit]`; there is no
  separate column picker or unit editor yet.
- Filters cover lot, wafer, hard/soft bin, pass-only and IQR/k·sigma; date,
  site, die-range and edge-exclusion filters are not exposed yet.
- Site-level grouping is not parsed yet.
- Custom labels are session data, not written back to STDF. They are included in
  templates, CSV exports and `report.json`. Text metadata columns from CSV are
  imported as wafer-level labels; per-die metadata is not supported.
- Categorical scatter series can overlap heavily when wafers track the same
  distribution; the legend and marker shapes distinguish them, but the top
  series may cover points underneath.
- Templates store test/wafer indices, so they are directly reusable across lots
  from the same test program. A dataset with a different test order may need
  plot adjustments after loading a template.
- The installer is unsigned, so Windows SmartScreen may show a warning on first
  run.

## Build from source

See the [README](https://github.com/aristofanee/ews-data-tool#desktop-app-recommended)
for the Node.js + Rust toolchain steps and the desktop end-to-end test command.
