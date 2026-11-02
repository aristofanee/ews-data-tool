# Numeric grouping labels

Numeric-label detection runs for imported STDF/CSV data after all selected files
and ZIP members have been merged and the latest retest attempts retained. A code
can therefore vary between separate wafer files even when each file contains only
one value. Text fields are retained per die; consistent wafer assignments become
custom labels, while varying fields can become [data categories](DATA_CATEGORIES.md).

## Eligibility

- Units must be empty after trimming.
- Every nonblank value must be finite and integer-valued. STDF numeric results
  use floating-point storage, so the check concerns fractional values rather than
  the physical R4 record encoding. No rounding/tolerance coerces values to integers.
- The sample must contain at least two distinct nonblank values. All-missing and
  constant fields remain measurements.
- Values must be consistent within each lot/wafer, as required by custom labels.
- At most 512 categories are accepted. Missing values leave a wafer unassigned;
  numerical zero is a real category, distinct from unassigned.

Sampling covers up to 256 wafers spread across the import, taking up to 16 evenly
spaced rows per selected wafer, including its first and last rows. Candidate
columns are then checked in full. A late fractional value or intra-wafer conflict
rejects the entire candidate. Memory use is bounded by sample and wafer counts.

## Data preservation and names

Original numeric tests and every source value remain available. Detection adds
wafer-level categorical views. Existing text/manual labels are preserved. Label
names use the source test name, with a label suffix or test-number qualification
when needed to avoid reserved names, ambiguous names or duplicate CSV headers.

Wide CSV numeric columns, including numeric columns named Split/Group/etc., first
remain numeric measurements and pass through these same rules. The separate wafer
number identifier remains available under its existing import behavior.

CSV export writes the original numeric source column once rather than duplicating
an automatically derived grouping. Re-importing that data can derive the label
again. Editing an automatic grouping makes it a manual custom column, which exports
independently as before. No split assignments are added to report templates.

## Validation

Native coverage includes two separately parsed STDF wafer files, fractional/unit/
constant/all-missing rejection, full-column checks outside sampled rows, category
limits, zero and missing distinctions, retests, preservation of original values,
idempotence, and CSV round trips with both derived and edited manual labels.
Native coverage also includes per-die data categories; see DATA_CATEGORIES.md.

The scatter Z-test field reuses TestCombobox with its own accessible label.
`node tools/verify-scatter-z-search.mjs` checks name, number and unit searches,
no-match/Escape behavior, and independent main/Y/Z selections in the browser demo.
