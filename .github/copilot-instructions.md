# EWS Data Tool

Read and follow the shared instructions in [AGENTS.md](../AGENTS.md) before
editing. Read [the handover guide](../docs/HANDOVER.md) for environment setup,
architecture entry points, and verification limits. These repository files
carry project context across coding assistants; keep shared rules there.

This is a Windows desktop app using Tauri/Rust and React/TypeScript/Plotly, with
an offline runtime and a separate browser demo. From the repository root use
`npm ci`, `npm run doctor`, `npm run check`, and `npm run test:browser` as
appropriate. Browser checks require Microsoft Edge and do not cover native
desktop features. Preserve unrelated working-tree changes and report the
checks actually run. Do not assume access to another assistant's chat or tools.
