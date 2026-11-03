---
status: accepted
date: 2026-10-19
tags: [cost, models, hooks]
origin: dotai 0005
---

# 0002 · Built-in cost policy

## Context

According to the author's own usage audit, in Sep–Oct 87 % of consumption was subagents, and 93 % of that spend ran on Opus through model inheritance. The overhead compared with Sonnet was ~32 % of the total. Instructions in the chat ("pick the model wisely") were not followed; configuration is followed.

## Decision

The cost policy ships as configuration and hooks, not as instructions in the prompt.

- **Opus** only to orchestrate, judge and arbitrate. **Sonnet** to execute and explore. **Haiku** for mechanical work.
- `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` as the default. A `PreToolUse` hook on `Agent` (at the time of this decision, whether to make it strict or default-based was still pending; resolved in [0018](0018-explicit-model-and-effort-per-delegation.md)).
- Round caps per profile: if a round does not improve the metric, it stops and reports.
- The quota is a safety brake, never a target.

## Considered options

- **A (chosen):** policy as configuration and hooks.
- **B:** instructions in the prompt/chat. Rejected because they were not followed ("pick the model wisely"); configuration is followed.

## Consequences

- Cost savings come from this policy and from the loop caps (see [dotai 0001](../../../dotai/docs/decisions/0001-own-configuration-engine.md)).
- The quota cap was refined later in [0019](0019-quota-cap-by-who-is-in-charge.md).

## Evidence

- Internal research (not published): the author's own usage audit.
- Internal research (not published): discovery of harness capabilities.
