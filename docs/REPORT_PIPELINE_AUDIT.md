# Report pipeline audit — 2026-11-01

Historical findings below have now been addressed. See
[REPORT_PIPELINE_FOUNDATION.md](REPORT_PIPELINE_FOUNDATION.md) for current behavior,
including the requested resolve-or-skip workflow. The audit script reproduces the
pre-fix behavior; use verify-report-resolution.mjs to check the repaired pipeline.

Scope: report item capture, reopening items, templates/custom labels, query/render
dispatch, image writes and generated HTML/JSON. This is an audit; report behavior
has not been changed. The requested single-wafer export legend change is separate
and implemented in the shared map renderer, including report images.

## Current pipeline

1. Store snapshots plot settings, filters and an optional opened group.
2. Templates serialize those settings plus custom columns.
3. Generate re-queries the currently imported dataset for every report item.
4. Items can expand into several images. Bin overviews expand per lot.
5. Images are written sequentially, then index.html and report.json are written.

Images are regenerated from data and settings; reports do not store frozen source
data or screenshots. Shared image rendering, exact range counts and selected-only
report generation passed the export checks across all seven plot types.

## Findings

### P1 — Templates can silently target different tests and wafers

References: src/store.ts:404–453; src/lib/useData.ts:94–110.

Templates store test indexes and numeric lot/wafer filter indexes without an
identity table. applyTemplate keeps in-range indexes without resolving identity.
Reordering two tests and two wafers before applying an otherwise identical template
changed test 1001 to 1002 and wafer 01 to 02 without an error. Titles can retain
the old identity while queries use the new index.

Custom columns have the same issue: their waferValues array is positional.
src-tauri/src/model.rs:329–343 checks wafer count but not wafer identities/order.
A different wafer population with the same length can therefore receive the old
labels. This is confirmed by code inspection, including the equivalent browser
implementation in src/lib/mock.ts.

Baseline fix: store stable test identities and lot/wafer identities; remap on load.
Reject or explicitly resolve missing/ambiguous identities before mutating labels,
filters or report items. Legacy positional templates need a compatibility policy.

### P1 — Failed regeneration can corrupt a previously complete report

References: src/lib/report.ts:126–140, 500–513;
src-tauri/src/commands.rs:512–521.

Outputs reuse deterministic filenames and write directly into the chosen folder.
Generating again overwrites matching images before index.html/report.json are
updated. An injected second-image write failure left the old index in place but
replaced its first referenced image with the new run's image. Successful shorter
runs can also leave obsolete JPGs from previous runs in that folder.

Baseline fix: generate into a distinct run folder, or stage a complete run and
publish it only after all images and manifests succeed. Explicitly identify an
incomplete run; preserve the last completed report on failure.

### P2 — Reopening a report item does not restore its selected plot

Reference: src/components/ReportDrawer.tsx:167–175.

The item loader restores spec/filters but ignores item.selection. Reproduction:
add opened wafer 03, view wafer 01, then click the saved report item. The report
still correctly stores 03, but the viewer remains on 01. Subsequent Copy or Save
from the viewer therefore acts on a different plot from the report item clicked.

Template loading also activates the first plot's spec with the template's global
filters rather than that first item's filters (src/store.ts:448–457), and does not
restore its selection. Viewer state and report state can disagree.

Baseline fix: one shared item-activation operation restores that item's settings,
filters and selection through the existing plot-selection memory.

### P2 — Invalid report entries can be silently omitted

References: src/lib/report.ts:333, 402, 428, 444; src/lib/useData.ts:128.

The generation loop skips plots with missing tests and continues to a successful
report. A synthetic two-item report containing one box plot with test=null returned
one image and completed successfully. The Add-current-plot guard prevents some
normal UI cases, but templates can introduce these entries: loading validates only
that plots is an array. Empty filtered groups can also produce no output without
an explicit item outcome.

Baseline fix: validate the full report before writing; report item-level errors or
explicit exclusions. Validate template schema/version and plot/filter references
before applying it. Do not present incomplete output as an unqualified success.

### P2 — Report header describes the whole import, not report scope

Reference: src/lib/report.ts:491–499.

The HTML header takes lots and wafer count directly from DatasetInfo. A report
filtered to one wafer advertised both imported lots and all 50 wafers.

Baseline fix: derive the represented lot/wafer population from generated item
scopes, or clearly distinguish imported population from report population.

## Other limitations to address during builder design

- Browser Generate is explicitly disabled in ReportDrawer, even though the report
  renderer now works with the browser folder writer. This is a UI restriction,
  not a renderer failure; useful to remove when local browser report review starts.
- Generate's JPG count is the item count, although one item can create many JPGs.
- Filter summaries omit SBIN and Site selections, making different items look alike.
- There is no explicit update-in-place operation for an existing report item.
  Clicking an item loads a viewer configuration; changes require adding another item.

## Evidence and next order

`node tools/audit-report-pipeline.mjs` reproduces the current identity mismatch,
selection mismatch, silent omission, misleading scope and failed regeneration.
It deliberately confirms existing faults rather than asserting desired behavior.
All file operations are intercepted on synthetic demo data; evidence is saved in
shots/report-pipeline-audit/result.json.

Recommended order: stable identity/validation, safe output runs, reliable item
activation, then accurate scope/counts. Builder features can then use these shared
operations without duplicating query/export behavior.

The legend change passed the production build and export checks for all seven
plot types; the individual bin-map legend position is asserted in
tools/verify-export-actions.mjs and was visually reviewed.
