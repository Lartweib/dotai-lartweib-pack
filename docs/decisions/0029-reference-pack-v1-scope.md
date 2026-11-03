---
status: superseded
superseded-by: 0043
date: 2026-10-24
tags: [product, scope, roadmap, v1]
supersedes: 0007
origin: dotai 0041 (pack half)
---

# 0029 · v1 scope of the reference pack

The engine half (engine v1) is [dotai 0020](../../../dotai/docs/decisions/0020-v1-scope-engine-and-pack.md).

## Context

[0007](0007-five-layers-and-profiles.md) defined five product layers (global base, `delegate`, global panel, onboarding with profiles, agy-hub parity) and built them in that order. Since then the engine and the packs were separated ([dotai 0010](../../../dotai/docs/decisions/0010-engine-and-pack-separated.md)), review left the base ([0027](0027-review-rounds-preset-in-the-tracker.md)), and variants ([0028](0028-standalone-and-orca-variants.md)) and install modes ([dotai 0018](../../../dotai/docs/decisions/0018-install-modes-and-mandatory-backup.md)) appeared. Most of the five layers are pack content, not engine features.

## Decision

**Reference pack v1:**

1. Base with the cost policy.
2. `delegate` in its two variants, `standalone` and `orca`.

**After v1:** the `godot`, `web`, `desktop` and `tooling` profiles, the global panel, and agy-hub parity.

The profile list from 0007 (`godot` with the `obra` sub-profile, `web`, `desktop`, `tooling`) stands.

## Considered options

- **A (chosen):** v1 split into engine and pack, trialed first through the engine's isolated install mode ([dotai 0018](../../../dotai/docs/decisions/0018-install-modes-and-mandatory-backup.md)).
- **B:** keep the five-layer order of 0007. Rejected: it mixes engine and pack, and it predates variants and install modes.

## Consequences

- Supersedes [0007](0007-five-layers-and-profiles.md).
- The isolated install mode lets the maintainer test the reference pack next to the current configuration before adopting it.
- The panel waits for the analysis of the real value of mods (open question 20).

## Update (2026-10-25)

Sub-profiles were replaced by flat, combinable profiles in [dotai 0023](../../../dotai/docs/decisions/0023-flat-profiles-and-layer-merge-rules.md); `obra` becomes an ordinary profile.

## Update (2026-10-26)

[0028](0028-standalone-and-orca-variants.md) gives `standalone` visibility "through the panel and the statusline". Since the panel is after v1, v1 `standalone` visibility is the statusline plus the launch log of [0018](0018-explicit-model-and-effort-per-delegation.md); the panel adds to it later.

## Update 2026-11-03: renamed

The profile `obra` is now `autonomous-orchestra` (author, 2026-11-03; see [0044](0044-v1-profile-set.md)). The text above keeps the old name.
