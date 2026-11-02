# EWS Data Tool v0.5.0

## Reports and image exports

- Revised image layouts, plot titles, group labels and plotting-range counts.
- Higher-resolution lot bin overviews with larger wafers and a right-side legend.
- Batch plot export selects one destination folder and reports progress per image.
- Saving, copying or adding an opened plot to a report uses only that plot.
- Report templates preserve plot configuration without importing lot-specific
  split assignments or test-limit overrides.
- Missing tests, grouping fields and category values flag report items in red.
  The resolver supports replacement mappings or bulk removal, with dependent
  errors nested under their parent. Unresolved items are skipped during export.
- Report exports ask for a folder each time, use separate output folders, and
  report progress per JPG. Adding a plot keeps the builder closed.

## Import and plotting

- Detect unitless integer wafer labels in both STDF and CSV imports, with
  distributed sampling followed by full consistency checks.
- Automatically expose eligible per-die numeric/text categories in ordinary
  plotting selectors. Preserve source measurements and per-die text in CSV.
- Searchable scatter Z-test selection, matching the Y-test selector.
- Fix scatter layout collapse when wafer grouping changes the Z colourbar
  orientation.
- Mean wafer tooltips omit individual-bin information. Coordinate averages were
  checked against individual wafer measurements, missing values and filters.
- Updated toolbar order and report item descriptions.

## Validation

- Native suite: 57 passed; six external-fixture/benchmark tests ignored.
- Production frontend build; browser checks for exports, report resolution,
  categorical grouping, scatter colourbar transitions and mean wafer maps.
- Windows release smoke test covers native imports, ZIP/.Z retests, CSV round
  trips, metadata import and desktop plotting.
