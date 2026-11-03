---
status: accepted
date: 2026-10-26
tags: [principles, hooks, deny, mcp, agents-md]
origin: dotai 0018
---

# 0014 · Base principles: scripts, hooks and deny

## Context

The pattern appears in all four profiles and in the audit ([DESIGN §2](../DESIGN.md#2-cross-cutting-principles), cross-cutting principles).

## Decision

Scripts/CLI before MCP; verification hooks with a cap and `timeout`; `permissions.deny` for artifacts; a short `AGENTS.md` without large mandatory reads; one fresh review on demand; policies in config and hooks. These are requirements for every profile.

## Considered options

The sources do not record rejected alternatives as formal options. DESIGN §2 contrasts each principle with the previous practice: MCP by default (because of schema cost), instructions in the chat (they were not followed), long context files (they raise cost by more than 20% without improving success).

## Consequences

- Principles P1–P8 of DESIGN §2 are requirements for every profile.

## Evidence

- Internal research (not published): web, Godot, desktop and tooling profiles.
- Internal research (not published): workflow alternatives.

## Update 2026-10-31: artifacts guarded by size

`permissions.deny` now covers secrets only. Artifacts are guarded by a size-based `Read` hook ([0039](0039-artifact-reads-guarded-by-size.md)).
