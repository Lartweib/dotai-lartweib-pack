---
status: superseded
date: 2026-10-20
tags: [product, layers, roadmap, profiles]
supersedes: 0006
superseded-by: 0029
origin: dotai 0011 (pack half)
---

# 0007 · Five-layer product, v1 order and profiles

> **Superseded by [0029](0029-reference-pack-v1-scope.md)** (2026-10-24). Kept as history; only 0029 is binding. The engine half is [dotai 0006](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0006-five-layer-product-and-v1-order.md).

## Context

The goal is for dotai to fit the author's own use cases, with controlled token consumption and without redefining the configuration in every project. The profiles `obra`, `web`, `desktop`, `docs` from [0006](0006-initial-profiles-modules-and-build-order.md) do not match the real projects: `obra` becomes a sub-profile of `godot`, and `docs` is covered by the base.

Approved by the author in conversation (v1 order accepted: base + cost policy → delegate CC→agy → global panel → onboarding + profiles → agy-hub parity).

## Decision

dotai is built in five layers: (1) global base, (2) `delegate`, (3) global panel, (4) onboarding + profiles, (5) agy-hub parity. v1 order: 1 → 2 → 3 → 4 → 5. Profiles: `godot`, `web`, `desktop`, `tooling`.

The detail of each layer is in [DESIGN §1](../DESIGN.md#1-what-dotai-is).

## Considered options

- **A (chosen):** five layers, order 1 → 5, profiles `godot`, `web`, `desktop`, `tooling`.
- **B:** the order and profiles from [0006](0006-initial-profiles-modules-and-build-order.md) (`delegate` → `review-web` → model policy + guards → profiles → panel; profiles `obra`, `web`, `desktop`, `docs`). Superseded because the profiles do not match the real projects.

## Consequences

- Supersedes 0006 (build order and profile list).
- `obra` is a sub-profile of `godot`; `docs` is covered by the base.

## Evidence

- Internal research (not published): component catalog.
- Internal research (not published): per-profile studies for `web`, `godot`, `desktop` and `tooling`.

## Update 2026-11-03: renamed

The profile `obra` is now `autonomous-orchestra` (author, 2026-11-03; see [0044](0044-v1-profile-set.md)). The text above keeps the old name.
