---
name: memory
description: "Save or recall long-term cross-project facts via the engram CLI."
metadata:
  author: Federico Ara
---

# memory

Engram CLI, pinned v1.20.0 (0041). Cross-project facts always use `--project global --scope personal`.

## Recall

`engram search "<query>" --scope personal --limit 5`. Add `--type <type>` to narrow.

## Save

- Only: user preferences and feedback, non-obvious tool or environment gotchas, cross-project conventions (0042).
- Never: what the repo records (ADR, commit, docs), per-step progress, or a session summary (the `PreCompact` hook writes it).
- Per-project facts not in the repo go to the project `MEMORY.md`, not Engram.
- When: a decision closes or something non-obvious appears, not after each step.

Steps:

1. Check the repo does not already record it.
2. `engram search` for a duplicate (search output does not show topic keys). Same fact: skip. Changed fact: save under the same topic key to replace it.
3. Save:

   ```sh
   engram save "<short title>" "<what; why; where it applies>" --type <type> --project global --scope personal --topic <family>/<slug>
   ```

   - `--type`: `preference` (preferences and feedback; `SessionStart` injects these), `config` (tool or environment gotcha), `pattern` (convention), `decision`, `learning`.
   - `--topic`: stable key such as `pref/brief-answers` or `tool/engram-windows`. Same key, project and scope: the save updates in place; another project creates a copy (checked on v1.20.0).
   - Quote both arguments; keep the content under ~5 lines.

Never run `engram delete`, `import`, `sync` or `projects consolidate` unless the user asks.
