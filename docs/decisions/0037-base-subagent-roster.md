---
status: accepted
date: 2026-10-30
tags: [subagents, models, cost, base]
---

# 0037 · Base subagent roster

## Context

[0030](0030-explicit-model-and-effort-enforcement.md) rejects generic agents, so the base must ship its own for what they did. Every definition adds to the always-on agent listing ([0008](0008-always-on-budget-values.md)), so the roster stays small. The reviewer is defined in [0036](0036-single-reviewer-by-focus.md).

Usage, 2026-09-06 to 2026-10-30 (internal research, not published): 1,075 launches, 822 generic. Purposes, from a hand-classified sample of 156: implementation 58%, review and audits 7%, tests and measurement 9%, planning 4%, exploration ~3%, visual QA ~3%, external research ~1.5%; 54 judge launches, mostly routine round gates. Profile agents (`seo-*`, `jd-*`, most `sdd-*`) were not used in that window.

Pricing (Anthropic, cached 2026-10-06): Haiku 5.5 $0.10 / $0.50 per MTok (×5 above 100K-token prompts), Sonnet 5.5 $2 / $10. Third-party benchmarks put Haiku 5.5 near Sonnet 5.5 on bounded coding (SWE-bench Multilingual 83.7% vs 90.3%) and far behind on long agentic tasks (Terminal-Bench 4.0 39.2% vs 70.6%).

## Decision

| Agent | Purpose | Model / effort | Tools |
|---|---|---|---|
| `explorer` | Search and map code or docs, return a summary | Haiku 5.5 / medium | Read-only |
| `researcher` | External research: docs, web, gather options | Haiku 5.5 / medium; raised to Sonnet if results are weak | Read + web |
| `worker` | Implement a bounded change; run tests, measurements, captures | Sonnet / medium | All |
| `reviewer` | Fresh review by focus ([0036](0036-single-reviewer-by-focus.md)); also routine round gates and audits | Sonnet / medium | Read-only (reads images) |
| `judge` | Blind judgment against criteria: high risk, taste, owner proxy, choosing between designs | Opus / high | Read-only |

Routing of the remaining cases:
- Planning and design: the orchestrator plans; `judge` picks between competing designs. No planner role.
- Visual QA: `worker` captures, `reviewer` or `judge` reads the images.
- Log mining, measurement, merges: `worker` or agy through `delegate`, never `explorer`.
- Audits go to `reviewer`, not `explorer`.

The Opus allowlist holds `judge` only. The `godot` profile adds `worker` with Opus for art work (sculpting, art against references); in Claude Code the model can be set per launch, effort still comes from the definition.

## Considered options

- **A (chosen):** five roles, Haiku for reading-heavy roles.
- **B:** Sonnet for every non-judge role. Rejected: 20× the price for bounded reading work.
- **C:** a separate `artist` role with Opus in `godot`. Rejected: one more listed agent; a scoped allowlist entry does the same.

## Consequences

- Good: about 90% of past generic launches map to a role; the rest is routed above.
- Accepted cost: Sonnet `worker` may lower quality on work that ran on Opus before; watch the launch log.
- Pending: confirm Haiku quality for `researcher` with real use.

## Evidence

- Subagent usage analysis, 2026-10-30 (internal research, not published).
- Benchmarks: [llm-stats](https://llm-stats.com/models/compare/claude-haiku-5-5-vs-claude-sonnet-5-5), [BenchLM](https://benchlm.ai/compare/claude-haiku-5-5-vs-claude-sonnet-5-5), [Caylent](https://caylent.com/blog/claude-haiku-5-5-stronger-capabilities-and-lower-prices).
