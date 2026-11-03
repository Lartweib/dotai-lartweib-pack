---
status: accepted
date: 2026-10-24
tags: [review-web, tracker, dependencies, packs]
supersedes: 0015
origin: dotai 0037 (pack half)
---

# 0027 · Review cards are a `review-rounds` preset of the external tracker

The engine half (dotai ships no review server; review tools are external and declared by the pack) is [dotai 0016](../../../dotai/docs/decisions/0016-review-via-external-tracker.md).

## Context

[0015](0015-review-web-in-base-local-server.md) placed `review-web` in the dotai base, with its own local server. Since then, a separate product has been scoped: a local, configurable work tracker with agents as collaborators (presets, CLI, MCP, leases, human verification, evidence store, views). A review card is a tracker item: checks with verdicts, media evidence, rounds and owner approval map directly onto the tracker's model.

## Decision

Review cards are a preset of the external tracker (`review-rounds`), not a dotai module. The tracker is an independent product with its own CLI and MCP server and no knowledge of dotai. The reference pack declares it like any other external tool (as with engram in [0005](0005-engram-as-memory-backend.md)) and activates it per profile.

Requirements the pack places on the tracker, inherited from 0015:

- It runs as a local server and works without internet and without Claude, so that it keeps working with agy as the hub.
- Its contract is CLI + MCP + preset format; the pack never depends on its internals.

## Considered options

- **A (chosen):** external tracker, consumed through the pack.
- **B:** keep `review-web` as a dotai module (0015). Rejected: it duplicates the tracker and ties the engine to one review flow.
- **C:** Orca's workspace board as the review surface. Rejected: its cards are worktrees, with a single status line, no media and no per-check verdicts. It remains useful as an optional notification layer (status `in-review`, unread mark, a tab with the review page).

## Consequences

- Supersedes [0015](0015-review-web-in-base-local-server.md). `review-web` leaves the base; it is an optional dependency that the pack activates per profile.
- The approval rules of [0016](0016-review-web-approval-by-criterion-type.md) still apply; they become rules of the `review-rounds` preset.
- Until the tracker exists, the reference pack keeps using the current per-project review flow.
- Open question 18 (whether a `proposed` ADR blocks in review) moves to the preset.
