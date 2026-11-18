---
status: accepted
date: 2026-10-20
tags: [memory, codegraph, engram, measurement]
origin: dotai 0016
---

# 0012 · Memory and code intelligence: keep and measure

## Context

The cost lies in the always-on protocol and in an incomplete configuration, not in storage. There is no independent study of savings. Complements [0005](0005-engram-as-memory-backend.md).

## Decision

Engram stays as the backend, with saving via hooks and bounded injection; native memory for per-repo conventions. codegraph is registered per project and piloted only in a single web project, with an A/B measured in tokens and correctness. Godot projects are not indexed.

## Considered options

- **A (chosen):** keep Engram, codegraph per project and only in a measured pilot.
- **B:** remove codegraph. Rejected: the maintainer's supported hypothesis is that it is poorly integrated, not useless (only for TS/web).
- **C:** expand codegraph. Rejected: there is no independent evidence of savings (vendor: −62% tokens; a preprint measured quality at 83% versus 92%).
- **D:** global codegraph registration. Rejected: it costs ~1.1k tokens in projects without an index and in ~80 worktrees; registration goes at the project level.
- **E:** index Godot. Rejected: codegraph does not support GDScript; Serena requires an open editor, which conflicts with "no editor" and with agy.

## Consequences

- Correct codegraph configuration: upgrade 0.9.8 → 1.6.2, `codegraph install`, `codegraph init -i` per project.
- Conditional usage rule ("to trace flows across more than 3 files"), not "NEVER grep".
- Pending: the list of measurements is in [DESIGN §5](../DESIGN.md#5-memory-and-code-intelligence) (memory and code intelligence) and in [OPEN-QUESTIONS](../OPEN-QUESTIONS.md).

## Evidence

- Internal research (not published): memory and code intelligence.

## Update 2026-11-02: measurement 4

The codegraph A/B ran on a copy of the main web project (426 TypeScript, Astro and JavaScript files; codegraph 1.6.2, indexed in 9 s, 8,268 nodes), with `claude -p` on Sonnet, 11 runs scored on a blind rubric.

| Median, direct runs | Without | With codegraph | Change |
|---|---|---|---|
| Tokens | 168k | 157k | −6% |
| Tool calls | 8 | 5 | −37% |
| Time | 47 s | 33 s | −30% |
| Cost | $0.149 | $0.144 | −3% |
| Score (mean, of 10) | 9.9 | 9.2 | |

All three factual errors of the trial came from codegraph runs (a same-named constant in another file; an invented caller). One delegated pair (a Sonnet subagent): −31% tokens, −7% cost, the same score; the subagent used codegraph because of the `CLAUDE.md` section `codegraph install` writes. Fixed cost: 1.1–1.8k tokens per session. Caveats: 1–2 runs per cell, ~25% variance on one question, Sonnet only.

**Result:** codegraph does not go into `web` or `tooling` by default. It stays an opt-in, per-project pilot, only for large TypeScript, Go or Python repos (roughly more than 2k files, where a question takes 15 or more tool calls without it). When subagents work in that project, the `codegraph install` section is required. The profile READMEs carry the manual registration.

## Update 2026-11-19: accepted

With measurement 4 done (update above), the decision stands: Engram stays as the backend, and codegraph stays a per-project, opt-in pilot, now scoped by the result to large TypeScript, Go or Python repos rather than to a single web project. The record moves from `proposed` to `accepted`.
