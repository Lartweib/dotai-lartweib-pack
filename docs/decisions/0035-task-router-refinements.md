---
status: accepted
date: 2026-10-30
tags: [workflows, router, verification, delegation]
---

# 0035 · Task router refinements

## Context

Reviewing the task table of [0023](0023-workflows-by-task-type-v2.md) with the author, four gaps came up: the type is chosen once and never revised; some changes have no executable check; some bugs cannot be reproduced by a test; and the table never says when to delegate to agy, although levelling usage with agy is a goal ([0022](0022-delegate-visible-orca-backend.md), update 2026-10-26). This record extends 0023; its table stands.

## Decision

The router and the per-type skills add four rules:

1. **Reclassify on evidence.** When the work outgrows its type (a small change touches a second file or fails its check; a medium change uncovers a design decision), the agent says so and moves to the next type with its own caps, instead of improvising under the old ones.
2. **Equivalent check when nothing is executable.** Docs: links resolve and the text agrees with the accepted ADRs. Configuration and the pack itself: `dotai doctor` or running the real command. "Done" still requires a check; for these changes it is the equivalent one.
3. **Bugs with no reproducing test** (UI, game feel, environment-specific): a reproduction script, or before/after evidence (screenshot, log, recording) replaces the failing test.
4. **Delegation column.** Research, audits and bulk mechanical changes are delegated to agy through `delegate` by default; small changes, bugs and exploratory work stay in Claude Code; medium, large and high-risk work may delegate bounded sub-steps (exploration, research).

## Considered options

- **A (chosen):** extend 0023 with these rules.
- **B:** leave them implicit. Rejected: without a written rule the agent keeps the first type's caps, declares done without a check, and never delegates.

## Consequences

- Good: caps follow the real size of the work; every type has a defined check; delegation becomes routine.
- The fresh reviewer used by the medium and high-risk rows is defined in [0036](0036-single-reviewer-by-focus.md).

## Evidence

- Review with the author, 2026-10-30.
