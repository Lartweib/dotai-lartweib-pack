---
status: accepted
date: 2026-10-20
tags: [statusline, base, quota]
origin: dotai 0021
---

# 0017 · Statusline in the base

## Context

The sources do not record an explicit reason. Available fact: agy's current statusline already uses a quota source.

## Decision

The base installs a statusline with a clean, clear design, in Claude Code and in agy, with the same visual language in both. The quota source that agy's current statusline already uses is reused.

## Considered options

The sources do not record rejected alternatives.

## Consequences

- Quota is visible in the statusline and in the panel ([0019](0019-quota-cap-by-who-is-in-charge.md)).

## Evidence

- Decision made in conversation on 2026-10-20.

## Update 2026-10-31: three-line layout

Confirmed with the author. The Claude Code statusline shows three aligned lines, with the 5 h and weekly columns one under the other:

```
CC      5h 41% ↻ 2h 13m   │ sem 22% ↻ 3d 4h 10m   │ Opus · ctx 34% · ⟳2
agy     5h  8% ↻ 4h 2m    │ sem  5% ↻ 6d 1h 0m    │ flash
agy 3p  5h  0% ↻ 5h 0m    │ sem  0% ↻ 6d 1h 0m    │ updated 2h ago
```

- Countdown to each window reset in `Xd Xh Xm`, omitting zero leading units.
- Claude Code receives `rate_limits.five_hour` / `seven_day` with `used_percentage` and `resets_at` on stdin.
- agy data comes from the snapshot its own statusline writes. That snapshot must also store each pool reset as an absolute time; the current script drops it. A stale snapshot shows `?` and its age, in line with unknown = available ([0022](0022-delegate-visible-orca-backend.md)).

## Update 2026-11-21: redesign

After the real install, the author asked for a cleaner line. The three rows are now `Claude`, `Gemini` (agy's own pool) and `Others` (agy's third-party pool). Each window shows an 8-cell bar, its percentage and a reset of at most two units (`5d 20h`, `4h 2m`); `wk` becomes `7d`. Bars and percentages keep the thresholds: green, yellow from 50%, red from 80%. Two cases that both showed `?` are now apart: `—` in green is a window the harness does not report for the plan (Claude Code sends only `seven_day` on some plans), and `···` in gray is no data yet. A stale snapshot keeps its values, dimmed, and shows its age in the last column. Columns stay fixed-width, and `NO_COLOR` keeps every mark without color.
