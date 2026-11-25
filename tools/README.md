# Verification and diagnostic scripts

Run commands from the repository root after `npm ci`. Browser scripts use
installed Microsoft Edge. Many start a Vite server on port 1421 or 1422; run
them sequentially. No Python packages are needed for the Node scripts.

## Baseline checks

- `npm run doctor`: read-only tool discovery.
- `npm run check`: frontend build and default Rust library tests.
- `npm run test:browser`: self-contained demo-data regression for exact box
  statistics, explicit sigma capability, and value-map/bin-map yield display.
- `node tools/verify-release-0511.mjs`: native, version-specific regression
  using generated synthetic STDF. Requires a fresh release executable.

See `docs/HANDOVER.md` for native prerequisites and checks not covered by the
browser demo. The baseline was validated during transfer preparation; other
historical scripts have not all been revalidated against the current UI.

## Preserved diagnostics

These previously local scripts are retained so the next assistant can inspect
and reproduce investigations:

- `audit-image-exports.mjs`: intercepts demo image export paths and writes
  diagnostic images/results without touching the system clipboard.
- `audit-report-pipeline.mjs`: historical bug reproductions for report identity,
  selection, and partial-write behavior. Some assertions intentionally expect
  the old buggy behavior; this is not a release pass/fail check.
- `debug-annotations.mjs`, `debug-pareto.mjs`, `debug-plotly-log.mjs`: focused
  browser probes; start `npm run dev` separately.
- `debug-ui.mjs`, `debug-ui2.mjs`, `debug-custom.mjs`, `debug-facets.mjs`:
  historical UI probes and screenshot captures; start `npm run dev` separately.
- `debug-feedback.mjs`, `desktop-v4.mjs`, `desktop-v6.mjs`: historical native
  workflows. These now derive repository paths and validate fixture locations
  before launching or writing outputs.

The three native scripts above need approved reference data supplied explicitly:

```powershell
$env:EWS_STDF_FIXTURE_DIR = 'C:\approved-fixtures'
# That directory must contain demofile.stdf.Z, lot2.stdf, and lot3.stdf.
# Optional: use a freshly built executable in a different location.
$env:EWS_DESKTOP_EXE = 'C:\approved-build\ews-data-tool.exe'
node tools/desktop-v6.mjs
```

They do not download reference data. Reference samples are not required for the
baseline checks. Earlier already-tracked `desktop*.mjs` scripts still contain
legacy machine-specific paths; inspect them before use.

Generated files under `shots/`, `tmp/`, and `output/` are ignored. They are not
needed to rebuild the app. Existing tracked documentation screenshots remain
tracked. For a deliberately retained new reference artifact, review its data
and provenance and add that specific file explicitly with `git add -f`.

The Windows IT checklist is preserved in `docs/setup/`; it is a dated reference,
not a substitute for the current setup guide or the organization's requirements.
