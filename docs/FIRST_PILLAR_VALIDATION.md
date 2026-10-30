# Import and visualization correctness pass

This pass focuses on the first pillar. CSV/report workflows and template
identity remain work for their own phase, apart from forwarding the active
map limits to the existing report renderer.

## Data rules

- STDF parts in flight are keyed by head and site, including PTR and MPR.
- Retests are resolved after merging all selected files. Identity is lot +
  wafer + X + Y; the last imported complete attempt replaces earlier attempts.
  Missing values in the latest attempt remain missing. Unknown STDF coordinates
  cannot establish identity and are preserved separately.
- The dataset, plots and CSV export contain only the retained attempts. The
  import notification and status bar show the number of replaced attempts.
- Long CSV assumes measurements are ordered by attempt. A repeated parameter
  for the same die/part starts a new attempt; files regrouped by parameter can
  be ambiguous without an attempt identifier.
- Tests merge only when number, name and units all match. Different units are
  kept separate; this pass does not convert units across files.
- Exact box statistics are separate from marker sampling, including positive
  values for logarithmic boxes. Capability uses the displayed specification
  overrides. Filters still apply before statistics.
- Map wafer yield is HBIN 1 / all tested source dice in the selected wafers.
  Bin and outlier filters affect the plot and test yield, not physical yield.
- Map test yield uses finite considered source measurements, inclusive LSL/USL
  and manual overrides. One-sided limits are supported. Missing/invalid limits
  or an empty measured population do not produce a test-yield percentage.
- Mean-map values are averaged by coordinate; yield counts source dice.
- CSV export continues to omit statistical plot filtering, as intended.

## Validation

- Frontend TypeScript and production build.
- Self-contained Rust regression tests for multisite interleaving, cross-file
  and long-CSV partial retests, distinct wafer identity, test number/unit
  collisions, truncated STDF, sampled box statistics and yield denominators.
- Three external STDF reference tests are explicitly ignored by default rather
  than silently returning success. They require STDF_DEMO/STDF_DEMO_Z.
- `node tools/verify-first-pillar.mjs --start-server` checks real Plotly box
  calculation against supplied medians, manual-limit Cp and separate yield
  labels in headless Edge. The server and browser are closed afterwards.

## Synthetic performance observation

One local debug-build run, 25 wafers x 4,500 dice x 32 tests:

| Operation | Time |
| --- | ---: |
| In-memory synthetic construction, merge and retest resolution | 937 ms |
| Box query, one test across all wafers | 212 ms |
| Bin overview, all 25 wafers | 28 ms |
| Dataset metadata | 36 ms |

The box response contained 28,125 marker samples and exact statistics for
112,500 values. Dataset storage reported about 15 MiB. These are observations,
not latency guarantees: construction excludes STDF/CSV disk parsing, and the
query timings exclude IPC and frontend rendering. Run the opt-in
`first_pillar_benchmark` Rust test with `--ignored --nocapture` to reproduce.

Remaining performance work needs representative production datasets, release
build profiling, parser/memory measurements, IPC/render measurements and
grouped-map responsiveness under rapid filter changes.
