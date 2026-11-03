---
status: accepted
date: 2026-10-30
tags: [review, subagents, cost, workflows]
---

# 0036 · One reviewer, chosen by focus and risk signals

## Context

Resolves OPEN-QUESTIONS question 5 (replace the `review-*` lenses with one reviewer?). The router ([0023](0023-workflows-by-task-type-v2.md), [0035](0035-task-router-refinements.md)) calls for a fresh-context review in medium and high-risk work without defining the reviewer. The author finds the four lenses excessive and rejects triggering review by changed-line count.

Usage analysis, 2026-09-06 to 2026-10-30 (internal research, not published):
- 246 lens runs, all fired automatically by a global rule, none on request.
- 18 severe findings in total; one project had 136 runs and no severe finding.
- The highest-value finding came from the risk lens on a security path.
- Readability mostly flagged stale docs and rarely blocked anything.
- In web work an Opus judge scoring against the owner's criteria was more useful (8 of 8 corrections applied); Godot work used ad-hoc judge → fix rounds.
- "Acted on" figures are estimated from later edits to the same file.

## Decision

The pack ships one reviewer subagent, parameterized by focus:

- **Focuses:** `correctness` (default; regressions, tests, partial failure, recovery), `security` (only when a risk path is touched), `docs-drift` (only for ADR, spec or contract edits). Profiles add their own: `godot` a blind game-feel judge against criteria, `web` a11y/perf. At most two focuses per run, in one agent.
- **Triggers (risk signals, never size):** medium and high-risk rows of the router; paths touching auth, secrets, payments, permissions, update or release, migrations, hooks, `settings*`, CI or IPC; a behavior change with no new test; an explicit request.
- **Skip:** docs, comment or formatting changes; exploratory or game-feel work (the owner decides); a bug whose reproducing test now passes; work already reviewed.
- **Caps:** at most 5 findings, severe first, each with location and evidence; one pass plus one scoped correction, then escalate.
- **Model:** the reviewer runs Sonnet at medium effort, declared in its definition ([0030](0030-explicit-model-and-effort-enforcement.md)). Opus only as the judge for high-risk changes and taste or owner-proxy judgments ([0002](0002-built-in-cost-policy.md)); scored re-rounds are blind.

## Considered options

- **A (chosen):** one reviewer by focus and risk signals.
- **B:** keep the four lenses. Rejected: high cost and low yield in the author's usage.
- **C:** trigger by changed-line count. Rejected by the author: line cuts did not match real risk.

## Consequences

- Good: one agent definition in the always-on listing; review only where risk is.
- Accepted cost: readability problems are not reviewed on their own; `docs-drift` covers the useful part.
- Pending: refine the focuses after measuring real outcomes, not same-file edits.

## Evidence

- Usage analysis of review runs, 2026-10-30 (internal research, not published).

## Update 2026-11-02: no `web` focus

The `web` a11y/perf focus is dropped: no profile ships it. `web` became a framework, build and checks profile ([0044](0044-v1-profile-set.md)), and design review lives in the `ui` skills (`impeccable`, `web-design-guidelines`). The `godot` blind game-feel judgment is done by the base `judge` agent against criteria, not by a reviewer focus. The base reviewer's focuses (`correctness`, `security`, `docs-drift`) are unchanged.
