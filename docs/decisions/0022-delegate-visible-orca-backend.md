---
status: accepted
date: 2026-10-23
tags: [experiment, orca, delegate]
origin: dotai 0026
---

# 0022 · `delegate` with a visible backend in Orca

Formerly EXP-01. Experiment closed on 2026-10-23 and accepted by the author; the final decision is in the "Result" section below.

## Context

Today `delegate` launches agy in headless mode via Bash. If instead Claude Code launches agy in an Orca terminal (skill `orca-cli`), the author sees the delegation with its status and can step in to watch it.

## Decision

Hypothesis to test: `delegate` would have two backends: headless (default, always works) and Orca terminal (if Orca is open). dotai does not depend on Orca.

What to verify:

- That `orca-cli` can launch agy (the skill names Codex and Claude).
- That Orca's statusline does not override the one from [0017](0017-statusline-in-base.md).
- The name clash between Orca's `computer-use` skill and the already installed Anthropic one.

## Considered options

- **A:** headless backend via Bash (default, always works).
- **B:** Orca terminal backend (if Orca is open).

Neither is rejected: the experiment decides whether B is added as a second backend.

## Consequences

- Pattern to adopt even if the experiment fails: Orca's skills are stubs that load the full guide from the binary (`orca skills get <x>`), so the fixed cost is only the description and the guide does not drift. dotai's skills can follow the same pattern (`dotai skills get <x>`).
- The result defines the scope of [0021](0021-orca-extend-dont-fork.md).

## Evidence

- Orca trial in progress (week of 2026-10-23).

## Update 2026-10-23: first test

From Claude Code inside Orca 1.4.237, with agy 1.4.2:
- `orca agent launch --agent antigravity --surface terminal --prompt "..." --json` opened agy in a visible tab of the same worktree and delivered the prompt (`prompt.outcome: handed-to-terminal`). Orca showed it as a child agent under the Claude Code session, with its status.
- `orca terminal wait --for tui-idle` waited for the end and `orca terminal read` returned the answer (a test research task, correct).
- Findings:
  - agy started with 13k tokens of context, consistent with the ~13k `GEMINI.md` ([0008](0008-always-on-budget-values.md)).
  - Without `--model` it used the default (Gemini 3.8 Flash, Medium), which violates [0018](0018-explicit-model-and-effort-per-delegation.md). `--model` and `--effort` with agy still need testing.
  - agy's statusline shows both pools (`[5h]`/`[7d]` and `[3P]`), and so does Orca's bar: the quota source for `delegate` exists.
  - Reading the result from the TUI screen is fragile; `delegate` should ask agy to write the result to a job file.
  - The tab stays open after finishing; `delegate` has to close it or mark it as finished.
  - Orca's statusline and the author's own do not compete (observed by the author).

## Update 2026-10-23: second test

- `orca agent launch --agent antigravity --model gemini-3.8-flash-low --effort low --surface terminal --prompt "..."`: agy started with the requested model (Gemini 3.8 Flash, Low). Orca passes `--model` and `--effort` to agy.
- The prompt asked it to write only the answer to `.dotai/jobs/exp01-a/result.md` and create an empty `done` file when finished. agy did so: a clean, complete result, without reading the screen.
- `orca terminal close --terminal <handle>` closed the test tabs.
- agy exposes `--model`, `--effort` (low to max), `-p`, `--output-format json`, `--json-schema` and `agy models`. Gemini ids already include the level (`gemini-3.8-flash-low|medium|high`); third-party ones (`claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium`) use the other pool. This answers the pending item from [0018](0018-explicit-model-and-effort-per-delegation.md) about effort in agy.
- The current runner (`<project>/.claude/tools/agy-task.mjs`, in one of the author's other projects) uses headless `-p --output-format json` and reads quotas with `readQuota()`; it is the basis of the headless backend.

**Validated cycle for the Orca backend:** launch with explicit model and effort → result in a job file + `done` marker → `orca terminal wait`/wait for the marker → read the file → close the tab.

## Update 2026-10-23: third test and final picture

Variant B: `orca terminal create --shell cmd.exe --title "agy job ..." --command "agy -p ... --output-format json > out.json"`. It is visible as a tab in Orca and the output is structured: `status`, `response`, `error`, `duration_seconds`, `num_turns` and `usage` (input, output, reasoning and cache tokens).

Findings:
- **`--effort` is not accepted on third-party models.** `claude-sonnet-4-6` with `--effort low` fails with `--effort is not supported for model`. In Gemini the level goes in the model id. `delegate` has to validate the model/effort pair before launching. The JSON reported the error cleanly (`status: ERROR`).
- **Third-party pool:** `claude-sonnet-4-6` without `--effort` answered correctly in 10 s.
- **Measured startup cost:** 14,084 input tokens (third-party) and 16,457 (Gemini) for one-line questions. This confirms that `GEMINI.md` and agy's base weigh ~14–16k per call.
- **Encoding bug in `-p` mode (Windows):** the `response` arrives with `U+FFFD` instead of accented characters (the Spanish word "Acci�n"), from bash, from cmd with `chcp 65001` and from PowerShell with UTF-8 output, in both `json` and `stream-json`. It comes from agy, not from the console. By contrast, the file the agent writes in interactive mode (variant A) preserves accents correctly.
- **`%errorlevel%` in cmd is not reliable** for the `done` marker (it gave `exit=0` on an error). The real status is in the JSON `status`.
- **Quota source:** `~/.gemini/antigravity-cli/rate_limits.json`, with `gemini_5h_pct`, `gemini_7d_pct`, `p3_5h_pct`, `p3_7d_pct` and `ts`. It is written by the author's statusline (`statusline.ps1`), so it is only updated while an interactive agy session runs. `delegate` must check `ts` and treat stale data as unknown.

**Final picture:**

| | A: agent in terminal (`orca agent launch`) | B: `agy -p --output-format json` in terminal |
|---|---|---|
| Visible in Orca | Yes, as a child agent with status | Yes, as a terminal tab |
| Result | File written by the model (depends on it obeying) | Structured JSON guaranteed by agy |
| Accented characters | Fine | Lost (agy bug) |
| Status and tokens | No | Yes (`status`, `usage`) |
| End of task | `done` marker or `tui-idle` | End of the process |

**Recommendation for `delegate`:** use B as the contract (reliable status, error, tokens and end) and also ask in the prompt for the agent to write the long result to a job file, which preserves accents. For the short answer, while the bug persists, prefer the file.

## Result

**Decision (accepted by the author, 2026-10-23):** `delegate` has two backends: headless (default, works without Orca) and Orca terminal (when Orca is open, so the delegation is visible). In both, the contract is `agy -p --output-format json` (status, error, tokens and end of process), and the prompt also asks the agent to write the long result to a job file, which preserves accents. Before launching, `delegate` validates the model/effort pair (`--effort` only on models that accept it) and discards as unknown a `rate_limits.json` with a stale `ts`. When finished, it closes the tab.

The encoding bug is not reported to agy: dotai adapts by using the job file.

## Update 2026-10-23: test of `orca orchestration`

Question: does `orca orchestration` (skill `orchestration`, `orca skills get orchestration`) work as the launcher for the "with Orca" mode, so that dotai only adds its contract (model/effort, pool, result file)?

**Model:** the coordinator creates a Run (`run-create`), launches supervised workers (`worker-start --spec|--task --agent --model --effort --worktree current`) and waits with `check --wait --types worker_done,escalation,question`. The worker receives an injected preamble with its IDs and must send `worker_done` exactly once (`--outcome succeeded|failed`, a 3-sentence summary). There is also blocking `ask`/`reply`, `task-create --deps` (DAG), decision gates and recovery (`worker-stop/abandon/release/retain`). Each delivery is acknowledged with `check --ack`.

**Tests (agy, `gemini-3.8-flash-low --effort low`, Spanish-language prompt):**
- `worker-start --agent antigravity --model gemini-3.8-flash-low --effort low`: `launch.effective` matches and agy's banner showed the requested model. Tab visible in Orca as a child agent. It finished in ~22 s.
- The result arrived in the `body` of `worker_done`, with accents intact (the Spanish words "Definición", "arquitectónica"), plus a `payload` with `taskId`, `dispatchId` and `outcome`. It is free text (a 3-sentence summary), not a file or a schema.
- `worker-release` closed the tab and archived the output; `worker-read` still returns it.
- **Error:** `--model claude-sonnet-4-6 --effort low` did NOT fail: `worker-start` exited with 0 and `launch.effective` repeated what was requested, but agy opened with Gemini 3.8 Flash (Medium). Orca does not validate the pair nor report that the model was ignored; `effective` is not evidence. The real model has to be verified (banner/`worker-read`) or validated beforehand, as 0018 already required.

**Comparison with `agent launch` + `done` file:**
- Adds: Run/Task/Dispatch with persistent state, an explicit `worker_done` with outcome (no need to guess the end with `tui-idle` or poll a marker), `ask`/`reply`, a DAG with dependencies, parallel waves, retries and cleanup with proof of exit.
- Costs: the coordinator loads ~4.5k tokens of guide (plus on-demand references) and each worker receives a long preamble in its prompt, added on top of agy's ~14–16k startup; a `check`/`ack`/`release` loop per worker. For a single-worker delegation it is a lot of ceremony.
- Breaks or is missing: it does not validate model/effort (silently); the result is a short summary, so the long result still needs a job file; there is no agy status/tokens (`usage`) nor quotas; the worker depends on obeying the protocol (if it does not send `worker_done`, all that is left is waiting); `reset` deletes by scope (`--tasks` cleared all tasks), there is no deletion by ID.

**Recommendation:** both, case by case. (1) Simple delegation (one worker, one-off research): `agent launch`/variant B with dotai's contract (validated model/effort, result file), without orchestration. (2) "With Orca" mode when there are several workers, dependencies, worker questions or supervision: `orca orchestration` as the launcher, with dotai adding only the contract: validate the model/effort pair before `worker-start`, choose the pool from `rate_limits.json`, require the long result in a job file and confirm the real model after startup. dotai should not reimplement Run/Dispatch/waiting: it delegates the guide with `orca skills get orchestration` (the stub pattern from this decision).

Cleanup: both workers released (`worker-release`), deliveries acknowledged, `reset --tasks` (only the 2 test tasks existed). No files were created in `.dotai/jobs/`.

## Update 2026-10-26: unknown quota counts as available

**Decision (accepted by the author, 2026-10-26):** when a pool's quota is unknown (stale `ts` or missing `rate_limits.json`, the usual case in headless `standalone`), pool selection treats it as available and delegates. A fresh value over the threshold still excludes the pool.

Reason: the author rarely uses agy directly and its quota usually goes unused; the goal of delegation is to level usage between Claude and agy. Blocking on unknown would leave `delegate` almost idle, since the quota file is only written by an interactive agy session.

Consequences:
- Exhaustion is detected by failure: when `agy -p` returns a quota error in its JSON, `delegate` marks that pool exhausted for the rest of the run, retries once on the other pool if it is not known to be over the threshold, and otherwise reports the failure to the orchestrator.
- The hard cap of autonomous work ([0019](0019-quota-cap-by-who-is-in-charge.md)) only applies to agy pools when quota data is fresh; with unknown data the quota error is the brake.
- Detection (measurement 1, 2026-10-26): exhausted when `status != "SUCCESS"` and `error` matches `out of quota|RESOURCE_EXHAUSTED|quota` (case-insensitive). No real sample yet; confirm on the first real exhaustion.
- Assumption: the author's agy account is subscription-only, with no paid AI credits, so exhaustion fails instead of spending credits (agy can fall back to AI credits once out of quota). If AI credits are ever enabled, this decision must be revisited.

## Update 2026-10-31: a bad result gets one retry in agy

Confirmed with the author. When an agy result is incomplete or fails its check, Claude sends the feedback back to agy for **one** retry. If the retry also fails, Claude takes the task over. This saves Claude quota, in line with levelling usage with agy.
