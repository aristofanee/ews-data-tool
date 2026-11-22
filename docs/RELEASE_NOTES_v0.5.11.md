# EWS Data Tool v0.5.11

## Import and CSV

- Retain STDF Job Name, Job Revision, Tester Name, Tester Type, Tester Serial Number, Flow ID, Probecard ID, Product, Temperature, Date and Time. Probe-card metadata follows head/site configuration. Date and Time use wafer start with job-start fallback and UTC formatting.
- Preserve mixed numeric/text CSV columns across the entire file, including late labels such as N2 after numeric-looking values and strings with leading zeros.
- Keep OCR as the default wafer identity. Import/export Wafer as a separate built-in plotting/grouping category; STDF wafer numbers come from the two digits in a standard `<lot>-<two digits><letter><digit>` OCR suffix. Nonstandard OCRs leave Wafer blank.
- CSV headers begin with Lot, OCR, Wafer and custom columns, followed by X, Y, HBIN, SBIN, Site and measurements. Keep units/specification limits aligned after reordering.
- Rename the numeric Part ID test to PartID and preserve its raw string counterpart on CSV round-trips.

## Plots and reports

- Add Show bin label to Bin map and Pareto. SBIN labels default on and HBIN labels default off, with separate remembered choices for interactive views, image exports and report templates.
- Global Pareto export titles now read HBIN or SBIN followed by the plot type. Wafer-specific export titles omit the separate lot prefix.
- Add logarithmic X scaling to scatter plots, including previews, exports and templates.
- Fix clipped specification labels in histogram previews. Group wafer-map galleries by lot only for wafer-identity/wafer-number grouping.
- Allow renaming custom columns and update their references in plots, filters and report items.
- Use case-insensitive ordered-subsequence search, ignoring query whitespace: both `acap` and `a cap` match A_Capacitance without matching M_Capacitance.
- Disable report/template actions until a dataset is loaded and add an icon to Metadata.
- Add a browser-demo-only UI font selector with wheel cycling. Plot/export fonts and desktop defaults are unchanged.

## Downloads

Windows x64 installer, portable executable, combined ZIP and SHA-256 checksums are included. The ZIP also includes these notes and the existing .Z decoder license notice.

## Validation

- 76 Rust tests passed; six optional fixture/performance tests remain ignored.
- Production frontend build and browser checks passed for wafer grouping, font controls, bin-label visibility and exported titles.
- Native desktop smoke test verifies STDF metadata and OCR extraction, CSV round-trips, plotting, controls and the packaged version.
