---
status: superseded
date: 2026-10-19
tags: [workflows, sdd, tasks]
superseded-by: 0023
origin: dotai 0004
---

# 0001 · Several workflows by task type; SDD is not the default

> **Superseded by [0023](0023-workflows-by-task-type-v2.md)** (2026-10-23). Kept as history; only 0023 is binding.

## Context

Anthropic's guidance (best practices), the lightweight versions of Kiro, spec-kit and BMAD, and the general shift of agent tooling toward risk-based review all agree. The common principle is that verification with fresh context is worth more than a detailed spec.

## Decision

There is no single workflow. The analyzer and the profiles pick the workflow according to the task type:

| Task type | Workflow |
|---|---|
| Small change | Direct prompt + check |
| Bug | Failing test → fix → verify |
| Medium change | Plan mode → implement → fresh-context review |
| Large feature | Interview → `SPEC.md` → new session |
| High risk | Full SDD with gates |
| Exploratory / game feel | Loop with checkpoints and visual verification, with no spec or a minimal one |
| Autonomous backlog | Features in JSON (`passes: false`) + progress file + `/goal` with a separate evaluator |
| Audit / migration / research | Opt-in workflow of bounded size |

## Considered options

- **A (chosen):** several workflows by task type.
- **B:** SDD as the default workflow. Rejected: SDD is not the default (see Context: verification with fresh context is worth more than a detailed spec).

## Consequences

The sources do not record additional consequences. The later correction of this table is in [0023](0023-workflows-by-task-type-v2.md).

## Evidence

- Internal research (not published): state of the art, §1.
