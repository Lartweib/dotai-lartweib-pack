---
status: accepted
date: 2026-10-19
tags: [context, orchestration, cost]
origin: dotai 0007
---

# 0004 · The 1M context stays; the operating mode changes

## Context

According to the author's own usage audit, `cache_read` was between 60 % and 79 % of the spend. It is cheap per token, but it is paid on every call. There is no evidence to recommend dropping to 200k.

## Decision

The context window is not reduced. What changes is the operating mode: **thin orchestrator and fresh context per item.**

- The main session picks the next item and delegates; it does not execute the backlog.
- Each item starts in a new agent that reads `STATUS.md` and `HANDOFF.md`.
- When a unit of work closes, run a focused `/compact`, without waiting for the context to fill up.

## Considered options

- **A (chosen):** keep 1M and change the operating mode.
- **B:** reduce the window to 200k. Rejected: there is no evidence to recommend it.

## Consequences

The sources do not record additional consequences.

## Evidence

- Internal research (not published): the author's own usage audit.
