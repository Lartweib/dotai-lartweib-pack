---
status: accepted
date: 2026-10-23
tags: [orca, fork, integration]
origin: dotai 0025
---

# 0021 · Orca: extend, don't fork

## Context

The author wants to be able to adapt things discovered along the way without being tied to maintaining a fork. Data on the `stablyai/orca` repo was queried on 2026-10-23 with `gh api`. The scope depends on the experiment [0022](0022-delegate-visible-orca-backend.md).

## Decision

Orca is not forked (neither desktop nor mobile). When a concrete need arises, it climbs this ladder, moving to the next step only if the previous one is not enough:

1. Configuration and skills (`orca.yaml`, hooks, automations).
2. External integration: dotai or scripts that talk to the `orca` CLI.
3. Upstream issue or PR.
4. A minimal, isolated patch on top of a stable version, never a full fork.

If 0022 succeeds, Orca covers the interface (agent visibility, quotas, access from the phone) and dotai focuses on what Orca does not do: configuration, cost policy, `delegate`, profiles, onboarding and `review-web`. See layer 3 (panel).

## Considered options

- **A (chosen):** extend via the four-step ladder.
- **B:** full fork. Rejected: ~1,600 commits per week, 497 contributors, ~210 MB of TypeScript. Freezing loses features and security fixes; rebasing is permanent maintenance of someone else's code.
- **C:** own mobile app. Rejected: it requires an Apple developer account, own push keys and an own relay (Orca's relay deployment lives in a private repo).

## Consequences

- Pending: read the relay security review (`cloud/docs/relay-security-2026-10-21.md`) to learn whether terminal output travels end-to-end encrypted.

## Evidence

- Repo `stablyai/orca`, queried on 2026-10-23 with `gh api`.
