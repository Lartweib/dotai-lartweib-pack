# desktop profile

Desktop apps with Electron only (pack 0044): Tauri has no real use. Not staged.

## Contents

| Path | What |
|---|---|
| `.rulesync/rules/desktop.md` | Commands, IPC security, compact verification output |
| `.rulesync/skills/desktop-verify/` | Real-window check and E2E: Playwright Electron support with a pinned version, `wdio-electron-service` as fallback |
| `.rulesync/skills/desktop-release/` | NSIS with electron-builder, GitHub Releases as drafts, optional signing hook |
| `dotai/tools/desktop-shot.mjs` (+ `.sh`, `.ps1`) | Launches the app, captures the first window, prints `{ok, title, errors, path}` |
| `dotai/tools/desktop-sign.cjs` | electron-builder `sign` hook template: unsigned without `DESKTOP_SIGN_COMMAND`, otherwise runs the signer per file. Not a tool command, so it has no `.sh`/`.ps1`; the project copies it to `build/sign.cjs` |
| `dotai/tools/read-size.desktop.txt` | Build and package paths |
| `tests/` | `node --test "profiles/desktop/tests/*.test.mjs"` |

## Decided (0044 update)

- Release: an NSIS installer from electron-builder, published to GitHub Releases. No Steam.
- Signing: optional; unsigned builds still work. the target apps will be open source, so: Certum Open Source Code Signing in the Cloud (~€49/year) through the hook, recommended; SignPath Foundation (free, CI-only, two-pass with NSIS) as fallback. Azure Artifact Signing does not serve individuals in the EU. The project sets `DESKTOP_SIGN_COMMAND` (signtool with the Certum thumbprint) and `DESKTOP_SIGN_REQUIRED=1` in its release job; details in the `desktop-release` skill.
- E2E: Playwright `_electron`, pinned (issue #39008 breaks launch on 1.58 with Electron 30+); `wdio-electron-service` is the fallback.

## Dropped

Tauri MCP, Windows-MCP, `rust-analyzer-lsp`, Playwright MCP, Steam deploy.

## TODO(trial)

- Record the passing Playwright version in the real project's `AGENTS.md` and run `desktop-shot.mjs` against that app (the trial below used a quick-start app).
- A signed release with Certum SimplySign (local build), then `signtool verify /pa` on the installer; SignPath only if Certum's cost or the public name matter.
- The project has no `AGENTS.md` yet: its commands go there, not in this profile.

## Verified (trial 2026-11-19, Windows, Node 22)

- Playwright 1.65.1 (`@playwright/test`, latest) launches Electron 45.3.4 (latest): `_electron.launch({ args: ['.'] })` on the minimal quick-start app returned the window title in 0.7 s and closed cleanly. No older Playwright was needed.
- `desktop-shot.mjs --main . --out shots` against that app printed `{"ok":true,"title":"Quick Start","errors":["console: boom-check"],"path":"...\shots\window.png"}`: the real window was captured and a `console.error` from the page's inline script was reported.
- npm did not run Electron's `postinstall` in that install, so `node_modules/electron/dist` was missing until `node node_modules/electron/install.js` ran (with `ELECTRON_CACHE` set, it stays out of the home folder).
