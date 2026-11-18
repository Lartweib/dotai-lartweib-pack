---
status: accepted
date: 2026-11-01
tags: [onboarding, profiles, skills, base]
---

# 0040 · Project onboarding by the pack, and profiles suggested on demand

## Context

The engine cleans and backs up user-scope config (install modes, [dotai 0018](../../../dotai/docs/decisions/0018-install-modes-and-mandatory-backup.md)) but not project files. Projects often carry old config, such as gentle-ai rules in `CLAUDE.md` or same-name skills, that clashes with the pack. The engine keeps a record of the applied profiles in the project's `.dotai/` directory ([PACK-FORMAT](../../../dotai/docs/PACK-FORMAT.md)).

Some capabilities are not tied to a project type: making animated videos (Hyperframes or similar) can come up in any project. The author expects the orchestrator to know such a profile exists and suggest it. This record extends [0010](0010-onboarding-profile-classification.md).

## Decision

1. **Global stays minimal:** only what pieces 1–8 of the base review settled. Occasional skills, such as `video-frames`, go to profiles.
2. **Project onboarding is the pack's job.**
   - A `SessionStart` hook checks for the engine's applied-profiles record in `.dotai/`. If it is missing, the hook suggests onboarding; if it exists, the hook does nothing.
   - `dotai-analyze` detects the stack and also finds what clashes with the pack: old rules files, same-name skills, duplicate hooks. It proposes a cleanup.
   - Before changing anything, the pack backs up the affected files outside the repository, at `~/.dotai/pack-backups/<project>/<timestamp>/`.
3. **Profiles on demand.** The core `AGENTS.md` carries a one-line profile catalog (~60 tokens): `godot`, `web`, `desktop`, `tooling`, `video`. When a task matches a profile the project does not have, the orchestrator suggests applying it at project scope. A `video` profile holds `video-frames` and video tools.
4. **After applying a profile mid-session**, the orchestrator says what to do next:
   - `/reload-skills` when the project's skills directory is new;
   - a restart when the profile adds agents and the project had no agents directory.

## Considered options

- **A (chosen):** the pack handles project onboarding, and a catalog line in `AGENTS.md`.
- **B:** `video-frames` and similar skills in the base. Rejected: a listing cost in every session for occasional use.
- **C:** rely on the engine for project cleanup. Not available: the engine does not touch project files.

## Consequences

- Good: a lean global context, and occasional capabilities a sentence away.
- Accepted cost: the pack's own backup and cleanup code at project scope; the catalog line must match `dotai.yaml`.
- Pending (engine questions):
  - Is `.dotai/` committed? The author wants the record out of the repository.
  - Can the pack generate the catalog line from `profiles.<name>.description`?
  - The ARCHITECTURE invariant "skills and agents are installed per profile, never globally" conflicts with the base's `delegate` skill and five subagents ([0037](0037-base-subagent-roster.md)). Is it outdated?

## Evidence

- Review with the author, 2026-11-01.
- Skill usage, 2026-09 to 2026-10: `video-frames` 18 uses in one web project and one Godot game project.
- Live reload: [skills](https://code.claude.com/docs/en/skills), [sub-agents](https://code.claude.com/docs/en/sub-agents).

## Update 2026-11-01: engine answers

- **Catalog line:** the engine does not generate it. The line is kept by hand in the core rules, and a pack check compares it with the `profiles` returned by `dotai validate --json`. After engine step 9b-2, `profiles` in that output is a list of objects with `name`, `path`, `description` and `hints`, so the check can compare descriptions.
- **Skills and agents at user scope:** the ARCHITECTURE invariant is outdated; the engine will write a record allowing the base to install them within the always-on budget.
- **Whether `.dotai/` is committed** is still open on the engine side (project scope). It is decided together with keeping the applied-profiles record out of the repository.

## Update 2026-11-01: `.dotai/` is not committed

Engine answer (implemented in engine step 10):

- The engine adds `.dotai/`, and everything else it creates in the project, to `.git/info/exclude`, never to `.gitignore`. This matches the author's wish to keep the record out of the repository.
- The engine never modifies a tracked file. It writes each harness's local variant instead:
  - Claude Code: `CLAUDE.local.md`, which imports `@AGENTS.md` when it exists, and `.claude/settings.local.json`;
  - OpenCode: `.opencode/opencode.json`, read after the root one;
  - agy: only new files under `.agents/`, since it has no local files.
- When a harness has nowhere to write without touching a tracked file, the install plan says so.
- A fresh clone or `git clean -fdx` loses the record. The `SessionStart` hook then finds no record and suggests onboarding again, which is the intended recovery.
- The catalog check compares against `pack.profiles` in `dotai validate --json` (engine PR #27).
- The ARCHITECTURE invariant is replaced in part by engine ADR 0039 (PR #26): the base and the variants may install skills and agents at user scope within the always-on budget of engine ADR 0007, which is still proposed. Until the engine can declare and check that cap, the pack keeps its own budget (DESIGN, CC and agy 3,200 tokens each (0008, update 2026-11-02)).

## Update 2026-11-02: project MCPs, worktrees and tool config

Engine answers:

- **Project MCPs in Claude Code** go to the local scope: `projects[<path>].mcpServers` in `~/.claude.json`. The engine edits those keys directly, so they appear in the install plan and the backup. It owns only the names the pack declares and records in `.dotai/`, and refuses when a name belongs to someone else. `.mcp.json` is not used: it is a tracked file and asks for approval.
- **Worktrees:** each worktree is another path, with its own entry and its own `.dotai/`, so profiles are applied once per worktree. `dotai doctor` will report orphaned entries. The `obra` lane tool must apply the project's profiles to each new lane, or say that it did not.
- **Extending a tool's config** ([dotai 0030](../../../dotai/docs/decisions/0030-tools-paths-and-project-config.md)): a profile ships its own file, such as `read-size.web.txt`, in `.dotai/tools/`, and the tool merges `~/.dotai/tools/` and `.dotai/tools/`. The base's size-based Read hook and model allowlist must read both when they are built.
- **Writes to `~/.claude.json`:** Claude Code does not merge edits: it rereads the file before writing, but not atomically (the engine's experiment lost 1 edit in 37 in one run of three), so refusing while it runs would not help, and dotai 0041 exempts these writes from that refusal. The engine retries on `EPERM`, rereads and verifies the keys; a key lost anyway shows in `dotai doctor` as `key-missing`, fixed by a new apply. Interactive sessions, which write on exit, are untested (engine answer, 2026-11-03).
- **Lanes inside a running session (resolved):** `obra` lanes are created from inside a running Claude Code session. A project apply is not refused there: [dotai 0041](../../../dotai/docs/decisions/0041-project-scope-local-and-untracked.md) allows `~/.claude.json` writes while Claude Code runs (the running-harness refusal covers only a replace install and a restore into a harness's own configuration). A key lost to a concurrent write shows in `dotai doctor` as `key-missing`.

## Update 2026-11-03: renamed

The profile `obra` is now `autonomous-orchestra`, and its lane tool is `orchestra-lanes` (author, 2026-11-03; see [0044](0044-v1-profile-set.md)). The text above keeps the old name. The lane tool now meets the worktree consequence: `orchestra-lanes new` prints the `dotai apply --profile ...` of the profiles recorded in the main checkout's `.dotai/state.json`, and runs it with `--apply` when `dotai` is on PATH, saying so when it did not apply. The question on MCP entries during a running session is resolved (see the bullet above).

## Update 2026-11-18: onboarding is dotai's

Partially superseded by [0047](0047-adopt-dotai-owned-onboarding.md): dotai's `dotai-profiles` skill and session-start hook ([dotai 0045](../../../dotai/docs/decisions/0045-dotai-owned-project-onboarding.md)) replace the pack's onboarding hint, its done marker and the catalog line, so the planned catalog check (never built) is moot. The backup and the clash cleanup (`dotai-analyze`) and point 4 stand.
