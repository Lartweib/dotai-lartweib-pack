# godot profile

Godot 4 games in GDScript (pack 0044, 0045). This file is not staged: the engine reads only `.rulesync/` and `dotai/`.

## Contents

| Path | What |
|---|---|
| `.rulesync/rules/godot.md` | Always-on rule (≤2 KB): headless, `timeout`, `--check-only` gate, files never read whole |
| `.rulesync/skills/godot-gdscript/` | GDScript conventions. Pack-owned English text; it replaces the Spanish `godot-gdscript` installed at user scope today, which the maintainer generated with the gentle-ai skill-creator template (its `author` and `license` lines are that template's defaults; no published source) |
| `.rulesync/hooks.jsonc` | `PreToolUse` shell guard, one block per harness, each matching that harness's shell tools (Claude Code `Bash\|PowerShell`, OpenCode `bash`, agy `run_command`); `SessionStart` state script in the Claude Code and agy blocks only: rulesync 41.0.0 renders a project `SessionStart` in the OpenCode plugin with no payload and drops its output (the same rendering hangs OpenCode's `write` tool, trial 2026-11-04), so the state could not reach the model; restore it when rulesync pipes the payload |
| `dotai/tools/godot-guard.mjs` (+ `.sh`, `.ps1`) | Guard of 0045: the editor (or a game window) asks, a launch without a deadline denies with the wrapped command for the shell that runs it, a memory/CPU cap with no fixed count |
| `dotai/tools/godot-run.mjs` (+ `.sh`, `.ps1`) | `godot-run [-k S] SECONDS godot ...`: a `timeout` that also works in cmd and PowerShell; kills the process tree at the deadline (`taskkill /T /F` on Windows, the process group elsewhere); exit 124 on timeout |
| `dotai/tools/godot-state.mjs` (+ `.sh`, `.ps1`) | Optional capped project state at session start; off unless configured; a command past `stateTimeoutSec` is cut and reported in one line. Plain text for Claude Code (and OpenCode, once wired), `injectSteps` JSON for agy (which drops plain text) |
| `../../base/dotai/tools/hook-lib.mjs` | Not in this profile: the shared hook lib (payload parsing, decision output, `.dotai/config.yaml` reader) is a base tool. The profile tools import it from the user tools directory, `${DOTAI_TOOLS}`, which staging writes into each tool |
| `dotai/tools/read-size.godot.txt` | Paths for the base size-based Read hook |
| `dotai/tools/model-allow.godot.txt` | Opus allowlist entry for `worker` (art work, 0037) |
| `tests/` | `node --test "profiles/godot/tests/*.test.mjs"` |

## Configuration (`.dotai/config.yaml`, owned by the user)

```yaml
godot:
  reserveMb: 1536          # the one tunable: memory left free after a new launch
  footprintMb: 1024        # assumed process size when no Godot process runs
  stateCommand: python tools/state.py --brief   # optional SessionStart state
  stateMaxLines: 30
  stateMaxChars: 1600
  stateTimeoutSec: 10      # clamped to 12 s, under the hook's 15 s timeout
```

Numeric keys must be plain numbers: a value such as `4096MB` falls back to the default, with a one-line warning (the guard's stderr and reason; the state's output).

The tools read this file only inside the project: the walk up from the current directory stops at `CLAUDE_PROJECT_DIR` when set, else at the nearest directory with `.git`, else at the nearest with `.dotai/`, and never reaches the home directory. A config above the project is ignored.

**Trust model.** `stateCommand` runs through the shell at every session start. It is trusted because it comes only from `.dotai/config.yaml`, which is local, never committed, and written only by the user. Do not commit the file or copy one from an untrusted source.

## How the cap works

At each Godot launch the guard reads free memory (`os.freemem`), samples CPU for 250 ms, and lists the running Godot processes with their working set (PowerShell `Get-Process` on Windows, `ps` elsewhere; the `*_console.exe` launcher is not a worker). The footprint of a new launch is the largest running worker, or `footprintMb` when none runs. Launches the guard allowed in the last 20 s count too (one reservation file each in `<tmp>/dotai-godot/`), so parallel launches cannot all pass before any shows in the process list. A launch is denied when `free - reserved - footprint < reserveMb`, or when CPU is at 97% or more with a worker running. Free memory that cannot be read (0, negative, not a number) is unknown, and unknown allows. On macOS free memory is free + inactive + speculative pages from `vm_stat`, since `os.freemem` counts only free pages. Measured cost: about 0.45 s per Godot launch, nothing for other commands.

## Dependencies on the base (not built yet)

- `hook-lib.mjs` in `base/dotai/tools/` (built; the base installs it at user scope).
- The base size-based Read hook must read `.dotai/tools/read-size.*.txt` from the project (one pattern per line).
- The base Agent hook must read `.dotai/tools/model-allow.*.txt` for extra Opus allowlist entries.

## Hook commands and paths with spaces

The hooks run `node ${DOTAI_PROJECT_TOOLS}/<tool>.mjs` with the path bare, so a project whose path has a space breaks them. Quoting would fix Claude Code and OpenCode, but agy runs hook commands through `cmd /c` on Windows and every `"` reaches cmd as `\"`, so a quoted path fails. Rule for agy hook commands: unquoted paths, no spaces. The engine plans `${DOTAI_TOOL:<name>}` in hook commands (engine answer, 2026-11-02); even then, agy cannot run a hook from a path with spaces. Keep projects at paths without spaces.

## Dropped

Godot MCP (2 calls), `godot-claude-skills` (needs the editor), codegraph (no GDScript support; never index Godot projects, pack 0012). `gdlint` on edit is not shipped: it has 0 uses in Godot projects (measurement 6). gdstyle 0.6.0 (measurement 6): fast (0.5 s for 415 files), but its output is style noise and it misses syntax errors; `--check-only` is the gate.

## TODO(trial)

- OpenCode on Windows: which shell runs `bash`. The guard decides from the environment (`MSYSTEM`, `SHELL`); without them it suggests `godot-run`, which works in every shell.
- The Claude Code `PowerShell` tool firing `PreToolUse` hooks is community-confirmed, not documented; check it in a session. Partial (2026-11-19): Claude Code 2.1.328 lists `PowerShell` next to `Bash` in its init tools (run with `CLAUDE_CODE_USE_POWERSHELL_TOOL=1`), and the shell guard denies a `PowerShell` payload for `Get-Content sub/.env`; the session itself did not run because the isolated configuration was not logged in.
- Tune `reserveMb` once on the 32 GB machine with several headless suites running.

## Verified on agy (trial 2026-11-19, agy 1.5.3, Windows)

- The guard runs on agy: the `run_command` matcher fires, the payload is `toolCall.name: "run_command"` with `toolCall.args.CommandLine` (plus `WaitMsBeforeAsync`, `toolSummary`; no `Cwd` unless the model sets one), and the top-level `cwd` is the project root. `{"decision":"deny","reason":...}` is honored, even with `--dangerously-skip-permissions`: the model got "tool call denied by pre-tool hook: godot guard: ...".
- agy starts hook commands with the working directory `<project>/.agents`, so hooks must take the project from the payload's `cwd`, never from `process.cwd()`.
- `run_command` runs in Windows PowerShell 5.1 even when agy starts from Git Bash; `MSYSTEM` is inherited (`MINGW64`) but means nothing there, which is why `shellKind` returns `powershell` for agy unconditionally.

## Measured (measurements 6 and 10, 2026-11-02)

- `--check-only` needs `--import` on a fresh copy (52 s once), then takes 3–8 s. It reports errors in the checked script (exit 1); a broken dependency is named by file, not line, and two levels down it exits 0. Any autoload reference gives a false "Identifier not found". Hence the rule: judge by `SCRIPT ERROR` lines, and verify scripts with autoloads through the suite.
- `--headless --write-movie` segfaults (dummy renderer): captures need a window.
- `--headless --editor --lsp-port 6018` listens in about 4 s with no window; Serena was not tried.
- Godot is often not on `PATH` (`Godot_v4.7-stable_win64_console.exe`); the guard recognises that name, with or without a path.

## Onboarding clashes

- One game project has `.opencode/agents/judge`, which clashes with the base `judge`.
- One game project runs its own Claude Code `SessionStart` hook (a state script, 60 s). Moving it to `godot.stateCommand` (author, 2026-11-02) is blocked until the script has a fast plain-text summary mode (<10 s, exit 0): measured 80 s (median, over its own 60 s timeout) and ~39k tokens per session (measurement 6). Its plain mode exits 1 on red checks, and the cap cuts its JSON envelope into something unreadable. Then `dotai-analyze` proposes the move and removing the project hook.
