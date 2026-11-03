---
name: browser-tooling
description: "Pick the browser tool first: agent-browser for interactive checks, a Playwright script for repeatable captures, E2E and metrics. Use before any screenshot, UI check or page automation."
metadata:
  author: Federico Ara
---

# browser-tooling

**agent-browser** for a walkthrough, one step at a time. **A Playwright script** for anything repeatable, bulk or measured. Neither is banned. No Playwright MCP.

## Which one

| Task | Tool |
|---|---|
| Explore or verify by hand: open the menu, click, see what happens | agent-browser |
| Quick look at one page or a few states while developing | agent-browser |
| Before/after visual diff of one page | `agent-browser diff` |
| One-off accessibility check | agent-browser's axe audit |
| Several viewports, scroll positions, fixed waits | `ui-shot.mjs` or a project script |
| Regression, E2E, CI | `@playwright/test`, `toHaveScreenshot` for visual regression |
| Metrics: CPU throttling, LCP/CLS, axe across pages | a Playwright script |
| Work delegated to agy | one script command, short output |

Explore with agent-browser, then freeze the working flow into a script in `scripts/`.

## Capture

`node ${DOTAI_PROJECT_TOOLS}/ui-shot.mjs <url> --viewports 1440x900,390x844 --out shots --name home` prints one JSON line per viewport: `{ok, title, errors, path, engine}`. Playwright first (the project's own); if it is missing or fails to launch, agent-browser, with `fallback` giving the reason. Report the `engine` used. Read an image only when the layout must be judged; visual judgment goes to `reviewer` or `judge` with the paths.

## agent-browser

- Needs agent-browser 0.38.0 or later (`--delta`, `--if-changed`); check with `agent-browser --version`.
- Look up flags instead of guessing, but never read the full `skills get core` (~10k tokens): `agent-browser <command> --help` for one command, or `agent-browser skills get core | rg -A 25 '^## <topic>'` for one section (for example `Waiting`).
- `snapshot -i` (interactive elements only), `-s <css>` to scope, `snapshot --delta` after an action; `screenshot --if-changed` skips an unchanged page.
- `get text` instead of a snapshot when only content matters.
- `--max-output` to cap, `--json` when parsing. `agent-browser close` when done.

## Playwright scripts

- Print a summary only: counts, numbers, file paths. Never print DOM, HTML or full snapshots.
- Terse reporter (`--reporter=line`); read failures only.
- One output folder per run; compare before/after by file.

## Avoid

- 100+ captures driven step by step through agent-browser.
- A full snapshot after every click; reading screenshots to find elements (use refs or locators).
- A second browser install when one Chrome serves both.
- Sessions or dev servers left open after the task.
