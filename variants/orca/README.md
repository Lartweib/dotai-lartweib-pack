# orca variant

The variant for machines with Orca (pack 0021, 0022, 0028, 0031, 0033, 0034): Orca launches and shows the workers, and the pack adds only its contract. Installed with `--variant orca`, or preselected when `orca` is on `PATH` (`detect`). `shared-skills: true` makes Orca's skills in `~/.agents/skills` visible in the isolated install (0033). This file is not staged.

## Contents

| Path | What |
|---|---|
| `dotai/tools/delegate-backend.mjs` (+ `.sh`, `.ps1`) | Same command and flags as in `standalone`; only the launch differs, plus `confirm` |
| `tests/` | Fake `orca` and `agy` on `PATH`, plus a fake `orca` replaying JSON recorded from Orca 1.4.247 (`fixtures/`); checks that both backends import the base core and the reserved names |

The shared contract (route, pair, pool and caps, log, `status`) is the base tool `base/dotai/tools/delegate-core.mjs` (0034, update 2026-11-03), described in [the standalone README](../standalone/README.md#the-contract-shared-with-orca).

No rule, skill or subagent: the base `delegate` skill drives this variant through `workers`, so the contract costs nothing always-on, and nothing here takes a name Orca ships or the `orca-` prefix (0033).

## Contract with Orca

Checked against Orca CLI 1.4.242 (`orca --help`, `orca terminal <cmd> --help`, `orca agent-context --json`, `orca skills get orchestration`), read-only; the terminal commands were then run against Orca 1.4.247 (see [Observed in the trial](#observed-in-the-trial-orca-14247-windows-11-cmdexe)).

**One delegation** (`run`, 0031). When `orca status --json` reports `result.runtime.reachable: true`:

1. `orca terminal create --title "<title> [<id>]" --command <line> [--shell cmd.exe] --json`. The line enters the working directory (`cd /d` in cmd.exe, which then gets `title <title> [<id>]` back), then runs `agy [--gemini_dir=<dir>] -p <prompt> --model M [--effort E] --output-format json --mode <plan|agyMode>` (the flag in an isolated install, as in `standalone`) with `DOTAI_DELEGATE_CALLER=agy` and `DOTAI_DELEGATE_PARENT=<id>` set, its JSON into `out.json`, stderr into `err.txt`, then touches `done` and exits. Those three files live in the attempt folder (`<job>/attempt-<n>/`), so a retry never reads the first attempt's. On Windows the shell is `cmd.exe` (0022, third test), which cannot take `"` or `%` in a typed path: such a working directory runs headless (`via=headless:orca-unquotable`).
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

## Observed in the trial (Orca 1.4.247, Windows 11, cmd.exe)

Harmless terminals only (`echo` and `ping`, no agent). The sanitized JSON is in `tests/fixtures/orca-1.4.247/`, and `tests/fake-orca-recorded.mjs` replays it.

- `terminal create --json`: `{ ok, result: { terminal: { handle: "term_<uuid>", tabId, paneKey, ptyId, worktreeId, title, processId, hostPlatform, surface } } }`. The handle is read from `result.terminal.handle` only.
- `terminal list --json`: `{ ok, result: { terminals: [{ handle, title, preview, tabId, worktreePath, connected, ... }], totalCount, truncated } }`, across every workspace. A live terminal is always listed; one whose line ran `exit` leaves the list by itself, so `exit` closes the tab. Liveness matches `handle` exactly and ignores a `truncated` list; `preview` is recent output, so another tab (the caller's own session) can quote a handle or job id and is never read.
- cmd.exe replaces the `--title` with `C:\windows\SYSTEM32\cmd.exe - <command>` while a command runs, so the job id was lost from the list. The line now runs `title <title> [<id>]` after `cd`, and the list shows `<title> [<id>]  - <command>`; the stray tab of a failed create is found by that title.
- `terminal close --terminal H --tab --json`: `{ ok, result: { close: { handle, tabId, ptyKilled, closeMode: "tab" } } }`; the process tree goes with the tab. On a terminal already gone it exits 1 with `error.code: "terminal_handle_stale"`, which the tool ignores.
- `status --json`: `result.runtime.reachable: true` and `result.runtime.appVersion`, as assumed.
- Not used by the tool: `terminal read --json` gives `result.terminal.{ status: running|exited, tail[], nextCursor, source }`, and `terminal wait --for exit --json` gives `result.wait.{ satisfied, status, exitCode }` (a timeout is `ok: false, error.code: "timeout"` with exit 0).

agy 1.4.12 (trial 2026-11-04): it never sets the tab title, and its banner prints the model on its own line (`Gemini 3.8 Flash (Low)`), which `confirm` matches. A worker in a fresh agy dir or an untrusted folder stops at onboarding or the trust prompt before the banner: open agy once in that folder first.

## TODO(trial)

- How the line behaves in Orca's login shell on macOS and Linux (the tab title, `exit`).
- `confirm` against `worker-read` output itself: the banner text above was captured from agy's own terminal, not through Orca.
- The standalone TODO(trial) items apply too (quota error sample, paid-credit fallback, the `auto` sandbox error from the relative `.env` deny rules). The `--gemini_dir` isolation is in the shared args, so the typed line carries it too; agy started by Orca's own `worker-start` is not.
