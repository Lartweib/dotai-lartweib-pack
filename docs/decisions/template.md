---
status: proposed        # proposed | accepted | rejected | superseded | deprecated
date: YYYY-MM-DD
tags: [tag-1, tag-2]
supersedes: []          # optional. Example: [0001]
superseded-by:          # optional. Example: 0023
---

# NNNN · Short title of the decision

<!--
Template based on MADR 4.0.0, in English. Rules:
- An `accepted` record is not rewritten. If its meaning changes, a new record is created with `supersedes` and the old one becomes `superseded`.
- If only a factual detail changes (without changing the decision), an "Update YYYY-MM-DD:" note is appended at the end and git serves as the changelog.
- Write only from what was said in the conversation or is evident in the diff. Anything reconstructed that the author did not say is marked `(inferred)`. Never invent reasons.
- Target: 150-400 words. More than 800 is a sign the record should be split.
- Sequential numbering, never reused.
-->

## Context

What problem or situation forces a decision, and what evidence exists. Include the answer to an open question if this decision resolves it.

## Decision

What is decided, stated affirmatively ("X will be done").

## Considered options

- **A (chosen):** short description.
- **B:** rejected because ...
- **C:** rejected because ...

If the sources do not record alternatives, say so explicitly. Any reconstruction is marked `(inferred)`.

## Consequences

- Good: ...
- Bad or accepted cost: ...
- Pending: ...

## Evidence

- Links to research, measurements or sources (relative paths, for example `../ARCHITECTURE.md`, or external URLs).
