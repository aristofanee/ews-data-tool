# EWS Data Tool

A fast, offline Windows desktop app for wafer-sort (EWS) data. Open STDF or CSV
files (including Unix-compressed `.Z`), explore box plots, value/bin wafer maps,
a multi-wafer Bin map, Pareto charts, histograms, trends and scatter plots,
split any grouped view into report clusters, then generate a complete JPG report
from a reusable template.

Built with **Tauri 2 + Rust** for parsing/aggregation and **React + Plotly** for
the charts. The wafer map is a custom canvas renderer for precise die grids,
hover values, zoom/pan and high-resolution JPG export.

![Box plot](shots/01-box-light.png)

## Highlights

- **Fast, local and compact** — Rust parses STDF/CSV in the background; the
  installer is about 3.5 MB and nothing leaves the machine.
- **Seven plot views** - box plots with an X axis and multi-level grouping,
  grouped value maps, a HBIN/SBIN Bin map overview of every wafer, grouped or
  split Pareto charts, grouped histograms, trends and X/Y scatter plots with
  optional continuous Z colour.
- **Presentation-ready** - slide-sized fonts, thicker lines and stronger
  markers; JPG, clipboard and report exports use a light background at
  2400x1500 with the chart title baked in.
- **Global presentation setting** - the top-bar **Slide-sized fonts** checkbox
  applies to every tab and collected report plot, persists between sessions,
  and travels with templates. Split previews keep compact readable axes.
- **Split plots** - turn a grouped box, histogram, scatter or Pareto chart into
  one preview per category; click a preview to enlarge it. Reports save them as
  a named cluster with the split in every title and filename.
- **Custom wafer labels** - stage several labels for different wafer groups in
  one dialog, then save once. Use the column as **Group by** or as a map group.
  A text `Split` column added in Excel is imported automatically. Labels travel
  with templates and `report.json`.
- **Real EWS features** - LSL/USL, CP/CPK, IQR and k-sigma outlier filters,
  HBIN / lot / wafer filters, hover provenance, STDF WCR die geometry and a
  continuous wafer notch. Die X/Y, bin and value provenance, log axes and
  auto/manual/±kσ/±k IQR/spec limits are included.
- **Templates that build reports** — save every report plot, its filters,
  theme and custom label columns to one JSON file; load it on new data and
  generate all JPGs in one click.
- **STDF → CSV** — use the same import as a converter; `.Z` files are
  decompressed transparently.
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
- `src-tauri\target\release\bundle\nsis\EWS Data Tool_0.4.0_x64-setup.exe`

### Browser preview

```powershell
npm run dev
```

Open <http://127.0.0.1:1420> and click **Load demo data**. The browser build uses
a synthetic dataset so the UI can be explored without Tauri; file dialogs, batch
report export and real file parsing require the desktop app.

## Using the app

1. **Open data** (`Ctrl+O`) and pick one or more STDF/CSV files, compressed `.Z`
   files, or ZIP archives containing STDF/`.Z` files (including folders).
   Files are merged into one dataset. Retested dice
   (same lot, wafer and X/Y) keep only their latest complete attempt, including
   its bins and missing measurements. A warning reports replaced attempts.
   Later records/files win in import order; timestamps are not used. Rows with
   unknown STDF coordinates are not collapsed.
2. Use the **Filters** panel to narrow by lot, wafer, HBIN or a statistical
   outlier rule. The test list selects the parameter.
3. Pick a plot tab (`Ctrl+1` to `Ctrl+7`). The **Plot settings** panel on the
   right controls the X axis, **Group by**, split views, limits, map palette and
   more. Scatter plots choose X/Y tests plus **Group by** or a continuous Z test.

   Box plots place **Group by** first: each group forms a contiguous block of
   X categories, with its label above the block instead of a legend. Split
   box/histogram/Pareto previews use consistent 4:3 cards, including a single
   preview, with tick labels and axis titles. Grouped Pareto has independent
   **Fail [%]** and **Yield [%]** scales; global Pareto uses one bar colour.

   Scatter previews also show both axes. All Cartesian preview galleries use
   explicit 4:3 row heights and larger cards (520-pixel target minimum, up to
   800 pixels), adapting to the available width without compressing rows when
   many plots are present. The **Sampled display** indicator means only a
   subset of scatter markers is drawn, normally at most 30,000 across all
   groups. **Considered dice** and **Displayed points** show the two counts.
   Correlation uses all considered X/Y measurements; the plotted fit line uses
   the displayed subset. Imported data is unchanged by marker sampling.

4. In **Custom labels**, add a column (for example `Split`), select wafers and
   assign a label. Use it as **Group by** or as a map group; empty labels clear
   the assignment.
5. **Add to report** collects the current plot. Use **All selected wafers** (on a
   map) or **All tests** (on box/hist/trend) to batch-add plots.
6. In **Report builder**, choose an output folder and **Generate JPGs**. The app
   writes numbered JPGs, an `index.html` contact sheet and `report.json`.
7. **Save template** (`Ctrl+S`) stores the report, settings and custom labels;
   **Load template** applies them to new data. Templates include the theme.
8. **Save as JPG** exports the current chart at 2400x1500; **Copy image** puts it
   on the clipboard. Both use a light background and include the title.
   **Export CSV** (`Ctrl+E`) writes the filtered dataset, including custom label
   columns.

Map interaction: scroll to zoom, drag to pan, double-click to reset. Plotly
charts support hover, box zoom and pan from the mode bar.

## Data formats

### STDF

- STDF **V4** (`.stdf`, `.std`), little- or big-endian.
- Interleaved multisite PIR/PTR/MPR/PRR records are associated by head and site.
- Per-die tester site is retained from PIR/PRR. Use **Site** as a category/X
  axis for box plots, histograms, trends, scatter and Pareto. A numeric `Site`
  column is imported from CSV and included in CSV exports; missing sites stay
  unknown rather than being assigned to site 0.
- Invalid FAR headers, truncated records and unfinished dice are rejected.
- Unix `compress` **`.Z`** streams are detected by magic bytes and decompressed
  before parsing. The decoder reads whole LZW codes and avoids adapter copies.
- **ZIP** archives can contain `.stdf`, `.std` and `.Z` members in folders;
  Stored and Deflate compression are supported. Members are processed one at
  a time in archive order, without extracting to disk. Later members win for
  retests. Unrelated files and macOS resource forks are ignored; invalid data,
  CRC failures, encryption or unsupported compression abort the import with
  a member-specific error. The previously loaded dataset remains available.
  Nested ZIP archives and gzip are not supported.
- Records used: FAR, MIR, WIR, WCR, PIR, PTR, MPR, PRR, HBR, SBR, TSR, WRR, MRR.
- Test names, units, limits and scaling are read from the STDF records. The WIR
  wafer ID (OCR) is available as a scatter/category grouping key.
- Tolerant of older writers: unpadded `Cn` strings, omitted trailing
  `LO_SPEC`/`HI_SPEC` fields and `0x00` bin pass flags are handled.
- ATDF (ASCII STDF) is **not supported yet**; non-CSV files are sent to the
  STDF V4 parser.

### CSV / TXT

The importer detects the delimiter (`,` `;` tab `|`), UTF-8/UTF-16 encodings,
and two layouts. It skips preamble rows, finds the real header, and consumes
metadata rows such as `Tests#`, `Unit`, `LowL` and `HighL` before the data.

**Wide** — one row per die, one column per test:

```csv
Lot,Wafer,X,Y,HBIN,SBIN,Vt_nch [V],Idsat [uA/um],Rds_on [ohm],Split
L24-0417,01,0,-22,1,1,0.41515,521.89,12.741,Split A
L24-0417,01,-6,-21,1,1,0.41439,488.87,13.352,Split A
L24-0417,02,0,-22,1,1,0.41602,519.11,12.803,Split B
```

- Key columns are recognised by name: `Lot`, `Wafer`, `X`, `Y`, `HBIN`, `SBIN`.
- Every other numeric column becomes a test. Units are read from a trailing
  `[unit]` or `(unit)` in the header.
- Text columns such as `Split` become wafer-level custom columns and can be
  selected as **Group by** for box, histogram, scatter and Pareto plots, or as a
  map group. A column is skipped if one wafer has conflicting labels.
- Decimal commas are accepted when the delimiter is not a comma.

**Long** — one row per measurement:

```csv
Lot,Wafer,X,Y,HBIN,Test,Value,Split
L24-0417,01,-6,-21,1,Vt_nch,0.41439,Split A
L24-0417,01,-6,-21,1,Idsat,488.87,Split A
```

A repeated test for the same die/part starts another attempt. Keep measurement
rows in attempt order so a partial retest cannot inherit older measurements.

Column mapping is automatic for common names. If Lot, Wafer/OCR, X or Y cannot
be detected, a manual picker maps those columns before import. The CSV exporter
writes header + `Tests#`/`Unit`/`LowL`/`HighL` + data, so exported files round-trip
through this importer; very small or large values use scientific notation.

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
- STDF skips unused string fields, avoids repeated metadata-string copies,
  uses dense per-test parsing state and writes directly to resolved columns.
  Multi-file imports refresh dataset counts/geometry after the final merge
  and retest resolution, rather than rescanning all previous files each time.
- Values are stored as one `f32` column per test, so a lot with 25 wafers ×
  4,500 dice × 500 tests is about 225 MB of measurement data.
- Aggregation (box stats, histograms, Pareto counts, trend means) runs in Rust
  on a blocking worker; only summaries and the selected map/outlier points cross
  into JavaScript.
- Box queries send roughly 30,000 regular marker samples by default, plus all
  outliers (including positive-population outliers for logarithmic plots); full-data
  quartiles, whiskers, means and standard deviations are calculated in Rust.
  Logarithmic boxes use exact statistics of the positive values.
- Bin metadata counts and the multi-wafer bin overview use single dataset
  passes rather than a full scan per bin/wafer.
- Individual-wafer value maps share filtering work in one batch query. Map
  responses are cached with a 600,000-die budget; small thumbnail bitmaps have
  a separate 32 MiB budget. Off-screen previews render only when visible.
  Unchanged tab returns reuse cached maps and restore the enlarged wafer.
  Test/filter/group changes reset the detail view; imports and label changes
  invalidate the cache. Least-recently-used entries are evicted when full.
- Box, histogram, scatter, trend and Pareto queries use a separate 48 MiB
  estimated-result cache. Switching tabs restores the enlarged split plot,
  zoom and hidden legend traces. Changed query settings use a fresh view;
  imports and label edits invalidate results. View snapshots keep only axis
  ranges and visibility, with at most 40 entries, rather than live plots.
- Static scatter previews draw their marker layer on a canvas instead of
  creating one SVG element per point. Axes, labels and fit lines remain
  visible. This adds no further sampling and avoids keeping a WebGL context
  per preview. Enlarged plots and report exports retain interactive/full
  figure traces.

Pareto percentages are absolute failure rates: bin count divided by all tested
dice in the selected lot/wafer scope (or in each plotted group). Selecting bins
changes the displayed failures without changing that denominator. HBIN/SBIN
labels include the number plus the description when available. Bin 1 and yield
are green; all other bin colours exclude green.
- Wafer maps batch dice into one path per colour and use a plain circular clip,
  cutting the flat/notch back out afterwards. This keeps hover, Bin map,
  grouped-map and split-view redraws responsive on large STDF files with
  physical WCR geometry.

## Tests

```powershell
$env:STDF_DEMO="$env:TEMP\pystdf\pystdf-main\data\demofile.stdf"
$env:STDF_DEMO_Z="$env:TEMP\pystdf\pystdf-main\data\demofile.stdf.Z"
cargo test --manifest-path src-tauri\Cargo.toml --lib
```

The suite covers the reference STDF file (1,619 dice, 74 tests), the compressed
`.Z` fixture, wide/long CSV import, semicolon + decimal-comma CSV, text `Split`
columns, the full query pipeline (box/map/Pareto/histogram/trend/scatter), custom
label columns and box grouping, plus multisite records, retests, test identity,
truncated STDF rejection, sampled boxes and yield denominators. Reference-file
tests are explicitly ignored by default; set the variables above and run them
with `cargo test --manifest-path src-tauri\Cargo.toml --lib reference_file -- --ignored`
and `cargo test --manifest-path src-tauri\Cargo.toml --lib query_pipeline -- --ignored`.

Run the self-contained browser regression with
`node tools/verify-first-pillar.mjs --start-server`. Run the synthetic backend
benchmark with `cargo test --manifest-path src-tauri\Cargo.toml --lib first_pillar_benchmark -- --ignored --nocapture`.

Value maps show two distinct yields: **Wafer yield (HBIN 1)** counts bin 1 over
all tested source dice in the selected wafers, independent of bin/outlier
filters; **Test yield (LSL/USL)** counts finite, considered source measurements
within the active inclusive limits. Test yield is available when limits exist.
Mean maps average values at each coordinate but never use those averaged
coordinates as the yield denominator. Bin-map yield also uses HBIN 1, including
when displaying SBIN colours. Manual LSL/USL overrides apply consistently to
box-plot capability statistics and value-map test yield.

Visual and desktop smoke tests:

```powershell
node tools\shoot.mjs       # screenshots of every plot in light/dark mode
node tools\flow.mjs        # JPG save, report builder, template save, bin map
node tools\desktop-v6.mjs  # real app via WebView2 CDP: tab/shortcut order,
                           # split previews, grouped maps, HBIN/SBIN, limits,
                           # grouped/split Pareto and a batch report on disk
```

The desktop tests expect the release build and the Galaxy Semiconductor STDF
samples under `%TEMP%\pystdf\pystdf-main\data` (see the test command above).

## Current limitations / next steps

- ATDF is not implemented.
- CSV columns/units are auto-detected; a manual picker handles missing Lot/Wafer/X/Y,
  but there is no separate unit editor yet.
- Filters cover lot, wafer, HBIN and statistical outliers. Date, site,
  die X/Y range and edge exclusion are not exposed yet (`edgeExclusion` exists in
  the plot spec but is unused).
- Site is a per-die category, not a wafer-level custom label. Value-map groups
  remain lot, wafer or wafer-level custom labels.
- Custom labels are session data, not written back to the STDF file. They are
  included in templates, CSV exports and `report.json`. Text metadata columns
  from CSV are imported as wafer-level labels; per-die metadata is not supported.
- Templates store test/wafer indices, so they are directly reusable across lots
  from the same test program. A dataset with a different test order may need
  plot adjustments after loading a template.
- STDF/CSV files can disagree on a test's USL/LSL. The first non-empty limit is
  kept and the Limits panel warns when a conflict was detected; per-lot limit
  sets are not modelled yet, so set LSL/USL explicitly for mixed-limit lots.
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
