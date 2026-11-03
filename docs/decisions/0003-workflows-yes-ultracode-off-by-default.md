---
status: accepted
date: 2026-10-19
tags: [workflows, ultracode, cost]
origin: dotai 0006
---

# 0003 · Workflows yes, ultracode off by default

## Context

With ultracode active, the model receives the directive that "token cost is not a constraint" and orchestrates any substantive task. What is valuable is the organization of the orchestration, not permanent fan-out.

Known constraint: a workflow cannot ask questions in the middle of a run. Human gates go between runs.

## Decision

Workflows enabled and ultracode off. Recurring flows (`/backlog-run`, `/audit`, etc.) are packaged as **saved workflows or skills** that are invoked explicitly. For a one-off task, the word `ultracode` is used in the prompt.

## Considered options

- **A (chosen):** workflows enabled, ultracode off, explicit invocation.
- **B:** ultracode active by default. Rejected: the model receives the directive that token cost is not a constraint and orchestrates any substantive task.

## Consequences

- Human gates go between runs, not inside a workflow.

## Evidence

- Decision made in conversation on 2026-10-19; the usage audit is internal research (not published).
