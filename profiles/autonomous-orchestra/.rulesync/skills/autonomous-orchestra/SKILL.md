---
name: autonomous-orchestra
description: "Run long autonomous work at scale: worktree lanes, batch integration, scheduled runs, monitors. Use after the autonomous skill has set the criterion and caps."
metadata:
  author: Federico Ara
---

# autonomous-orchestra

`autonomous` decides what done means, the caps and the verifier. `autonomous-orchestra` is how a long run executes once that is set. Never start here without a success criterion and caps.

## Lanes

- One lane per independent item: `node ${DOTAI_PROJECT_TOOLS}/orchestra-lanes.mjs new <area>/<id>` (worktree `.claude/worktrees/<id>`, branch `<area>/<id>`, e.g. `combat/dash`). Ids are disjoint: two lanes never own the same files. Write each lane's file scope in the work list before starting it.
- Each worktree is a separate project for dotai: `new` prints the `dotai apply` that gives it the main checkout's profiles; `--apply` runs it when `dotai` is on PATH. Do it before the lane's worker starts.
- A lane runs its scoped checks only, never the full suite.
- One worker per lane, in its own fresh context, with the item, its file scope and its check.
- `orchestra-lanes.mjs list` gives one line per worktree under `.claude/worktrees/` (branch, ahead/behind, dirty, last commit). Read that, not each lane's log.

## Integration

- One integrator merges finished lanes in order into the base branch, one at a time.
- The full suite runs once per batch, after the merges, not per lane.
- A conflict or a red suite sends the lane back with the failing output; the integrator does not rewrite lane work.
- `orchestra-lanes.mjs rm <id>` after a lane is merged; it refuses dirty or unmerged lanes.

## Scheduled runs and monitors

- Scheduled or unattended runs set `DOTAI_AUTONOMOUS=1` in their environment, so `delegate` applies the hard quota cap (pack 0019) and defers instead of asking.
- Before each scheduled launch (`CronCreate`, a nightly queue), read the quota from the base `delegate` config. Over the cap: stop, write `STATUS.md` and `HANDOFF.md`, and schedule one relaunch after the reset. Never loop on quota.
- A `Monitor` always has an end condition and a maximum duration. No sleep loops.
- `Workflow` runs stay `small` or `medium`, with no human gates inside. Human review happens between runs.

## Review between runs

When the project uses the external tracker, each finished batch gets a review card from the `review-rounds` preset (pack 0027): checks with verdicts, media evidence, the owner's approval. Otherwise, a short report: per lane one line, then the suite result and what needs a decision.
