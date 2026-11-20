---
status: accepted
date: 2026-10-23
tags: [mods, panel, scope, claude-code]
origin: dotai 0032 (pack half)
---

# 0026 · Mods in the reference pack: incident and open value

The engine half (mods are never installed at user scope) is [dotai 0011](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0011-mods-always-project-scoped.md).

## Context

Incident on 2026-10-23: a bug-tracker panel mod was installed with user scope and showed up in every project. It was uninstalled from user scope. Its marketplace (type `directory`) points to a folder on the author's Desktop, which is fragile. Development copies were also left in `~/.claude/dev-mods/`.

## Decision

The reference pack's global base carries no mods (it does carry, among other things, the statusline, cost policy and `delegate`). Panels are installed per project, following [dotai 0011](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0011-mods-always-project-scoped.md).

## Considered options

See [dotai 0011](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0011-mods-always-project-scoped.md).

## Consequences

- Pending (inferred): review the copies in `~/.claude/dev-mods/` and the location of the bug-tracker panel's marketplace.
- Pending (undecided): what real value mods have for the author's use cases now that Orca shows agents and quotas. To be analyzed when structuring the author's pack ([OPEN-QUESTIONS](../OPEN-QUESTIONS.md), question 20).

## Evidence

- Incident on 2026-10-23 (uninstalling the bug-tracker panel mod from user scope); `extraKnownMarketplaces.<marketplace>` in `~/.claude/settings.json`.
- Approved by the author in conversation on 2026-10-23.
