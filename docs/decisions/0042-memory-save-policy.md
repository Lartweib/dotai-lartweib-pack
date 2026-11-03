---
status: accepted
date: 2026-11-01
tags: [memory, engram, hooks, base]
---

# 0042 · Memory save policy: Engram for the long term, `MEMORY.md` per project

## Context

Measurement 3 (2026-11-01, internal research, not published) checked the Engram store against native memory.

- **What is saved:** in a sample of 25 observations, 10 were redundant with the repository, 7 were per-repo facts that fit `MEMORY.md`, 1 was user-level and 7 were noise. Typed preferences and feedback are 1.3% of the store; session summaries are 406 of 3,541.
- **How it is used:** 852 saves against 104 reads. 57% of searches were empty, and only 3.2% of the store was ever retrieved. When something was retrieved, it was used (12 of 15).
- **Reliability:** no real write failure on Windows in 936 saves.

The author keeps Engram as long-term memory. The problem is what gets saved and when, not the backend. This record resolves OPEN-QUESTIONS measurement 3 and refines [0041](0041-engram-via-cli-and-hooks.md).

## Decision

- **Engram holds what serves across projects:**
  - the author's preferences and feedback;
  - non-obvious gotchas about tools and the environment;
  - cross-project conventions.
- **Native `MEMORY.md` holds per-project facts** that are not in the repository.
- **Nothing is saved when:**
  - the repository already records it, in an ADR, a commit or the docs;
  - it is a generic session summary.
- **When to save:** when a decision closes or something non-obvious is found, not after every step. Before saving, the `memory` skill checks whether the repository already records it.
- **Session summary:** written only in `PreCompact`, so it survives compaction. It is not written at every session end.
- **Injected at `SessionStart`** (within the ~300-token cap of 0041): the author's preferences and the project's pinned items, not the most recent observations.

## Considered options

- **A (chosen):** keep Engram for the long term, with a save policy.
- **B:** make Engram optional, with native memory as the default. Rejected by the author, who wants a long-term memory beyond `MEMORY.md`.
- **C:** keep saving everything proactively. Rejected: about 70% has little value.

## Consequences

- Good: less noise and more useful recall; fewer writes.
- Accepted cost: some useful facts may go unsaved; the existing store keeps its noise until it is cleaned.
- Pending: decide whether to clean the existing store; fix or work around the export/import failure caused by 3 orphan rows before relying on it for backups.

## Evidence

- Measurement 3, 2026-11-01 (internal research, not published).
- Review with the author, 2026-11-01.
