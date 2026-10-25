# EWS Data Tool v0.3.1

A focused STDF scaling fix for the v0.3.0 release. All v0.3.0 features remain
unchanged: STDF/CSV import, seven linked views, Bin map, split plots, the Pareto
redesign, CSV mapping/export, staged labels and report clusters.

## Downloads

- **`EWS-Data-Tool-0.3.1-x64-setup.exe`** - Windows 11 x64 installer (NSIS,
  per-user install, no administrator rights required).
- **`EWS-Data-Tool-0.3.1-portable.exe`** - portable single executable; run it
  directly. WebView2 is required and is included with Windows 11.
- **`SHA256SUMS.txt`** - SHA-256 checksums for both binaries.

## What's fixed

### First die and STDF unit scaling

- **First-die defaults are applied** - the first PTR/MPR for a test can appear
  outside a PIR/PRR and establish the test's `RES_SCAL`, limits, units and
  `C_RESFMT` defaults. Later records may omit those fields or mark `RES_SCAL`
  invalid. The parser now keeps the defaults and applies them to the first die
  instead of reading its raw base-unit value.
- **One display scale per test** - explicit `RES_SCAL` values are counted across
  the file. The majority value is used for the whole test (ties go to the first
  explicit value), and every finite result and limit is normalized to that
  scale. This retroactively scales the first die even when its own record
  omitted or disagreed about `RES_SCAL`.
- **Correct display units** - units are derived from STDF `UNITS` plus the
  chosen `RES_SCAL` (`a` + 6 -> `ua`, `a` + 3 -> `ma`, `hz` - 3 -> `khz`) and
  `C_RESFMT` is used as a hint when the tester recorded a different spelling
  (`Khz`, `%`, `m`). Limits, spec limits and the Limits panel use the same
  scaled unit as the values.
- **MPR results included** - each result in a multiple-result parametric record
  shares the test's chosen scale and unit, including results from the first die.
- **Limit conflicts preserved** - differing raw limits still retain the first
  effective value and set the existing conflict warning, now in the normalized
  display unit.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml --lib` - **19 tests passed**,
  including new regressions for:
  - a first die whose PTR omits `RES_SCAL`, limits and units while a default PTR
    outside PIR/PRR supplies them;
  - a first die recorded at `RES_SCAL=0` followed by dice at `RES_SCAL=6`;
  - SI-prefixed unit derivation from `RES_SCAL` and `C_RESFMT`;
  - a 1 pA limit difference that must still be reported as a conflict after
    scaling.
- `npm run build` - TypeScript and Vite production build passed.
- `node tools/desktop-v2.mjs` - real WebView2 app: `.Z` + two STDF files,
  4,807 dice, 89 tests, 2 lots, 3 wafers. The exported CSV shows `[ua]` for test
  1100 (first value `-268.125`), `[Khz]` for test 1270 (first value `95.60611`)
  and `[ma]`, `[%]`, `[m]` for the other scaled tests. Custom labels, scatter
  modes, box blocks, dark modal, clipboard, report, CSV export and re-import
  passed.
- `node tools/desktop-v3.mjs` - real WebView2 app: 3 Bin map tiles and enlarged
  modal, 3 split map facets, 3-image split report cluster, manual mapping of
  fully custom CSV headers, scientific tiny-number export and limit-conflict
  detection passed.

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
