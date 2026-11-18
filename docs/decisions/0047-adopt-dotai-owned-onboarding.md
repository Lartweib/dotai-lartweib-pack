---
status: accepted
date: 2026-11-18
tags: [onboarding, profiles, skills, hooks, manifest]
supersedes: []
---

# 0047 · Adopt dotai's project onboarding; the pack keeps only the clash cleanup

## Context

[0040](0040-project-onboarding-and-on-demand-profiles.md) made project onboarding the pack's job: `session-start.mjs` suggested `dotai-analyze` while a project had neither `.dotai/state.json` nor the pack's done marker `.dotai/packs/dotai-lartweib-pack/onboarded.json`; `dotai-analyze` detected the stack, proposed and applied profiles, cleaned clashes and wrote the marker; a catalog line in the core rules listed the profiles for on-demand suggestions.

The engine now owns onboarding ([dotai 0045](../../../dotai/docs/decisions/0045-dotai-owned-project-onboarding.md)). `dotai install` generates the `dotai-profiles` skill from each profile's `description` and `hints` and a `SessionStart` hook, `dotai onboarding hook --harness <id>`, that prints one line while the repository is neither set up nor dismissed, or when its fingerprint changed. Keeping both onboardings would ask twice and drift.

## Decision

The pack uses dotai's onboarding (author, 2026-11-18) and keeps only what the engine does not do:

- `dotai-analyze` is only the clash cleanup: old rules, same-name skills and agents, duplicate hooks, user plugins duplicating a profile, outdated CLIs, the always-on budget of the applied set, and the backup before any change. It no longer chooses or applies profiles, has no sync mode and writes no marker; it points to `dotai-profiles`. Its name stays: dotai's `onboarding-duplicate` matches only a subagent named `onboarding`, and `onboarding-name-reserved` only an item named `dotai-profiles`.
- `session-start.mjs` keeps the Engram preferences and the memory notice; the onboarding hint and the done marker are removed.
- The core rules drop the profile catalog; one line remains: load `dotai-profiles` when a task needs a profile the project lacks.
- Profile `description` and `hints` in `dotai.yaml` are written for the skill: hints are `path.Match` globs over tracked repository-relative paths, so `node_modules/...` hints are removed and the dependency goes in the description; profiles without hints say when to suggest them.

## Considered options

- **A (chosen):** dotai's onboarding, the pack's cleanup skill beside it.
- **B:** keep the pack's onboarding as `onboarding.custom`. Rejected: dotai's skill is regenerated from the manifest, the hook adds a drift check, and a custom item is at the pack author's own risk (`onboarding-replaced`).
- **C:** keep both. Rejected: two prompts at session start, and the duplicated procedure drifts.

## Consequences

- Good: one onboarding prompt; profile knowledge lives once, in the manifest.
- Accepted cost: the default workflow level per stack (DESIGN §6) is no longer said at onboarding.
- Accepted cost: the cleanup runs only when the agent or the user calls it after an apply; nothing prompts it.
- Partially supersedes 0040: the pack's onboarding hook, the done marker and the catalog line. Its backup and clash cleanup, and the advice after a mid-session apply, stand.

## Evidence

- [dotai 0045](../../../dotai/docs/decisions/0045-dotai-owned-project-onboarding.md), [PACK-FORMAT, Onboarding](../../../dotai/docs/PACK-FORMAT.md#onboarding), `internal/pack/onboarding.go` (engine `origin/main` bd65f3a).
- `dotai validate` and `dotai stage` on this pack, 2026-11-18.
