# orca variant

The variant for machines with Orca (pack 0021, 0022, 0028, 0031, 0033, 0034): Orca launches and shows the workers, and the pack adds only its contract. Installed with `--variant orca`, or preselected when `orca` is on `PATH` (`detect`). `shared-skills: true` makes Orca's skills in `~/.agents/skills` visible in the isolated install (0033). This file is not staged.

## Contents

| Path | What |
|---|---|
| `dotai/tools/delegate-backend.mjs` (+ `.sh`, `.ps1`) | Same command and flags as in `standalone`; only the launch differs, plus `confirm` |
| `tests/` | Fake `orca` and `agy` on `PATH`; checks that both backends import the base core and the reserved names |

The shared contract (route, pair, pool and caps, log, `status`) is the base tool `base/dotai/tools/delegate-core.mjs` (0034, update 2026-11-03), described in [the standalone README](../standalone/README.md#the-contract-shared-with-orca).

No rule, skill or subagent: the base `delegate` skill drives this variant through `workers`, so the contract costs nothing always-on, and nothing here takes a name Orca ships or the `orca-` prefix (0033).

## Contract with Orca

Checked against Orca CLI 1.4.242 (`orca --help`, `orca terminal <cmd> --help`, `orca agent-context --json`, `orca skills get orchestration`), read-only.

**One delegation** (`run`, 0031). When `orca status --json` reports `result.runtime.reachable: true`:

1. `orca terminal create --title "<title> [<id>]" --command <line> [--shell cmd.exe] --json`. The line enters the working directory (`cd /d` in cmd.exe), then runs `agy -p <prompt> --model M [--effort E] --output-format json --mode <plan|agyMode>` with `DOTAI_DELEGATE_CALLER=agy` and `DOTAI_DELEGATE_PARENT=<id>` set, its JSON into `out.json`, stderr into `err.txt`, then touches `done` and exits. Those three files live in the attempt folder (`<job>/attempt-<n>/`), so a retry never reads the first attempt's. On Windows the shell is `cmd.exe` (0022, third test), which cannot take `"` or `%` in a typed path: such a working directory runs headless (`via=headless:orca-unquotable`).
2. The tool waits for `done` (up to `timeoutMin`), since the terminal's exit code is not evidence and the real status is in the JSON (0022). Every 10 s (`DOTAI_ORCA_PROBE_MS`) it asks `orca terminal list --json` whether the terminal is still there; one gone before `done` fails the run (`terminal closed`) instead of waiting for the timeout.
3. `orca terminal close --terminal <handle> --tab --json`, after every attempt (a quota retry on `--alt` opens and closes its own terminal).
4. The same parsing as `standalone`: status, tokens, the quota error and its retry on `--alt`. The result line ends `via=orca:<handle> result=<file>`.

Without the `orca` CLI or with Orca unreachable, the delegation runs headless (`via=headless`): dotai never depends on Orca (0022). When `terminal create` times out (60 s, `DOTAI_ORCA_CREATE_TIMEOUT_MS`) or fails, a terminal it may still have opened is looked up in `terminal list` by the job id in its title and closed, so agy never runs twice, and the delegation runs headless (`via=headless:orca-create-timeout` or `headless:orca-create-error`).

**Several workers** (0022 orchestration test, 0034). `run --jobs` is refused here; `workers` prints the stub guide:

1. Load Orca's guide with `orca skills get orchestration`; the pack never copies it.
2. Before each `worker-start`: `delegate-backend check --model M --effort E --title T`. Exit 0 prints the flags to pass (`--agent antigravity --model M [--effort E]`; no `--effort` for third-party models). Exit 2, 3 or 4: do not start it.
3. Each task spec requires the long result in its own `.dotai/jobs/<name>/result.md`; `worker_done` carries only a short summary.
4. After startup: `delegate-backend confirm --dispatch <id> --model M` reads `orca orchestration worker-read --dispatch <id> --json` and looks for the model in the worker's output, because `launch.effective` repeats the request even when agy ignored it (0022). `CONFIRMED` exits 0; `MISMATCH` or `UNCONFIRMED` exits 1: stop that worker and report it.

`check` and `confirm` write `checked`, `refused` and `confirm` entries to `<pack home>/checks.jsonl`, apart from the launch log, so many checks never evict a launch; Orca's own UI shows the workers running.

## TODO(trial)

- `orca terminal create --json`: the result shape is not in Orca's schema; the handle is read from `result.terminal.handle`, any `handle` field or a `term_*` string, else from `terminal list` by the job id in the title. Without one the job still runs and is read, but the tab is not closed and liveness is not probed.
- `orca terminal list --json`: the shape is assumed; a terminal counts as open while the output holds its handle anywhere, and an object holding the job id `[<id>]` names the terminal of a failed create. A list that fails proves nothing and the wait goes on.
- Whether `exit` at the end of the line closes the tab by itself, and how the line behaves in Orca's login shell on macOS and Linux.
- `confirm`: the text of agy's banner in `worker-read` output; `Gemini 3.8 Flash (Low)` is matched as words against `gemini-3.8-flash-low`.
- The standalone TODO(trial) items apply too (quota error sample, paid-credit fallback, `--mode` under `-p`).
