---
status: accepted
date: 2026-10-24
tags: [packs, variants, orca, delegate]
supersedes: 0025
origin: dotai 0038 (pack half)
---

# 0028 · The reference pack's `standalone` and `orca` variants

The engine half (variants as a generic capability) is [dotai 0017](../../../dotai/docs/decisions/0017-pack-variants-as-layers.md).

## Context

[0025](0025-common-base-two-execution-modes.md) defined two execution modes (without Orca / with Orca) as part of dotai. Since the engine supports variants as a generic capability and knows nothing about Orca, those modes become variants of this pack.

## Decision

The content of 0025 becomes the description of the reference pack's two variants:

- `standalone`: own runner (ported from the maintainer's existing runner), visibility through the panel and the statusline.
- `orca`: delegation through `orca agent launch` and `orca orchestration`, with no own runner. (The single-delegation launcher is superseded by [0031](0031-orca-single-delegation-terminal-agy-p.md): an Orca terminal running `agy -p`.)

What must hold in both variants (the cost policy: validated model/effort pair and quota caps) stays in the pack's base, so no variant can drop it.

## Considered options

- **A (chosen):** two variants of the reference pack.
- **B:** keep the two Orca modes in the engine (0025). Rejected in [dotai 0017](../../../dotai/docs/decisions/0017-pack-variants-as-layers.md).

## Consequences

- Supersedes [0025](0025-common-base-two-execution-modes.md).
- Accepted cost: the reference pack still maintains two delegation paths, as in 0025.

## Update (2026-10-26)

The panel is after v1 ([0029](0029-reference-pack-v1-scope.md)). In v1, `standalone` visibility is the statusline plus the launch log of [0018](0018-explicit-model-and-effort-per-delegation.md).

## Update 2026-11-01: default variant

`standalone` is the default variant in `dotai.yaml`: it works on any machine with no dependency. The author installs with `--variant orca`.
