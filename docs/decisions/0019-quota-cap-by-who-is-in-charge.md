---
status: accepted
date: 2026-10-23
tags: [quota, cost, autonomous]
origin: dotai 0023
---

# 0019 · Quota cap by who is in charge

## Context

It resolves open question P-04 (hard quota cap per profile, not modifiable from the chat?). With the maintainer present, deliberately squeezing the quota is a valid decision. Without supervision, a loop can consume the entire weekly quota. It matches [0002](0002-built-in-cost-policy.md) ("quota is a safety brake, never a target") and the `quota-stop-hard` memory from a Godot game project.

## Decision

- **Interactive session: soft cap.** When the threshold is reached, the agent warns and asks before continuing. Quota is visible in the statusline and in the panel.
- **Work marked as autonomous** (overnight queues, `/goal`, workflows): **hard cap.** When the threshold is reached, work stops, state is saved and a report is produced. The threshold is defined per profile and can only be changed by editing the configuration, never from the chat.

## Considered options

- **A (chosen):** soft in interactive mode, hard in autonomous mode.
- **B:** always a hard cap (the original wording of P-04). Rejected: with the maintainer present, deliberately squeezing the quota is a valid decision.
- **C:** always a soft cap. Rejected: without supervision, a loop can consume the entire weekly quota.

## Consequences

- Supersedes P-04.

## Evidence

- The `quota-stop-hard` memory from a Godot game project; the author's own usage audit (internal research, not published).

## Update 2026-10-28

"Defined per profile" is partially superseded by [0034](0034-delegate-packaging-base-tool-variant-runners.md): the threshold is configuration of the base `delegate` tool at user scope. The soft and hard caps, and "never from the chat", stand.
