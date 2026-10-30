# Plot caching and compressed import

Non-map query results share a separate 48 MiB estimated LRU budget, with
canonical request keys, concurrent-request deduplication, retryable failures
and dataset-generation invalidation. Map budgets remain independent. Split
plot selection is remembered across tabs, and small snapshots retain zoom
and trace visibility. Double click resets to the original figure default.

`tools/verify-cache-zip-round.mjs` exercises all five cached query APIs,
canonical-key deduplication, failure retry and stale-response invalidation.
It checks main-chart zoom/legend restoration and double-click reset, then
enlarged selection and zoom restoration for box, histogram, scatter and
Pareto, and selection reset on filter changes.

Yield/bin 1 now use brighter green (`#16c55e`, light theme; `#4ade80` for
dark-theme yield traces). Failure bin colors remain outside green.

The native file picker accepts ZIP. Stored/Deflated ZIP members ending in
`.stdf`, `.std` or `.Z` are imported in archive order, including folder paths.
Each member is read, validated and appended before reading the next. There
is no disk extraction. Provenance includes archive and member names. Errors
abort replacement of the loaded dataset; latest retest resolution runs once
after all inputs are merged. Encrypted ZIPs, nested ZIPs and other compression
methods are unsupported.

The `.Z` decoder is adapted under the upstream MIT license, retaining its
dictionary and code-group alignment rules. It replaces bit-by-bit reads with
whole-code reads, narrows dictionary prefixes to 16 bits, copies each decoded
phrase in bulk and avoids compressed-input/output adapter copies. Direct
files use memory-mapped compressed input; ZIP entries use their existing buffer.

Five public reference fixtures (small, repeated text, large text with 12/16-bit
dictionaries, binary) match both their uncompressed originals and the previous
decoder byte for byte. Reader tests cover every bit offset and width 9–16.
ZIP tests cover nested mixed raw/compressed STDF, Stored/Deflate, tester site,
retest ordering, unrelated entries, invalid archives/streams and CRC corruption.
Fixtures and license attribution are in `src-tauri/test-data/lzw` and
`src-tauri/licenses`.

An isolated debug benchmark on the public 265,271-byte `.Z` fixture expanding
to 1,062,255 bytes measured three runs:

| Decoder | Runs (ms) | Median (ms) |
| --- | --- | --- |
| Previous | 34.704, 32.819, 30.292 | 32.819 |
| Optimized | 21.167, 23.558, 21.682 | 21.682 |

This is about 34% lower median decoder time in this debug benchmark. It is
not a release-build or end-to-end import measurement; customer files may
behave differently. Run `cargo test --manifest-path src-tauri/Cargo.toml
z_decode_benchmark -- --ignored --nocapture` to repeat.

ZIP and decoder functionality require the desktop executable. The browser
demo exercises plots and caching using synthetic data.

Validation completed: frontend production build; native suite (37 passed,
6 intentionally ignored fixture/benchmark tests); cache/view restoration,
plot-polish and 50-preview browser regression scripts. Browser runs reported
no page errors. The existing review server on port 1420 returned HTTP 200.
