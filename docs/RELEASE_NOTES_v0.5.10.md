# EWS Data Tool v0.5.10

- Sidebar and custom filters now use the same filtered population for Pareto percentages and wafer yield. Filtering to a single failing bin gives that bin 100% of the remaining population.
- Pareto failure axes scale to rates below 1%.
- Box plots and histograms offer Sigma and Percentile Cp/Cpk methods. Percentile is the default and uses the 0.135th-to-99.865th percentile width with median centering. Split statistics and exported images use the selected method.
- Chart thumbnails follow the selected plot ranges. Box previews show specification lines and rotate long labels consistently with trend previews. Scatter and trend thumbnails omit the X-axis title.
- Interactive category labels adapt to available space and zoom while retaining the 500% density setting.
- CSV header inspection reads a small prefix before import. Full import still validates the complete file. CSV export reports progress while writing rows.
- Test search matches each typed word as a continuous substring.
- Update report item is an always-present icon that is disabled when unavailable. Label assignment is disabled for empty text, and typing in the label dialog reuses the wafer list.
- Desktop startup waits for the initial UI paint before showing the window. Background blur has been removed from dialogs and overlays.

Windows x64 downloads include the installer, portable executable, combined ZIP and SHA-256 checksums.
