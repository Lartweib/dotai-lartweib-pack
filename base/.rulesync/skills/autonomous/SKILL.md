---
name: autonomous
description: "Plan unattended or backlog work with caps and a separate verifier."
metadata:
  author: Federico Ara
---

# autonomous

Combine only the ingredients the task needs, from [references/ingredients.md](references/ingredients.md) (read it before planning). Never omit the two it marks required: a measurable success criterion and these caps.

- A turn clause in the `/goal` condition; stop after two rounds in a row with no improvement.
- The quota cap from config; never change it from chat. Unattended runs set `DOTAI_AUTONOMOUS=1` so `delegate` applies it as a hard cap (0019).

There is no template (0013): write the plan in the project's own terms. Human decisions go between runs, never inside one. To execute the plan at scale (worktree lanes, integration, scheduled runs), use the `autonomous-orchestra` profile when the project has it.
