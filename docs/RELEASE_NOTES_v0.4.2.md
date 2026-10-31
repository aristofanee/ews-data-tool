# EWS Data Tool v0.4.2

Fixes for CSV metadata boundaries, wafer naming and map legends.

- Pattern and other descriptive rows before the first die no longer end
  metadata detection. Later units and limit rows are still read as metadata,
  preventing phantom LOT/W1 entries and a spurious die at (0,0).
- Custom wafer-level labels are inferred from actual die rows. Invalid
  lot/wafer identities or coordinates after data starts reject the import.
- CSV OCR takes priority over Wafer/wafer number regardless of column order.
  The numeric column remains available as the **Wafer number** grouping label.
  STDF wafer identity behavior is unchanged.
- Wafer-map units occupy a separate header band above the range labels,
  preventing overlap at the larger font sizes. Long units fit the available
  width with an ellipsis.
- Pareto and bin-map legends/X tick labels omit HBIN/SBIN prefixes. Hardware
  bins show numbers; software bins retain descriptions when available.

Downloads include a Windows x64 installer, portable executable, combined ZIP
and SHA-256 checksums. WebView2 is required.

Release checks include the native suite (42 passed; six external-fixture or
benchmark tests intentionally skipped), TypeScript/Vite and optimized Windows
builds, browser plot checks, and map-label text-bound checks at three font
sizes. The built executable is checked through WebView2/native IPC using
synthetic CSV/STDF/ZIP data before publishing. No customer data is included.
