---
name: spec
description: "Write a self-contained SPEC.md for a large feature or a per-change spec for high-risk work."
metadata:
  author: Federico Ara
---

# spec

Pick the mode by whether milestones can be verified, not by size.

- Large feature: interview the user, then write `SPEC.md` at the repo root (one active at a time). One new session per milestone.
- High risk: write a delta spec at `docs/specs/<yyyy-mm-dd>-<slug>.md`, then fresh review per milestone (`reviewer`, or `judge` for taste).

Sections, in order (≤150 lines; delta ≤80):

1. Goal: the user-visible outcome, one paragraph.
2. Non-goals.
3. Constraints: locked decisions; do not re-ask.
4. Context: entry files and commands.
5. Milestones: `M<n>`: criterion, command, files. A delta adds before/after and rollback.
6. End-to-end check: one command proving the goal, not the parts.
7. Open decisions: each with the default taken.

The spec states intent; progress lives in `STATUS.md` (current milestone, last command result) and `HANDOFF.md`. Update both when a milestone closes; edit the spec only to resolve an open decision.

Cap: one scoped correction per milestone, then escalate to the user.
