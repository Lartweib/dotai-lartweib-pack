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

- The Playwright version whose Electron launch passes against the app's Electron; record it in the project.
- `desktop-shot.mjs` against the real Electron app (the tests use a fake Electron).
- A signed release with Certum SimplySign (local build), then `signtool verify /pa` on the installer; SignPath only if Certum's cost or the public name matter.
- The project has no `AGENTS.md` yet: its commands go there, not in this profile.
