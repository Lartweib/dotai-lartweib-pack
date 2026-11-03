---
status: accepted
date: 2026-11-01
tags: [product, scope, roadmap, v1, profiles]
supersedes: [0029]
---

# 0043 · v1 is the complete pack, profiles included

## Context

[0029](0029-reference-pack-v1-scope.md) limited v1 to the base and `delegate` in its two variants, and left the profiles, the global panel and agy-hub parity for later. The base review is now nearly closed, onboarding is designed ([0040](0040-project-onboarding-and-on-demand-profiles.md)), and without profiles `dotai-analyze` and the profile catalog have nothing to offer.

The author does not want intermediate releases: v1 is the final, complete version of the pack, and it must include the profiles.

## Decision

- **v1 is the complete pack.** There are no intermediate releases.
- **v1 includes the profiles.** Their set and content come from a new analysis of the author's usage, plus a review of skills, MCPs and tools the author has not used but would have benefited from.
- The profile open questions (OPEN-QUESTIONS 6–16, 25) are closed while the profiles are built, not after v1.
- The global panel and agy-hub parity are part of v1 if their open questions (20 and measurement 1) show they are worth it (inferred).

## Considered options

- **A (chosen):** a complete v1 with profiles.
- **B:** keep 0029 (base and `delegate` first). Rejected by the author: there are no intermediate versions.
- **C:** add only `godot` and `web` to v1. Rejected for the same reason.

## Consequences

- Supersedes [0029](0029-reference-pack-v1-scope.md).
- Good: onboarding and the catalog can be tested end to end on real projects.
- Accepted cost: v1 takes longer; the profile questions block it.
- Pending: the profile set, decided from the usage analysis.

## Evidence

- Review with the author, 2026-11-01.

## Update 2026-11-02: measurement 1 (agy hub)

agy-hub parity no longer waits on measurement 1: headless agy 1.4.12 (`agy -p`) is a viable hub. It runs shell commands, asynchronous subagents with a model setting, tasks and scheduling. Limits found:

- Subagent models must be pinned to `gemini-*`, so an agy hub never spends Claude's quota through the third-party pool ([0009](0009-directional-delegation-with-quota-config.md)).
- There is no quota signal in headless mode: the `statusLine` command does not run under `-p`, and quota reaches only that command. This gap stays open ([OPEN-QUESTIONS](../OPEN-QUESTIONS.md), measurement 1). `--settings` allows session-only settings.
- Each subagent launch costs about 19k tokens.

The global panel's question 20 was resolved by [0044](0044-v1-profile-set.md): no mods in v1.
