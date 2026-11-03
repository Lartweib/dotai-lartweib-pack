---
name: dotai-analyze
description: "Onboard a project: detect its stack, suggest profiles, find clashing old config."
metadata:
  author: Federico Ara
---

# dotai-analyze

Read-only until the user approves. Rules and tables: [references/detection.md](references/detection.md).

1. Detect the stack from manifests and files (profile hints in `dotai validate --json`, `pack.profiles`). Confirm by content, not by path alone.
2. Find clashes with the pack: old rules files, same-name skills, duplicate hooks.
3. Ask which profiles to apply; propose a cleanup. Sum the set's rules and listing costs apart and warn per cap and at 4,000 total (reference, Budget). Offer `seo` only for an audit, to be removed after it.
4. Back up affected files outside the repo before changing anything: copy each one, keeping its relative path, to `~/.dotai/pack-backups/<project>/<timestamp>/` (`<project>` is the repo folder name, `<timestamp>` is `YYYYMMDD-HHMMSS`), plus a `MANIFEST.txt` listing each path and the action taken. Confirm the copies exist before deleting or editing.
5. Clean up only what the user approved, with the smallest edit (remove a marked block, not the file). Say when an edited file is tracked by git; never commit.
6. Apply with `dotai apply --profile ...`; then say whether `/reload-skills` or a restart is needed.
7. Write the done marker `.dotai/packs/dotai-lartweib-pack/onboarded.json`: `{"version":1,"date":"<ISO date>","profiles":[...],"backup":"<backup dir or null>","removed":[...],"kept":[...]}`.

If the marker exists, run in sync mode: report only new stack evidence or clashes, and only add.
