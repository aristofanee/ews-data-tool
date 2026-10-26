# EWS Data Tool v0.3.3

A map, chart and report polish release. It adds an all-wafer mean map, makes
large split-map and Bin-map collections easier to scan, removes pass bins from
the Pareto chart, and fixes several rendering details in limits, outliers and
scatter fits.

## Downloads

- **`EWS-Data-Tool-0.3.3-x64-setup.exe`** - Windows 11 x64 installer (NSIS,
  per-user install, no administrator rights required).
- **`EWS-Data-Tool-0.3.3-portable.exe`** - portable single executable; run it
  directly. WebView2 is required and is included with Windows 11.
- **`SHA256SUMS.txt`** - SHA-256 checksums for both binaries.

## What's new

### All-wafer mean map

- The Wafer map tab now defaults to **All wafers (mean)**. Every selected
  wafer contributes to one die-by-die mean map, so lot-level behaviour is
  visible without opening each wafer separately.
- The map header and stats panel show the number of contributing wafers and
  how many dice were excluded by the active statistical filter.
- Pick a specific wafer from the Wafer selector at any time. Split maps still
  show one map per wafer.
- The report builder understands the mean scope and writes it into the report
  subtitle and filename.

### Full-size map detail for split maps and Bin maps

- Split wafer-map tiles and Bin-map tiles are now larger, pattern-only
  previews. They do not capture the wheel, so the mosaic scrolls normally.
- Click any preview to open the shared full-size detail view with the legend,
  hover values and zoom/pan. Use **All maps** to return, the arrow buttons to
  step through wafers, or the left/right arrow keys. Escape also returns to the
  mosaic.
- The detail view replaces the old Bin-map modal and keeps the same chart body
  as the single-map tab.

### Faster split charts

- Split box, scatter, histogram, trend and Pareto facets are built lazily as
  they approach the visible part of the scroll area. Large split scatters no
  longer freeze while every Plotly chart is constructed up front.
- Split facet labels stay above the plots; the duplicate in-plot title is gone
  on screen. Exported JPGs still contain the full title.

## What's fixed and improved

- **Pareto** global mode now shows failing bins only. Percentages remain
  relative to all tested dice, so the pass bin no longer occupies a bar.
- **Pooled outlier limits** on a single-wafer map are computed across every
  selected wafer, not just the wafer being displayed. Per-wafer mode still
  uses each wafer's own limits.
- **Limit lines** are drawn as a single line above the grid, and the white
  background behind USL/LSL labels has been removed so it cannot cover the
  line.
- **Boxplot outliers** use thin orthogonal crosses instead of dots. The
  `All` points mode keeps small dots for dense boxes.
- **Scatter fit lines** are composited above WebGL markers, so the least-squares
  line remains visible even with dense point clouds.
- **Wafer maps** cache the static die layer and redraw only the hover
  highlight. Pinch and scroll zooming use a smooth continuous factor.
- **Map values** that are whole numbers are displayed without misleading
  trailing decimals; fractional mean values remain readable.
- **Bin-map legend** counts have more room at the right edge.
- **Wafer map tab** is now value-only; use the **Bin map** tab for hard-bin
  maps. The redundant Value/Bin switch has been removed from the Wafer map
  inspector.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml --lib` - **20 tests passed**,
  including the reference STDF file, compressed `.Z` fixture, CSV wide/long
  import, scaling, limits, all-wafer means, pooled outlier limits and the query
  pipeline.
- `npm run build` - TypeScript and Vite production build passed.
- `node tools/desktop-v2.mjs` - real WebView2 app: `.Z` + two STDF files,
  4,807 dice, 89 tests, 2 lots, 3 wafers. Custom labels, scatter modes, box
  blocks, dark modal, clipboard, report, CSV export and re-import passed.
- `node tools/desktop-v3.mjs` - real WebView2 app: Bin map tiles and the shared
  full-size detail view, split map previews and detail navigation, report split
  clusters, manual mapping of fully custom CSV headers, scientific tiny-number
  export and limit-conflict detection passed.
- `node tools/desktop-v5.mjs` - focused checks for split-map preview scrolling,
  enlarged-map legends, Bin-map legend spacing, split-facet titles and
  single-line limits passed.

## Requirements

- Windows 11 x64 (WebView2 is included with Windows 11).
- No network access is used; all parsing, plotting and report writing happen
  locally.

## Known limitations

- Per-test scaling is resolved within each STDF file. If two loaded files use
  different display scales for the same test name, the merged column keeps the
  first file's unit; mixed-scale files are not converted across files yet.
- ATDF (ASCII STDF) is not supported.
- Per-lot limit sets are not modelled; conflicting limits are flagged and the
  first value is shown.
- Site-level grouping is not parsed yet.
- CSV units are read from metadata or header suffixes; there is no separate unit
  editor.
- Templates store test/wafer indices, so a different test order may need plot
  adjustments after loading a template.
