# dotai-lartweib-pack

A pack for [dotai](https://github.com/Lartweib/dotai), the cross-harness configuration engine for AI coding agents. A pack is an opinionated setup in dotai's format, rendered by the engine into each harness: think LazyVim on top of Neovim.

This one ships a base with a cost policy and guard hooks, two variants for how work is delegated, and nine project profiles. It targets **Claude Code** and **Google Antigravity CLI (agy)**; **OpenCode** is optional and a preview, managed only when you ask for it.

## Install

You need [dotai](https://github.com/Lartweib/dotai#install), git 2.41 or later, Node.js 22 or later (every hook and tool is a Node script), and the harnesses you use.

```sh
# Fetch the pack at a release tag
dotai pack add https://github.com/Lartweib/dotai-lartweib-pack --ref v0.1.0

# User scope: the base and one variant (see the plan first, then run it again without --dry-run)
dotai install ~/.dotai/packs/github.com/lartweib/dotai-lartweib-pack --variant standalone --dry-run

# Project scope, from inside a project: one or more profiles
dotai apply --profile web,ui
```

You don't need to pick profiles by hand. dotai's `dotai-profiles` skill proposes them from the files the project tracks, and its session-start hook offers it once per project. `dotai restore` undoes an install, `dotai restore --project` undoes an apply, and `dotai pack update github.com/lartweib/dotai-lartweib-pack` shows what changed before it updates.

## What it adds

```mermaid
flowchart LR
  P(["dotai-lartweib-pack"])

  P --> B["Base<br/><i>user scope, always</i>"]
  P --> V["Variants<br/><i>user scope, pick one</i>"]
  P --> F["Profiles<br/><i>per project, combinable</i>"]

  B --> BR["<b>Rule</b><br/>core: cost policy, task router"]
  B --> BS["<b>Skills</b><br/>delegate · autonomous · memory<br/>spec · dotai-analyze"]
  B --> BA["<b>Subagents</b><br/>explorer · researcher · worker<br/>reviewer · judge"]
  B --> BH["<b>Hooks</b><br/>shell-guard · read-guard · agent-guard<br/>session-start · memory-compact"]
  B --> BX["<b>Statusline · permissions</b><br/>quota · secret reads denied"]

  V --> VS["<b>standalone</b><br/>launches the agent itself"]
  V --> VO["<b>orca</b><br/>runs it in an Orca terminal"]

  F --> FW["<b>Web</b><br/>web · ui · seo · cloudflare"]
  F --> FA["<b>Apps and tools</b><br/>desktop · tooling · video"]
  F --> FG["<b>Games</b><br/>godot"]
  F --> FO["<b>Long runs</b><br/>autonomous-orchestra"]

  classDef pack fill:#334155,stroke:#0f172a,color:#ffffff
  classDef base fill:#1d4ed8,stroke:#1e3a8a,color:#ffffff
  classDef baseItem fill:#dbeafe,stroke:#1d4ed8,color:#0f172a
  classDef variant fill:#b45309,stroke:#78350f,color:#ffffff
  classDef variantItem fill:#fef3c7,stroke:#b45309,color:#0f172a
  classDef profile fill:#15803d,stroke:#14532d,color:#ffffff
  classDef profileItem fill:#dcfce7,stroke:#15803d,color:#0f172a

  class P pack
  class B base
  class BR,BS,BA,BH,BX baseItem
  class V variant
  class VS,VO variantItem
  class F profile
  class FW,FA,FG,FO profileItem
```

## How the layers stack

dotai merges the layers in a fixed order: the base, then the variant on top of it, then dotai's own onboarding, all at user scope; profiles come later, per project, as peers. Every step only adds: a later layer cannot silently replace what an earlier one ships.

```mermaid
flowchart TB
  subgraph U["User scope · dotai install · once per machine"]
    direction TB
    L1["<b>① Base</b><br/>root rule · skills · subagents · hooks<br/>statusline · permissions"]
    L2["<b>② Variant</b> · standalone or orca<br/>delegate-backend"]
    L3["<b>③ dotai onboarding</b><br/>dotai-profiles skill · session-start hook"]
    L1 -->|"adds on top"| L2
    L2 -->|"engine adds"| L3
  end

  subgraph PJ["Project scope · dotai apply · per project"]
    direction LR
    F1["web"] ~~~ F2["ui"] ~~~ F3["tooling"] ~~~ F4["…"]
  end

  L3 -->|"proposes from the tracked files"| PJ
  L1 -.->|"the delegate skill runs the backend"| L2

  classDef base fill:#1d4ed8,stroke:#1e3a8a,color:#ffffff
  classDef variant fill:#b45309,stroke:#78350f,color:#ffffff
  classDef engine fill:#475569,stroke:#1e293b,color:#ffffff
  classDef profile fill:#dcfce7,stroke:#15803d,color:#0f172a
  class L1 base
  class L2 variant
  class L3 engine
  class F1,F2,F3,F4 profile
```

| What | How layers combine |
|---|---|
| Skills, subagents, rules, MCP servers | One name, one owner. A same name in two layers is an error unless the later one declares an override; a profile can never reuse a base or variant name. |
| Hooks and permissions | Union in layer order: a later layer appends entries, never removes or changes one. |
| Settings (statusline, env) | A later layer replaces a value only with a declared override; two profiles setting the same key is an error. |
| Tools | The base and the variant share `~/.dotai/tools/`, so the same file in both is an error; profiles install to the project's `.dotai/tools/`. |
| Root rule | Only the base provides it. |

User and project scope write separate files; where both set something, the harness decides which wins (Claude Code, for one, prefers the project).

### Two projects, one install

The user scope is installed once and every project gets it; what changes from one project to the next is only the profiles applied there.

```mermaid
flowchart TB
  U["<b>User scope, installed once</b><br/>base + standalone variant"]

  subgraph A["Project A · a Next.js site on Cloudflare Workers"]
    direction TB
    AS["<b>Shared</b><br/>core rule · delegate · memory · spec<br/>guards · subagents · statusline"]
    AW["<b>web</b><br/>web rule · web-check on stop"]
    AU["<b>ui</b><br/>lartweib-taste · browser-tooling · ui-shot"]
    AC["<b>cloudflare</b><br/>cloudflare rule · wrangler · workers-best-practices"]
    AS --- AW --- AU --- AC
  end

  subgraph B["Project B · a Godot 4 game"]
    direction TB
    BS["<b>Shared</b><br/>core rule · delegate · memory · spec<br/>guards · subagents · statusline"]
    BG["<b>godot</b><br/>godot-gdscript · godot-guard<br/>godot-run · godot-state"]
    BO["<b>autonomous-orchestra</b><br/>orchestra skill · orchestra-lanes"]
    BS --- BG --- BO
  end

  U --> AS
  U --> BS

  classDef user fill:#1d4ed8,stroke:#1e3a8a,color:#ffffff
  classDef shared fill:#dbeafe,stroke:#1d4ed8,color:#0f172a
  classDef profile fill:#dcfce7,stroke:#15803d,color:#0f172a
  class U user
  class AS,BS shared
  class AW,AU,AC,BG,BO profile
```

Blue is the same in both projects; green is what each project chose.

## Base

Installed once per machine, at user scope, in every harness the pack manages.

- **Core rule**: the cost policy (which model and effort for which task), a lightweight task router, and short working rules.
- **Skills**: `delegate` (hand work to another harness with an explicit model and effort), `autonomous` (plan an unattended run), `memory` (Engram through its CLI), `spec`, and `dotai-analyze` (clean up clashes with what a project already carries).
- **Subagents**: `explorer`, `researcher`, `worker`, `reviewer`, `judge`, each with its model and effort declared.
- **Hooks**: `shell-guard` asks before destructive commands and blocks reads of secret paths; `read-guard` caps large artifact reads; `agent-guard` requires a model and a declared effort on every subagent launch; `session-start` and `memory-compact` wire Engram memory.
- **Statusline** for Claude Code and agy, with quota and delegation state.
- **Permissions** that deny reads of common secrets (`.env` files, keys, cloud credentials).

## Variants

| Variant | When | Adds |
|---|---|---|
| `standalone` (default) | No Orca | `delegate-backend`: launches the delegated agent itself and keeps a launch log |
| `orca` | The `orca` command is on `PATH` | `delegate-backend` that runs each delegation in an Orca terminal and reads its result |

## Profiles

Flat and combinable; each one is applied per project.

| Profile | When | Main items |
|---|---|---|
| `godot` | Godot 4 games in GDScript | `godot-gdscript` skill, `godot-guard` shell hook, `godot-run`, `godot-state` |
| `autonomous-orchestra` | Long unattended runs on any stack | `autonomous-orchestra` skill, `orchestra-lanes` worktree tool |
| `web` | Astro, Next.js, SvelteKit or Vite apps | `web` rule, `web-check` typecheck on stop |
| `ui` | Any project with a UI | `lartweib-taste` and `browser-tooling` skills, `ui-shot` capture |
| `seo` | An SEO audit of a public site | Read-size paths for audit outputs; the suite is a manual install |
| `cloudflare` | Workers and Pages with wrangler | `cloudflare` rule, `wrangler` and `workers-best-practices` skills (vendored, with their licenses) |
| `video` | Making and reviewing video | `video` rule, `video-frames` skill, `vframes`, `ffqa` |
| `tooling` | Go or Python CLIs, JS tool workspaces | `tooling` rule, `tooling-check` lint on edit (agy: on Stop) |
| `desktop` | Electron apps | `desktop` rule, `desktop-verify` and `desktop-release` skills, `desktop-shot` |

Each profile's README lists its external items (tools you install yourself) and what was measured.

## Repository layout

| Path | What |
|---|---|
| `dotai.yaml` | The manifest: version, pinned rulesync, harnesses, profiles, variants |
| `base/` | The base layer: `.rulesync/` (rules, skills, subagents, hooks, permissions) and `dotai/` (settings, tools) |
| `variants/` | `standalone/` and `orca/` |
| `profiles/` | One directory per profile, same shape as the base |
| `scripts/` | `check.mjs`, the checks run before a release |
| `docs/` | [Design](docs/DESIGN.md), [runtime](docs/RUNTIME.md), [decision records](docs/decisions/README.md), [open questions](docs/OPEN-QUESTIONS.md) |

## Versioning and releases

Releases are SemVer tags `vX.Y.Z` on `main`, and that tag is what you pin with `--ref`. The tag always equals `version` in `dotai.yaml`. Release notes are generated from the Conventional Commits. The pack stays on `0.x` until the engine features it waits for are released; then comes `v1.0.0`. dotai identifies a git pack by its repository, not by the manifest `name` ([decision 0048](docs/decisions/0048-versioning-and-release.md)).

## Development

- Tests: `node --test --test-concurrency=2` (Node's built-in runner, no dependencies).
- Pack check: `dotai validate . --variant standalone` and `--variant orca`.
- Before tagging, run `node scripts/check.mjs`: tests, `dotai validate` for each variant (`DOTAI` names the binary, else `dotai` on `PATH`), the tree check dotai runs on `pack add`, a privacy guard over tracked files, and the tag against `dotai.yaml`. CI runs the same script.
