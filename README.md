# EWS Data Tool

A fast, offline Windows desktop app for wafer-sort (EWS) data. Open STDF or CSV
files, explore box plots, wafer maps and Pareto charts, then generate a complete
JPG report from a reusable template.

Built with **Tauri 2 + Rust** for parsing/aggregation and **React + Plotly** for
the charts. The wafer map is a custom canvas renderer for precise die grids,
hover values, zoom/pan and high-resolution JPG export.

![Box plot](shots/01-box-light.png)

## Highlights

- **Fast, local and compact** — Rust parses STDF/CSV in the background; the
  installer is about 3 MB and nothing leaves the machine.
- **Three focus plots** — box plots (by wafer or lot), value/bin wafer maps and
  failure Pareto charts, plus histogram and trend views.
- **Real EWS features** — LSL/USL and control limits, CP/CPK, IQR and k·sigma
  outlier filters, pass-only / bin / lot / wafer filters, hover provenance
  (die X/Y, bin, value), log axes, per-plot Y limits.
- **Templates that build reports** — save every report plot, its filters and
  theme to one JSON file; load it on new data and generate all JPGs in one click.
- **STDF → CSV** — use the same import as a converter.
- **Blue + yellow design** with light and dark themes.

| Wafer map | Pareto |
| --- | --- |
| ![Wafer map](shots/02-map-light.png) | ![Pareto](shots/03-pareto-light.png) |

| Histogram | Report builder |
| --- | --- |
| ![Histogram](shots/04-hist-light.png) | ![Report builder](shots/08-report-drawer.png) |

## Getting started

### Desktop app (recommended)

Download the latest Windows installer from the
[Releases](https://github.com/aristofanee/ews-data-tool/releases/latest) page,
or build it locally:

```powershell
npm install
npm run tauri dev      # development window
npm run tauri build    # release build + NSIS installer
```

Build output:

- `src-tauri\target\release\ews-data-tool.exe`
- `src-tauri\target\release\bundle\nsis\EWS Data Tool_0.1.0_x64-setup.exe`

### Browser preview

```powershell
npm run dev
```

Open <http://127.0.0.1:1420> and click **Load demo data**. The browser build uses
a synthetic dataset so the UI can be explored without Tauri; file dialogs, batch
report export and real file parsing require the desktop app.

## Using the app

1. **Open data** (`Ctrl+O`) and pick one or more STDF/CSV files. Files are merged
   into one dataset; duplicate dice are kept as separate rows.
2. Use the **Filters** panel to narrow by lot, wafer, hard bin, pass dice or a
   statistical outlier rule. The test list selects the parameter.
3. Pick a plot tab (`Ctrl+1` … `Ctrl+5`). The **Plot settings** panel on the
   right controls grouping, spec/control limits, Y range, map palette and more.
4. **Add to report** collects the current plot. Use **All selected wafers** (on a
   map) or **All tests** (on box/hist/trend) to batch-add plots.
5. In **Report builder**, choose an output folder and **Generate JPGs**. The app
   writes numbered JPGs, an `index.html` contact sheet and `report.json`.
6. **Save template** (`Ctrl+S`) stores the report and settings; **Load template**
   applies them to new data. Templates include the light/dark theme.
7. **Save as JPG** exports the current chart at 1800×1100; **Copy image** puts it
   on the clipboard. **Export CSV** (`Ctrl+E`) writes the filtered dataset.

Map interaction: scroll to zoom, drag to pan, double-click to reset. Plotly
charts support hover, box zoom and pan from the mode bar.

## Data formats

### STDF

- STDF **V4** (`.stdf`, `.std`), little- or big-endian.
- Records used: FAR, MIR, WIR, PIR, PTR, MPR, PRR, PCR, HBR, SBR, TSR, WRR, MRR.
- Test names, units, limits and scaling are read from the STDF records.
- Tolerant of older writers: unpadded `Cn` strings, omitted trailing
  `LO_SPEC`/`HI_SPEC` fields and `0x00` bin pass flags are handled.
- ATDF (ASCII STDF) is **not supported yet**; non-CSV files are sent to the
  STDF V4 parser.

### CSV / TXT

The importer detects the delimiter (`,` `;` tab `|`), UTF-8/UTF-16 encodings,
and two layouts.

**Wide** — one row per die, one column per test:

```csv
Lot,Wafer,X,Y,HBIN,SBIN,Vt_nch [V],Idsat [uA/um],Rds_on [ohm]
L24-0417,01,0,-22,1,1,0.41515,521.89,12.741
L24-0417,01,-6,-21,1,1,0.41439,488.87,13.352
```

- Key columns are recognised by name: `Lot`, `Wafer`, `X`, `Y`, `HBIN`, `SBIN`.
- Every other numeric column becomes a test. Units are read from a trailing
  `[unit]` or `(unit)` in the header.
- Decimal commas are accepted when the delimiter is not a comma.

**Long** — one row per measurement:

```csv
Lot,Wafer,X,Y,HBIN,Test,Value
L24-0417,01,-6,-21,1,Vt_nch,0.41439
L24-0417,01,-6,-21,1,Idsat,488.87
```

Column mapping is automatic. A manual column picker / unit editor is not in this
version yet.

### Synthetic sample data

```powershell
node tools/make-sample-data.mjs          # 2 lots x 10 wafers, ~30k dice
node tools/make-sample-data.mjs --full   # 2 lots x 25 wafers, ~232k dice
```

This writes `sample-data/sample-wide.csv` (units in headers) and
`sample-data/sample-long.csv`. Values include lot/wafer drift, radial and edge
signatures and realistic bin failures.

## Performance

- STDF is memory-mapped and parsed record-by-record; CSV is streamed.
- Values are stored as one `f32` column per test, so a lot with 25 wafers ×
  4,500 dice × 500 tests is about 225 MB of measurement data.
- Aggregation (box stats, histograms, Pareto counts, trend means) runs in Rust
  on a blocking worker; only summaries and the selected map/outlier points cross
  into JavaScript.
- Box plots cap plotted outlier points to keep the UI responsive; the box
  statistics always use every value.

## Tests

```powershell
$env:STDF_DEMO="$env:TEMP\pystdf\pystdf-main\data\demofile.stdf"
cargo test --manifest-path src-tauri\Cargo.toml --lib
```

The suite covers the reference STDF file (1,619 dice, 74 tests), wide/long CSV
import, semicolon + decimal-comma CSV, and the full query pipeline
(box/map/Pareto/histogram/trend).

Visual smoke tests (browser demo, requires `npm run dev`):

```powershell
node tools\shoot.mjs    # screenshots of every plot in light/dark mode
node tools\flow.mjs     # JPG save, report builder, template save, bin map
node tools\desktop.mjs  # real app via WebView2 CDP: STDF import, clipboard,
                        # every chart tab and a 4-plot batch report on disk
```

The desktop test expects the release build and the Galaxy Semiconductor STDF
samples under `%TEMP%\pystdf\pystdf-main\data` (see the test command above).

## Current limitations / next steps

- ATDF is not implemented.
- CSV columns/units are auto-detected; no import wizard yet.
- Filters cover lot, wafer, bin, pass dice and statistical outliers. Date, site,
  die X/Y range and edge exclusion are not exposed yet (`edgeExclusion` exists in
  the plot spec but is unused).
- Group/colour is by lot or wafer; site-level grouping is not parsed yet.
- Templates store test/wafer indices, so they are directly reusable across lots
  from the same test program. A dataset with a different test order may need
  plot adjustments after loading a template.
- The browser demo cannot write batch reports or read real files.

## Project layout

```
src/                 React UI, Plotly figures, canvas wafer map, report writer
src-tauri/src/       Rust STDF/CSV import, columnar dataset, stats, queries
tools/               sample-data generator, Playwright visual/functional tests
docs/                filled requirements template
shots/               screenshots from the visual test run
sample-data/         generated CSV examples
```
