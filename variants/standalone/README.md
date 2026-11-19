# standalone variant

The default variant (`dotai.yaml`, pack 0028): `delegate` works on any machine, with no Orca. It runs agy (or OpenCode) headless and gives its own answer to each use case Orca covers in the `orca` variant (0032). This file is not staged: the engine reads only `.rulesync/` and `dotai/`.

## Contents

| Path | What |
|---|---|
| `dotai/tools/delegate-backend.mjs` (+ `.sh`, `.ps1`) | The backend the base `delegate` skill calls. Headless `agy -p --output-format json`; several jobs in parallel with `run --jobs` |
| `tests/` | `node --test "variants/*/tests/*.test.mjs"`; fake `agy`, `opencode` and `orca` on `PATH` (`tests/fake-cli.mjs`), paths with spaces, no real CLI call |

The shared contract (route, model/effort pair, pool and caps, launch, capped log, result line, `status` tree) is the base tool `base/dotai/tools/delegate-core.mjs` (0034, update 2026-11-03), tested in `base/tests/delegate-core.test.mjs`. The backend imports it from the user tools directory once staged (base and variant are both user scope), or from the base layer in the pack source; a missing core is one line on stderr and exit 1.

## Commands

```
node "${DOTAI_TOOLS}/delegate-backend.mjs" run --model M --effort E --spec FILE [--title T] [--kind research|audit|code]
     [--alt M2:E2] [--to agy|opencode] [--from claudecode|agy|opencode] [--mode interactive|autonomous] [--over-cap]
node "${DOTAI_TOOLS}/delegate-backend.mjs" run --jobs a.json b.json      # parallel, one job file each
node "${DOTAI_TOOLS}/delegate-backend.mjs" check --model M --effort E    # decide only, no launch
node "${DOTAI_TOOLS}/delegate-backend.mjs" status [--watch | --line]     # launch tree, quota; --line for a statusline
node "${DOTAI_TOOLS}/delegate-backend.mjs" workers                       # the guide for several workers
```

One result line per job, and an exit code: `0 OK`, `1 FAIL`, `2 REJECT`, `3 DEFER` (quota), `4 ASK` (soft cap). Example: `delegate 20261102-101500-a1b2 OK agy gemini-3.8-flash-low/low 42s in=16.5k out=1.2k result=<project>/.dotai/jobs/<id>/result.md`.

A job file holds the same keys as the flags: `{"spec": "task.md", "model": "...", "effort": "...", "alt": "model:effort", "to": "agy", "kind": "code", "title": "..."}`; a relative `spec` is read from the job file's folder. The spec (links resolved) must be inside the project root or the pack home and must not match the secrets list (`deny-paths.*.txt`); anything else is `REJECT`.

`--kind` sets what the agent may do: `research` (the default) and `audit` are read-only (agy `--mode plan`, OpenCode without `--auto`), and the agent's reply is saved as `result.md`; `code` auto-approves edits (agy `--mode <agyMode>`, OpenCode `--auto`) and the agent writes `result.md` itself.

## The contract (shared with `orca`)

1. **Route** (0009, 0043). Nobody targets Claude Code. Only a Claude Code caller may use agy's third-party pool; an agy hub, OpenCode or an unknown caller is pinned to `gemini-*`. The caller is the parent delegation (`DOTAI_DELEGATE_CALLER`, set for every child), which `--from` and a job file's `from` cannot override; else `--from`; else `CLAUDECODE=1`; else unknown (the restrictive case).
2. **Pair** (0022, 0030). agy: a Gemini id that holds a level (`gemini-3.8-flash-low`) needs that effort, passed as `--effort`; third-party ids (`claude-*`, `gpt-*`) take `--effort default`, since agy rejects `--effort` for them. Effort levels: `low`, `medium`, `high`, `xhigh`, `max`. OpenCode: `provider/model`, effort as `#variant`, never a Claude model. A model ending in `\` or holding a control character is rejected.
3. **Pool and caps** (0019, 0022). Quota is read from `~/.gemini/antigravity-cli/rate_limits.json` (and the isolated install's copy; the newest wins), written by the base statusline in interactive agy sessions only. Stale (`staleMinutes`) or missing is unknown, and unknown counts as available. A fresh pool over its threshold, either window, moves to `--alt` when that is on the other pool and fine; otherwise interactive work gets `ASK` (rerun with `--over-cap` on the user's yes) and autonomous work gets `DEFER`. Autonomous is `--mode autonomous` or `DOTAI_AUTONOMOUS=1`, which no flag weakens.
4. **Quota error** (0022). `status != SUCCESS` and the error says `RESOURCE_EXHAUSTED`, "out of quota", "quota exceeded" or "exceeded your quota" (stderr counts only when stdout held no JSON; a bare "rate limit" is transient and does not count) marks the pool exhausted for `exhaustedMinutes`, then one retry on `--alt` if given, else `DEFER` with the advice for the caller (Claude Code: Sonnet or Haiku, or defer; a hub: defer and notify). A quota state that cannot be written costs one stderr line, never the verdict.
5. **Job folder.** `<project>/.dotai/jobs/<id>/` (project root as the base hook lib finds it), else `<pack home>/jobs/<id>/`: `spec.md` (a copy), `result.md` (written by the agent in a code job, which keeps accents that `-p` output loses; the reply otherwise), and one `attempt-<n>/` per launch with the CLI's raw stdout in `out.json`, read whole from there (no pipe cap), plus `err.txt` and `done` in `orca`. Job folders older than seven days are deleted when a `run` starts (only folders named like a job id). The prompt holds no quote, `%` or line break, so it survives every shell; a `.cmd` shim gets every argument escaped for cmd.exe (base hook lib `cliInvocation`).
6. **Launch log.** `<pack home>/launches.jsonl`, append-only; past `logMax` lines it is renamed to `launches.jsonl.1` (the older generation is dropped) under a lock file, so concurrent writers never lose or tear an entry, and readers read both. A log that cannot be written costs one stderr line, never the result line. Events: `start` (`id`, `ts`, `harness`, `from`, `model`, `effort`, `pool`, `title`, `kind`, `mode`, `pid`, `parent`, `jobDir`), `end` (`id`, `status`, `secs`, `inTok`, `outTok`, `result`), `refused`. `check` and `confirm` entries go to `<pack home>/checks.jsonl`, so they never evict a launch. `status` draws the tree from it; the base `Agent` hook appends a `start` entry with `harness: "claudecode"` (plus `agent`, `kind: "subagent"`, no `pid`) for every Claude Code subagent launch it allows, so they show in the same tree as `launched`. The base statusline adds `status --line` as its fourth line, reading this log directly (no subprocess); no log, no line. The tree strips control characters from titles and models.

## Configuration (user scope, owned by the user)

`<pack home>` is `~/.dotai/packs/dotai-lartweib-pack/` (`DOTAI_DELEGATE_HOME` overrides it, as the tests do). The engine reserves `.dotai/packs/<flat identity>/` only at project scope (dotai 0041, amended by 0044): this user-scope directory is the pack's by convention, never deleted (`~/.dotai` is never removed) and not backed up on undo. It does not overlap the engine's git clones, which live at `~/.dotai/packs/github.com/<owner>/<repo>/` (dotai 0044); `pack update` and `pack remove` touch only that clone, and the recovery sweep only `~/.dotai/packs/github.com`. Thresholds live in `<pack home>/delegate.yaml` and change only by editing it, never from the chat (0019, 0034):

```yaml
delegate:
  gemini5h: 85          # % of the 5 h window at which the pool counts as over
  gemini7d: 90
  thirdParty5h: 85
  thirdParty7d: 90
  staleMinutes: 15      # older rate_limits.json is unknown
  exhaustedMinutes: 60  # how long a quota error keeps a pool out
  timeoutMin: 30        # per job; the process tree is killed at the deadline
  maxParallel: 3        # run --jobs
  logMax: 500           # lines per log generation
  agyMode: accept-edits # agy --mode for code jobs: accept-edits, auto or plan
```

A value that is not a positive number (or a known mode) keeps its default, with one warning on stderr.

## Parity with `orca` (0032)

| Use case | `orca` | `standalone` |
|---|---|---|
| See delegations run | Orca's tab or child agent | `status --watch` in a side terminal; the base statusline's `delegate:` line |
| Several agy workers | Orca `orchestration` | `run --jobs`, in parallel |
| Dependencies, questions mid-run | Orca `orchestration` | After v1: run dependent jobs in sequence; put decisions in the spec |

## TODO(trial)

- Quota error text: no real sample yet (`RESOURCE_EXHAUSTED`, "out of quota until" from the binary). agy may fall back to paid AI credits after quota instead of failing (measurement 1); the account is assumed subscription-only (0022).
- `--mode accept-edits` under `-p` (trial 2026-11-19, agy 1.5.3): a shell command neither prompts nor hangs; it is refused at once ("permission check failed ... user denied permission to run command"), and agy ends the turn with an empty reply, so a code job that needs one command ends `FAIL no reply and no result.md` in about 8 s. With `agyMode: auto` the same job ran the command and ended `OK`. Open: whether code jobs default to `auto` (0019 decides how much a code job may approve).
- OpenCode `run` without `--auto`: whether a permission that would ask is refused or hangs.
- The delegated agy runs without `--gemini_dir`, so under an isolated install it uses the user's own agy configuration (`~/.gemini`), not the isolated one with the pack's deny rules and hooks.

## Verified (trial 2026-11-19, agy 1.5.3)

- `--mode plan` under `-p`: agy reads `spec.md` in the job folder and project files, and the reply keeps accents (`ó`, `é`, no U+FFFD) through `--output-format json` into result.md.
- agy's JSON output (`conversation_id`, `status`, `response`, `duration_seconds`, `num_turns`, `usage`) does not name the model, so `actual-model=...!` never shows for agy. The model is in agy's transcript (`model` on each planner step) and in hook payloads (`modelName`).
- OpenCode `run --format json --auto`: the event shape; success is the exit code, and tokens are not read.
- Exhaustion could end at the pool's reset time, which the base statusline now writes (`*_resets`), instead of `exhaustedMinutes`.
