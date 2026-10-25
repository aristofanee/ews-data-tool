# EWS Data Tool v0.3.2

A wafer-map performance and centring patch for STDF datasets with physical WCR
geometry. All v0.3.1 import, scaling, plotting, label, report and export
behaviour is unchanged.

## Downloads

- **`EWS-Data-Tool-0.3.2-x64-setup.exe`** - Windows 11 x64 installer (NSIS,
  per-user install, no administrator rights required).
- **`EWS-Data-Tool-0.3.2-portable.exe`** - portable single executable; run it
  directly. WebView2 is required and is included with Windows 11.
- **`SHA256SUMS.txt`** - SHA-256 checksums for both binaries.

## What's fixed

### STDF wafer maps no longer stall on redraw

- The flat/notch was being used as the clip path for every die. WebView2/Skia
  fell back to a slow per-rectangle mask, so a map with 50,000 dice could take
  seconds per hover redraw.
- The renderer now clips dice to a plain circle and cuts the flat/notch back out
  with a background-coloured overlay after drawing the dice. The notch and
  outline look the same as before.
- Dice are batched into one `Path2D` per colour instead of one `fillRect` per
  die, and bin counts are cached until the map data changes.
- On a synthetic 500,000-row STDF (10 wafers × 50,000 dice, 300 mm WCR, 1 mm
  dice, flat D), 120 pointer moves dropped from ~226 s to ~0.4 s. The Bin map
  dropped from ~4.1 s to ~1.3 s and the 10-wafer split map from ~78.5 s to
  ~2.5 s. The equivalent CSV also improved, from ~12.6 s to ~0.7 s for the same
  hover sweep.

### STDF maps centre correctly with placeholder WCR centres

- WCR `CENTER_X`/`CENTER_Y` are only used when physical die dimensions exist
  and the centre is near the tested die bounds. Files that store a placeholder
  such as `128/128` while the dice span `4..45` now fall back to the
  bounding-box centre instead of drawing the map off-canvas. Legacy CSV grids
  always use the bounding-box centre.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml --lib` - **19 tests passed**,
  including the reference STDF file, compressed `.Z` fixture, CSV wide/long
  import, scaling, limits and query pipeline.
- `npm run build` - TypeScript and Vite production build passed.
- `node tools/desktop-v2.mjs` - real WebView2 app: `.Z` + two STDF files,
  4,807 dice, 89 tests, 2 lots, 3 wafers. Custom labels, scatter modes, box
  blocks, dark modal, clipboard, report, CSV export and re-import passed.
- `node tools/desktop-v3.mjs` - real WebView2 app: 3 Bin map tiles and enlarged
  modal, 3 split map facets, 3-image split report cluster, manual mapping of
  fully custom CSV headers, scientific tiny-number export and limit-conflict
  detection passed.
- The reference STDF wafer map now renders centred and its pixel content
  matches the equivalent CSV map. The map remains interactive with hover,
  zoom/pan and split facets.
- Large synthetic benchmark as described above; the same STDF map renders
  centred, clips at the wafer edge and hit-tests correctly.

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
