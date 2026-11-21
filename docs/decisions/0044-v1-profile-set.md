---
status: accepted
date: 2026-11-01
tags: [profiles, onboarding, v1]
---

# 0044 · The v1 profile set

## Context

[0043](0043-v1-is-the-complete-pack.md) puts the profiles in v1 and asks for their set to come from the author's usage. A fresh analysis (2026-11-01, internal research, not published) covered the author's recent Claude Code tool calls, prompt history, agy history and the marker files in their projects. The candidate set was `godot`, `web`, `desktop`, `tooling`, `video` and `mobile`.

Profiles are flat and combinable ([dotai 0023](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0023-flat-profiles-and-layer-merge-rules.md)), and a name has one owner. A capability used across stacks therefore needs its own profile rather than a copy in each.

## Decision

v1 ships nine profiles. A project combines the ones it needs.

| Profile | Covers | Evidence |
|---|---|---|
| `godot` | Godot 4 games in GDScript | several active projects; `godot --headless` among the most frequent commands; `godot-gdscript` the most used skill |
| `obra` | Long autonomous work: workflows, scheduled runs, monitors; any stack | workflows, monitors and scheduled runs in regular use |
| `web` | Web framework, build and checks (Astro, Next.js) | several web projects; `vitest`, `tsc` and `astro check/build` in frequent use |
| `ui` | Design skills and browser capture | design skills used in web, Godot and tooling projects; capture scripts in regular use |
| `seo` | SEO audits, applied on demand | occasional audits |
| `cloudflare` | Wrangler, Workers, Pages | `wrangler` in regular use; one project on Cloudflare Pages |
| `video` | Making and analyzing video | `ffmpeg` in frequent use; `video-frames` used occasionally |
| `tooling` | CLIs, scripts, Go, Python; per-language checks chosen by marker files | `go test`, `pytest` and `ruff` in frequent use |
| `desktop` | Electron apps | one Electron app; Tauri has no real use |

- `ui`, `seo` and `cloudflare` are split out of `web`: they are used outside web projects or only sometimes.
- `desktop` is Electron only. This answers the Tauri part of OPEN-QUESTIONS 7.
- `cloudflare` is its own small subset. This answers OPEN-QUESTIONS 8.
- `obra` must not ship an item named like the base `autonomous` skill.
- `mobile` is decided separately (OPEN-QUESTIONS 25): there is no usage data.

## Considered options

- **A (chosen):** nine narrow profiles, combined per project.
- **B:** the original candidates, with design, SEO and Cloudflare inside `web`. Rejected: Godot and tooling projects use the design skills too, and one owner per name forbids copies.
- **C:** also `social`, `research`, `data` and a Next/Vercel/Supabase profile. Rejected: project-local skills or the base already cover them, or usage is near zero.

## Consequences

- Good: each project gets a combination fitted to it, not a generic bundle.
- Accepted cost: more profiles to maintain, and onboarding must suggest combinations.
- Pending: the content of each profile, and the remaining author questions (OPEN-QUESTIONS 7, 9, 11, 13–16, 25).

## Evidence

- Usage analysis and ecosystem research, 2026-11-01 (internal research, not published).
- Review with the author, 2026-11-01.

## Update 2026-11-01: author answers

- **`mobile` stays out of v1.** The author first accepted it (Android only), then left it out: it will be designed when a mobile project starts. Research on an Android-only stack (Kotlin + Jetpack Compose suggested) was kept for that moment (internal research, not published).
- **`desktop` release:** an NSIS installer from electron-builder, published on GitHub Releases. No Steam. Code signing is open: Azure Artifact Signing serves individuals only in the USA and Canada, so not individuals in the EU (organizations in the EU qualify), and the cheap options need an open-source app. The profile ships the release flow with signing as an optional hook.
- **`desktop` E2E with a real window:** Playwright's Electron support, with a pinned version (an open issue breaks launch on Playwright 1.58 with Electron 30 and later); `wdio-electron-service` is the fallback. Chosen without the author, since they already use Playwright (inferred).
- **RTK** is not adopted: unused. Its BUSL license (OPEN-QUESTIONS 16) is moot.
- **Answered from usage data** (OPEN-QUESTIONS 6, 10, 13, 14 in part):
  - No more roles in the base: the custom roles were never launched; the base roster of [0037](0037-base-subagent-roster.md) stays.
  - `context7` is dropped by policy: never called.
  - Warp, the pixel-art MCP and `pixel-agents` leave: Warp is no longer enabled, the pixel-art MCP serves a single project that registers it itself, and the author uninstalled `pixel-agents`.
  - Both Godot MCP servers (`godot` and `godot-mcp`) and `godot-claude-skills` (needs the editor) are dropped, all barely used; `impeccable` goes to `ui`; the unused design skills are dropped.
- **Visual review stays in Claude** (OPEN-QUESTIONS 15): the `reviewer` (Sonnet, reads images) does it. agy is not calibrated as a visual judge (measurement 5 dropped): it failed 73% of earlier trials and approved a defective case. agy keeps research and mechanical work.
- **No mods in v1** (OPEN-QUESTIONS 20): Orca's panel (`orca`) and the viewer plus the statusline (`standalone`, [0032](0032-variant-parity-by-use-case.md)) cover visibility. A project that needs a panel gets a project mod ([0026](0026-mods-incident-and-value.md)).
- **`ui` keeps 4 third-party design skills** (`impeccable`, `design-taste-frontend`, `web-design-guidelines`, `mobile-responsive-adaptation`) **and adds `lartweib-taste`.** An analysis of the author's design prompts across their web projects showed the four cover method but not the author's expectations, and some of their bans contradict choices the author makes on purpose. The author wants expectations, not a fixed style applied to every site: `lartweib-taste` holds the bar, identity per product, motion, precision and process, and sets no font, palette or theme.
- **`design-taste-frontend` is dropped** (left to the maintainer's judgment by the author): its bans conflict most with the author's choices, it covers marketing pages only, it proposes its own direction instead of following the author's mockup, and its description costs ~840 characters per session. `ui` ships `impeccable`, `web-design-guidelines` and `lartweib-taste`.
- **`mobile-responsive-adaptation` is dropped** (author, 2026-11-02): it has no published source (generated locally from the gentle-ai skill-creator template), impeccable `adapt` covers about 80% of it, and its triggers overlap impeccable's. What `adapt` lacks (`dvh`/`svh`, `viewport-fit=cover`, 16px inputs, a 320px check) went into an "On phones" list in `lartweib-taste`.
- **`video-frames` is the author's own** (confirmed 2026-11-02; no published copy found). It gains subtitle-anchored frames, a sliding-window dedup and an opt-in local Whisper transcription, ideas taken from `claude-real-video` and `claude-video` (both MIT; no code copied, credited in the `video` README); Gemini stays a documented manual option, since the video leaves the machine.
- **Godot guards** (OPEN-QUESTIONS 9): [0045](0045-godot-guards-with-load-based-cap.md).

## Update 2026-11-02: engine answers

The profile build (2026-11-01) raised engine questions; the engine answered them on 2026-11-02.

- **Hooks from several profiles merge** ([dotai 0040](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0040-list-files-merged-as-a-union.md), PR #30). `godot`, `web` and `tooling` stage together: checked with `godot,tooling`, `web,ui,tooling`, `godot,web,tooling` and all nine profiles.
- **Shared code lives in the base.** The hook lib, which was copied into three profiles, is now one base tool, `base/dotai/tools/hook-lib.mjs`. Profile tools import it from the user tools directory (`${DOTAI_TOOLS}`, [PACK-FORMAT](https://github.com/Lartweib/dotai/blob/main/docs/PACK-FORMAT.md)).
- **Matchers per harness.** A `Bash` matcher fires in neither agy nor OpenCode. Hooks with a matcher go in per-harness blocks (`claudecode:`, `opencode:`, `antigravity-cli:`) and name each harness's own tool. Shell: `Bash`, `bash` and `run_command`. The pack keeps every event that has a matcher out of the shared `hooks` block: rulesync replaces a harness's shared event when that harness's block sets the same event, so a shared entry from another layer would be dropped silently.
- **Pending in the engine:**
  - `${DOTAI_TOOL:<name>}` in hook commands comes in a later engine change. Until then, hooks run `node <path>` with the path bare, so a project path with spaces breaks them. agy runs hooks without a shell, so even then a path with spaces cannot work there.
  - The same MCP server in two profiles comes in the same change, accepted when the definitions are identical. codegraph is not registered in any profile: measurement 4 made it an opt-in, per-project pilot ([0012](0012-memory-and-code-intelligence-keep-and-measure.md), update 2026-11-02). The `web` and `tooling` READMEs carry one identical definition.
- **External skills, plugins and agents** can be declared only after engine v1. Pack v1 lists them in the profile READMEs with manual install steps.

## Update 2026-11-02: measurements 6, 8, 10 and 11

Profile content set by measurement; the numbers are in each profile's README.

- **`godot`** (6, 10): the closing gate is judged by `SCRIPT ERROR` lines, not the exit code; scripts that reference autoloads get false positives from `--check-only` and are verified with the project's suite; a fresh copy needs `--import` first. Captures with `--write-movie` need a window, so the user's approval (headless crashes). gdstyle is dropped (style noise, misses syntax errors). Moving one project's own state script to `godot.stateCommand` waits for a fast plain-text mode in that script (measured 80 s, ~39k tokens per session); the state timeout is now configurable (`godot.stateTimeoutSec`).
- **`ui`** (8): agent-browser 0.38.0 or later is required (`--delta`, `--if-changed`); `skills get core` (~10k tokens) is never read whole; no Playwright MCP (~5.3k fixed).
- **`web`** (11): the one-line Next docs rule stays; the `@next/codemod agents-md` index (~2.3k tokens per session) is opt-in; the Astro docs MCP is not registered by default (~7k tokens per search): WebFetch of one page is the default.
- **`tooling`** (11): `gopls mcp -instructions` is not loaded by default (~2.3k tokens with its tools, and it makes the agent run vulncheck every session).
- **codegraph** (4): an opt-in pilot, not in `web` or `tooling` ([0012](0012-memory-and-code-intelligence-keep-and-measure.md), update 2026-11-02).

## Update 2026-11-02

- **`desktop` stays, and signing is chosen.** The author confirmed that two of their Electron apps will be open source. Signing stays optional; the recommended route is Certum Open Source Code Signing in the Cloud (SimplySign, ~€49/year, issued to the individual), run through the profile's `sign` hook so the installer, uninstaller and `latest.yml` stay consistent. SignPath Foundation (free) is the fallback: it signs only uploaded CI artifacts, cannot sign inside NSIS, and needs a released project and a signing policy. The hook gained `DESKTOP_SIGN_REQUIRED=1` so a release job fails instead of shipping unsigned.

## Update 2026-11-03: renamed, and lane conventions

Author decisions:

- **Renamed.** The profile `obra` is now `autonomous-orchestra`: directory `profiles/autonomous-orchestra/`, skill `autonomous-orchestra`, lane tool `orchestra-lanes` (`.mjs`, `.sh`, `.ps1`). The text above keeps the old name. The rule that it ships no item named like the base `autonomous` skill still holds.
- **Worktrees** go under `.claude/worktrees/<id>`, the author's real location, added to `.git/info/exclude`, never `.gitignore`.
- **Branches by area.** `orchestra-lanes new <area>/<id>` (for example `combat/dash`) creates `.claude/worktrees/<id>` on branch `<area>/<id>`; area and id are each one lowercase ref component, and ids stay disjoint across areas. `list` shows every worktree under `.claude/worktrees/`, whatever its branch (ahead/behind against the base, dirty, last commit), one line each. `rm <id>` refuses dirty or unmerged lanes.
- **Autonomous runs.** The skill tells the agent to set `DOTAI_AUTONOMOUS=1` for scheduled or unattended runs, so `delegate` applies the hard quota cap ([0019](0019-quota-cap-by-who-is-in-charge.md)).
- **Profiles per worktree** ([0040](0040-project-onboarding-and-on-demand-profiles.md), update 2026-11-02): after `new`, the tool prints the `dotai apply` for the main checkout's profiles, or runs it with `--apply` when `dotai` is on PATH.

## Update 2026-11-03: Remotion default for `video`

Author decision:

- **Remotion is the default, HyperFrames the fallback** (reverses the earlier README order). Remotion (v4.0.540) is mature, has 13 official agent skills and an `llms.txt`, and it has already carried a real production (Godot footage in `<OffthreadVideo>` with overlays). HyperFrames (Apache-2.0) is pre-1.0 (v0.9.6) with open Windows issues (#4845, #4058, #4060); it stays for short web or app promos, or when an OSI license is required, after its 10-second Windows trial.
- **License note.** The pack will be public and Remotion is not OSI: the README says who needs a paid company license (companies above 3 employees that are not non-profits; from $25 per seat per month, or $0.01 per render with a $100 monthly minimum) and links the [license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) and [pricing](https://www.remotion.pro/license). The pack ships no Remotion code; skills are installed by the user.
- **Rule lines from that production's pains:** check frames with `npx remotion still` (or `hyperframes snapshot`) before a full render (7,462 frames took ~27 min); `--concurrency` 6 or less, always under a timeout (to keep the PC usable); integer composition width and height (a 720.036 height failed); video projects in git (that production's projects were lost). Audio mixing outside Remotion (Python scripts) is noted, not ruled.
- **Not adopted:** Motion Canvas, Revideo, Theatre.js, Editly (stalled); Manim (math-focused).

## Update 2026-11-19: `tooling` lints on Stop for agy

Author decision, delegated; agy 1.5.3 trials:

- **agy's check moves to `Stop`.** On agy's `PostToolUse` the output is parsed as a proto whose only field is `overwriteResult`: `{decision: "block"}` is rejected ("unknown field decision") and an `overwriteResult` did not reach the model either. On `Stop`, `{decision: "block", reason}` reaches the model. So the agy block of `profiles/tooling/.rulesync/hooks.jsonc` runs `tooling-check.mjs stop` (no `PostToolUse`): the same per-file checks over git's changed tracked and untracked files under the workspace, one time budget, `go vet` once per package, and a tree already checked (same files, same mtimes) is skipped, which ends the block loop, since agy's `Stop` has no `stop_hook_active`. Claude Code keeps `PostToolUse` on its edit tools. OpenCode still gets no hook.
- **Shared helpers.** The changed-files, fingerprint and stamp helpers moved from the web profile's `web-check` to the base hook lib, one owner for both Stop hooks.
- **Evidence.** In a throwaway Go module with the profile applied, `dotai run antigravity-cli` (gemini-3.8-flash-low, `accept-edits`) wrote a misformatted `p/p.go`; the Stop hook blocked with "tooling check: lint problems in the files this turn changed. Fix these, then finish: ... gofmt: not gofmt-formatted", the model quoted that feedback, rewrote the file gofmt-clean without a shell command, and the run ended `SUCCESS`.

## Update 2026-11-19: a tenth profile

Option C rejected a Next/Vercel/Supabase profile. A narrower `vercel` profile (CLI and skill, no MCP) is added by [0049](0049-vercel-profile.md): the author now has projects on Vercel.
