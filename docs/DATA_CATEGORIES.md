# Per-die data categories

Data categories are separate from wafer-level custom labels. They can vary
between dice on the same wafer and work as X axes, grouping fields, plot splits,
map cohorts and scatter groups. Fields that pass detection appear automatically
alongside the existing plotting choices. There is no separate management panel
or category section in those selectors. Original measurements remain available.

Both STDF and CSV run detection after all imports merge and retests retain the
latest attempt. Numeric test results remain measurements. CSV extra text columns
are retained per die; STDF PRR Part ID and Part text are retained when present.
Text that is constant within each wafer remains a wafer-level custom label.

Automatic per-die categories require:

- At least two nonblank levels, with variation within at least one wafer.
- No more than 64 levels. Rare levels are retained.
- At least 90% of nonblank observations belong to levels occurring more than once.
- Numeric values must be unitless, finite integers. A distributed sample screens
  candidates, followed by full-column validation.
- Text values must be no longer than 80 characters and must not look like dates
  or timestamps. Unique identifiers and free-form notes normally fail these rules.

Blanks remain separate from numerical zero and literal text such as Unassigned.
Grouping codes are internal; filters and templates store original values.

CSV exports retain original numeric and text columns, once each, plus manually
created wafer labels. Detection runs again after import. Report templates reference category fields
and values without importing die assignments. Missing fields/values use the
existing report error resolver and are skipped on export until resolved.

Validation: native tests cover actual STDF PRR extraction, CSV round trips,
retests, automatic exclusions, overrides, missing values, grouping/filter totals,
maps, Pareto yield and representative scatter sampling. The browser check is
`node tools/verify-data-categories.mjs`.
