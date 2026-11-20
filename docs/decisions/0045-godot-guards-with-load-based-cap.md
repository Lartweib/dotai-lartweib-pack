---
status: accepted
date: 2026-11-01
tags: [godot, hooks, guards, profiles]
---

# 0045 · Godot guards in every Godot project, with a load-based process cap

## Context

One Godot project enforces Godot guards in code (`guard_core.mjs`): no editor, mandatory `timeout`, and at most 3 Godot processes (2 under load). The other Godot projects follow the same practice by hand (nearly every Godot command wrapped in `timeout`, the editor launched only rarely) or only describe it in `AGENTS.md`. This resolves OPEN-QUESTIONS 9.

A fixed process cap fits one machine. Machines differ in RAM (for example 32 vs 64 GB), so a fixed number would only limit the bigger ones.

## Decision

The `godot` profile ships a `PreToolUse` Bash guard for every Godot project:

1. **Editor (`-e`, `--editor`): ask.** The author approves or rejects it, as with the destructive commands of [0038](0038-base-bash-guards-ask-and-deny.md). Headless runs reject it.
2. **`timeout` is mandatory:** a Godot launch without it is rejected, and the reason shows the wrapped command.
3. **The process cap is computed at launch, not configured.** The guard reads free memory and CPU load, estimates the footprint of one Godot process from the ones already running (the `*_win64.exe` console worker included), and rejects a new launch only if it would leave the machine without a safety reserve. There is no fixed count.

## Considered options

- **A (chosen):** editor asks, `timeout` denies, the cap is computed from load.
- **B:** a fixed cap of 3 (2 under load), as in that project. Rejected: it limits a bigger machine for nothing.
- **C:** a per-project guard, or none. Rejected: the practice is the same in every Godot project.

## Consequences

- Good: the same protection in every Godot project, and it scales with the hardware.
- Accepted cost: the guard needs a cheap way to read memory, load and process sizes on Windows, and a reserve value that must be tuned once (a margin, not a process count).
- Pending: measure the cost of the load check per launch.

## Evidence

- Usage analysis, 2026-11-01 (internal research, not published).
- Review with the author, 2026-11-01.

## Update 2026-11-02: engine answers

A `PreToolUse` matcher of `Bash` fires only in Claude Code ([HARNESS-NOTES](https://github.com/Lartweib/dotai/blob/main/docs/HARNESS-NOTES.md), hook commands). The guard is now declared once per harness, in `.rulesync/hooks.jsonc` per-harness blocks: Claude Code `Bash`, OpenCode `bash` (the rulesync plugin also matches OpenCode's `shell` as `bash`), and agy `run_command`. The agy name and its payload (`toolCall.args.CommandLine`) come from agy 1.4.12's own hooks docs and `agy plugin validate`; a session has not run the guard in agy yet. The guard's code now imports the shared hook lib from the base ([0044](0044-v1-profile-set.md), update 2026-11-02).

## Update 2026-11-02: review fixes

- **Editor rule:** `godot --path <dir>` without `--headless`, `--script`/`-s`, `--export*`, `--check-only`, `--doctool` or `--write-movie` opens a window, so it asks like `-e`.
- **Deadline:** besides `timeout`, the pack's `godot-run` tool counts as a deadline. In cmd and PowerShell `timeout` is the Windows wait command, so there the deny reason suggests `node <tools>/godot-run.mjs 300 <command>`; in POSIX shells it still suggests `timeout 300`. `godot-run` kills the whole process tree at the deadline.
- **Shells:** the Claude Code matcher is `Bash|PowerShell`. The parser handles shell keywords, more wrappers (`env -u/-C/-S`, `sudo`, `setsid`, `stdbuf`, `nice`, `nohup`, `xargs`, `cmd /c`, `start`, `Start-Process`), redirections and cmd syntax (agy runs commands through `cmd /c`), and `$(...)` or backticks inside double quotes. Unknown shapes still pass.
- **Cap:** each allowed launch leaves a reservation for 20 s that counts as running, so parallel launches cannot all pass before any shows in the process list. Free memory that cannot be read is unknown, and unknown allows; on macOS free memory comes from `vm_stat`.
- **Config:** numeric keys that are not plain numbers fall back to the default with a warning. `.dotai/config.yaml` is read only inside the project root.
- **agy:** the `SessionStart` state goes out as `injectSteps` JSON; plain text is dropped there.
