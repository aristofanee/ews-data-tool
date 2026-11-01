# EWS Data Tool v0.4.3

Plot interaction, rendering performance and CSV export compatibility improvements.

- Faster box-plot navigation: reuse chart hosts, batch point layers and render interactive all-point/outlier markers with WebGL. Exact statistics, outlier inclusion and die/group hover details are preserved.
- Deterministic double-click zoom reset, with saved zoom and enlarged split selections restored when switching tabs.
- Trend now supports X axis, Group by and Split into different plots like Box Plot, including custom labels, contiguous group headings, statistical filters and image/report exports.
- Hold the middle mouse button and drag to pan charts or maps without changing the selected left-button tool.
- Up/Down arrows navigate the filtered test list. Scatter Y selection supports typing and the same fuzzy search as the main test list.
- Numeric-looking Pareto bin labels remain discrete categories. Failure bins use a more varied palette; bin 1 remains bright green and unknown bins gray.
- Improved automatic histogram bin counts, larger scatter points, finer regression lines and thicker Pareto yield lines/markers.
- Map legends have wider bars, more generous spacing and fitted white backgrounds for readability while zooming. WebView2 pinch gestures are enabled for map zoom.
- CSV exports contain only LSL/USL metadata rows; test numbers and units are encoded in test headers for backwards compatibility. Custom labels, including Split, remain extra columns. Exports retain all imported dice regardless of plot-only statistical filters.

Windows x64 downloads: installer, portable executable, combined ZIP and SHA-256 checksums. WebView2 is required. Physical laptop touchpad behavior and NDA production datasets still need user validation.

Validation: 44 native tests passed (six external-fixture or benchmark tests skipped), production frontend and optimized Windows builds, browser regression checks, and real WebView2/native IPC smoke checks with synthetic CSV/STDF/ZIP files. No customer data is included.
