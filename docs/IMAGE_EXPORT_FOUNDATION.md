# Image export foundation

Chart controls and the report builder share image rendering and encoding.
Exports retain configured plotting ranges rather than temporary screen zoom,
pan or hidden traces.

## Actions and selection

- Save from a split grid opens one folder picker and writes every image directly
  to that folder. The bin-map grid includes its overview and each individual wafer.
- Save, Copy and Add to report from an opened plot apply only to that plot.
  Report templates preserve the selected group, including its label and wafer.
- Copy is disabled on split grids without a composite image. The bin-map grid
  supports copying its overview.
- Pickers open before image construction. Batch saves reuse the import progress
  overlay to identify the image being rendered or saved. Single saves and copies
  have no progress bar. Images render sequentially to limit memory.
- Cancellation performs no rendering or writes. Export actions reject stale
  specifications and are guarded while loading or already exporting.
- Batch filenames start with the grouping category and value in brackets, followed
  by the plot name and a stable ordinal. Sanitized label collisions cannot overwrite
  another image within a batch.
- Browser folder exports use File System Access in Edge/Chrome. Desktop exports
  use native dialogs and writes. Individual browser downloads remain a fallback
  when the single-file picker is unavailable.
- The slide-sized option is removed; legacy templates and preferences use normal
  presentation settings.

## Images and styling

- Plotly renders PNG before JPEG encoding at 0.96 quality. Source figures are
  cloned and exports have a white background.
- Box Plot, Histogram, Trend and Pareto use 2400x1500. Scatter, value maps and
  individual bin maps use 2400x2100. Bin-map overviews use 4800x2700 (16:9).
- Titles are `[Test] vs [X] · [Plot type]`. Scatter follows Y vs X; histogram uses
  test vs Count. Bin plots use HBIN/SBIN in place of the test.
- Combined grouped plots center the category above group labels. Standalone
  splits prefix the title with `[category value]`. There are no subtitles.
- Export text is regular black. Data, yield and specification colors retain their
  semantic meaning. Long titles wrap.
- Pareto yield axis, tick labels and title retain green in exported images.
- Bin-map overviews maximize wafer size within the grid, remove die gaps, omit
  the Total footer and place a complete bin legend on the right. Report overviews
  contain one lot per image. Single-wafer bin maps retain their Total footer.
- Single-wafer bin maps also use the complete right-side legend in standalone
  images and reports, with room allocated for long software-bin descriptions.
- Complete bin legends include software descriptions and counts. Hardware bin
  descriptions remain omitted. Excessive content that cannot fit raises an error
  rather than silently dropping labels.

## Counts and ranges

“In Limits” refers to the selected plotting/colour range, not acceptance limits.
Plotly resolves actual numeric axis bounds before exact source counts are
computed. Scatter counts require finite paired X/Y values and match joint
statistical filtering. Maps use resolved colour bounds and the source cohort.

Auto and Custom show Total and In Limits without a range-type description.
Resolved sigma, IQR and specification ranges identify their type. Plots without
numeric ranges show only Total, except bin-map overviews which omit the footer.
Counts never come from sampled markers or histogram bins.

## Validation

`node tools/verify-export-actions.mjs` checks all seven plot types, folder writes,
selected saves/copies/report items, template selection round trips, disabled grid
copy, cancellation, progress and 4800x2700 overviews. Clipboard and file dialogs
are intercepted; synthetic output is under `shots/export-actions-review/`.

The production frontend build passes. Earlier range validation covered Auto,
Custom, sigma, IQR and LSL/USL against full source values, paired scatter counts,
per-lot report overviews and a pixel-level no-grid-seam check. Native query suite:
45 passed, six fixtures/benchmarks ignored.
