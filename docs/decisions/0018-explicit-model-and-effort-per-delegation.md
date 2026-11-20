---
status: superseded
date: 2026-10-23
tags: [cost, models, hooks, delegation]
origin: dotai 0022
superseded-by: 0030
---

# 0018 · Explicit model and effort in every delegation

## Context

It resolves open question P-02 (model hook: strict or with a default?). The maintainer wants whoever delegates to always weigh the quality the work requires. According to the author's own usage audit, in Sep–Oct 93% of subagent spend ran on Opus through inheritance ([0002](0002-built-in-cost-policy.md)).

## Decision

Every delegation declares `model` and `effort`; there is no silent inheritance.

- **Strict `PreToolUse` hook on `Agent`:** without `model` or without `effort`, it is rejected. The rejection message carries the criterion (Haiku for mechanical work; Sonnet for executing and exploring; Opus for designing, judging and arbitrating; effort according to the task's uncertainty), so the criterion is paid for only when needed and not on every request.
- **Opus allowlist by role**, adjustable per profile. Opus with a generic agent is rejected with an explanation.
- **Short rule in the base** (`AGENTS.md`) asking to declare both fields. It is needed because the `Agent` tool only sets `effort` when an instruction asks for it.
- **Log of every launch** (role, model, effort, description) to audit the quality of the choices from the panel.
- **`CLAUDE_CODE_SUBAGENT_MODEL=sonnet`** as a safety net for paths the hook does not cover.
- **`delegate` to agy applies the same:** the job declares tier and effort or is rejected.

## Considered options

- **A (chosen):** extended strict hook: rejects without `model` or without `effort`, with the criterion in the message, an Opus allowlist by role and the environment variable as a safety net.
- **B:** hook with a default (applies Sonnet automatically). Rejected: it is more convenient, but a default makes deciding optional and can degrade design tasks without anyone noticing.
- **C:** simple strict hook (only reject `Agent` calls without `model`, with no criterion and no `effort`). This is the "strict" variant of P-02; the chosen option extends it. (inferred: it is listed as a separate option to mark the difference with A; the sources mention it only as "strict: forces thinking about every launch").

## Consequences

- The hook guarantees that the fields are present, not that the choice is good; the log measures that.
- Supersedes P-02.
- Pending: verify which equivalent of effort or reasoning level agy exposes per model. Resolved by [0022](0022-delegate-visible-orca-backend.md) (see the 2026-10-26 update).

## Evidence

- Internal research (not published): usage audit.

## Update 2026-10-23

Data from internal research (not published) on harness surfaces (§0.5, §0.7 and §0.8). The decision does not change.

- **Subagent model precedence in Claude Code:** invocation > frontmatter `model` > `CLAUDE_CODE_SUBAGENT_MODEL` > main model. The `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` safety net only applies when nothing sets the model, unless `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` is added.
- **`PreToolUse` can rewrite the input** with `hookSpecificOutput.updatedInput`, not just deny.
- **The documented `tool_input` of `Agent` lists `model` but not `effort`.** Before relying on the hook to require `effort`, this must be verified with a hook that logs the payload ([OPEN-QUESTIONS](../OPEN-QUESTIONS.md)).

## Update (2026-10-26)

Verified facts ([HARNESS-NOTES](https://github.com/Lartweib/dotai/blob/main/docs/HARNESS-NOTES.md)); the goal (no silent inheritance) stands, but enforcement of effort changes:

- **Claude Code:** `tool_input` of `Agent` carries `model` only when the model sends it, so the hook can require `model`. Effort is never in `tool_input` and cannot be set per launch; it is fixed in the subagent definition ([dotai 0024](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0024-models-declared-per-harness-no-tiers.md)). Consequences for the Decision section: the hook rejects only a missing `model`; effort is guaranteed by every pack subagent declaring `effort` in its `claudecode:` block (`dotai doctor` reports a subagent without a model); the base rule asks only for `model`; the launch log records the effort of the definition launched, not a per-launch value.
- **agy:** agent definitions have no effort field and `model` only accepts `inherit|flash|pro`. For `delegate`, the job declares model and effort (there are no tiers, [dotai 0024](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0024-models-declared-per-harness-no-tiers.md)); effort goes through `--effort` (Gemini models only) or in the Gemini model id; `delegate` validates the pair ([0022](0022-delegate-visible-orca-backend.md)).
- The pending item in Consequences (effort in agy) is resolved by [0022](0022-delegate-visible-orca-backend.md), second test.
