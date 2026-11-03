---
name: desktop-verify
description: "Check an Electron app in a real window: Playwright Electron launch, capture, E2E; wdio-electron-service as fallback. Use to verify desktop UI changes."
metadata:
  author: Federico Ara
---

# desktop-verify

Unit tests do not prove the app starts. After a change to the main process, the preload or the window UI, launch the real app.

## Quick check

1. Build what the main entry needs (`npm run build`).
2. `node ${DOTAI_PROJECT_TOOLS}/desktop-shot.mjs --main . --out shots` prints `{ok, title, errors, path}`.
3. `ok: false` or any error: fix it before going on. Read `path` only when the layout must be judged; send it to `reviewer` for a visual judgment.

## E2E with Playwright

- Pin `@playwright/test` to an exact version in `package.json` (no `^`). Playwright 1.58 fails to launch Electron 30 and later (issue microsoft/playwright#39008); use a version whose launch smoke test passes against the project's Electron. TODO(trial): find that version for the current Electron and record it in the project's `AGENTS.md`.
- Launch with `_electron.launch({ args: ['.'] })`, then `app.firstWindow()`. Use locators, not screenshots, to find elements.
- Visual regression: `expect(window).toHaveScreenshot()`, with snapshots per platform.
- Terse reporter (`--reporter=line`); read failures only.
- Electron support is still experimental and moving to its own package (PR microsoft/playwright#40184): check the import path when upgrading.

## Fallback: WebdriverIO

When Playwright cannot launch the project's Electron, use `wdio-electron-service`: it matches Chromedriver to the app's Electron and can mock main-process APIs. It also runs under Xvfb in Linux CI.

## Never

- Kill Electron by image name; close the app from the test, or kill by PID.
- Leave an app instance running after the check.
