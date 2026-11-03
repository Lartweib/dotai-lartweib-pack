---
status: accepted
date: 2026-10-20
tags: [autonomous, workflows, ingredients]
origin: dotai 0017
---

# 0013 · Autonomous work as ingredients, not a template

## Context

The author's own briefs already cover the function of a template (Objective, Sources, Scope, Phases, Success criterion). Each ingredient encodes an assumption about the model and must be re-evaluated with every model generation.

Approved by the maintainer in conversation.

## Decision

There is no official autonomous-work template. dotai ships a versioned, dated list of ingredients ([DESIGN §6](../DESIGN.md#6-workflows-by-task-type), workflows by task type) that the agent adapts per project. Caps and the separate verifier are never omitted.

## Considered options

- **A (chosen):** versioned list of ingredients that the agent adapts.
- **B:** official autonomous-work template. Rejected because the author's own briefs already cover that function, and each ingredient encodes an assumption about the model that must be re-evaluated.

## Consequences

- Round and turn caps, and verification with fresh context, are not omitted in autonomous mode.

## Evidence

- Internal research (not published): workflow alternatives (§4.3).
- Internal research (not published): SDD usage pattern.
