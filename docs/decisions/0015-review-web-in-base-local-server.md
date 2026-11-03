---
status: superseded
date: 2026-10-20
tags: [review-web, base, local-server]
superseded-by: 0027
origin: dotai 0019
---

# 0015 · `review-web` in the base, with its own local server

> **Superseded by [0027](0027-review-rounds-preset-in-the-tracker.md)** (2026-10-24). Kept as history; only 0027 is binding.

## Context

It is the most used review flow (130 feedback items) and works for any kind of review. It resolves open question P-06 (own review server or Artifacts comments?).

## Decision

`review-web` is part of the base and is installed without per-project configuration. It has a generic core (cards, feedback, approval) and per-profile sections (GIFs and scenes in `godot`, per-viewport screenshots in `web`, windows in `desktop`, diffs or designs in `tooling`). The UI is redesigned from scratch. It runs as its own local server, as it does today.

## Considered options

- **A (chosen):** own local server. Works with agy as the hub and without internet.
- **B:** Artifacts comments. Rejected because they depend on Claude and would fail precisely in the fallback.

## Consequences

- Supersedes P-06.
- Replaces the position of `review-web` in the order of [0006](0006-initial-profiles-modules-and-build-order.md): it is now in the base.

## Evidence

- Internal research (not published): harness discovery.
