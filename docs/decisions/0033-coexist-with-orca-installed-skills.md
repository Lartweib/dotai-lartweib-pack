---
status: accepted
date: 2026-10-28
tags: [orca, skills, variants, naming]
---

# 0033 · Coexist with the skills Orca installs

## Context

The author wants the pack to stay compatible with Orca installing its own skills, with no conflict between the two. Verified on the installed Orca CLI (2026-10-28):

- `orca skills install` writes its bundled skills to the shared `~/.agents/skills` folder and links them into each detected agent's skills folder, globally by default (`--local` for a project).
- Bundled names: `orca-cli`, `orchestration`, `computer-use`, `orca-jira`, `orca-linear`, `jira-tickets`, `linear-tickets`, `orca-emulator`, `orca-emulator-android`, `orca-per-workspace-env`.
- It never overwrites a different skill with the same name: it skips and reports it (`--force` replaces it after a backup). `orca skills update` follows the same rule.
- `orca skills get <name>` prints a guide without installing anything.

On the engine side, dotai never rewrites or deletes foreign content ([dotai 0013](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0013-renderer-merges-by-key.md)), and the replace mode never removes shared paths such as `~/.agents/skills` ([dotai 0018](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0018-install-modes-and-mandatory-backup.md)).

## Decision

- **Orca owns its skills.** The pack never ships, copies or edits them, in any layer. Installing and updating them stays with Orca.
- **Reserved names.** No pack skill, subagent or command uses a name Orca ships or the `orca-` prefix. The list above is kept here and checked when pack content is added.
- **The `orca` variant references, it does not duplicate.** It points to Orca's skills by name (for example `orchestration`) or loads them with `orca skills get`, and adds only the pack's contract ([0022](0022-delegate-visible-orca-backend.md), [0031](0031-orca-single-delegation-terminal-agy-p.md)).

## Considered options

- **A (chosen):** Orca owns its skills; the pack reserves its names and references them.
- **B:** vendor Orca's skills into the `orca` variant. Rejected: two owners for one name, and Orca's update would skip or fight the pack's copy.

## Consequences

- Good: `orca skills install` and `update` and `dotai apply` never touch each other's files.
- Pending (engine): in the isolated install mode, the harness reads a separate configuration directory, so skills Orca linked into the normal agent folders may not be visible there.

## Evidence

- `orca skills --help`, `orca skills list`, `orca skills install --help` (Orca CLI, 2026-10-28).

## Update 2026-11-01: shared skills

The engine answered the pending item ([dotai 0036](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0036-shared-skills-per-variant.md)). The `orca` variant declares `shared-skills: true`, so Orca's skills in `~/.agents/skills` are visible in the isolated install: Claude Code gets a junction or symlink, agy a copy, and OpenCode reads the folder directly. `standalone` keeps the default (`false`) and sees only the pack's content.
