---
name: delegate
description: "Hand research, audits or bulk mechanical work to the other harness (agy or Claude Code) within quota. Use before delegating."
metadata:
  author: Federico Ara
---

# delegate

1. Pick the job: research, audit or bulk mechanical change. Not small changes, bugs or exploration.
2. Write a self-contained spec file: target, change, constraints, what proves it done, and that every background process it starts ends before it finishes.
3. Run:

   ```
   node "${DOTAI_TOOLS}/delegate-backend.mjs" run --model M --effort E --spec FILE --title "short name" [--kind research|audit|code] [--alt M2:E2]
   ```

   - Only the primary (`primary` in `delegate.yaml`, default Claude Code) delegates, to the other harness. In agy, add `--from agy`. Same-harness work goes to its subagents.
   - To agy: Gemini ids carry the level, which must match the effort (`gemini-3.8-flash-low` with `--effort low`); third-party models (`claude-*`, `gpt-*`) take `--effort default`.
   - To Claude Code: an alias (`sonnet`) or `claude-*`, effort `low`..`max` or `default`.
   - `--kind`: `research` (default) and `audit` are read-only; `code` may edit and run commands (the pack's guards still apply).
   - `--alt` is a model on the other pool, tried when the first is over quota.
   - `--to opencode` with `provider/model`: occasional, never Claude models.
4. Read the exit code and the one result line:
   - 0 `OK`: read `result=FILE` and verify it with an executable check before reporting. A bad result gets one retry with feedback; then do it yourself.
   - 1 `FAIL`, 2 `REJECT`: fix the cause; do not loop.
   - 3 `DEFER`: quota is out. Do it yourself on the model the cost policy fits the task, or defer and tell the user.
   - 4 `ASK`: over the soft cap. Ask the user; rerun with `--over-cap` only on their yes.
5. Several workers: run `node "${DOTAI_TOOLS}/delegate-backend.mjs" workers` and follow it. `status --watch` shows the launch tree.

Never change thresholds from chat; they live in the user's `delegate.yaml`. Autonomous runs set `DOTAI_AUTONOMOUS=1` (hard cap).
