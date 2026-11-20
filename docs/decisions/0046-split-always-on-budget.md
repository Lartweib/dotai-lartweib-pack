---
status: accepted
date: 2026-11-03
tags: [cost, context, budget]
supersedes: []
---

# 0046 · Split always-on budget: rules, listing, total

## Context

[0008](0008-always-on-budget-values.md) set one always-on cap, 3,200 real tokens in Claude Code and agy. A measurement of real profile sets (2026-11-03) showed that one number mixes two costs with different risks:

- **Rules** (base and profile rules) are read as instructions: past a few thousand tokens, adherence drops (instruction dilution).
- **Listing** (skill and agent descriptions) is read only to pick a skill or agent; Claude Code has its own listing budget.

Measured factor: real cost is about **2.0× the static estimate** (characters / 4) per added profile in Claude Code (`godot` 1.97×, all eight profiles 1.98×); the base adds +1,759 real; agy's base is 1.55×. Installed external skills and agents that a profile expects count too (`ui`: impeccable 227 + its agent 34 + `web-design-guidelines` 52 static; `seo`: 9 skills 742 + 7 agents 298 static). Real per profile set: `web` + `ui` + `cloudflare` + `video` ~3,840, ~5,900 with `seo`; the other sets measured 2,270–3,115.

Cost: 2k extra tokens cost about $0.52/day on Opus 5.5 with caching, ~6.5% of the cost of the 30.9k bare floor. Quality is the binding reason, not price.

This record partially supersedes 0008: its cap values only. 0008's other content (what the cap measures, `dotai doctor` checks it) stands.

## Decision

Three limits replace the single cap, in both Claude Code and agy, all in real tokens:

1. **Rules cap:** base rules plus profile rules ≤ 2,500.
2. **Listing cap:** skill plus agent descriptions ≤ ~2,000, and ≤ ~100 per entry (about 200 characters).
3. **Total:** warn at 4,000, fail at 5,000.

Externals a profile expects count toward its listing. Onboarding (`dotai-analyze`) sums rules and listing separately and warns per cap and at 4,000 total.

## Considered options

- **A (chosen):** split caps plus a total.
- **B:** keep one cap of 3,200: rejected because it blocks listing-heavy sets that do not dilute the rules (`web` + `ui` + `cloudflare` + `video` at ~3,840) and does not catch a long rule set under the total.
- **C:** raise the single cap: rejected for the same reason (inferred from the author's framing).

## Consequences

- Good: the cap that matters for adherence (rules) is explicit; listing growth is bounded by the harness's own limit.
- Accepted cost: a project with `web`, `cloudflare` and `video` sits at the rules cap (base ~1,400 real plus those profiles ~1,100); a new rule there must trim another.
- Over the per-entry limit today: `lartweib-taste` (224 characters, ~112 real); `browser-tooling` and `video-frames` are at it (~100). External descriptions over it (impeccable's skill) are flagged, not edited.
- `seo` is listing-heavy (~2,080 real alone). Claude Code's `skillOverrides: "name-only"` cuts its skills to ~30 static, but its agents stay; it is applied for an audit and removed afterwards ([profiles/seo/README.md](../../profiles/seo/README.md)).
- Engine state (answer, 2026-11-03): no budget check exists ([dotai 0007](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0007-always-on-context-budget.md) is proposed, with no way yet for a pack to declare caps), so `dotai-analyze` stays the only check; frontmatter `dotai: { capabilities }` is parsed but no doctor code reads it, so expected externals stay in each profile README; `claudecode.skillOverrides` is replaced whole by the last layer (only `env` merges per key), so two profiles setting it are a `profile-conflict` ([PACK-FORMAT](https://github.com/Lartweib/dotai/blob/main/docs/PACK-FORMAT.md#settings)). All three are engine work after v1.

## Evidence

- Analysis script and per-profile-set measurement, 2026-11-03 (internal research, not published).
- Claude Code memory docs: keep `CLAUDE.md` under 200 lines; longer files reduce adherence (https://code.claude.com/docs/en/memory).
- Claude Code skills docs: the listing budget scales at 1% of the context window and drops descriptions on overflow; an entry is truncated at 1,536 characters; `skillOverrides` `"name-only"` lists a skill without its description (https://code.claude.com/docs/en/skills, "Skill descriptions are cut short").
- IFScale, instruction-following at scale (https://arxiv.org/abs/2507.11538).
- Chroma, Context Rot (https://research.trychroma.com/context-rot).
