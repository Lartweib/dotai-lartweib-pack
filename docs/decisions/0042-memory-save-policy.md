---
status: accepted
date: 2026-11-01
tags: [memory, engram, hooks, base]
---

# 0042 · Memory save policy: Engram for the long term, `MEMORY.md` per project

## Context

Measurement 3 (2026-11-01, internal research, not published) checked the Engram store against native memory.

- **What is saved:** in a sample of observations, about 40% were redundant with the repository, about 30% were per-repo facts that fit `MEMORY.md`, one was user-level and the rest were noise. Typed preferences and feedback are about 1% of the store; session summaries are about a ninth of it.
- **How it is used:** saves outnumber reads about eight to one. 57% of searches were empty, and only 3.2% of the store was ever retrieved. When something was retrieved, it was almost always used.
- **Reliability:** no real write failure on Windows in regular use.

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
