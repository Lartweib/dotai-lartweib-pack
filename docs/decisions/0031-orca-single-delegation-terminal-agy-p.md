---
status: accepted
date: 2026-10-26
tags: [orca, delegate, variants]
supersedes: [0028]   # partially: only the launcher for a single delegation in the `orca` variant
---

# 0031 · Single delegation in the `orca` variant: Orca terminal running `agy -p`

## Context

[0028](0028-standalone-and-orca-variants.md) says the `orca` variant delegates through `orca agent launch`. The Result of [0022](0022-delegate-visible-orca-backend.md) chose, for both backends, the `agy -p --output-format json` contract run inside an Orca terminal (option B), because `agent launch` gives no status, error or token usage and its end must be guessed from a marker file or `tui-idle`. The quota decision in 0022's 2026-10-26 update also depends on reading the quota error from that JSON.

## Decision

In the `orca` variant, a single delegation opens a visible Orca terminal (`orca terminal create`) that runs `agy -p --output-format json`, then uses `orca terminal wait`/`read`/`close`. Several workers, dependencies or worker questions still go through `orca orchestration` (0022, update 2026-10-23). The rest of 0028 stands.

## Considered options

- **A (chosen):** `orca terminal create` running `agy -p`. Same contract as `standalone`: status, error, tokens and the quota error.
- **B:** `orca agent launch`. Rejected: no JSON, no usage and no quota error, so exhaustion would go undetected.

## Consequences

- Good: one delegation contract for both variants; quota exhaustion is detectable in `orca` too.
- Accepted cost: the agy TUI is not shown in the tab, only the headless run's output.
- Partially supersedes 0028 (its `orca agent launch` line).

## Evidence

- [0022](0022-delegate-visible-orca-backend.md): comparison table A vs B, Result, updates 2026-10-23 and 2026-10-26.
