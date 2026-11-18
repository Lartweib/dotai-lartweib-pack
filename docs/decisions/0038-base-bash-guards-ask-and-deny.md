---
status: accepted
date: 2026-10-31
tags: [hooks, guards, permissions, base]
---

# 0038 · Base Bash guards: ask for destructive commands, deny for denied paths

## Context

The base ships `PreToolUse` guards on Bash ([0014](0014-base-principles-scripts-hooks-deny.md), principle P6: policy in code, not prompt text). Two open points:

- **Destructive commands** that caused past incidents: `git stash` overwrote work, `git reset --hard` dropped changes, and `taskkill /IM` killed unrelated processes such as the Godot editor. The author sometimes asks for these commands on purpose, so a hard block gets in the way. A justification written by the agent is no safeguard, because the agent that is wrong is the one judging.
- **`permissions.deny`** in Claude Code is expected to stop only the `Read` tool, so `cat .env` through Bash would get past it (OPEN-QUESTIONS question 9, base part; measurement 9 confirms the exact behavior).

## Decision

1. **Destructive commands ask; they are not denied.** The hook returns the permission decision `ask`, so the author sees the full command and approves or rejects it. The reason text also tells the agent the safe alternative.

   | Command | Hook | Safe alternative given to the agent |
   |---|---|---|
   | `taskkill /PID <n>` | passes | — |
   | `taskkill /IM <name>` | ask | kill by PID |
   | `git reset --hard` | ask | WIP commit or a new branch |
   | `git stash` | ask | WIP commit |

   In headless runs (`agy -p`, a background worker) nobody answers the prompt, so the command is rejected. This is intended.
2. **Denied paths are denied in Bash too.** The hook rejects a Bash command that names a path matching a `permissions.deny` pattern. This is a hard deny with no prompt. It is a text filter: it stops accidental reads, not a script built to evade it.

## Considered options

- **A (chosen):** ask for destructive commands and a text-filter deny for denied paths.
- **B:** a hard deny for destructive commands. Rejected: it blocks commands the author asks for on purpose.
- **C:** allow them when the agent justifies them. Rejected: no human decides.
- **D:** the Claude Code sandbox for denied paths. Deferred: its behavior on Windows and the tools it may break are still unknown. To evaluate with measurement 9.
- **E:** no Bash guard for `deny`. Rejected: `deny` would protect almost nothing.

## Consequences

- Good: the past incidents need the author's approval; secrets are not read by accident.
- Accepted cost: one extra prompt when the author asks for a destructive command; the path filter can be evaded on purpose.
- Pending: confirm with measurement 9 whether `deny` covers Bash and its exact syntax; verify which hooks agy supports (engine question). The Godot guards in other projects (rest of question 9) stay in the `godot` profile.

## Evidence

- Review with the author, 2026-10-31.
- Incidents listed in [DESIGN.md](../DESIGN.md) (Godot guards row).

## Update 2026-11-01: measurement 9

Tested on Claude Code 2.1.316 on Windows 11 with Haiku and dummy files, using CLI flags only.

**Syntax.** Read rules use gitignore patterns:
- `x` and `./x` are relative to the cwd; a bare name matches at any depth.
- `/x` is relative to the settings source.
- `//c/...` is an absolute Windows path, in POSIX form.

**Bash.** The Read deny already covers the Bash file commands Claude Code recognizes. These were blocked: `cat`, `head`, `rg` naming the file, `cd sub && cat ../x`, PowerShell `Get-Content` and the Grep tool.

Three reads leaked:
- `python -c "open(...)"` and `cmd //c type x`, which name the file. The hook in this record catches them.
- `rg CANARY .`, which searches a directory without naming the file. No text filter can catch it; only the sandbox (option D) can.

The hook therefore stays, scoped to interpreters and `cmd` commands that name a denied path.

## Update 2026-11-02: shell tool names per harness

The engine verified hooks in agy: a `Bash` matcher fires in neither agy nor OpenCode ([HARNESS-NOTES](../../../dotai/docs/HARNESS-NOTES.md), hook commands). When the base guards are built as hooks, they go in per-harness blocks of `.rulesync/hooks.jsonc` and match `Bash` (Claude Code), `bash` (OpenCode) and `run_command` (agy), as the `godot` guard does ([0045](0045-godot-guards-with-load-based-cap.md), update).

Claude Code on Windows also has a `PowerShell` tool, and hooks matching `PowerShell` fire on it (community-confirmed, not in the hooks reference yet), so the Claude Code shell matcher is `Bash|PowerShell`.

## Update 2026-11-03: `permissions.deny` per harness, and no timeout hook

- **Denied paths as permissions.** `base/.rulesync/permissions.jsonc` denies reads of the same secrets as `deny-paths.base.txt`, one block per harness, since rulesync 41.0.0 passes patterns through and each harness reads them differently: gitignore patterns for Claude Code (no `!`, so `.env.*` is spelled out per file and `.env.example` stays readable), wildcards with last match wins for OpenCode, and plain paths only for agy, where the glob entries are left to the shell guard. OpenCode expands `~/` (OpenCode 2.0.30, trial 2026-11-04); agy does not (agy 1.4.12, trial 2026-11-03), so agy's home paths use `${DOTAI_HOME}`, which the engine replaces with the real home directory while staging (comments in `permissions.jsonc`).
- **No "require a timeout" hook.** This record decides none. The need (DESIGN §3, the 7 h and 5 h hangs) is covered by settings: `BASH_DEFAULT_TIMEOUT_MS` and `BASH_MAX_TIMEOUT_MS` in `base/dotai/settings.yaml` cap every Claude Code Bash call at 30 minutes, every base hook declares its `timeout`, and `delegate` kills a job's process tree at `timeoutMin`.
