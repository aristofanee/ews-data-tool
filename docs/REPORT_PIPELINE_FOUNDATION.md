# Report matching and export foundation

Implemented after the historical findings in REPORT_PIPELINE_AUDIT.md.

## Template reuse across products and splits

Templates now use version 2. Each report item records the identities of its tests,
lot/wafer filters, category columns and selected split. Array indexes are resolved
against the current import rather than reused as identities.

Automatic test matching requires the same test number, trimmed name and units,
with exactly one candidate. Lot/wafer identities use lot name plus wafer ID.
Different names or ambiguous matches require an explicit user mapping. Choosing
between indistinguishable tests applies to the current import; a saved template
requires that ambiguity to be resolved again on its next import.

Missing references stay attached to the item; they are not replaced by test 0 or
an unfiltered population. Version 1 templates still load, but positional tests and
filters require one-time mapping because their original identities were not saved.

## Resolver workflow

- Invalid items have a red icon and a very pale red background.
- Resolve errors groups problems by the missing identity and shows the number of
  items using it. Choose a current test, lot, wafer, category column or split value.
- Apply maps that identity in every affected item. A renamed custom split column
  and its renamed value can be mapped separately.
- Connected errors are nested under their prerequisite (for example category →
  split, or lot → wafer). A child's replacement selector appears only after its
  unresolved prerequisites are mapped. Resolved parents remain visible while
  their children are being fixed. Cards use the missing reference as their title.
- Remove all affected items removes every item using the missing reference.
- Runtime rendering/no-data errors can be retried on the next export or removed.
- Export skips unresolved items and reports the skipped count. The run manifest
  contains skipped item IDs, titles and reasons; no placeholder images are exported.

Report item activation restores its own filters and opened split, overriding
remembered plot selection. Update loaded item replaces that item with the viewer's
current settings. Adding another item remains available separately.

## Lot-specific splits and template validation

Templates save the category and split names needed by their report entries, but
never save custom columns or wafer-to-split assignments. Loading a template never
creates, restores or replaces custom labels, even if an older file contains those
assignments. Splits belong to the imported lot. Missing split references remain
red and can be mapped to the current data through Resolve errors.

Schema, reference fields and filters are checked before report state is changed.

## Report item descriptions and adding plots

Adding a plot or a batch preserves the builder's current open/closed state. The
toolbar report button opens it explicitly. Item titles start with the shared image
export title and add relevant grouping, separate-plot, Z, point and bin settings.
Subtitles describe lot/wafer/bin/site/statistical filters and plotting range/limits.
The range is labelled `Range` and omitted in Auto mode. Individual LSL/USL values
are omitted from descriptions. Templates clear custom LSL/USL overrides on saving
and loading, including older templates; a specification-range choice uses the
current dataset's limits. Range mode and manually configured plotting bounds are
still retained.
Unresolved references appear on a separate red error line. Long descriptions wrap
and retain their complete text in hover tooltips.

The builder omits Add current plot, All selected wafers and output-folder controls.
Each Generate action opens a folder picker; a previous choice never bypasses it.
The toolbar order is theme | Open data, Export CSV, Metadata | Save, Load, Report.

## Output runs

Each export creates a fresh subfolder beneath the chosen output folder. Its name
includes the report name, timestamp and random suffix. Existing runs are never
reused. Native folder creation is exclusive; browser export uses nested directory
handles. Browser report generation is enabled in Edge/Chrome with folder access.

report-status.json initially marks the run incomplete. Images render sequentially.
Progress is weighted by JPG count and updates before rendering, before writing and
after each JPG. Metadata provides an initial planned count; query results refine
empty or filtered groups without buffering all report measurement arrays.
If one item fails during rendering, its previously written images are removed and
the item is excluded. Disk-write failures abort the run without altering older
reports. After image generation, report.json and index.html are written, followed
by the completed status and image/skipped-item manifest.

The HTML header describes the union of selected wafer scopes for successful
items, including opened wafer/lot/custom splits. It does not advertise the whole
import. This is selected scope, not a promise that each wafer has a finite value
after every test/bin/statistical filter. Report filter summaries include SBIN/Site.

## Verification

- `node tools/verify-report-resolution.mjs`: reordered identities, ambiguous/missing
  tests, malformed templates, bulk test/split mapping and removal, invalid styling,
  selected item activation/update, browser generation, skipped items, one-wafer
  scope, failed-run isolation, rollback of a partially rendered item, legacy
  templates, legacy assignment payloads being ignored, preservation of existing
  labels, and the exact create-split/save/reset-demo/import-template scenario.
- `node tools/verify-export-actions.mjs`: all seven plot types, selected saves/
  copies/report images, template round trips and folder/cancellation behavior.
- Native tests include exclusive run folders, constrained image cleanup and
  validation without replacing existing custom labels.

Synthetic review artifacts are in shots/report-resolution-review. The production
frontend build passes; native suite: 47 passed, six fixture/benchmark tests ignored.
