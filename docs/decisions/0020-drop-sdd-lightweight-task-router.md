---
status: accepted
date: 2026-10-23
tags: [sdd, workflows, router, autonomous]
origin: dotai 0024
---

# 0020 · Drop SDD; own lightweight task router

## Context

SDD fell out of use because of drift; the three vendors agree that the workflow depends on the task. The ideas of ODD are taken without turning them into a methodology with a large fixed prompt, which would reintroduce the cost that [0008](0008-always-on-budget-values.md) cuts.

It resolves open question P-C1 (does SDD remain as an on-demand package or is it dropped?) and **completes the answer to P-01** (which previous tools are kept?): only engram, installed directly. From ODD, ideas are kept, not code: (1) the gate "does this authorize a change?", (2) a single task file only for substantial work, (3) delegating for a named reason and with an evidence budget. RDD (frozen receipts) is not kept, nor is any skill (`branch-pr`, `chained-pr`, etc. are unused).

## Decision

`dotai` does not install SDD, not even on demand. Instead, its own router:

- **Classification in the base** (`AGENTS.md`, ~10 lines, ~200–300 tokens): does the request authorize a change? What type of task is it? What risk does it carry?
- **One skill per task type** (bug, medium change, high risk, autonomous, exploratory), loaded only when it applies. High risk uses a single spec file per change, with gates and a fresh review.
- **What is its own compared with ODD:** each type carries a model, effort and cap ([0018](0018-explicit-model-and-effort-per-delegation.md), [0019](0019-quota-cap-by-who-is-in-charge.md)); the classification also decides whether delegating to agy makes sense; verification is defined per type; the scaffolding is re-evaluated with every model generation.
- Existing `openspec/` folders (in two of the author's other projects) are left untouched.

## Considered options

- **A (chosen):** drop SDD, own lightweight router with one skill per task type.
- **B:** SDD as an on-demand package. Rejected: SDD fell out of use because of drift.
- **C:** adopt ODD as a methodology with a large fixed prompt. Rejected: it would reintroduce the cost that 0008 cuts; only its ideas are taken.

## Consequences

- Supersedes P-C1 and completes the answer to P-01.
- Complements [0023](0023-workflows-by-task-type-v2.md), which sets the table of workflows by task type.

## Evidence

- Internal research (not published): SDD usage pattern.
- Internal research (not published): workflow alternatives (§1 and §4.5).

## Update 2026-11-22: delegate first

In the first hours of the real install, the launch log held 17 Claude Code subagent launches (12 `worker`, 4 `reviewer`, 1 `explorer`) and no delegation to agy besides the author's smoke tests. The router line named `delegate` for research, audits and bulk mechanical work, but the subagent roster offered the same jobs at a lower launch cost, so the session took the subagents. The line now makes `delegate` the first route for those jobs; `researcher`, `explorer` and `worker` take them only when `delegate` returns DEFER or the job needs the session's context. Measure again from the launch log.

The same trial found that agy in plan mode reaches for a shell command to read a file, which plan mode denies, and then replies with nothing; the read-only prompt of `delegate-core.mjs` now names the file tools.
