---
status: accepted
date: 2026-10-20
tags: [browser, playwright, agent-browser, skills]
origin: dotai 0015
---

# 0011 · Browser tooling split

## Context

agent-browser's "82–93% fewer tokens" figure could not be verified, and it compares against the MCP, not against a script. The global "NEVER Playwright" rule breaks a language-learning project and two web projects.

## Decision

agent-browser for interactive exploration; Playwright scripts (or `@playwright/test`) for anything repeatable, bulk or measured. No Playwright MCP by default. The "NEVER Playwright" rule is replaced by the `browser-tooling` skill.

## Considered options

- **A (chosen):** split between agent-browser (exploration) and Playwright scripts (repeatable, bulk or measured).
- **B:** global "NEVER Playwright" rule. Rejected because it breaks a language-learning project and two web projects.
- **C:** Playwright MCP by default. Rejected: principle of scripts/CLI before MCP ([0014](0014-base-principles-scripts-hooks-deny.md)).
- **D:** agent-browser for everything, based on the "82–93% fewer tokens" figure. Rejected because the figure could not be verified.

## Consequences

- Pending: measure the 10-step flow with agent-browser, playwright-cli and MCP (see [OPEN-QUESTIONS](../OPEN-QUESTIONS.md)).

## Evidence

- Internal research (not published): browser tooling.
- A draft of the `browser-tooling` skill exists; it will live in the reference pack, not in this repository (see [dotai 0015](../../../dotai/docs/decisions/0015-pack-in-its-own-repository.md)).

## Update 2026-11-19: accepted

Measurement 8 ([0044](0044-v1-profile-set.md), update 2026-11-02) ran the 10-step flow: agent-browser `-i` produced ~290 tokens of output, playwright-cli ~975, and the Playwright MCP schema costs ~5.3k tokens per session. The split stands as decided, with no Playwright MCP; agent-browser 0.38.0 or later is required (`snapshot --delta`, `screenshot --if-changed`), and the `ui` profile pins 0.41.2, the version the trials ran on. The record moves from `proposed` to `accepted`.
