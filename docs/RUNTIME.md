# Runtime

- **Status:** design, no code. Describes the planned runtime of the reference pack as decided.
- **verified-at:** 2026-11-01
- **covers:** [0008](decisions/0008-always-on-budget-values.md), [0009](decisions/0009-directional-delegation-with-quota-config.md), [0010](decisions/0010-onboarding-profile-classification.md), [0014](decisions/0014-base-principles-scripts-hooks-deny.md), [0016](decisions/0016-review-web-approval-by-criterion-type.md), [0017](decisions/0017-statusline-in-base.md), [0030](decisions/0030-explicit-model-and-effort-enforcement.md), [0019](decisions/0019-quota-cap-by-who-is-in-charge.md), [0020](decisions/0020-drop-sdd-lightweight-task-router.md), [0021](decisions/0021-orca-extend-dont-fork.md), [0022](decisions/0022-delegate-visible-orca-backend.md), [0023](decisions/0023-workflows-by-task-type-v2.md), [0024](decisions/0024-sessions-by-topic-clean-context.md), [0027](decisions/0027-review-rounds-preset-in-the-tracker.md), [0028](decisions/0028-standalone-and-orca-variants.md), [0029](decisions/0029-reference-pack-v1-scope.md), [0034](decisions/0034-delegate-packaging-base-tool-variant-runners.md), [0031](decisions/0031-orca-single-delegation-terminal-agy-p.md), [0032](decisions/0032-variant-parity-by-use-case.md), [0033](decisions/0033-coexist-with-orca-installed-skills.md), [0035](decisions/0035-task-router-refinements.md), [0036](decisions/0036-single-reviewer-by-focus.md), [0037](decisions/0037-base-subagent-roster.md), [0038](decisions/0038-base-bash-guards-ask-and-deny.md), [0039](decisions/0039-artifact-reads-guarded-by-size.md), [0040](decisions/0040-project-onboarding-and-on-demand-profiles.md), [0041](decisions/0041-engram-via-cli-and-hooks.md), [0042](decisions/0042-memory-save-policy.md)

This document is a map of how the reference pack behaves at runtime. The engine that installs it is described in [the engine's ARCHITECTURE.md](../../dotai/docs/ARCHITECTURE.md), and the format this pack follows in [PACK-FORMAT.md](../../dotai/docs/PACK-FORMAT.md). The why lives in the [decision records](decisions/README.md) and the detail in [DESIGN.md](DESIGN.md). Anything not yet decided is marked as pending and points to [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md). Anything not stated by a source document is marked `(inferred)`.

## 1. Overview

The pack adds its own modules to the base (`delegate`, statusline, task router) and an onboarding step that detects the project's stack. Orca is an optional interface layer that the pack supports through a variant ([0028](decisions/0028-standalone-and-orca-variants.md)). Review cards live in an external tracker that the pack declares ([0027](decisions/0027-review-rounds-preset-in-the-tracker.md)).

```mermaid
flowchart TB
  subgraph DOTAI["dotai engine"]
    direction TB
    LOAD["Load pack: base, profiles, variants as layers"]
    ADP["Adapters: Claude Code, agy, OpenCode"]
    SAFE["Backup, restore, install modes"]
    DOC["doctor"]
    LOAD --> ADP
    SAFE --- ADP
    DOC --- ADP
  end

  PACK[("Pack: rules, agents, skills, hooks, MCP, cost policy, delegate")]
  PACK --> LOAD

  subgraph HARNESS["Target harnesses"]
    CC["Claude Code: main hub"]
    AGY["agy: delegate and fallback hub"]
    OC["OpenCode: minimal and occasional"]
  end

  ORCA["Orca: optional interface layer"]
  ENG[("engram: shared memory")]

  DOTAI -- "apply" --> CC
  DOTAI -- "apply" --> AGY
  DOTAI -- "apply" --> OC

  CC -- "delegate: Gemini or third-party pool" --> AGY
  AGY -- "as hub: never delegates" --x CC
  OC -. "only free models and third-party credits" .- OC_NOTE["Never Claude via API"]

  ORCA -. "optional agent visibility" .- CC
  ORCA -. "optional tab" .- AGY

  CC --- ENG
  AGY --- ENG
```

Directional routing ([0009](decisions/0009-directional-delegation-with-quota-config.md)):

```mermaid
flowchart LR
  CC["Claude Code hub"] -- "delegate" --> POOLS
  subgraph POOLS["agy: two quota pools"]
    G["Gemini pool"]
    T["Third-party pool"]
  end
  G -- "over the threshold" --> T
  T -- "over the threshold" --> DEFER["Defer and notify"]
  CC -- "both pools over the threshold" --> LOCAL["Run on Sonnet or Haiku, or defer"]
  AGYHUB["agy hub"] -- "never" --x CLAUDE["Claude, neither via third parties nor via OpenCode with API"]
  AGYHUB -- "exhaustion" --> DEFER
```

## 2. Source levels

What each source level contains ([DESIGN §3 and §4](DESIGN.md#3-global-base)):

| Level | Content | Always-on cost |
|---|---|---|
| **Base** | Core `AGENTS.md`, cost policy, task router ([0020](decisions/0020-drop-sdd-lightweight-task-router.md)), sessions-by-topic rule ([0024](decisions/0024-sessions-by-topic-clean-context.md)), `delegate` skill, hooks (`PreToolUse` on `Agent`, `timeout`, Bash guards that ask for destructive commands and filter denied paths, a size-based `Read` hook for artifacts), `permissions.deny` for secrets, `memory` skill and Engram hooks, statusline | Rules ≤ 2,500, listing ≤ ~2,000, total warn 4,000 in Claude Code and agy ([0046](decisions/0046-split-always-on-budget.md)) |
| **Profiles** (flat and combinable, [dotai 0023](../../dotai/docs/decisions/0023-flat-profiles-and-layer-merge-rules.md)) | `godot`, `autonomous-orchestra` (autonomous backlogs), `video` ([0040](decisions/0040-project-onboarding-and-on-demand-profiles.md)), `web`, `astro-cloudflare`, `next-vercel-supabase`, `seo`, `desktop`, `tooling` and per-stack tooling profiles; final list is reference pack content | `web` ~1.1k, `godot` 1–3k, `tooling` ≤0.7k, `desktop` ≤0.5k |
| **Modules** | `delegate`, guards, panel, clash cleanup (`dotai-analyze`); per [dotai 0004](../../dotai/docs/decisions/0004-installer-language-and-shape.md), opt-in | On demand |

Pending:

- Headless agy is a viable hub ([0043](decisions/0043-v1-is-the-complete-pack.md), update 2026-11-02); how a headless hub learns its quota is still open: [OPEN-QUESTIONS, measurement 1](OPEN-QUESTIONS.md).
- Stability of the mods API for the panel: [OPEN-QUESTIONS, measurement 12](OPEN-QUESTIONS.md).

## 3. Runtime

### 3.a `delegate` from Claude Code to agy

Validated in [0022](decisions/0022-delegate-visible-orca-backend.md). The reference pack declares two variants ([0028](decisions/0028-standalone-and-orca-variants.md)): `standalone`, where its own backend launches; and `orca`, where Orca launches, waits and closes (an Orca terminal running `agy -p` for a single delegation, [0031](decisions/0031-orca-single-delegation-terminal-agy-p.md); `orca orchestration` for several workers) and the pack only adds its contract. The engine knows nothing about Orca; it only applies the chosen variant as a layer. Packaging ([0034](decisions/0034-delegate-packaging-base-tool-variant-runners.md), engine answers in its 2026-11-01 update): one backend-agnostic `delegate` skill and one shared contract tool in the base, `delegate-core.mjs` (a library the backends import, with no wrapper; 0034 update 2026-11-03), and one backend tool per variant named `delegate-backend` (there is no `runners/` directory). In both variants, the pack's base tool validates the model/effort pair beforehand and confirms the actual model afterwards, because Orca's `launch.effective` is not evidence. The current runner's "use Claude" rejection is inverted per [0009](decisions/0009-directional-delegation-with-quota-config.md): when agy is the hub, exhausting the pools defers and notifies.

Quota freshness: `rate_limits.json` is written only while an interactive agy session with the statusline runs ([0022](decisions/0022-delegate-visible-orca-backend.md)), so a headless `standalone` delegation will often find a stale `ts`, which counts as unknown. Unknown quota counts as available; exhaustion is detected by the quota error from `agy -p`, which marks the pool exhausted for the run ([0022, update 2026-10-26](decisions/0022-delegate-visible-orca-backend.md#update-2026-10-26-unknown-quota-counts-as-available)).

Visibility in v1: in `standalone`, a live viewer of the subagent tree read from the launch log, in a side terminal ([0032](decisions/0032-variant-parity-by-use-case.md)), plus the statusline's `delegate:` line and the launch log ([0030](decisions/0030-explicit-model-and-effort-enforcement.md)); the base `Agent` hook appends Claude Code subagent launches to the same log, so the viewer shows one tree; the panel named in [0028](decisions/0028-standalone-and-orca-variants.md) comes after v1 ([0029](decisions/0029-reference-pack-v1-scope.md)). In `orca`, Orca shows the delegation as a child agent or tab.

```mermaid
sequenceDiagram
  participant CC as Claude Code
  participant D as delegate
  participant Q as agy rate_limits.json
  participant B as Backend
  participant A as agy
  participant J as Job file
  participant L as Launch log

  CC->>D: job with model and effort
  D->>D: validate the model and effort pair
  Note over D: --effort only on models that accept it.<br/>On Gemini the level is in the model id
  D->>Q: read quota per pool
  Note over D,Q: a stale ts is treated as unknown.<br/>Unknown quota counts as available
  alt Gemini pool under the threshold
    D->>D: Gemini pool
  else Third-party pool under the threshold
    D->>D: third-party pool
  else Both over the threshold
    D-->>CC: defer and notify, never use Claude if agy is the hub
  end
  D->>B: launch
  alt standalone variant: own runner, headless
    B->>A: agy -p --output-format json
  else orca variant: one worker
    B->>A: orca terminal create running agy -p --output-format json
  else orca variant: several workers
    B->>A: orca orchestration worker-start ...
  end
  A->>J: long result in the job file
  A-->>D: single delegation (both variants): JSON with status, usage and response. orchestration: worker_done, no usage
  D->>J: read result
  D->>A: confirm the actual model (banner or worker-read, launch.effective is not evidence)
  D->>B: close the tab or release the worker in the orca variant
  D->>L: record role, model and effort
  D-->>CC: status, tokens and result
```

### 3.b Subagent launch under the strict hook

Decided in [0030](decisions/0030-explicit-model-and-effort-enforcement.md): in Claude Code effort cannot be set per launch, so the hook requires `model` and effort comes from the subagent definition ([dotai 0024](../../dotai/docs/decisions/0024-models-declared-per-harness-no-tiers.md), [HARNESS-NOTES](../../dotai/docs/HARNESS-NOTES.md)). The hook guarantees the model is present; the log measures the quality of the choice.

```mermaid
sequenceDiagram
  participant CC as Claude Code
  participant H as PreToolUse hook on Agent
  participant S as Subagent
  participant L as Launch log

  CC->>H: Agent without model
  H-->>CC: deny with the selection criterion
  Note over H,CC: Haiku for mechanical work, Sonnet to execute and explore,<br/>Opus to design, judge and arbitrate.<br/>Effort is not in tool_input: it comes from the subagent definition
  CC->>H: Agent with model
  alt Opus with a generic agent or outside the role allowlist
    H-->>CC: deny with explanation
  else Within the allowlist
    H->>S: allow
    H->>L: record role, model, definition effort and description
  end
```

Safety net for paths the hook does not cover: `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`.

### 3.c Project onboarding

Decided in [0010](decisions/0010-onboarding-profile-classification.md) and [0040](decisions/0040-project-onboarding-and-on-demand-profiles.md) (the pack backs up affected files before cleaning clashes) and [0047](decisions/0047-adopt-dotai-owned-onboarding.md) (dotai's own session-start hook and `dotai-profiles` skill choose the profiles, [dotai 0045](../../dotai/docs/decisions/0045-dotai-owned-project-onboarding.md); a task that needs a missing profile loads `dotai-profiles`); shape in [DESIGN §4.5](DESIGN.md#45-onboarding-layer-4). Mods are always installed at project level (invariant, see §5).

```mermaid
sequenceDiagram
  participant U as User
  participant H as dotai onboarding hook
  participant AN as dotai-profiles skill
  participant CL as dotai-analyze, read-only until approval
  participant DA as dotai apply
  participant P as Project
  participant O as Orca

  H->>U: one line: not set up, or profiles may no longer fit
  U->>AN: load it
  AN->>P: detect stack by content, hints as evidence
  AN->>U: a few targeted questions, then the dry-run plan
  U-->>AN: answers and approval
  AN->>DA: selected profiles
  DA->>P: profile agents, skills and MCP
  DA->>P: mods, always project-scoped
  opt Orca present
    DA->>O: register setup script, step 1 or 2 of the 0021 ladder
  end
  DA-->>U: summary of what was applied
  opt old config clashes
    U->>CL: clean up
    CL->>P: back up, then remove only what the user approved
  end
```

Registering the setup script in Orca is optional and its exact form (`orca.yaml` or the `orca` CLI) is not defined (inferred from [0021](decisions/0021-orca-extend-dont-fork.md): configuration, then external integration).

### 3.d Approval in review cards

Rules from [0016](decisions/0016-review-web-approval-by-criterion-type.md), applied by the `review-rounds` preset of the external tracker ([0027](decisions/0027-review-rounds-preset-in-the-tracker.md)).

```mermaid
sequenceDiagram
  participant AG as Agent
  participant RW as Tracker, review-rounds preset
  participant U as User
  participant Q as Overnight queue

  AG->>RW: card submitted with its criterion type
  alt Taste criterion, such as game feel or visual design
    RW->>U: blocks the merge until approved
    Q->>Q: skip the blocked item
    Q->>Q: continue with the next one
    U-->>RW: approve or give feedback
  else Correctness criterion, such as tests, lint or verifier
    RW->>U: notify only, the automatic gate already verifies
  end
```

## 4. Task router

Classification in the base and one skill per type ([0020](decisions/0020-drop-sdd-lightweight-task-router.md), [0023](decisions/0023-workflows-by-task-type-v2.md)). Sessions-by-topic rule in [0024](decisions/0024-sessions-by-topic-clean-context.md). Quota caps in [0019](decisions/0019-quota-cap-by-who-is-in-charge.md).

```mermaid
flowchart TD
  IN["User request"] --> THEME{"Does the topic change from the session?"}
  THEME -- "refinement of the same topic" --> CLS
  THEME -- "related task" --> BATCH["Suggest grouping into a batch"] --> CLS
  THEME -- "different topic" --> CLEAN["Suggest a clean session, without starting it unconfirmed"] --> CLS
  CLS{"Does it authorize a change?"}
  CLS -- "no" --> ANS["Answer or research, without editing"]
  CLS -- "yes" --> TYPE{"Type and risk"}
  TYPE --> S1["Small change: direct prompt and one check"]
  TYPE --> S2["Bug: failing test, fix, verify"]
  TYPE --> S3["Medium change: plan, implement, fresh review"]
  TYPE --> S4["Large feature: interview, SPEC.md, new session"]
  TYPE --> S5["High risk: per-change spec, milestones, fresh review"]
  TYPE --> S6["Exploratory: checkpoints and visual verification"]
  TYPE --> S7["Autonomous backlog: ingredients, caps, separate verifier"]
  TYPE --> S8["Audit or research: bounded workflow"]
  S1 --> RUN
  S2 --> RUN
  S3 --> RUN
  S4 --> RUN
  S5 --> RUN
  S6 --> RUN
  S7 --> RUN
  S8 --> RUN
  RUN["Run with declared model and effort, and decide whether to delegate to agy"] --> QUOTA{"Work mode"}
  QUOTA -- "interactive" --> SOFT["Soft cap: at the threshold, notify and ask"]
  QUOTA -- "autonomous" --> HARD["Hard cap: stop, save state and report"]
  SOFT --> DONE
  HARD --> DONE
  DONE{"Task closed?"} -- "yes" --> HAND["Write handoff and suggest /clear"]
  DONE -- "no" --> IN
```

The hard threshold is configuration of the base `delegate` tool at user scope ([0034](decisions/0034-delegate-packaging-base-tool-variant-runners.md)) and is changed only by editing that configuration, never from the chat ([0019](decisions/0019-quota-cap-by-who-is-in-charge.md)). The full verification and cap table per type is in [0023](decisions/0023-workflows-by-task-type-v2.md).

## 5. Invariants

- agy as hub never delegates to Claude, neither directly, nor via its third-party pool, nor via OpenCode with API. Exhaustion is resolved by deferring and notifying ([0009](decisions/0009-directional-delegation-with-quota-config.md)).
- No silent inheritance ([0030](decisions/0030-explicit-model-and-effort-enforcement.md)): every Claude Code delegation declares `model` (the hook rejects it otherwise) and effort is fixed in each pack subagent's definition (agents without a declared effort, generic built-ins included, are rejected); every `delegate` job declares model and effort, validated as a pair ([0022](decisions/0022-delegate-visible-orca-backend.md)).
- Quota thresholds and the preferred pool are configuration of the base `delegate` tool at user scope, not chat and not profile content ([0034](decisions/0034-delegate-packaging-base-tool-variant-runners.md)). Soft cap in interactive mode, hard cap in autonomous mode ([0019](decisions/0019-quota-cap-by-who-is-in-charge.md)).
- Mods are installed per project, never at user level ([dotai 0011](../../dotai/docs/decisions/0011-mods-always-project-scoped.md)). The panel, after v1 ([0029](decisions/0029-reference-pack-v1-scope.md)), has per-project extension sections ([DESIGN §7](DESIGN.md#7-delegate-and-quota-routing)).
- Always-on budget, real tokens, both harnesses: rules ≤ 2,500, listing ≤ ~2,000 (≤ ~100 per entry), total warn 4,000 and fail 5,000, measured by `dotai doctor` (engine question). ([0046](decisions/0046-split-always-on-budget.md))
- Scripts and CLI before MCP; policy in config and hooks, not in prompt text. ([0014](decisions/0014-base-principles-scripts-hooks-deny.md))
- Review cards live in an external tracker consumed through the pack; it runs locally and works with agy as hub and without internet ([0027](decisions/0027-review-rounds-preset-in-the-tracker.md)).
- dotai does not depend on Orca: the `standalone` variant's headless backend always works ([0022](decisions/0022-delegate-visible-orca-backend.md), [0028](decisions/0028-standalone-and-orca-variants.md)). Orca is not forked ([0021](decisions/0021-orca-extend-dont-fork.md)).
- SDD is not installed, not even on demand ([0020](decisions/0020-drop-sdd-lightweight-task-router.md)).

## 6. Boundaries and external integrations

The pack does not control these surfaces: it uses them and can break if they change. Verified harness facts are in the engine's [HARNESS-NOTES.md](../../dotai/docs/HARNESS-NOTES.md).

| System | What the pack uses | Source and notes |
|---|---|---|
| **Claude Code** | Hooks (`PreToolUse` on `Agent`, `Bash` and `Read`; `Stop`; `SessionStart`; `PreCompact`), `statusLine`, `permissions.deny` (secrets; a Read deny also blocks the Bash file commands Claude Code recognizes, [0038](decisions/0038-base-bash-guards-ask-and-deny.md)), mods (panel), variables such as `CLAUDE_CODE_SUBAGENT_MODEL` | [DESIGN §3](DESIGN.md#3-global-base), [0030](decisions/0030-explicit-model-and-effort-enforcement.md) |
| **agy** | `agy -p --output-format json`, `--model`, `--effort` (only where the model supports it), `--json-schema`, `agy models`; quotas in `~/.gemini/antigravity-cli/rate_limits.json` (`gemini_5h_pct`, `gemini_7d_pct`, `p3_5h_pct`, `p3_7d_pct`, `ts`, written by the statusline) | [0022](decisions/0022-delegate-visible-orca-backend.md). Limits: encoding bug in `-p` (worked around with a job file); agy hooks unverified |
| **Orca** (optional) | `orca terminal create` (running `agy -p`, [0031](decisions/0031-orca-single-delegation-terminal-agy-p.md)), `orca orchestration`, `orca terminal wait`/`read`/`close` (`orca` variant of the reference pack, [0028](decisions/0028-standalone-and-orca-variants.md)); `orca skills get <x>` pattern | [0021](decisions/0021-orca-extend-dont-fork.md), [0022](decisions/0022-delegate-visible-orca-backend.md). Ladder: configuration, external integration, upstream issue or PR, minimal patch |
| **engram** | Shared memory from Claude Code to agy, through its pinned CLI and a `memory` skill (no MCP); the session summary is saved by a `PreCompact` hook and `SessionStart` injects preferences and pinned items, capped | [0005](decisions/0005-engram-as-memory-backend.md), [0041](decisions/0041-engram-via-cli-and-hooks.md), [0042](decisions/0042-memory-save-policy.md), [DESIGN §5](DESIGN.md#5-memory-and-code-intelligence). Open risks on Windows |
| **gh** | CLI instead of the GitHub MCP | [DESIGN §2, P1](DESIGN.md#2-cross-cutting-principles) (backed by [0014](decisions/0014-base-principles-scripts-hooks-deny.md)) |
| **OpenCode** | Minimal and occasional target; third-party API credits | [0009](decisions/0009-directional-delegation-with-quota-config.md). Pi was evaluated and not adopted (no subagents, no permission model; [0009](decisions/0009-directional-delegation-with-quota-config.md), update 2026-11-02) |

## Maintenance

Review this file when a decision listed in `covers` changes or pack content appears.
