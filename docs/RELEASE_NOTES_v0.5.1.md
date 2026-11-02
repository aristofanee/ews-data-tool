# EWS Data Tool v0.5.1

- Fix Sigma/IQR range changes being overwritten by cached zoom settings.
  Adjusting a range keeps the opened split plot selected.
- Scatter fit lines, group R², statistical ranges and Z colour limits now use
  the full considered population, independently of sampled markers.
- Correct Trend Sigma/IQR calculations to use the plotted group means.
- Correct per-wafer scatter outlier filtering in the browser demo.
- Display readable category names in map and Pareto grouping summaries.
- Scatter Y/Z dropdowns reopen at the current test with neighbouring tests
  available. Preserve its displayed name until typing starts a new search,
  and keep the selected row visible in long, wrapped lists.
- Reject ambiguous duplicate CSV columns and invalid UTF-8/UTF-16 instead of
  silently overwriting values or replacing characters. Duplicate test names
  remain supported when test numbers differ.
- Reuse native query filter masks, avoid unnecessary allocations and remove
  unused code and obsolete category-management endpoints.

Validation: 60 native tests passed (six external-fixture/benchmark tests skipped),
production frontend/Windows builds, browser range/statistics/report/export and
dropdown checks, and a native Windows/WebView2 import/export smoke test.

CSV numeric storage remains 32-bit and column typing still uses an initial
200-row sample. The general audit documents these existing precision and mixed
numeric/text inference limitations; they are not changed by this patch.

Windows x64 downloads include the installer, portable executable, combined ZIP
and SHA-256 checksums. The portable build requires WebView2.
