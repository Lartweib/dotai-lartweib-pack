---
name: delegate
description: "Hand research, audits or bulk mechanical work to agy within quota. Use before delegating."
metadata:
  author: Federico Ara
---

# delegate

1. Pick the job: research, audit or bulk mechanical change. Not small changes, bugs or exploration.
2. Write a self-contained spec file: target, change, constraints, what proves it done.
3. Run:

   ```
   node "${DOTAI_TOOLS}/delegate-backend.mjs" run --model M --effort E --spec FILE --title "short name" [--kind research|audit|code] [--alt M2:E2]
   ```

   - Gemini: the level is in the id and must match the effort (`gemini-3.8-flash-low` with `--effort low`). Third-party models (`claude-*`, `gpt-*`): `--effort default`.
   - `--kind`: `research` (default) and `audit` are read-only; `code` may edit and run commands (agy skips its permission prompts, the pack's guards still apply).
   - `--alt` is a model on the other pool, tried when the first is over quota.
   - `--to opencode` with `provider/model`: occasional, never Claude models.
4. Read the exit code and the one result line:
   - 0 `OK`: read `result=FILE` and verify it with an executable check before reporting. A bad result gets one retry with feedback; then do it yourself.
   - 1 `FAIL`, 2 `REJECT`: fix the cause; do not loop.
   - 3 `DEFER`: quota is out. Run on Sonnet or Haiku, or defer; an agy hub defers and notifies.
   - 4 `ASK`: over the soft cap. Ask the user; rerun with `--over-cap` only on their yes.
5. Several workers: run `node "${DOTAI_TOOLS}/delegate-backend.mjs" workers` and follow it. `status --watch` shows the launch tree.

Never change thresholds from chat; they live in the user's `delegate.yaml`. Autonomous runs set `DOTAI_AUTONOMOUS=1` (hard cap).
