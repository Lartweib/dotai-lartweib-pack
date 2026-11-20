---
status: superseded
date: 2026-10-19
tags: [profiles, modules, roadmap]
superseded-by: 0007
origin: dotai 0009 (pack half)
---

# 0006 · Initial profiles, modules and build order

> **Superseded by [0007](0007-five-layers-and-profiles.md).** Kept as history. The engine half of the original record (Go binary, `apply`/`doctor`) is [dotai 0004](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0004-installer-language-and-shape.md).

## Context

The installer's shape was decided in [dotai 0004](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0004-installer-language-and-shape.md). It needed a first list of profiles and modules, and an order to build them.

## Decision

Core under 2k tokens, profiles (`obra`, `web`, `desktop`, `docs`) and opt-in modules (`delegate`, `review-web`, `guards`, `ops-pane`, `analyze`).

Proposed build order: `delegate` → `review-web` → model policy + guards → profiles → panel.

## Considered options

The sources do not record rejected alternatives.

## Consequences

- Superseded by [0007](0007-five-layers-and-profiles.md): the list of profiles (`obra`, `web`, `desktop`, `docs`) and the build order.
- `review-web` later moved to the base through [0015](0015-review-web-in-base-local-server.md).

## Evidence

- Decision made in conversation on 2026-10-19.

## Update 2026-11-03: renamed

The profile `obra` is now `autonomous-orchestra` (author, 2026-11-03; see [0044](0044-v1-profile-set.md)). The text above keeps the old name.
