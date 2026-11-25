# Working on EWS Data Tool

These are shared repository instructions for coding agents. Read `README.md`
and `docs/HANDOVER.md` for setup, checks, and transfer limitations. Keep project
knowledge in the repository; do not rely on a previous agent's chat history.

## Architecture

- `src-tauri/src/`: Rust import, dataset, statistics, queries, and Tauri commands.
- `src/lib/api.ts`: frontend/backend boundary and browser-demo fallback.
- `src/types.ts` and `src-tauri/src/model.rs`: corresponding data contracts.
- `src/store.ts`: frontend state. `src/charts/`: chart construction and export.
- `src/components/`: UI. `src/lib/report*.ts`: report and template logic.
- `tools/`: verification scripts; some older scripts depend on local paths.
- `docs/`: design decisions, validation notes, and release history. Historical
  notes describe their date/version; verify current behavior against code.

## Change rules

- Inspect relevant code and the working tree before editing. Preserve existing
  user changes and untracked work. Keep fixes focused on the requested behavior.
- Preserve local/offline runtime operation. Dependency installation and agent
  services may use the network; they are separate from app runtime behavior.
- Keep Rust/TypeScript contracts and the demo fallback consistent when changing
  command inputs, outputs, or plot specifications.
- Treat statistical formulas, missing-value handling, retest ordering, yield
  denominators, and import behavior as explicit product decisions. For changes,
  document the intended result and use a small independent expected-value test.
- Preserve existing saved templates where possible; explain any incompatible
  changes and their migration. Do not silently reinterpret old settings.
- Derive paths from the repository or accept explicit configuration. Do not add
  personal drive paths, temporary sample locations, secrets, or company datasets.
- Prefer existing dependencies and lockfiles. Avoid incidental dependency updates.

## Verification and completion

Run commands from the repository root:

```text
npm run doctor
npm run check
npm run test:browser
```

`check` builds the frontend and runs default Rust library tests using Cargo.lock.
`test:browser` requires installed Microsoft Edge and starts its own demo server
on port 1421. Run browser scripts sequentially because many share ports.
Reference-file tests are ignored by default; see the README for their fixtures.

Choose checks appropriate to the change. For desktop behavior, also verify a
fresh desktop build and the affected workflow; browser demo checks do not prove
native import, clipboard, dialogs, or disk export. Do not treat historical
screenshots or an old executable as evidence for new changes.

Report changed behavior, commands actually run and their results, and checks
that remain unverified. When setup or a dependency is unavailable, report that
limitation instead of claiming the corresponding check passed.
