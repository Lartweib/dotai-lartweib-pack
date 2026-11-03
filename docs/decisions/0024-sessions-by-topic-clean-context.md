---
status: accepted
date: 2026-10-23
tags: [context, cost, sessions, compaction]
origin: dotai 0028
---

# 0024 · Sessions by topic: the agent suggests a clean context

## Context

With 1M-context models, automatic compaction only kicks in at ~967k tokens, and every request resends the whole conversation. Compacting is also a large request: it reads the whole conversation and rebuilds the cache. `/clear` costs nothing. The author wants to save tokens without having to watch compaction, and at the same time get used to working by topic.

## Decision

No custom compaction threshold is defined; the default (~967k) stays as a safety net. Instead, a short rule in the base makes the agent judge the **topic** of each request:

| Request | What the agent does |
|---|---|
| Refinement or discussion of the current topic | Stays in the session; the loaded context is worth it. If it is something to debate or define, it suggests settling it in this session. |
| Related task | Suggests batching it within the session. |
| Another topic that starts well with a clean context | Suggests it up front and clearly ("a clean session is better to save tokens"). It does not start one without confirmation. |
| Current task closed | Leaves a written handoff (`HANDOFF.md` or engram) and suggests `/clear`. |

Only one suggestion per topic change; if the author says no, it does not insist until the next topic change.

## Considered options

- **A (chosen):** a per-topic criterion, applied by the agent through a rule in the base.
- **B:** a lower compaction threshold per profile (`autoCompactWindow`), plus `# Compact instructions` and `PreCompact`/`SessionStart(compact)` hooks. Rejected as the main mechanism: compacting costs a large request and loses detail; cutting by topic is cheaper.
- **C:** A plus a `UserPromptSubmit` hook that injects the context size when it crosses a threshold. Rejected: the right criterion is the topic, not the size; the only case it covered (the same topic stretching on) is already handled by "task closed → handoff + `/clear`", and the author sees the size in the statusline, which also trains the habit.

## Consequences

- Good: the fixed cost is a rule of a few lines; there are no avoidable compaction requests.
- Accepted cost: it depends on the agent detecting topic changes correctly and on the author accepting the suggestions.
- Pending: write the rule inside the router from [0020](0020-drop-sdd-lightweight-task-router.md) and verify that the handoff before `/clear` is enough to resume without rereading the repo.

## Evidence

- Claude Code documentation consulted on 2026-10-23: [costs](https://code.claude.com/docs/en/costs) (`/clear` costs nothing, compacting is a large request, `# Compact instructions`), [model-config](https://code.claude.com/docs/en/model-config) (~967k default on 1M models), [hooks](https://code.claude.com/docs/en/hooks).
- [0004](0004-keep-1m-context-thin-orchestrator.md): fresh context per item.
