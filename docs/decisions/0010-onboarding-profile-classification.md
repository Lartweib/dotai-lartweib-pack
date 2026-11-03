---
status: accepted
date: 2026-10-20
tags: [onboarding, profiles, analyzer]
origin: dotai 0014 (pack half)
---

# 0010 · Onboarding in the reference pack: classification and analyzer

> **Partially superseded by [dotai 0023](../../../dotai/docs/decisions/0023-flat-profiles-and-layer-merge-rules.md): sub-profiles.** The engine half (detection by content, approval before applying, installation per profile) is [dotai 0008](../../../dotai/docs/decisions/0008-onboarding-by-detection-and-base-profile.md).

## Context

~60 unused skills and agents were paid for on every request; actual use of `seo-*` and design skills is concentrated in web projects.

Approved by the maintainer in conversation.

## Decision

`seo-*` belongs to `web`; a language-learning project is classified as `tooling`. Onboarding is run by a read-only `dotai-analyze` skill, which proposes the profiles for the engine to apply.

## Considered options

The sources do not record rejected alternatives for the classification.

## Consequences

The shape of onboarding (read-only `dotai-analyze` skill, "sync" mode) is in [DESIGN §4.5](../DESIGN.md#45-onboarding-layer-4) (onboarding, layer 4).

## Evidence

- Internal research (not published): component catalog.
- Internal research (not published): web profile.
