---
status: accepted
date: 2026-10-19
tags: [memory, engram]
origin: dotai 0008
---

# 0005 · Memory: engram as the backend, without cloning it (for now)

## Context

Engram is the only verified option with a shared store between Claude Code ↔ agy without an extra process (saves outnumber searches about ten to one). The cost lies in the always-on protocol, not in storage ([0012](0012-memory-and-code-intelligence-keep-and-measure.md) complements this).

## Decision

- **Phase 0:** keep engram. Move saving out of the instructions into hooks (Stop / SessionEnd / PreCompact) and inject with a 1–2k token cap at SessionStart. Compare against Claude Code's native memory.
- **Phase 1:** build an own memory only if Phase 0 shows measured gaps.

Candidate improvements if Phase 1 is reached: Markdown as the source and SQLite as a derived index; project identified by the git remote; typed supersession; conflicts resolved in batch from the review module; an evaluation set with 30–50 real questions.

Honest estimate for Phase 1: 4 to 8 weeks part-time.

## Considered options

- **A (chosen):** Phase 0 with engram, own Phase 1 only if there are measured gaps.
- **B:** build an own memory now. Rejected for now: it is only justified by measured gaps and costs 4 to 8 weeks part-time.
- **C:** claude-mem and mem0. Not adopted (per DESIGN §5); the recorded reason for claude-mem is that its ingestion uses its own LLM and consumes quota. For mem0 the sources do not record a reason. basic-memory only if Phase 1 is reached and AGPL is accepted.

## Consequences

- Split: native memory for per-repo conventions; Engram only for decisions and bugs that must cross over to agy.
- Open risks of Engram: Windows (#1937, #1912) and the 10:1 write/read ratio.

## Evidence

- Internal research (not published): memory and code intelligence.
- [DESIGN §5](../DESIGN.md#5-memory-and-code-intelligence)
