# EWS Data Tool v0.3.0

A fast, offline Windows desktop app for wafer-sort (EWS) data. Import STDF or
CSV files (including Unix-compressed `.Z`), explore seven linked plot views,
label wafers, split plots into report clusters, and generate a
PowerPoint-ready JPG report from a reusable template.

## Downloads

- **`EWS-Data-Tool-0.3.0-x64-setup.exe`** - Windows 11 x64 installer (NSIS,
  per-user install, no administrator rights required).
- **`EWS-Data-Tool-0.3.0-portable.exe`** - portable single executable; run it
  directly. WebView2 is required and is included with Windows 11.
- **`SHA256SUMS.txt`** - SHA-256 checksums for both binaries.

## What's new

### STDF correctness

- **Wafer geometry from WCR** - die width/height, wafer centre and flat
  orientation are read from the WCR record. Non-square dice now use the real
  die aspect ratio instead of square cells.
- **Units by majority vote** - when PTR/MPR records disagree about a test's
  unit, the most common non-empty unit is shown for the whole file.
- **Readable test labels** - tests display as `99999 - X1 Charging`, with the
  STDF test number, spaces instead of underscores, and units inline where the
  chart axis needs them.
- **Long paths** - the loading overlay truncates very long file paths instead of
  stretching the window.

### Maps and Bin map

- **Aggregated value maps** - duplicate coordinates are combined by the mean of
  finite values. Empty coordinates are omitted instead of being painted as
  zero. Bin maps choose the majority bin per coordinate.
- **Continuous notch** - the wafer notch is drawn as scalable geometry that
  stays crisp at every zoom level and export size.
- **Bin map tab** - every wafer is shown side by side, grouped by lot, with pass
  count, fail count and yield. Click a wafer to open an enlarged interactive
  bin map.
- **Split maps** - one value map per wafer, with a split checkbox in the Wafer
  map settings. The maps keep full hover/zoom detail and export as separate
  images.

### Pareto, scatter and box plots

- **Pareto redesign** - the 80% line is gone. Global mode includes the pass bin
  with percentages, no cumulative line, and yield in the title. Grouped mode
  stacks failure bins per group and draws a good-yield line on a secondary
  axis.
- **Visible fit line** - the scatter fit line is thicker and clearly distinct
  from the data points.
- **Control limits toggle** - show or hide LSL/USL and LCL/UCL independently of
  the specification limits.
- **Block-first box sorting** - grouped boxes are sorted by block first, then by
  the normal within-group order.

### Graphics and reports

- Units are included in chart and axis names, titles describe the selected test
  and grouping, and presentation mode uses smaller 30/23/20 px fonts so about
  six plots fit on a slide.
- JPG, clipboard and report exports are 2400x1500 with a light background and
  the title baked in.
- **Split plots** - grouped box, scatter, value-map and Bin map plots can be
  split per wafer, lot or custom label. Reports save each split as its own JPG,
  with the split in every title and filename, grouped under a cluster heading.
- Plotly and report rendering use a higher export scale, and the toolbar image
  export is sharper.

### CSV import, mapping and export

- **Preamble and metadata aware** - the importer skips report preamble rows,
  finds the real header, and consumes `Tests#`, `Unit`, `LowL` and `HighL`
  metadata rows before reading data. Metadata and limit rows are never imported
  as dice.
- **Manual column mapping** - if Lot, Wafer/OCR, X or Y cannot be detected (or
  the headers are completely custom), a dialog lets you map each key column
  before import. Long and wide CSV layouts are supported.
- **Round-trip export** - CSV export writes header + metadata + data and can be
  re-imported. Tiny values such as `1.2e-15` and very large values use
  scientific notation instead of becoming `0`.
- **Limit conflict warning** - if imported files disagree about a test's
  USL/LSL or control limits, the first non-empty value is kept and the Limits
  panel warns that the files disagree. Per-lot limit sets are not modelled yet;
  set LSL/USL explicitly for mixed-limit lots.

### Custom labels

- The label dialog stages labels independently for multiple wafer groups while
  it is open, then commits all assignments in one save. A typed label that has
  not been explicitly staged is still applied to the current selection when you
  save, so the quick single-label workflow remains one click.

## Verification

- `npm run build` - TypeScript and Vite production build passed.
- `cargo test --manifest-path src-tauri/Cargo.toml` - **15 tests passed**,
  including CSV preamble/metadata, custom-header mapping, `.Z` STDF parsing and
  tiny-number export formatting.
- `node tools/desktop-v2.mjs` - real WebView2 app: `.Z` + two STDF files,
  4,807 dice, 89 tests, 2 lots, 3 wafers; custom labels, scatter modes, box
  blocks, dark modal, clipboard, report, CSV export and re-import passed.
- `node tools/desktop-v3.mjs` - real WebView2 app: 3 Bin map tiles and enlarged
  modal, 3 split map facets, 3-image split report cluster, manual mapping of
  fully custom CSV headers, scientific tiny-number export and limit-conflict
  detection passed.

## Requirements

- Windows 11 x64 (WebView2 is included with Windows 11).
- No network access is used; all parsing, plotting and report writing happen
  locally.

## Known limitations

- ATDF (ASCII STDF) is not supported.
- Per-lot limit sets are not modelled; conflicting limits are flagged and the
  first value is shown.
- Site-level grouping is not parsed yet.
- CSV units are read from metadata or header suffixes; there is no separate unit
  editor.
- Templates store test/wafer indices, so a different test order may need plot
  adjustments after loading a template.
