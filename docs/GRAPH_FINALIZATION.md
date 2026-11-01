# Graph controls and export compatibility

- Pareto category axes are explicit, so numeric-looking bin labels remain
  discrete bins in rank order.
- CSV output uses only LSL and USL metadata rows. Test number/name/units are
  in column headers; the importer recovers the number from `1001 - Name [unit]`.
  Custom labels such as Split remain extra per-die columns, using the label
  assigned to that die's wafer. A native roundtrip test covers this layout.
- Arrow Up/Down select the previous/next test in the filtered sidebar list,
  except while editing an input or using another native control.
- Scatter Y selection uses a single editable combobox with the same
  token/subsequence search as the test list, plus Enter/Escape/arrow support.
- Automatic histograms retain the full range and all values, but bound the
  Freedman–Diaconis proposal by twice Sturges' count, sqrt(N), and 80 bins.
  Constant populations use one bin. Manual bin counts still take precedence.
- Map colour bars use 26px width and a white legend panel; bin legends use
  the more generous spacing/width. Legend regions do not receive die hover.
- Scatter marker diameters double; regression lines use the normal line
  width. Pareto yield uses the previous slide-sized line width and at least
  10px markers. Legend panels have white fill without an outline.
  White panels fit measured text, swatches and range markers with equal 16px
  padding on every side, rather than covering the whole reserved column.
- Interactive box plots use WebGL for both all-point and outlier-only
  markers. All points, die-coordinate hover records, exact statistics and
  cross symbols remain in the figure. Previews retain SVG.
  A synthetic 30,000-outlier benchmark including two paint frames measured
  about 1.46s for SVG versus 0.72s for WebGL in headless Edge. This measures
  rendering, not end-to-end import/query time on customer datasets.
- Wry maps Tauri's zoomHotkeysEnabled setting to WebView2 zoom and pinch
  settings. Enable it so gestures can reach document-level map interception.
  An engine-generated mouse-source pinch changes the map without changing
  page scale in the browser check. Physical Windows touchpad validation is
  still required on the laptop.

Validation: production frontend build, 43 native tests, CSV header/Split
roundtrip, automatic-bin edge cases and browser controls/styling/pinch checks.

The demo box query no longer includes an artificial 60ms delay. Positive-only
groups reuse their exact ordinary summary for the identical log population.
Across six demo parameters (~229k considered dice each), measured query times
changed from 194–275ms to 137–173ms, excluding drawing. This is a browser-demo
measurement; desktop queries use Rust and are not changed by this adjustment.

Further box rendering work batches visually identical point layers, reducing
the default 50-wafer figure from 100 traces to 51. Native boxes remain separate:
Plotly's box hover renderer uses trace.name and cannot safely identify boxes
inside one shared trace. Per-point customdata retains wafer/group and die
identity. Calculated quartiles/medians and source whiskers are checked for all
50 boxes. A local paint-inclusive comparison measured 171ms versus 139ms;
query time is separate. The chart host is retained between test selections,
hidden while a new result is pending, and reused with Plotly.react. Explicit
initial axis ranges make repeated double-click resets deterministic; cached
zoom, visibility and enlarged split selections have regression checks.

The Y-test combobox list is portalled outside the scrolling inspector, sizes
to option text like the original native select, stays inside viewport bounds
and can open above the field.

Trend now supports the same X-axis categories, outer grouping and split
previews as Box Plot. Group blocks share the Box Plot heading/separator
renderer, and lines/bands stop at group boundaries. Split selections use the
existing plot memory; image and report exports include each selected group.
Native trend queries apply the same statistical filters as Box Plot, checked
against exact box summaries for sites, wafers, bins and unknown sites.
The shared bin palette uses more varied discrete colors (bin 5 pink, bin 8
orange), preserving bright green exclusively for bin 1 and gray for unknowns.
Validation: frontend production build, 44 native tests passed (6 fixture or
benchmark tests ignored), browser checks for grouping/custom labels, previews,
selection restoration and image rendering.
