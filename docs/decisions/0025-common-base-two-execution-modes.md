---
status: superseded
date: 2026-10-23
tags: [delegate, orca, execution, cost]
superseded-by: 0028
origin: dotai 0031
---

# 0025 · Common base and two execution modes (without Orca / with Orca)

> **Superseded by [0028](0028-standalone-and-orca-variants.md)** (2026-10-24). Kept as history; only 0028 is binding.

## Context

[0022](0022-delegate-visible-orca-backend.md) validated two ways of launching agy from Orca (`orca agent launch` and `orca orchestration`). It also showed that Orca's `launch.effective` repeats what was requested even when agy falls back to another model. dotai never depends on Orca ([0022](0022-delegate-visible-orca-backend.md)). The author wants to be able to drop Orca without rethinking the design.

## Decision

**Base (always, in dotai):** cost policy (model, effort and quota caps), profiles, onboarding, `review-web`, decisions and the job contract: a validated model/effort pair, the long result in the job file and a launch log.

**Without-Orca mode:** dotai provides the launcher. It is an own runner, ported and generalized from an existing runner in one of the author's projects (`<project>/.claude/tools/agy-task.mjs`: quota reading, pool fallback, `-p` with JSON). Visibility comes from the panel (mod) and the statusline.

**With-Orca mode:** Orca launches, waits and closes. `orca agent launch` for a single delegation; `orca orchestration` for several workers, dependencies or worker questions. dotai only adds its contract.

In both modes, dotai validates the model/effort pair before launching and then confirms the real model.

Suggested order: the base and the with-Orca mode first; right after, the port of the without-Orca runner, so it is never left untested.

## Considered options

- **A (chosen):** a common base plus each mode's own pieces.
- **B:** a single mode tied to Orca. Rejected: the author wants to be able to drop Orca without rethinking.
- **C:** two separate installation paths that duplicate logic. Rejected (inferred from the conversation: the author's intent is one base with per-mode pieces, not two products).

## Consequences

- Good: switching modes does not touch the cost policy or the contract.
- Accepted cost: two launchers have to be maintained (the own runner and the Orca integration).
- Pending: in the without-Orca mode, how much the panel adds now that Orca shows agents and quotas ([0026](0026-mods-incident-and-value.md)).

## Evidence

- [0022](0022-delegate-visible-orca-backend.md), tests from 2026-10-23, including the `orca orchestration` one.
- Current runner: `agy-task.mjs` and `agy-lib.mjs` in one of the author's projects (quota reading and Gemini → third-party fallback).
- Approved by the author in conversation on 2026-10-23.
