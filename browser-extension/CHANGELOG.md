# Release notes

## 0.1.0 — 2026-11-02

First version of Our LoRA Bridge:

- Toolbar action opens or focuses a dedicated dashboard and passes the selected Civitai model/version link.
- Local LoRA Manager health and installed-version checks, with duplicate protection for an installed exact version.
- Download requests using LoRA Manager's configured folders, progress tracking, pause and resume controls.
- Loopback-only connection settings and local transfer history. No API-key handling or Civitai page access.
- Dependency-free runtime and reproducible ZIP packager.

Verified on Windows with Chrome and LoRA Manager 1.2.8:

- Ten Node tests passed, covering URL validation, version selection, API failures, permission scope, and dashboard reuse.
- JavaScript syntax checks and Git whitespace checks passed.
- Loaded the unpacked extension into Chrome; the toolbar opens its dashboard.
- The actual extension connected to the running LoRA Manager at `127.0.0.1:8188`.
- A known local version was correctly identified as installed, with downloading disabled.

Not verified end to end in this release: a real Civitai download, transfer completion, and pause/resume during a live transfer. No test model was downloaded. The Civitai API key was not available/configured during these checks. Keep the dashboard tab open during transfers; see the README for recovery limitations.
