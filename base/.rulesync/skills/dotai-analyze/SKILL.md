---
name: dotai-analyze
description: "Clean up old project config that clashes with the pack's applied profiles: old rules, same-name skills, duplicate hooks."
metadata:
  author: Federico Ara
---

# dotai-analyze

Clash cleanup only: dotai's `dotai-profiles` skill chooses and applies profiles (pack 0047). Run after an apply, or when the user asks. Read-only until the user approves. Rules and tables: [references/detection.md](references/detection.md).

1. Read the applied profiles from `.dotai/state.json` (`profiles`). Without it, say that `dotai-profiles` proposes them, and check only against the base.
2. Find clashes with the pack and the applied profiles: old rules files, same-name skills and agents, duplicate hooks, user plugins and outdated CLIs (reference, Clashes).
3. Sum the applied set's rules and listing costs apart and warn per cap and at 4,000 total (reference, Budget).
4. Propose a cleanup and ask once.
5. Back up affected files outside the repo before changing anything: copy each one, keeping its relative path, to `~/.dotai/pack-backups/<project>/<timestamp>/` (`<project>` is the repo folder name, `<timestamp>` is `YYYYMMDD-HHMMSS`), plus a `MANIFEST.txt` listing each path and the action taken. Confirm the copies exist before deleting or editing.
6. Clean up only what the user approved, with the smallest edit (remove a marked block, not the file). Say when an edited file is tracked by git; never commit.
7. Say whether `/reload-skills` or a restart is needed.
