# ui profile

Design skills and browser capture for any project with a UI: web, Godot and tooling projects use them (pack 0044). Not staged.

## Contents (pack-owned)

| Path | What |
|---|---|
| `.rulesync/skills/lartweib-taste/` | The maintainer's expectations for any UI; sets no style (0044) |
| `.rulesync/skills/browser-tooling/` | agent-browser vs Playwright split, capture rules (adapted from the maintainer's draft) |
| `dotai/tools/ui-shot.mjs` (+ `.sh`, `.ps1`) | Repeatable capture: one `{ok, title, errors, path, engine}` line per viewport. Playwright first (the project's own); when it is missing or fails to launch (not when the page errors), agent-browser on PATH (one isolated session; console and page errors, no HTTP status codes), with a one-line `fallback` reason. Neither available: one `ok: false` line saying how to install either |
| `dotai/tools/read-size.ui.txt` | Paths for the base size-based Read hook |
| `tests/` | `node --test "profiles/ui/tests/*.test.mjs"` |

## External items (not shipped)

The engine can declare external skills, plugins and agents only after engine v1 (engine answer, 2026-11-02), so pack v1 documents them with the manual install steps below.

| Item | Kind | Source | License (installed copy) | Install today |
|---|---|---|---|---|
| `impeccable` | Claude Code plugin (1 skill, 23 commands, 1 agent) | `impeccable` marketplace, Paul Bakaus, v3.5.0 | Apache-2.0 (marketplace `LICENSE`) | `/plugin marketplace add` the impeccable marketplace, then install `impeccable` |
| `web-design-guidelines` | skill | `vercel-labs/agent-skills` | no license file in the installed copy | `npx skills add vercel-labs/agent-skills --skill web-design-guidelines` |
| agent-browser | CLI | `vercel-labs/agent-browser` | Apache-2.0 | `npm i -g agent-browser@0.41.2`. **Blocking install step: 0.38.0 or later**: `snapshot --delta` and `screenshot --if-changed` arrived in 0.38.0 (2026-09-16), and `browser-tooling` uses them; the installed 0.27.0 lacks them (measurement 8) |

The `impeccable` plugin's agent (`impeccable-manual-edit-applier`) has no `effort` in its definition, so the base Agent hook (0030) denies its launches until the user accepts it in writing under `agents.defaultEffort` (`base/dotai/tools/agent-guard.mjs`, header). The profile cannot ship that entry: `.dotai/config.yaml` is local and written only by the user. Add it once, in `~/.dotai/config.yaml` (every project) or the project's `.dotai/config.yaml`:

```yaml
agents:
  defaultEffort:
    impeccable-manual-edit-applier: medium
```

The plain name also matches the namespaced `impeccable:impeccable-manual-edit-applier`. The value is recorded in the launch log, not enforced: Claude Code cannot set effort per launch.

## Dropped

`design-taste-frontend` (0044), `mobile-responsive-adaptation` (0044: about 80% covered by impeccable `adapt`; the rest is a short "On phones" list in `lartweib-taste`), the 9 design skills with 0 calls, `high-end-visual-design`, `gpt-taste` and `redesign-existing-projects` (not in the decided set), Playwright MCP, `Claude_Browser` MCP. `design-references` stays project-local. No Playwright MCP is confirmed by measurement 8: its schema costs ~5.3k tokens per session, while the same 10-step flow through agent-browser `-i` produced ~290 tokens of output (playwright-cli ~975).

## Onboarding clashes

- Two web projects carry project copies named `agent-browser`, `web-design-guidelines` and `frontend-design`. `dotai-analyze` must flag them for removal.
- `agent-browser --version` below 0.38.0 (for example 0.27.0): `dotai-analyze` flags it as a blocking step before the profile is used; the user upgrades it (`npm i -g agent-browser@0.41.2`), since the cleanup never changes user-scope installs.

## TODO(trial)

- agent-browser 0.41.2 on Windows: `diff` and the axe audit; close Chrome before `--profile`. (Measurement 8 ran the 10-step flow, `--delta` and `skills get` on 0.41.1 with no failures, also from `agy -p`; Electron over CDP was not tried.)
- `ui-shot.mjs` against a real dev server. Most of the author's UI projects have no Playwright installed (one web project does), so the agent-browser path is the common one: checked on 2026-11-02 with agent-browser 0.27.0 on a local page (two viewports, console and page errors). Rechecked on 2026-11-04 with agent-browser 0.41.2 on Node 22.18 (the package declares `node >=24`, but its `bin/agent-browser.js` only spawns the native binary and runs fine on 22): fallback from a cwd without Playwright, and fallback on a real launch failure (a project's Playwright 1.61 whose headless shell was not installed), both at 320 and 1440 wide with `--full`; same CLI flags and JSON shapes, and `errors --clear` now works. On 2026-11-04 both paths ran against a real dev server (Vite 8.3.5 vanilla with HMR, Playwright 1.64.1, agent-browser 0.41.2, Node 22.18) at 320 and 1440 wide: Playwright as engine, and agent-browser on a launch failure and with Playwright not installed. Console and page errors are reported, the HMR websocket and Vite client add no false errors, and an edit while the server runs shows on the next capture. Found and fixed: agent-browser followed the OS dark scheme while Playwright renders light, so the fallback now pins `set media light`. Known: an edit saved just before a capture can make Vite full-reload the page mid-capture, so the same errors appear twice (the capture is still fresh); and agent-browser 0.41.2 leaves a `~/.agent-browser/ui-shot-<pid>.target` file after `close`. Page error text also differs by engine (`page: msg` vs `page: Error: msg`).
