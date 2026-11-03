---
status: accepted
date: 2026-10-20
tags: [review-web, approval, overnight-queue]
origin: dotai 0020
---

# 0016 · `review-web` approval depends on the type of criterion

## Context

It resolves open question P-03 (does web approval block the merge or only warn?). Blocking gives a guarantee, but in the overnight queue it can stall the backlog. Taste can only be judged by the maintainer; correctness already has automatic verification.

## Decision

Matters of taste (game feel, visual design) block the merge until human approval. Matters of correctness (tests, lint, verifier) only warn, because they already have an automatic gate. In the overnight queue, a blocked item is skipped and the queue moves on to the next one.

## Considered options

- **A (chosen):** block matters of taste, warn on matters of correctness, skip in the overnight queue.
- **B:** always block. Rejected: in the overnight queue it can stall the backlog; skipping prevents one item from stopping the queue.
- **C:** always only warn. Rejected for matters of taste: only the maintainer can judge them, so they need the maintainer's approval.

## Consequences

- Supersedes P-03.
- The question of whether a `proposed` ADR blocks in `review-web` is open (see [OPEN-QUESTIONS](../OPEN-QUESTIONS.md)).

## Evidence

- Internal research (not published): harness discovery.

## Update (2026-10-24)

With [0027](0027-review-rounds-preset-in-the-tracker.md), review cards live in an external tracker. These rules still apply as rules of its `review-rounds` preset.
