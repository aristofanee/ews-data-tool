# Global presentation, grouped boxes and import optimization

Source changes in this pass:

- The home screen title is EWS Data Tool; the long promotional paragraph was
  removed. The illustration uses one clipped wafer outline with an attached
  notch, rather than a floating triangle painted inside a circle.
- Slide-sized fonts and markers are a global top-bar preference. All plot
  tabs and collected report specifications update together. The preference
  persists in local storage and in the optional top-level template
  `presentation` field. Legacy templates use the first plot's preference and
  normalize the remaining plots. Resetting a plot preserves the global choice.
- Grouped boxes place the group first and the X category inside each block.
  Headers sit above the contiguous blocks, with separator lines and no
  grouping legend. Dense headings/ticks are compacted to reduce overlap.
- Pareto fail/yield axes have independent data-driven ranges. The titles are
  Fail [%] and Yield [%]; yield uses rounded ticks and green type. Global
  Pareto bars use one blue colour. Percentages retain absolute denominators.
- Split box, histogram and Pareto galleries use auto-fill columns and fixed
  4:3 cards. A single split remains a thumbnail rather than expanding to fill
  the panel. Previews retain compact ticks and axis titles; enlargement uses
  the global full-plot presentation preference.

## STDF performance changes

The parser now skips unused length-prefixed strings, fast-paths printable
ASCII without an intermediate String copy, borrows inherited test names/units
until ownership is needed, uses column-indexed parsing state, and avoids a
second column hash lookup when writing a measurement. Multi-file imports
defer dataset statistics/geometry recomputation until final retest resolution.

The opt-in `stdf_import_benchmark` generates a 16,230,041-byte STDF with 10,000
dice, 32 tests and 320,000 PTR measurements. Each run reads the file and checks
every result plus row/test counts. Local debug-build observations:

| Run | Before | After |
| --- | ---: | ---: |
| 1 | 1,655 ms | 626 ms |
| 2 | 1,777 ms | 653 ms |
| 3 | 2,137 ms | 667 ms |
| Median | 1,777 ms | 653 ms |

This is about 2.7 times faster on this synthetic case. It is not a guarantee
for production files or compressed .Z data; release-build performance and
vendor-specific STDF compatibility still need work-PC validation.

## Verification

- Rust suite: scaling/defaults/limits, multisite/site handling, retests, CSV
  round-trip, exact statistics, batch queries and absolute Pareto rates.
- Added tests compare deferred and eager merging after finalization, verify
  ASCII/sanitized-string cursor equivalence, and check MPR result columns and
  limits with skipped metadata fields.
- `node tools/verify-layout-round.mjs` verifies home copy/notch construction,
  global font propagation/persistence/template restoration, group-first box
  positions and headers, independent Pareto axes, a single global bar colour,
  equal preview sizes across plot types and one/two-preview cases, and visible
  thumbnail axes. Screenshots use the `shots/round-` prefix.
- `node tools/verify-plot-polish.mjs` rechecks site grouping, outlier retention,
  map layout/cache/detail restoration, bin identity/colours and zoom resets.
- `npm run build` checks TypeScript and creates the frontend production bundle.

Three real-STDF fixture tests remain opt-in because their fixtures are absent.
Both synthetic performance benchmarks are opt-in as well. No Windows release
installer was rebuilt in this pass.
