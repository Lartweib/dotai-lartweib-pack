---
status: accepted
date: 2026-10-23
tags: [workflows, sdd, tasks, router]
supersedes: [0001]
origin: dotai 0027
---

# 0023 · Workflows by task type (v2)

Supersedes [0001](0001-workflows-by-task-type.md). It comes from the "Proposed correction to D-04" in DESIGN §8, plus the router from [0020](0020-drop-sdd-lightweight-task-router.md); the author approved leaving SDD out and the router.

## Context

Several sources agree: Anthropic's guidance (best practices), the lightweight versions of Kiro, spec-kit and BMAD, and a general move of agent tooling away from mandatory spec phases and toward automatic review only for high risk. Two measurements support less context and independent verification: context files raise cost by more than 20% without improving overall success, and a full harness cost more than 20x. The common principle is that fresh-context verification is worth more than a detailed spec. Each scaffolding ingredient is re-evaluated with each model generation.

## Decision

There is no single workflow. The analyzer and the profiles pick the workflow by task type, with a default verification and cap on each row (full detail in [DESIGN §6](../DESIGN.md#6-workflows-by-task-type)).

| Task type | Workflow | Default verification | Cap |
|---|---|---|---|
| Small change (the diff fits in one sentence) | Direct prompt, no plan | One executable check | 1 attempt + 1 correction; then `/clear` and rephrase |
| Bug | Failing test → fix → verify | The reproducing test passes + a scoped suite | 2 failed corrections → clear context |
| Medium change | Plan mode → implement → fresh-context review | Check + 1 fresh reviewer focused on the dominant risk | 1 review pass + 1 correction |
| Large feature | Interview → self-contained `SPEC.md` → new session | End-to-end verification written at the end of the spec | One new session per milestone |
| High risk or many verifiable milestones | Per-change (delta) spec + milestones with criteria + fresh review; chosen by verifiable milestones, not by size | Milestone by milestone + fresh review | 1 scoped correction, then escalate |
| Exploratory / game feel | Checkpoints, `/rewind`, minimal spec or none | Visual verification; the owner decides | Taste: 1 round + 1 check. Engine correctness: a gate measured against its noise band |
| Autonomous backlog | Adaptable ingredients with caps and a separate verifier ([0013](0013-autonomous-work-as-ingredients.md)) | Executable check + separate verifier | Turn clause in `/goal`; "two rounds in a row without improvement"; quota cap in config |
| Audit / migration / research | Bounded workflow | Adversarial verification | Pilot on one slice; no human gates inside |

Router ([0020](0020-drop-sdd-lightweight-task-router.md)): classification in the base (does it authorize a change? what type? what risk?) and one skill per task type, loaded only when it applies. SDD is not installed, not even on demand.

## Considered options

- **A (chosen):** revised workflow table, with verification and cap per row, and a lightweight in-house router.
- **B:** the original table from [0001](0001-workflows-by-task-type.md), with "High risk = full SDD with gates" and "Autonomous backlog" with features in JSON. Superseded: see changes below.
- **C:** SDD as an on-demand package. Rejected by [0020](0020-drop-sdd-lightweight-task-router.md).

## Consequences

Changes relative to 0001:

- The "High risk" row goes from "full SDD with gates" to "per-change spec + gates + fresh review", chosen by verifiable milestones and not by size.
- The "Autonomous backlog" row becomes a list of adaptable ingredients with caps and a separate verifier.
- The rule "if the diff fits in one sentence, no plan" is added.
- Existing `openspec/` folders (in two of the author's other projects, a web project and a tooling project) are not touched.

## Evidence

- Internal research (not published) on workflow alternatives, §3–4.
- Internal research (not published) on the author's SDD usage pattern.
- It also corrects internal research (not published) on the state of the art, §1, which attributed the shift to v4.1.1.

## Update 2026-11-02: spec file shape

Decided with the author from their own specs (internal research, not published): the plans that were followed were 53–131 lines with a runnable acceptance command per unit; the 200–400-line plans got one commit each; an `openspec` run with fine-grained requirements passed verification while its goal was never met.

- Large feature: `SPEC.md` at the repo root, one active at a time. High risk: `docs/specs/<yyyy-mm-dd>-<slug>.md`.
- Sections in order: goal, non-goals, constraints (locked decisions), context (entry files and commands), milestones `M<n>` each with criterion, command and files (a delta adds before/after and rollback), one end-to-end check proving the goal, open decisions each with the default taken.
- Caps: 150 lines, 80 for a delta.
- The spec holds intent only; progress goes to `STATUS.md` and `HANDOFF.md` (the `autonomous` skill).
