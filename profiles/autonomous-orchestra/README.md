# autonomous-orchestra profile

Long autonomous work on any stack (pack 0044): worktree lanes, batch integration, scheduled runs, monitors. Suggested on demand (no marker hints). Not staged.

## How it complements the base `autonomous` skill

`autonomous` (base) plans the run: success criterion, caps, separate verifier, which ingredients. `autonomous-orchestra` executes it at scale once that is set: lanes, integrator, scheduling and monitors. It ships no item named `autonomous`, and its skill tells the agent to start from `autonomous`. No always-on rule: the skill listing is the only cost.

## Contents

| Path | What |
|---|---|
| `.rulesync/skills/autonomous-orchestra/` | Execution conventions: lanes with disjoint ids, integrator, suite once per batch, quota-aware scheduling (`DOTAI_AUTONOMOUS=1` for unattended runs, 0019), bounded monitors, review between runs |
| `dotai/tools/orchestra-lanes.mjs` (+ `.sh`, `.ps1`) | `new <area>/<id> [--apply]`, `list`, `rm <id>`: worktree `.claude/worktrees/<id>` (added to `.git/info/exclude`) on branch `<area>/<id>`; `new` prints the `dotai apply` of the main checkout's profiles (from `.dotai/state.json`) or runs it with `--apply`; `list` shows every worktree under `.claude/worktrees/`, one line each |
| `tests/` | `node --test "profiles/autonomous-orchestra/tests/*.test.mjs"` (real temporary git repos) |

## Dependencies

- Quota thresholds come from the base `delegate` config (0019, 0034); the skill only points at it.
- Review cards: the external tracker's `review-rounds` preset (0027), when the project uses it.
- The orchestra panel (a mod, rarely used) is not shipped: no mods in v1 (0044).
- Profiles per lane: each worktree is a separate project for the engine (own `.dotai/`, own MCP entries in `~/.claude.json`), so profiles are applied once per lane (0040, update 2026-11-02). `orchestra-lanes new` prints the apply; `--apply` from inside a running session is not refused: dotai 0041 allows the `~/.claude.json` writes while Claude Code runs, and a lost key shows in `dotai doctor` as `key-missing` (0040).

## TODO(trial)

- One night run with 3 lanes: check that `orchestra-lanes list` is enough for the integrator, without reading lane logs.
- Worktrees and codegraph: each worktree needs its own index if codegraph is registered.
