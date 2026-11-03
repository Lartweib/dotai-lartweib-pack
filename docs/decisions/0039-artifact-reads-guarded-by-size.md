---
status: accepted
date: 2026-10-31
tags: [hooks, permissions, cost, base]
supersedes: []
---

# 0039 · Artifact reads are guarded by size, not denied

## Context

[0014](0014-base-principles-scripts-hooks-deny.md) put build artifacts in `permissions.deny` (principle P3): `node_modules`, `dist`, `target`, lockfiles, logs and Lighthouse JSON. The reason is cost: one accidental full read of a lockfile costs 24–75k tokens, and nine Lighthouse JSON files cost about 1M.

Reviewing it with the author, some reads in those paths are legitimate: a library's source or `.d.ts` while debugging, the installed version, or checking that a build produced what it should. In Claude Code `deny` takes precedence over `allow`, so exceptions cannot be carved out. The real problem is size, not path.

This record partially supersedes 0014: P3 now applies to secrets only.

## Decision

- **Secrets stay in `permissions.deny`**, with no exceptions. The list is in [DESIGN.md](../DESIGN.md) (base table), and Bash enforces it too ([0038](0038-base-bash-guards-ask-and-deny.md)).
- **Artifacts leave `deny`.** A `PreToolUse` hook on `Read` covers the artifact paths:
  - It allows small files and partial reads (`offset`/`limit`).
  - It rejects a full read of a large file. The rejection tells the agent to read a range, use `rg` or use the tool's own command (`npm ls`, for example).
  - The size threshold is part of the hook configuration and is set when the hook is built.
- Profiles add their own artifact paths to the hook (`.next`, `.astro`, `.godot`, `*.asar`…), not to `deny`.

## Considered options

- **A (chosen):** secrets denied, artifacts guarded by size.
- **B:** keep artifacts in `deny`. Rejected: it blocks legitimate reads and allows no exceptions.
- **C:** move artifacts to `permissions.ask`. Rejected: nobody answers the prompt in headless or background runs, and it interrupts the author for a small file.

## Consequences

- Good: targeted reads work, and accidental full reads of large files are still blocked.
- Accepted cost: one more hook to build and test. A Bash `cat` of a large artifact is not covered by this hook.
- Pending: pick the threshold; decide whether the Bash guard also caps output for artifact paths.

## Evidence

- Review with the author, 2026-10-31.
- P3 row in [DESIGN.md](../DESIGN.md) (token costs from internal research, not published).
