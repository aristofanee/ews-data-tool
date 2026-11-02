# General application audit — 2026-11-02

Review of the current source after v0.5.0, covering import, retests, categorical
fields, query statistics, cached views, maps, CSV/image exports and reports.
The fixes below are included in v0.5.1.
The earlier image/report audit documents describe historical findings; their
foundation documents describe fixes already included in v0.5.0.

## Correctness fixes

| Finding | Result |
| --- | --- |
| Scatter fit used sampled markers while correlation used all considered measurements. | Fit coefficients now use the full considered population, independently of the marker limit. |
| Opened scatter groups displayed the global R². | Each group has its own full-population fit and R². |
| Scatter statistical ranges and Z extrema depended on sampled markers. | Sigma/IQR statistics and colour extrema use all considered values; a rare extreme cannot disappear from the scale because of sampling. |
| Trend IQR used min/max as Q1/Q3, and Sigma used RMS within-group SD. | Both use actual statistics of the plotted group means, consistent with a trend of those means. |
| Demo scatter ignored the per-wafer statistical-filter option. | X/Y filtering now follows the selected per-wafer or pooled population, matching the native behavior. |
| Zoom memory omitted the range multiplier k. | A k edit no longer restores an obsolete axis range. |
| Range edits could close an opened split plot. | Group selection stays open while the axis view is recalculated. |
| Duplicate CSV measurements could overwrite each other during merge; duplicate text fields could overwrite raw per-die values. | Ambiguous duplicate identities now reject the import with an explicit error. Identical names with different test numbers remain supported. |
| Invalid UTF-8/UTF-16 could silently replace characters in units, identities and labels. | Invalid encoding rejects the import with a UTF-8/UTF-16 conversion message. No lossy text replacement is performed. |

Full scatter statistics are returned once per query and per group. Figure
construction reuses those results for interactive plots, split previews and
exports rather than repeatedly estimating fits and sorting sampled Y arrays.
Source measurements, filters and marker sampling remain separate.

## Efficiency and dead code

- Reuse the existing lot/wafer/bin/category mask when calculating statistical
  filters, instead of scanning the same rows again in every native query.
- Avoid allocating an unused default keep-mask when a statistical mask exists.
- Remove an obsolete wafer-category resolver and keep test-only CSV/merge
  convenience wrappers out of production builds.
- Remove unused imports, renderer fields/locals and an unused filter-summary
  function. Enable TypeScript's unused local/parameter checks in normal builds.
- Remove the unused category-management command/API and source-choice metadata
  left over after the management UI was removed. Detection stays automatic.
- Update the export-range regression harness for folder-based report output and
  current 4800 × 2700 lot-overview exports.

These changes avoid identifiable work; this review does not claim a measured
whole-application speedup. Rust Clippy still reports small style/refactoring
suggestions, rather than production dead-code warnings.

## Remaining design/architecture work

1. **CSV numeric precision.** Numeric columns use `f32`, including CSV data.
   This matches STDF R4 storage but can round CSV values beyond roughly seven
   significant decimal digits. For example, integer 16,777,217 rounds to
   16,777,216. Long numeric identifiers are particularly sensitive. Moving all
   numeric storage to f64 doubles measurement-array memory; preserving original
   identifier/text values separately is another possible approach.
2. **CSV type inference.** The first 200 data rows determine numeric versus text
   columns using the existing 80% rule; blanks count as numeric-compatible.
   A text field blank in that sample, or a column mixing mostly numbers with
   later text, can be inferred as numeric and later text becomes NaN. Full
   categorical validation does not repair that earlier inference. This needs a
   complete-column inference or raw-value preservation strategy, with appropriate
   import-time/memory testing, rather than another heuristic threshold.
3. **Rapid navigation.** UI results are guarded against stale responses, but
   already-started native queries still finish while holding the shared dataset
   mutex. Cancellation/coalescing of obsolete queries is a larger improvement
   for rapid navigation through very large datasets.
4. **Large report map sets.** Batch native map queries exist and are used by the
   gallery; report wafer-map generation still queries groups sequentially.
   Reusing batches could reduce scans but should be tested against memory costs
   for large wafers, rather than buffering every map unconditionally.

## Validation

- Native suite: **60 passed, six external-fixture/benchmark tests ignored**.
  Added adversarial scatter sampling, duplicate CSV identity and encoding tests.
- Production TypeScript/Vite build, with unused checks enabled.
- `tools/verify-general-audit.mjs`: full/group fit and range invariance under
  marker sampling, exact Z extrema, per-wafer filtering, Trend statistics, and
  preserving opened groups during range edits.
- `tools/verify-range-k.mjs`: Sigma/IQR changes across Box Plot, Histogram,
  Scatter and Trend, including view restoration across tabs.
- `tools/verify-report-resolution.mjs`: identity mapping, nested errors, template
  portability, selected plots, per-JPG progress, output failures and rollback.
- `tools/verify-export-ranges.mjs`: plotting-limit counts, image footers, map
  exports, 16:9 lot overviews and removal of inter-die grid seams.

The v0.5.1 release additionally runs a Windows/WebView2 native smoke test.
The audit's detailed checks above use native unit tests and browser integration
tests on synthetic data.
