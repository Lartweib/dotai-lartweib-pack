# dotai-analyze: clash and budget rules

Dated 2026-11-03 (pack 0040, 0044, 0046), updated 2026-11-18 (pack 0047): profiles are chosen by dotai's `dotai-profiles` skill from the descriptions and hints in `dotai.yaml`; this skill only cleans up clashes for the profiles applied (`.dotai/state.json`).

## Clashes

Pack names: the base skills (`memory`, `delegate`, `spec`, `autonomous`, `dotai-analyze`) and agents (`explorer`, `researcher`, `worker`, `reviewer`, `judge`), plus the skill and agent names of each applied profile (its `README.md`).

| Kind | Where to look | Clash when | Action |
|---|---|---|---|
| Old rules | `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `GEMINI.md`, `.claude/rules/`, `.agents/rules/` | A `<!-- gentle-ai:<name> -->` ... `<!-- /gentle-ai:<name> -->` block; or text that restates the core rules (persona, commit attribution, tool lists, memory protocol, SDD orchestration) | Remove the block or the restated lines; keep project-specific text |
| Same-name skill | `.claude/skills/<n>/`, `.agents/skills/<n>/`, `.opencode/skill(s)/<n>/` | `<n>` is a pack name | Remove the project copy when its owning layer is applied; else flag |
| Same-name agent | `.claude/agents/<n>.md`, `.agents/agents/<n>.md`, `.opencode/agent(s)/<n>.md` | `<n>` is a pack name | Remove the project copy; flag if it holds project-specific prompts |
| Duplicate hook | `.claude/settings.json`, `.claude/settings.local.json` (`hooks`), `.agents/hooks.json`, `.opencode/plugins/` | It does what a pack hook does: `SessionStart` state or memory injection, Agent model guard, Bash guards, read-size guard, statusline | Propose removal, or a move to the profile's config key |
| Memory MCP | `.mcp.json`, `.claude/settings*.json` | An `engram` MCP server (the pack uses the CLI, 0041) | Flag; the user decides |
| User plugin duplicating a profile | `claude plugin list` | The `cloudflare` plugin (`cloudflare@cloudflare`) with `cloudflare` applied: it duplicates `cloudflare:wrangler` and `cloudflare:workers-best-practices` | Flag; the user runs `claude plugin uninstall cloudflare@cloudflare` (user scope, never touched by this skill) |
| User plugin duplicating a profile | `claude plugin list` | The `vercel` plugin (`vercel@vercel`) with `vercel` applied: its `vercel-cli` skill duplicates `vercel`, and it adds the Vercel MCP | Flag; the user runs `claude plugin uninstall vercel@vercel` (user scope) |
| User plugin duplicating the base | `claude plugin list` | The `engram` plugin (`engram@engram`): its MCP server, hooks and skills duplicate the base `memory` skill and hooks (0041) | Flag; if the engram CLI is on PATH on its own (`engram --version` runs and its path is outside `~/.claude/plugins/`), the user runs `claude plugin uninstall engram@engram` (user scope); otherwise install the engram CLI first |
| Outdated CLI | `agent-browser --version` | Below 0.38.0 with `ui` applied: `browser-tooling` needs `snapshot --delta` and `screenshot --if-changed` | Flag as a blocking step; the user runs `npm i -g agent-browser@0.41.2` |

Known cases (profile READMEs, "Onboarding clashes" and notes):

- `.claude/skills/video-frames` in a game project: older copy; remove when `video` is applied.
- `agent-browser`, `web-design-guidelines`, `frontend-design` project copies in web projects: remove when `ui` is applied.
- `.opencode/agents/judge` in a game project: clashes with the base `judge`; remove.
- A project `SessionStart` hook running the project's own state script (godot): keep for now. Propose moving it to `godot.stateCommand` only once the script has a fast plain-text mode (under 10 s, exit 0); see `profiles/godot/README.md`.

Never touch user-scope config (`~/.claude`, `~/.gemini`, `~/.config/opencode`): the engine owns it.

## Budget

Caps in real tokens, Claude Code and agy (0046): **rules** (base plus profile rules) ≤ 2,500; **listing** (skill and agent descriptions) ≤ ~2,000, and ≤ ~100 per entry (~200 characters); **total** warn at 4,000, fail at 5,000. Static is characters / 4 of the rendered rules and of each entry's name plus description; real is about 2.0× static per added profile in Claude Code (1.55× for agy's base). Listing includes the externals a profile expects (installed skills and agents, its `README.md`).

Base: rules 835 static, listing 217 static; measured +1,759 real (~1,400 rules, ~360 listing). Headroom for profiles, static at 2.0×: rules ~550, listing ~820, total ~1,120.

| Profile | Rules static | Listing static | Real (2.0×) |
|---|---|---|---|
| `godot` | 301 | 47 | ~600 + ~95 |
| `tooling` | 228 | 0 | ~455 + 0 |
| `web` | 222 | 0 | ~445 + 0 |
| `video` | 208 | 50 | ~415 + ~100 |
| `desktop` | 174 | 85 | ~350 + ~170 |
| `cloudflare` | 123 | 74 | ~245 + ~150 |
| `vercel` | 107 | 35 | ~215 + ~70 |
| `ui` | 0 | 420 (own 107; impeccable 227 + its agent 34, `web-design-guidelines` 52) | 0 + ~840 |
| `autonomous-orchestra` | 0 | 46 | 0 + ~90 |
| `seo` | 0 | 1,040 (9 skills 742, 7 agents 298); ~330 with skills `name-only` | 0 + ~2,080 (~660) |

Sum the rules and listing columns of the applied set apart. Warn when rules exceed ~550 static, listing ~820, or both together ~1,120 (4,000 total); propose dropping the least-used profile. Flag any entry over ~200 characters (today `lartweib-taste`, 224). Examples:

- `web` + `ui` + `cloudflare` + `video`: rules 553 (at the cap), listing 544, total ~3,950. Warn: no room for another rule.
- `godot` + `ui` + `video`: rules 509, listing 517, total ~3,820.
- `tooling` + `desktop` + `ui`: rules 402, listing 505, total ~3,570.
- `web` + `ui` + `cloudflare` + `seo`: listing 1,534, total ~5,520 (fails); with `seo` skills `name-only`, listing 822 (at the cap), total ~4,090 (warns). Apply `seo` for an audit and remove it afterwards (`profiles/seo/README.md`).

Figures are the 2026-11-03 measurement; prefer `dotai doctor` output when it reports the cost. Since 2026-11-18 (0047) the base rules are about 54 static lower (the profile catalog line is gone) and dotai adds its `dotai-profiles` entry, about 51 static listing, so the totals barely move.
