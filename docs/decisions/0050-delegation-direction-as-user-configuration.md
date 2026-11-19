---
status: accepted
date: 2026-11-19
tags: [delegate, agy, quota, pack-format]
supersedes: [0009]   # partially: only the fixed direction "Claude Code delegates to agy"; its guarantees stand
---

# 0050 · Delegation direction as user configuration (`primary`)

## Context

[0009](0009-directional-delegation-with-quota-config.md) fixes the direction: Claude Code delegates to agy, and agy never delegates to Claude. The pack should serve a user whose main account is agy the same way it serves the author with Claude Code as main, and it should install on either harness or both. Before this record it could not: `dotai.yaml` had `requires: [claudecode, antigravity-cli]`, and `delegate-core.mjs` hardcoded the direction (`checkRoute`: "delegate never targets Claude Code"). The engine's [PACK-FORMAT](../../../dotai/docs/PACK-FORMAT.md) (origin/main) allows `requires` to list "possibly none".

## Decision

- A new key, `primary`, in the `delegate:` section of the user-scope `<pack home>/delegate.yaml` that `loadConfig` reads ([0034](0034-delegate-packaging-base-tool-variant-runners.md)). Values: `claudecode` or `agy`. Unset: `claudecode` (the behaviour before this record). Any other value, or a file that cannot be read or parsed, fails closed: `run` and `check` refuse (item 7 below).
- The primary is the only harness that delegates; the secondary only receives. Delegation stays one-way, so 0009's guarantees hold in both directions: the primary's quota is never spent on the secondary's behalf, and there are no cycles (a delegated child is never the primary, so its own delegations are refused).
- When the secondary is over quota or fails, the primary does the task itself, on whatever model the cost policy fits the task (not necessarily a cheap one), or defers and tells the user. The work never moves to another harness by itself. `fallbackAdvice` says this for both primaries.
- No delegation within one harness: agy has native subagents (the pack ships them), as Claude Code does, so `agy -> agy` and `claudecode -> claudecode` are refused with a message pointing to the subagents. Delegation only crosses harnesses: primary to secondary, or to OpenCode as an occasional target.
- OpenCode is a target only, never a caller or primary.
- A `primary` set in `delegate.yaml` whose harness is not installed (its CLI not on PATH, or absent from the install state's `harnesses`) warns and turns delegation off: `run` and `check` print `REJECT` and nothing launches. It is not a hard failure; `status` and `workers` still work. The unset default is not checked, so a Claude-only or agy-only install with no `primary` behaves as before (the missing target fails with "not found on PATH").
- Caller detection: an agy caller passes `--from agy` until a trial shows an agy environment marker. `DOTAI_DELEGATE_CALLER` (set on every delegated child, and authoritative) and `CLAUDECODE=1` stay as they were.
- `requires` becomes `[]`; `harnesses` stays as it was. The pack installs on either harness or both; delegation needs both.

## Considered options

- **A (chosen):** direction as one user-scope key in the delegate tool.
- **B:** keep the fixed direction. Rejected: an agy-main user gets no delegation and must install Claude Code.
- **C:** a variant per direction. Rejected (inferred): variants are per environment (standalone, orca), and the two axes would multiply.
- **Same-harness delegation (agy -> agy, as 0009 allowed with gemini-* only):** dropped. Each harness has native subagents for that, and a nested agy cost a headless launch for no quota gain.

## Consequences

- Good: one pack for Claude-main and agy-main users; installs on one harness or both.
- Accepted cost: `claude -p` is a launched target, with its own isolation, quota and model rules.
- Partially supersedes 0009 (direction, and the agy -> agy route); touches 0034 (a new non-numeric key in `delegate.yaml`, and `claude5h`/`claude7d`).

What changed (2026-11-19):

1. `delegate-core.mjs`: `loadConfig` validates `primary` and `agyMode` each against its own values and reports which keys were set; `TARGETS` gains `claudecode`; `checkRoute(from, target, primary)` refuses OpenCode as a caller, any caller that is not the primary (an unknown caller gets the `--from agy` hint when agy is the primary), and a same-harness route; the default `--to` is the secondary; `primaryProblem` checks an explicit primary (install state plus `findOnPath`).
2. Models per direction: to agy, `gemini-*` and the third-party pool as before; to Claude Code, Claude models only (an alias such as `sonnet`, or `claude-*`), effort `low`..`max` as `--effort`, or `default` to leave it to Claude Code. The Gemini-only pin for non-Claude callers is gone, since only the primary reaches a target.
3. Quota: `readQuota` adds a `claude` pool from the newest `rate_limits.json` under `CLAUDE_CONFIG_DIR`, `~/.claude` and `<home>/.dotai/isolated/claude` (written by the statusline, interactive sessions only, so mostly stale and unknown under an agy primary), with `claude5h`/`claude7d` thresholds (85/90); `isQuotaError` takes the target and has Claude limit texts; `parseClaudeJson` reads `claude -p --output-format json`.
4. Launch: `buildArgs` has a `claude -p` branch: `-p PROMPT --model M [--effort E] --output-format json --no-session-persistence`, `--permission-mode plan` for research and audit, `--permission-mode acceptEdits --permission-prompts none` for code (never `bypassPermissions`), and `--add-dir` last when the job folder is outside the project. Flags checked with `claude --help` only (Claude Code 2.1.328). `claudeIsolation` sets `CLAUDE_CONFIG_DIR=<home>/.dotai/isolated/claude` in an isolated install and fails closed like `agyIsolation`. The orca backend types `claude -p` into its terminal and prints `worker-start --agent claude` from `check`.
5. Texts: the skill description and steps, the core rule line ("to the other harness"), the statusline (the primary's rows first), [DESIGN §7](../DESIGN.md#7-delegate-and-quota-routing), [RUNTIME](../RUNTIME.md), the README and the standalone README. The launch tree tells subagent entries (`kind: subagent`) from a delegated Claude Code, which has a pid and shows as running.

Risk review fixes (2026-11-19):

6. One-way delegation holds even against the delegated model. A child is recognised by the presence of `DOTAI_DELEGATE_CALLER`, even emptied (`isDelegated`), so blanking it and passing `--from <primary>` is still refused. delegate-core sets the variable on every launch (agy, `claude -p`, OpenCode; the Orca terminal line sets it too), and the base shell guard, whose process inherits the launched harness's environment, denies in a delegated job any command that runs `delegate-backend`/`delegate-core` or names the variable (`X=`, `env -u`, `unset`, `set X=`, `Remove-Item Env:`, `$env:`): "a delegated job cannot start delegations (pack 0050)". The check runs before the deny list loads, so a broken list never skips it. Tests show the variable reaching each fake CLI; that a harness passes it on to its hook processes is assumed: Claude Code hooks inherit its environment, and agy and OpenCode are a TODO(trial).
7. `delegate.yaml` fails closed: a file that exists but cannot be read, a line the reader would skip (outside a `name:` header, or not `key: value` inside `delegate:`), or an unknown `primary` makes `run` and `check` print `REJECT` with the reason and launch nothing; `status` and `workers` still work. A missing or comment-only file is the defaults. A bad threshold or `agyMode` still keeps its default with a warning.

Trial follow-ups (throwaway projects only; nothing here was run against a real session, login or quota):

- TODO(trial): the JSON shape of `claude -p --output-format json` on the current Claude Code. The parser and the fixtures in `base/tests/fixtures/claude-p-assumed/` are assumed from the documented result object (`type`, `subtype`, `is_error`, `result`, `usage`).
- TODO(trial): a Claude quota-error sample. The matched texts ("usage limit reached", "hit your limit", "5-hour/weekly limit reached", "out of usage") are assumed, as is whether the error arrives as JSON with `is_error` or on stderr.
- TODO(trial): whether a code job's shell commands pass under `acceptEdits` with `--permission-prompts none` in `-p`, or need the pack's allow rules (agy needed `skip-permissions` for the same reason, 0034).
- TODO(trial): the isolated Claude Code config's login (the install plan says "needs a new login", and it was lost before).
- TODO(trial): Orca's agent id for Claude Code in `worker-start` (`claude` is assumed), and `confirm` against a Claude banner.
- TODO(trial): an agy environment marker that would replace `--from agy`.
- TODO(trial): that agy and OpenCode pass `DOTAI_DELEGATE_CALLER` on to their shell-guard hook processes (Claude Code's hooks inherit its environment), so a delegated job's attempt to run `delegate-backend` is denied there.
- TODO(trial): agy -> Claude Code end to end, standalone and orca; an agy-only and a Claude-only install with `requires: []`.

## Evidence

- `base/dotai/tools/delegate-core.mjs` (`CALLERS`, `loadConfig`, `checkRoute`, `readQuota`, `fallbackAdvice`, `buildArgs`), `base/dotai/tools/statusline.mjs`, `variants/orca/dotai/tools/delegate-backend.mjs`, read 2026-11-19.
- PACK-FORMAT on dotai origin/main, `requires` row.
- `claude --help`, Claude Code 2.1.328, 2026-11-19: `-p/--print`, `--model` (alias or full name), `--effort` (low, medium, high, xhigh, max), `--output-format` (text, json, stream-json), `--permission-mode` (acceptEdits, auto, bypassPermissions, manual, dontAsk, plan), `--permission-prompts` (host, none), `--no-session-persistence`, `--add-dir <directories...>`.
- Author request and resolution of the open points, 2026-11-19.
