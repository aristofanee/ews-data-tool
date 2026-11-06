# EWS Data Tool v0.5.5

- Rebuild histogram bins when the plot range changes. Auto can focus on the main distribution when distant outliers stretch the range. The full filtered population still supplies the statistics.
- Show In Limits after Dice in box plots and histograms when a plot range applies. Fit normal curves to the values shown in each split histogram.
- Enable full-data rendering by default for scatter and box plots. Keep the box plot's point mode independent and use WebGL consistently for dense scatter plots.
- Keep split controls below Group by and allow enabling splits before choosing a grouping.
- Add per-die Test time in seconds to the start of the test list when STDF provides it.
- Add right-aligned Mean, SD and Cpk where available to exported plot footers. Align grouped histogram legend entries and remove the duplicate grouping heading from exported scatter plots.
