---
status: accepted
date: 2026-10-20
tags: [delegate, agy, quota, opencode]
origin: dotai 0013
---

# 0009 · Directional delegation with quota as configuration

## Context

Work has already been moved off Claude's quota to Gemini with `agy-task.mjs`; the two current runners (`agy_review.py` and `agy-task.mjs`) are being unified. An earlier incident (Claude worked from OpenCode via the API, consumed the credits and left work half-done) shows the risk of delegation without direction.

Approved by the maintainer in conversation.

## Decision

Claude Code delegates to agy, choosing between its two pools (Google / third-party) based on the 5 h and 7 d windows. When agy is the hub, it never delegates to Claude; exhaustion is handled by deferring and notifying. Claude Code is reserved for orchestrating, designing and judging. Thresholds and the preferred pool are profile configuration. OpenCode is minimal and occasional.

## Considered options

- **A (chosen):** directional routing; in agy-hub mode the exhaustion exit is "defer and notify".
- **B:** the current behavior of `agy-task.mjs`: Gemini pool → third-party pool (Claude via agy) → exit 3 ("use Claude's own plan"). Rejected: it is reversed, because agy-hub must never delegate to Claude (neither via agy-third-party if that consumes Claude's exhausted quota, nor via OpenCode with the API).
- **C:** two separate runners. Rejected: they are unified into a single job schema.

## Consequences

- If both pools are above the threshold, Claude Code does not delegate: it runs on Sonnet/Haiku or defers.
- OpenCode uses free models and third-party/automation credits, never Claude via the API for main-flow work.
- Pending: confirm agy's actual quota contract (see [OPEN-QUESTIONS](../OPEN-QUESTIONS.md)).

## Evidence

- Internal research (not published): harness discovery.
- [DESIGN §7](../DESIGN.md#7-delegate-and-quota-routing) (delegate and quota routing)

## Update 2026-10-28

Where thresholds and the preferred pool live is partially superseded by [0034](0034-delegate-packaging-base-tool-variant-runners.md): they are configuration of the base `delegate` tool at user scope, not profile configuration. The routing rules above stand.

## Update 2026-11-02: Pi versus OpenCode (measurement 13)

OpenCode stays the optional harness for API credits. Pi (`@earendil-works/pi-coding-agent` 1.5.0, MIT) starts cheaper (~1,450 tokens, 2,920 with the pack base, against OpenCode 2.0.30's ~5.4k of its own plus ~2.4k of user skills), but it has no subagents and no permission model, which the pack's guards and roster need. Whether the engine gets a Pi adapter is an engine question, not a pack one.

## Update 2026-11-19: OpenCode is a compatible preview harness

Engine decision [dotai 0047](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0047-harness-selection-and-preview-harnesses.md) removed `optional-harnesses`: `harnesses` now lists the harnesses a pack is compatible with, and `requires` those an install cannot do without. `dotai.yaml` lists all three as compatible and requires Claude Code and agy, as `harnesses` did before; OpenCode is compatible and never required. The engine marks OpenCode as a preview, so an install manages it only when `--harness` or the saved choice names it. That keeps the role above: optional, for API credits.

## Update 2026-11-19: direction as configuration

[0050](0050-delegation-direction-as-user-configuration.md) (accepted) makes the direction a user setting, `primary` in `delegate.yaml` (`claudecode` by default, or `agy`), so agy may be the primary and Claude Code the secondary. The guarantees above stand in both directions: one-way delegation and no cycles. When the secondary is out of quota or fails, the primary does the task itself on the model the cost policy fits, or defers; it never moves on by itself. The agy -> agy route (gemini-* only) is dropped: delegation only crosses harnesses, and each harness has its own subagents. OpenCode stays a target only, and `requires` is `[]`.
