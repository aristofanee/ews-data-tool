# EWS Data Tool v0.1.0

A fast, offline Windows desktop app for wafer-sort (EWS) data. Import STDF or
CSV files, explore box plots, wafer maps and Pareto charts, then generate a
complete JPG report from a reusable template.

## Downloads

- **`EWS-Data-Tool-0.1.0-x64-setup.exe`** — Windows 11 x64 installer (NSIS,
  per-user install, no administrator rights required).
- **`EWS-Data-Tool-0.1.0-portable.exe`** — portable single executable; run it
  directly. WebView2 is required and is included with Windows 11.
- **`SHA256SUMS.txt`** — SHA-256 checksums for both binaries.

## Highlights

- **STDF V4 and CSV/TXT import** — columnar Rust parser, both endiannesses,
  PTR/MPR/PRR/PIR/MIR/WIR/WRR/PCR/HBR/SBR/TSR records, automatic units and
  test limits.
- **Focused plots** — box plots (by wafer or lot), value/bin wafer maps,
  failure Pareto, histogram and trend, all with zoom/pan and hover provenance.
- **Real EWS analysis** — LSL/USL and control limits, CP/CPK, IQR and k·sigma
  outlier filters, pass-only / hard-bin / soft-bin / lot / wafer filters.
- **Templates and batch reports** — save every report plot, its filters and
  theme to one JSON file; load it on new data and write numbered JPGs plus an
  `index.html` contact sheet and `report.json` in one click.
- **Output** — JPG, clipboard image, plotted-data CSV, and STDF-to-CSV export.
- **Light and dark themes**, blue/yellow brand palette, fully offline with no
  telemetry.

## Verified with real STDF data

The release was exercised against three reference STDF files (2 lots, 3 wafers,
4,807 dice, 89 tests):

- Wafer map yield: **85.11%** (1,378 pass / 241 fail on the first wafer).
- Pareto: **662 failures**, 11 fail bins, top bin **Bin 8 · 33.4%** (pass bin
  excluded by default).
- Batch report: **4 JPGs + `index.html` + `report.json`** generated without
  errors.
- Clipboard image copy, JPG/PNG file writes and CSV export (1,963,457 bytes,
  4,807 rows, units in the header) verified.

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
- Templates store test/wafer indices, so they are directly reusable across lots
  from the same test program. A dataset with a different test order may need
  plot adjustments after loading a template.
- The installer is unsigned, so Windows SmartScreen may show a warning on first
  run.

## Build from source

See the [README](https://github.com/aristofanee/ews-data-tool#desktop-app-recommended)
for the Node.js + Rust toolchain steps and the desktop end-to-end test command.
