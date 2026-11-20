---
status: accepted
date: 2026-10-26
tags: [cost, context, budget]
origin: dotai 0012 (pack half)
---

# 0008 · Always-on budget values

The engine half (a pack declares the caps; `dotai doctor` measures them) is [dotai 0007](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0007-always-on-context-budget.md).

## Context

Today the prefix is ~16–20k tokens per request (plus ~13k in agy) and it is repeated in every subagent.

## Decision

The Claude Code base has a cap of 3,200 always-on tokens (target 2,500) and the agy base a cap of 1,500. Each profile declares its fixed cost (`web` ~1.1k, `godot` 1–3k, `tooling` ≤0.7k, `desktop` ≤0.5k). `dotai doctor` measures and fails if the cap is exceeded.

## Considered options

The sources do not record rejected alternatives.

## Consequences

- Subagents pay the same prefix, so the savings multiply.

## Evidence

- Internal research (not published): discovery of harness capabilities.
- Internal research (not published): component catalog, §1.
- [DESIGN §3](../DESIGN.md#3-global-base)

## Update 2026-10-26: accepted

Accepted by the author. The caps are a starting point: re-check them against the real first-request cost once the base is assembled (OPEN-QUESTIONS, measurement 2); changing them then needs a new record.

## Update 2026-10-26: what the cap measures

Measured (OPEN-QUESTIONS, measurement 2): the Claude Code harness itself adds ~23k tokens (system prompt and built-in tools) that no pack controls. The caps apply only to what the pack adds on top: rules, output style, skill and agent listings, MCP instructions and hook injections. The current pre-pack global config adds ~24k, so the base must be built far leaner than it.

## Update 2026-11-02: measurement 2 on the assembled base

Measured with Claude Code (`claude -p`, Haiku) against an empty config (bare first request 30,938 tokens): the base adds **+1,759 tokens**, 55% of the 3,200 cap; base plus `godot` +2,331; base plus eight profiles +4,977. The real cost is about **1.7× the static estimate** (characters / 4 of the rendered files): the static base is 1,048 (core rule 831, skill listing 113, agent listing 104). Static profile costs: `godot` 291, `tooling` 284, `desktop` 259, `video` 244, `web` 204, `cloudflare` 197, `ui` 107, `obra` 42, `seo` 0.

The caps stand. Consequences:

- **Claude Code:** about three rule-carrying profiles per project fit under the cap. Onboarding (`dotai-analyze`) warns when a suggested combination exceeds it.
- **agy:** the base is estimated at ~1,800 tokens, over agy's 1,500 cap. Trimming `core.md` for agy (an agy-only variant of the rule or a shorter shared one) is a pending task ([DESIGN §3](../DESIGN.md#3-global-base)), not done yet.
- agy's first request is now 31.8k tokens with the current global config (15.8k on 2026-10-26); that is the user's config, not the pack's.

## Update 2026-11-02: agy measured, one cap for both harnesses

Measured in agy 1.4.12 (`-p "hi"`, scratch `--gemini_dir`, staged base): bare 7,226 input tokens; base +1,630 (1.55× the static count); base plus `godot` +2,300. agy's own floor is ~7.2k; the 31.8k seen before is mostly the user's global config (~24.6k).

The 1,500 agy cap is replaced by the Claude Code cap: **3,200 always-on tokens in both harnesses** (author, 2026-11-02). The 1,500 figure dated from when `GEMINI.md` added ~13k tokens and had no measurement behind it; agy quota is not a constraint for the author, and agy is used little. The pending task to trim `core.md` for agy is dropped. The same "about three rule-carrying profiles" limit applies in agy.

## Update 2026-11-03: renamed

The profile `obra` is now `autonomous-orchestra` (author, 2026-11-03; see [0044](0044-v1-profile-set.md)). The text above keeps the old name.

## Update 2026-11-03: cap values replaced

The single 3,200 cap above is replaced by split caps in both harnesses: rules ≤ 2,500 real, listing ≤ ~2,000 real (≤ ~100 per entry), total warn at 4,000 and fail at 5,000 ([0046](0046-split-always-on-budget.md), which partially supersedes this record). The measured factor is now ~2.0× static per added profile in Claude Code, not 1.7×. The rest of this record (what the cap measures, `dotai doctor` checks it) stands.
