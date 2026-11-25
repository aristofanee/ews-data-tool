# Moving EWS Data Tool to another laptop or coding assistant

## What travels with the project

Transfer the source, both dependency lockfiles, and documentation through an
approved Git repository or reviewed source archive. Preserve any intended
uncommitted work first: a clone contains committed files only. Run
`git status --short` and review untracked files as well as `git diff` before
transfer. During transfer preparation, useful local diagnostic scripts were
retained under `tools/`, and the existing IT checklist was copied into
`docs/setup/`. Generated screenshots, reports, and temporary files are ignored;
they can be recreated. See `tools/README.md` for the preserved diagnostics.

Reinstall `node_modules` and rebuild `dist` and `src-tauri/target` on the new
machine. Do not use copied caches or an old executable as the baseline build.
Transfer any desired user templates or custom labels separately; browser/app
local storage and preferences are not part of a Git clone. Test saved templates
with the intended dataset after moving them.

Check company requirements for the repository location, approved coding
assistant, software installation, and permitted data use. Keep production STDF
files, reports, credentials, and personal agent configuration outside the source
transfer unless explicitly appropriate. The app's offline runtime does not mean
an external coding assistant processes code or prompts offline.

## Windows setup

Install through your organization's approved channels:

- Git and Node.js/npm. The installed Vite dependency declares Node
  `^20.19.0 || >=22.12.0`; choose an approved maintained version within that range.
- Rust with the Windows MSVC host toolchain. `Cargo.toml` declares Rust 1.85,
  but locked dependencies can impose a newer requirement. Preserve Cargo.lock
  and verify compilation rather than assuming that minimum covers dependencies.
- Microsoft C++ Build Tools with the Desktop development with C++ workload and
  Windows SDK, plus WebView2 for Tauri. Microsoft Edge is separately needed by
  the existing browser verification scripts.

See the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
The previous workstation reported Node 25.6.0, npm 11.8.0, and Rust/Cargo
1.100.0-nightly (2026-08-31 compiler commit). This is an observed environment,
not a requirement or proof that a particular stable toolchain has been tested.
No Rust toolchain is currently pinned; record the successful approved versions
on the new laptop before choosing a shared pin.

From the repository root:

```powershell
node tools/doctor.mjs
npm ci
npm run check
npm run test:browser
npm run tauri dev
```

`doctor` only discovers tools and prerequisites; it makes no installations or
configuration changes and cannot prove compiler/SDK/WebView2 readiness.
`npm ci` installs the frontend versions in package-lock.json. `check` runs the
TypeScript/Vite build and default Rust library tests with Cargo.lock enforced.
`test:browser` uses demo data, starts port 1421, and requires Edge. Do not run
other scripts sharing that port concurrently. Network access is needed for
uncached npm/Cargo packages and may be needed for installer resources.

For registry/proxy/certificate failures, use the organization's documented
configuration. Do not disable TLS verification or commit tokens to fix setup.
Browser preview alone (`npm run dev`) is useful before native prerequisites are
ready, but cannot verify real imports or disk report exports.

## Baseline verification

After the commands above pass, build a fresh desktop executable with
`npm run tauri build`. On Windows, the release executable is normally
`src-tauri/target/release/ews-data-tool.exe`. Open the synthetic
`sample-data/sample-wide.csv` and check filtering, plots, CSV export, template
save/load, and a JPG report in a new temporary output folder. Close and reopen
the app to verify any persistence relevant to your workflow.

An existing native regression uses generated synthetic STDF rather than an
external dataset:

```powershell
node tools/verify-release-0511.mjs
```

It runs against the release executable and writes to `shots/release-0511`.
This is a version-specific check (including a v0.5.11 UI expectation); update
its expectations deliberately when the app version or behavior changes.

The default Rust suite excludes ignored reference-file tests. See README's
Tests section for `STDF_DEMO`, `STDF_DEMO_Z`, and commands for those optional
checks. Supply approved fixtures explicitly; a successful default run does not
mean the external fixtures were tested.

### Existing portability debt

Earlier already-tracked `desktop.mjs`, `desktop-v2.mjs`, `desktop-v3.mjs`, and
`desktop-v5.mjs` hard-code a personal drive path or expect
`%TEMP%/pystdf/pystdf-main/data`. Do not run them unchanged on the new laptop.
The newly preserved `desktop-v4.mjs`, `desktop-v6.mjs`, and `debug-feedback.mjs`
use repository-relative paths and require `EWS_STDF_FIXTURE_DIR` explicitly;
see `tools/README.md`. Their historical assertions still need review against
the current UI. The newly preserved browser probes also use portable output
paths. Many browser scripts use the installed `msedge` channel and fixed ports.

## Starting with another agent

`AGENTS.md` is the shared source of project guidance.
`.github/copilot-instructions.md` provides the Copilot entry point and directs
it to that file. Instruction support varies by Copilot client and feature; see
[GitHub's support matrix](https://docs.github.com/en/copilot/reference/custom-instructions-support).
Verify that the chosen client loads repository instructions; explicitly include
the files in the first request if needed. No Codex plugin, chat history, MCP
server, or personal skill is required to build and check this repository.

Use this first request after moving:

> Read AGENTS.md, README.md, and docs/HANDOVER.md. Inspect git status and explain
> the architecture briefly. Run the documented environment and baseline checks
> available here. Report tool versions, actual results, and missing prerequisites
> before making feature changes. Do not install software or alter dependencies
> merely to hide a setup failure.

## Transfer preparation check: 2026-11-25

On the original workstation, with the versions recorded above:

- `npm run doctor`: passed tool discovery.
- `npm run check`: frontend build passed; Rust tests: 76 passed, 6 ignored.
  Vite reported warnings about mixed static/dynamic imports of Tauri modules.
- `npm run test:browser`: passed after launching outside the restricted agent
  sandbox. The initial sandbox launch failed with an Edge access-denied error.
  The existing regression was updated to select sigma capability explicitly,
  check both Cp and Cpk, and check the current value-map and bin-map yield views.
- A clean install, stable Rust toolchain, fresh packaged desktop build, native
  regression, and the destination work laptop were not verified in this change.

These results are a dated baseline, not evidence that the destination environment
is ready. Re-run the checks after transfer.

Update the following handoff record before each future move or substantial task
handoff. Keep it factual; do not treat historical validation notes as fresh tests.

```text
Branch and commit:
Intended uncommitted work / files to transfer:
Current task and acceptance criteria:
Decisions and reasons (link docs/code):
Checks run, date, versions, results:
Known failures / checks not run:
Next concrete step:
```
