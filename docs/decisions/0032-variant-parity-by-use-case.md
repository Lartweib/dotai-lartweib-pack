---
status: accepted
date: 2026-10-26
tags: [variants, orca, delegate, visibility]
---

# 0032 · Variant parity by use case

## Context

[0028](0028-standalone-and-orca-variants.md) defines the `standalone` and `orca` variants, and 0025 (superseded by 0028) wanted Orca to be droppable without rethinking the design. Neither states what `standalone` must offer. Some use cases are covered in `orca` only because Orca provides them: orchestration of several agy workers (`orca orchestration`) and seeing delegated agents run, with agy shown among the Claude subagents.

## Decision

The pack covers all of the author's use cases in both variants. Each variant defines only what its environment lacks:

- `orca` relies on Orca for what Orca already solves and adds only the pack's contract.
- `standalone` provides its own solution for each of those use cases.

Known gaps in `standalone` to be filled:

- **Visibility of delegations:** a view of the tree of launched subagents, agy included alongside Claude's (the author's example: a mod showing that tree).
- **Orchestration of several agy workers:** parallel launches, dependencies and worker questions.

## Considered options

- **A (chosen):** parity by use case; each variant fills what its environment lacks.
- **B:** `standalone` as a reduced variant with no visibility or multi-worker support. Rejected: the author wants the pack to cover every use case without depending on Orca.

## Consequences

- Good: dropping Orca never loses a use case.
- Accepted cost: `standalone` carries more of its own pieces than `orca`.
- Constraint: mods are never installed at user scope, so variants carry none ([PACK-FORMAT](../../../dotai/docs/PACK-FORMAT.md), [dotai 0011](../../../dotai/docs/decisions/0011-mods-always-project-scoped.md)), and the panel is after v1 ([0029](0029-reference-pack-v1-scope.md)). Resolved in the update below.

## Update 2026-10-26: visibility in `standalone`

The author wants visual comfort, not a panel as such. `standalone` provides visibility in v1 with a viewer that is not a mod: a command that reads the launch log and shows the live tree of launched subagents (Claude and agy), meant to run in a terminal next to the session, plus a short summary in the statusline. No engine change is needed; the panel stays after v1 and optional.

## Update 2026-10-26: several agy workers in `standalone`

It is a real use case (several agy agents on different tasks has happened in a game project); today the author covers it with Orca. `standalone` must still cover it:

- **v1:** the runner launches several `agy -p` jobs in parallel, each with its own job file, and the viewer shows them all. Cheap, since it reuses the single-delegation contract.
- **After v1:** dependencies between workers and worker questions mid-run, because Orca covers them meanwhile.

## Evidence

- Author's statement in conversation, 2026-10-26.
- [0022](0022-delegate-visible-orca-backend.md), [0025](0025-common-base-two-execution-modes.md), [0028](0028-standalone-and-orca-variants.md).
