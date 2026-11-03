---
status: accepted
date: 2026-11-01
tags: [memory, engram, hooks, cost, base]
---

# 0041 · Engram through its CLI and hooks, not an always-loaded MCP

## Context

[0005](0005-engram-as-memory-backend.md) keeps Engram as the memory backend. Today it costs about 1.9k tokens per session: the MCP instructions (~1.2k) and the SessionStart protocol (~0.7k), measured in OPEN-QUESTIONS measurement 2.

Usage from 2026-09 to 2026-10 (internal research, not published):

| Call | Count |
|---|---|
| `mem_save` | 1,093 |
| `mem_judge` | 140 |
| `mem_session_summary` | 127 |
| `mem_search`, `mem_context` and `mem_get_observation` | 180 |

Use is write-heavy, and many saves are forced by the "save proactively" rule.

Engram from v1.20 to v3.6 (releases, checked 2026-11-01):
- The CLI has `save`, `search` and `context`. It has no `--topic-key` and no summary command.
- Conflict detection and topic-key upserts are MCP-only.
- Agy and OpenCode 2.x are supported.
- A major version ships about every two weeks, each with breaking changes.
- The Windows write bugs #1937, #1949 and #2016 are still open on v3.6.

## Decision

- **No Engram MCP in the base.** A `memory` skill (~50 tokens listed) uses the CLI: it searches before saving to avoid duplicates, then runs `engram save`. It also uses `engram search`.
- **Hooks do the protocol.**
  - `SessionStart` injects `engram context`, capped at ~300 tokens.
  - `Stop` or `PreCompact` saves the session summary. The model runs no ritual.
- **The same CLI serves every harness** (Claude Code, agy, OpenCode), so no MCP is configured per harness.
- **The Engram version is pinned.** It is upgraded only after a smoke test on Windows (save, search, context).
- **Consequence for the engine:** Engram needs no plugin packaging, only a binary dependency, a skill and hooks. This drops the Engram part of engine question 3.

## Considered options

- **A (chosen):** CLI, a skill and hooks.
- **B:** keep the MCP, with `--tools=agent` and `--protocol=slim`. Rejected: an always-on cost for a write-heavy use, and coupled to the fast-changing MCP surface.
- **C:** upgrade to v3.6 and keep the current setup. Rejected: same cost, and the Windows bugs are not fixed.

## Consequences

- Good: about 1.9k tokens saved per session; one integration for every harness; a small surface (`save`, `search`, `context`) exposed to breaking changes.
- Accepted cost: no topic-key upserts, no conflict judge, no version history.
- Pending:
  - Measurement 3 (coverage against native `MEMORY.md`) still decides whether Engram stays.

## Evidence

- Engram releases: https://github.com/Gentleman-Programming/engram/releases (v2.0.0, v3.0.0, v3.5.1, v3.6.0).
- Engram issues #1937, #1949 and #2016.
- Usage and cost measurements, 2026-10-26 and 2026-11-01 (internal research, not published).

## Update 2026-11-01: installed binary

Only one Engram binary is installed: v1.20.0, built 2026-07-24. Its module path has no `/v2`, so it is a real v1. It already contains `mem_judge`, so the claim that `mem_judge` arrived in v2 was wrong.

## Update 2026-11-01: save policy

[0042](0042-memory-save-policy.md) refines what is saved and when, and what `SessionStart` injects: preferences and pinned items, not recent context. The session summary moves to `PreCompact` only.

## Update 2026-11-02: the CLI has topic upserts

Checked against engram v1.20.0 on a scratch store: `engram save --topic <family>/<slug>` replaces the earlier observation with the same topic, project and scope. The statements above about no topic-key upserts are wrong for this version; conflict detection and the judge remain MCP-only. The `memory` skill uses `--project global --scope personal --topic <family>/<slug>`.
