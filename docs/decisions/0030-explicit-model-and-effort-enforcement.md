---
status: accepted
date: 2026-10-26
tags: [cost, models, hooks, delegation]
supersedes: [0018]
---

# 0030 · Explicit model and effort: enforcement by definition

## Context

[0018](0018-explicit-model-and-effort-per-delegation.md) decided that every delegation declares `model` and `effort`, with no silent inheritance, enforced by a strict `PreToolUse` hook on `Agent`. Verified harness facts ([HARNESS-NOTES](https://github.com/Lartweib/dotai/blob/main/docs/HARNESS-NOTES.md)) break that enforcement: in Claude Code, `effort` is never in the `Agent` tool input and cannot be set per launch; it comes only from the subagent definition. Generic agents (`general-purpose`, `Explore` and other built-ins) declare no effort and inherit the session's, so an Opus session at high effort launches them at high effort silently. This resolves the open question on whether such agents may be launched.

## Decision

The goal of 0018 stands; enforcement moves to definitions.

- **Claude Code hook:** rejects an `Agent` call without `model`, and rejects any agent whose definition does not declare `effort`, which includes the generic built-ins. The orchestrator launches only pack-defined agents.
- **Pack agents:** every subagent declares `model` and `effort` in its `claudecode:` block; `dotai doctor` reports one that does not. The pack ships its own cheap agents for the jobs generic agents did (exploration, general research).
- **Kept from 0018:** the criterion in the rejection message, the Opus allowlist by role, the short base rule (now asking only for `model`), the launch log (recording the effort of the definition launched) and `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` as a safety net.
- **agy:** `delegate` jobs declare model and effort, with no tiers ([dotai 0024](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0024-models-declared-per-harness-no-tiers.md)); `delegate` validates the pair ([0022](0022-delegate-visible-orca-backend.md)).

## Considered options

- **A (chosen):** reject agents without a declared effort, generic built-ins included. The only way to keep "no silent inheritance" in Claude Code.
- **B:** allow generic agents to inherit the session effort. Rejected: simpler, but expensive launches go unnoticed, which is what 0018 set out to prevent.

## Consequences

- Good: every launch has a known model and effort; cost stays auditable from the launch log.
- Accepted cost: the pack must define its own exploration and research agents before the hook is enabled.
- Supersedes 0018.

## Evidence

- [0018](0018-explicit-model-and-effort-per-delegation.md), updates 2026-10-23 and 2026-10-26.
- [HARNESS-NOTES](https://github.com/Lartweib/dotai/blob/main/docs/HARNESS-NOTES.md).

## Update 2026-11-03: launch log and the other harnesses

- **Launch log.** The `Agent` hook appends each launch it allows to the delegate launch log (`<pack home>/launches.jsonl`, capped at `logMax`, the backend's format) as a `start` entry with `harness: "claudecode"`, the agent, the model, the effort of the definition launched and the description. `delegate-backend status` and the base statusline show Claude Code subagents and delegations in one tree. Denied launches are not logged.
- **agy and OpenCode stay unhooked.** [HARNESS-NOTES](https://github.com/Lartweib/dotai/blob/main/docs/HARNESS-NOTES.md) verifies neither harness's subagent tool name nor its payload, so no matcher is guessed. OpenCode takes the model from the agent definition, and agy launches from the pack go through `delegate`, which validates the pair. Raised as an engine question: the subagent tool name and payload fields in agy and OpenCode `preToolUse`.
