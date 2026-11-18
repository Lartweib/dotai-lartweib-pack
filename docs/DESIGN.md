# Design

Consolidates internal research reports 01 to 09 (internal research, not published) into a single design. It does not research anything new. Decisions live in [decisions/README.md](decisions/README.md) (one file per decision, with its status) and open questions in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md). Where this document says "proposal", the current status is the one in the corresponding record.

**Date:** 2026-10-20; aligned with the accepted records on 2026-10-26 and again on 2026-11-01 (records 0031 to 0042); §1, §4 and §5 aligned with 0043 and 0044 on 2026-11-02. Markers inherited from the reports: **[M]** measured, **[H]** verified against a source, **[C]** claimed by a vendor or third party, **[I]** inference. Token costs = characters / 4, approximate.

---

## 1. What dotai is

`dotai` (working name, [dotai 0005](../../dotai/docs/decisions/0005-working-name-dotai.md)) is open source, but the real goal is that it fits the author's own use cases, so that agent configuration does not have to be redefined in every new project. Controlled token consumption is a core goal, not a side effect: every always-on piece has to justify its cost. It builds on official standards ([dotai 0003](../../dotai/docs/decisions/0003-align-with-official-standards.md)): `AGENTS.md`, `SKILL.md`, MCP, Claude Code plugins and mods.

### The 5 product layers

| # | Layer | What it delivers | Order in 0007 (superseded) |
|---|---|---|---|
| 1 | **Global base** | Installed once: cost policy, short core rules, Claude Code ↔ agy parity. OpenCode only minimal and occasional (its API credits are for third-party use and automation, and it has some free models) | 1st |
| 2 | **`delegate`** | Quota-aware delegation with **directional** routing: Claude Code (hub) delegates to agy, choosing between its two quotas (Google models / third-party models, each with 5 h and 7 d windows). If agy is the hub (Claude's quota ran out), it **never** delegates to Claude. Claude Code is reserved for orchestrating, designing and judging where it adds differential value | 2nd |
| 3 | **Global panel** | Claude Code mod with quotas and active delegations, plus per-project extension sections | 3rd |
| 4 | **Onboarding + profiles** | One command (or the agent in the first session) detects the stack, asks a few targeted questions, applies a base profile (`godot`, `web`, `desktop`, `tooling`) and installs agents, skills, MCP, mods and a panel section as needed | 4th |
| 5 | **agy-hub parity** | Polish so that agy works as a full hub when Claude's quota runs out | 5th |

The five-layer order (base + cost policy → delegate CC→agy → global panel → onboarding + profiles → agy-hub parity) came from [0007](decisions/0007-five-layers-and-profiles.md), now superseded. **Current v1 ([0043](decisions/0043-v1-is-the-complete-pack.md), superseding [0029](decisions/0029-reference-pack-v1-scope.md)):** the complete pack, with no intermediate releases: the base with the cost policy, `delegate` in its `standalone` and `orca` variants ([0028](decisions/0028-standalone-and-orca-variants.md)) and the profiles of [0044](decisions/0044-v1-profile-set.md). No mods, so no global panel ([0044](decisions/0044-v1-profile-set.md) update); headless agy is a viable hub ([0043](decisions/0043-v1-is-the-complete-pack.md) update, measurement 1).

Why this shape: the author's own usage audit showed that 87 % of consumption was subagents, 93 % of that spend on inherited Opus, and that the fixed prefix (~16–20k tokens of base, ~45k per subagent) is paid on every call (internal research (not published): usage audit and harness discovery).

---

## 2. Cross-cutting principles

A pattern that repeats across the four profiles and the audit. They are the backbone of the base.

| # | Principle | What it means in practice | Evidence |
|---|---|---|---|
| P1 | **Scripts and CLI before MCP** | A command that returns a summary costs ~0 fixed tokens. GitHub MCP: 11–55k tokens of schemas versus `gh` at ~0 [C]. Playwright, Supabase, Cloudflare, Godot, Tauri and Windows MCP: no MCP by default | Internal research (not published): tooling, web, Godot and desktop profiles; browser tooling |
| P2 | **Verification hooks with a cap and a `timeout`** | `Stop` with typecheck/lint/test, output truncated to ~20 lines, once per turn. Every hook carries a `timeout` (there were 7 h hangs; only one Godot game project's hooks have one) | Internal research (not published): web, Godot and tooling profiles; harness discovery |
| P3 | **`permissions.deny` for secrets; a size-based `Read` hook for artifacts** | There is no `.claudeignore`. `deny` covers secrets only; `node_modules`, `dist`, `target`, `.godot`, lockfiles, Lighthouse JSON and logs are guarded by a `Read` hook that rejects full reads of large files ([0039](decisions/0039-artifact-reads-guarded-by-size.md)). One accidental `Read` costs more than a normal day (lockfile 24–75k tokens; 9 Lighthouse JSON files ≈ 1M). A Read deny blocks the Bash file commands Claude Code recognizes (`cat`, `head`, `rg <file>`), but not `python`/`cmd` that name the file (a Bash hook catches those) or an unnamed recursive search (measured 2026-11-01, [0038](decisions/0038-base-bash-guards-ask-and-deny.md)) | Internal research (not published): web, Godot, desktop and tooling profiles |
| P4 | **Short `AGENTS.md`, no "read this huge file at startup"** | Only what is not discoverable by reading the code: commands, hard rules, pointers. Long context files raise cost by >20 % without improving success [H]. The main web project instructs reading ~32k tokens at startup | Internal research (not published): workflow alternatives; web and Godot profiles |
| P5 | **One fresh-context review, on demand** | One reviewer focused on the dominant risk, correctness gaps only. No 4R by default. In one tooling project the lenses that found the most were reliability and resilience | Internal research (not published): tooling profile, workflow alternatives, SDD usage pattern |
| P6 | **Policy in config and hooks, not in prompt text** | Explicit model in `Agent`, quota cap, `timeout`, guards: code. Phrases in the chat were not followed ("choose the model well", quota caps that changed 8 times) | [0002](decisions/0002-built-in-cost-policy.md); internal research (not published): usage audit and harness discovery |
| P7 | **Bounded output by design and derived state** | Scripts print failures + count + log path; state is derived by a script, not narrated | Internal research (not published): Godot and tooling profiles; harness discovery |
| P8 | **Measure before adopting** | The savings figures for RTK, codegraph, agent-browser and gopls come from the vendor. Every new tool comes in with its own A/B of total tokens, not percentages | Internal research (not published): memory and code intelligence, browser tooling, tooling profile |

---

## 3. Global base

Installed once, valid for any project and for the three harnesses (Claude Code and agy in full, OpenCode minimal).

### Proposed content and always-on cost

| Component | Where | Tokens | Note |
|---|---|---|---|
| Core global `AGENTS.md`: conventional commits without attribution, tools (bat/rg/fd), language, "do not declare done without an executable check", "if the diff fits in one sentence do not plan", "after two failed corrections clear the context", "answers brief by default; expand only when the user explicitly asks to elaborate or explain", "one question at a time, then stop and wait", "each question to the user carries brief context: where it comes from and what each answer causes", "verify before agreeing; when the user is wrong, explain why with evidence", "propose alternatives with tradeoffs when relevant" (confirmed by the author, 2026-10-30); one line to load `dotai-profiles` when a task needs a profile the project lacks (the catalog line of [0040](decisions/0040-project-onboarding-and-on-demand-profiles.md) is gone, [0047](decisions/0047-adopt-dotai-owned-onboarding.md)); "if the task needs project state, read `STATUS.md` first" (read on demand, never at session start), with the `STATUS.md` shape (phase, broken, next; ≤40 lines) and the `HANDOFF.md` shape (goal, state, next step, key files; written when suggesting a clean context, [0024](decisions/0024-sessions-by-topic-clean-context.md)) in two or three lines each, not as template files (confirmed 2026-11-01) | `~/.claude` (via `claude-md-and-agents-md`), `~/.gemini/config`, OpenCode | ~800 [M, 05] + ~20 [I] for the brief-answers rule | A single source, no generated `CLAUDE.md` (internal research (not published): state of the art). Updated by [dotai 0012](../../dotai/docs/decisions/0012-rules-file-per-harness.md): in Claude Code a `CLAUDE.md` is generated from the same source |
| Cost policy as text (Opus/Sonnet/Haiku tiers, "explicit model") | same `AGENTS.md` | ~100 [I] | Enforcement goes through a hook, not through this text |
| Engram through its pinned CLI: a `memory` skill plus a `SessionStart` hook (preferences and pinned items, capped ~300) and a `PreCompact` hook for the session summary; no MCP ([0041](decisions/0041-engram-via-cli-and-hooks.md), [0042](decisions/0042-memory-save-policy.md), 2026-11-01) | skill + hooks + binary | ~50 listed + ≤300 injected | ~1.9k today (MCP instructions ~1.2k + SessionStart protocol ~0.7k); both go away with the MCP (internal research (not published): memory and code intelligence; [0005](decisions/0005-engram-as-memory-backend.md)) |
| No output style (decided 2026-11-01). Brevity, one thing at a time, verify before agreeing and the language split are already in the core `AGENTS.md`; it adds "tone: neutral and warm" (~10 tokens) | — | 0 | ~2,000 today with the Gentleman style [M, Q2]; dropping it also removes duplicated rules |
| `delegate` skill (how and when Claude orchestrates agy) | skills | ~100 [I] | Replaces per-project redefinition |
| Base skill and agent descriptions | — | ≤500 [M, 05] | Versus ~7k of skills + ~2k of agents today |
| **`PreToolUse` hook on `Agent`**: requires `model` | settings | 0 | Strict, with the selection criterion in the rejection and an Opus allowlist by role ([0030](decisions/0030-explicit-model-and-effort-enforcement.md)). Effort cannot be set per launch in Claude Code: it comes from the subagent definition (0030; agents without a declared effort, generic built-ins included, are rejected) |
| **Hook that requires a `timeout`** on test commands and long calls | settings | 0 | Prevents the 7 h and 5 h hangs |
| `BASH_DEFAULT_TIMEOUT_MS=600000`, `BASH_MAX_TIMEOUT_MS=1800000` (2026-10-31). From the author's history, 148k foreground Bash calls: p90 64 s, p99 ~530 s; the most-used explicit values were 600000 and 1800000. Calls over 1 h were wait loops, not work | settings (env) | 0 | Bash duration analysis, 2026-10-31 (internal research, not published) |
| Generic guards: `git stash`, `git reset --hard` and `taskkill /IM` ask the author for approval (rejected in headless runs); `taskkill /PID` passes ([0038](decisions/0038-base-bash-guards-ask-and-deny.md)) | common core + per-harness adapter | 0 | `guard_core` core with tests, thin adapters (internal research (not published): harness discovery) |
| Base `permissions.deny` for secrets, plus a size-based `Read` hook for artifacts, lockfiles and logs ([0039](decisions/0039-artifact-reads-guarded-by-size.md)). Secrets: `.env`/`.env.*` except `.env.example`, `*.pem`, `*.key`, `id_rsa*`, `~/.ssh/**`, `~/.aws/**`, `~/.config/gcloud/**`, `~/.wrangler/**`, `~/.claude/.credentials.json`, agy's OAuth token under `~/.gemini/` (confirmed 2026-10-31). Enforced in Bash too ([0038](decisions/0038-base-bash-guards-ask-and-deny.md)) | settings | 0 | P3 |
| Statusline + `rate_limits.json` and quota policy as config | script/config | 0 | Soft cap in interactive sessions (warn and ask), hard cap in autonomous work (stop, save state, report); thresholds only from the base `delegate` tool's config, never from the chat ([0019](decisions/0019-quota-cap-by-who-is-in-charge.md), [0034](decisions/0034-delegate-packaging-base-tool-variant-runners.md)) |
| `STATUS.md`, `HANDOFF.md` and decision record templates ([template](decisions/template.md)) | templates | 0 | State shared across harnesses |
| Variables and flags: `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`, workflows enabled, `/effort ultracode` off, `workflowSizeGuideline: small\|medium`, `Workflow(<name>)` in allow | settings | 0 | [0002](decisions/0002-built-in-cost-policy.md), [0003](decisions/0003-workflows-yes-ultracode-off-by-default.md) |
| **Total always-on in Claude Code** | | **~2,000–2,700** | **Caps: rules ≤ 2,500, listing ≤ ~2,000, total warn 4,000 / fail 5,000 ([0046](decisions/0046-split-always-on-budget.md))** |

### Target budget versus today

| Harness | Today | Target | How |
|---|---|---|---|
| Claude Code (main thread and each subagent) | ~16–20k per request [M, 02] (`CLAUDE.md` 5.5k, style 1.6k, skills ~7k, agents ~2k, MCP ~2k) | **Rules ≤2,500, listing ≤~2,000, total ≤4,000** ([0046](decisions/0046-split-always-on-budget.md)) | Take orchestration/review/receipts out of the prompt; occasional skills and agents per profile (the base keeps `delegate` and a small subagent roster, [0037](decisions/0037-base-subagent-roster.md), [0040](decisions/0040-project-onboarding-and-on-demand-profiles.md) update) |
| agy | +~13,200 from `GEMINI.md` (52.8 KB) [M] | Same caps as Claude Code ([0046](decisions/0046-split-always-on-budget.md)) | `GEMINI.md` replaced by the same core `AGENTS.md`. agy limit: 24 KB per file and 20k tokens of always-on rules (internal research (not published): state of the art) |
| OpenCode | ~3,000 (global `AGENTS.md`) [M] | Same core, or nothing | Occasional use |

The budget is verifiable: `dotai doctor` should measure the tokens of the first request, report rules, listing and total separately, warn at 4,000 and fail at 5,000 ([0046](decisions/0046-split-always-on-budget.md); engine question). Subagents pay the same prefix, which is why the savings multiply.

**Measured 2026-11-02 (measurement 2, [0008](decisions/0008-always-on-budget-values.md) update) [M]:** in Claude Code the assembled base adds +1,759 tokens to a bare first request (30,938), 55% of the then 3,200 cap; base plus `godot` +2,331; base plus eight profiles +4,977. The base's real cost is about 1.7× the static estimate (static base 1,048: core rule 831, skill listing 113, agent listing 104; static profiles from 291 for `godot` to 0 for `seo`). Consequences:

- Superseded on 2026-11-03 by split caps ([0046](decisions/0046-split-always-on-budget.md)): rules ≤ 2,500 real, listing ≤ ~2,000 real (≤ ~100 per entry, externals counted), total warn 4,000 and fail 5,000. The measured factor per added profile is ~2.0× static in Claude Code (`godot` 1.97×, all eight 1.98×). `dotai-analyze` sums rules and listing separately and warns per cap.
- agy, measured: base +1,630 (1.55× static), base plus `godot` +2,300. agy shares the Claude Code caps ([0046](decisions/0046-split-always-on-budget.md)); no agy-only trim.

### What leaves the base

`sdd-*` (out entirely, [0020](decisions/0020-drop-sdd-lightweight-task-router.md)), `jd-*`, `review-*` (on demand or out), the ~4,600 tokens of review/receipts contract in `CLAUDE.md`, per-prompt `skill-registry refresh`, `GEMINI.md`, the 12 `pixel-agents` hooks, global `context7` and `codegraph`, Gmail/Calendar/Drive/Docs connectors in coding sessions. Details in internal research (not published): component catalog.

---

## 4. Profiles

Profiles are flat and combinable ([dotai 0023](../../dotai/docs/decisions/0023-flat-profiles-and-layer-merge-rules.md)) and part of v1 ([0043](decisions/0043-v1-is-the-complete-pack.md)). The set, its evidence and the rejected alternatives (design, SEO and Cloudflare inside `web`; per-stack profiles; `astro-cloudflare`, `next-vercel-supabase`) are in [0044](decisions/0044-v1-profile-set.md). Each profile's content, measured numbers, external items and onboarding clashes are in its README; this section does not repeat them.

| Profile | README |
|---|---|
| `godot` | [profiles/godot](../profiles/godot/README.md) |
| `autonomous-orchestra` | [profiles/autonomous-orchestra](../profiles/autonomous-orchestra/README.md) |
| `web` | [profiles/web](../profiles/web/README.md) |
| `ui` | [profiles/ui](../profiles/ui/README.md) |
| `seo` | [profiles/seo](../profiles/seo/README.md) |
| `cloudflare` | [profiles/cloudflare](../profiles/cloudflare/README.md) |
| `video` | [profiles/video](../profiles/video/README.md) |
| `tooling` | [profiles/tooling](../profiles/tooling/README.md) |
| `desktop` | [profiles/desktop](../profiles/desktop/README.md) |

Always-on cost per profile and the combinations that fit the cap: [§3](#3-global-base) (measurement 2) and the `dotai-analyze` budget rules.

### Still valid from the research, not recorded elsewhere

- **godot, avoid:** Serena or an LSP server (needs an open editor; unusable from agy), automatic `gdformat` (150 of 190 files would change), reading `.godot/`, `*.import` and `*.uid`. Review cards go through the external tracker's `review-rounds` preset ([0027](decisions/0027-review-rounds-preset-in-the-tracker.md)); `agy-review` stays uncalibrated ([0044](decisions/0044-v1-profile-set.md) update: visual review stays in Claude).
- **web, avoid:** a global "NEVER Playwright" rule, reading the full decision log and work log at startup (~32k tokens in the main web project), duplicated skills in `.agents/` and `.claude/`. The language-learning project is `tooling`, not `web` ([0010](decisions/0010-onboarding-profile-classification.md)).
- **tooling:** an "Invariants" table (invariant → guard test) in the project `AGENTS.md`; the "System map" goes to an on-demand file. Never SDD, 4R or receipts ([0020](decisions/0020-drop-sdd-lightweight-task-router.md), [0036](decisions/0036-single-reviewer-by-focus.md)).
- **desktop:** the Electron app has no E2E with a real window yet (CI never launches Electron) and no `AGENTS.md`.

### Onboarding

dotai onboards the project ([0047](decisions/0047-adopt-dotai-owned-onboarding.md), [dotai 0045](../../dotai/docs/decisions/0045-dotai-owned-project-onboarding.md)): its session-start hook says when the repository is not set up or its profiles may no longer fit, and its generated `dotai-profiles` skill proposes profiles from each profile's `description` and `hints` in `dotai.yaml`, then applies them after approval. The pack's `dotai-analyze` base skill only cleans up old config that clashes with the applied profiles, after a backup, and warns on the applied set's budget ([0040](decisions/0040-project-onboarding-and-on-demand-profiles.md)). `dotai doctor` diffs the generated output against the source.

---

## 5. Memory and code intelligence

Evaluation criterion: does it save tokens when configured well? Measured on the author's own data on 2026-11-02 (items below).

### Memory: chosen direction

| Decision | Detail | Evidence |
|---|---|---|
| **Engram as the backend** | The only verified option with a shared Claude Code ↔ agy store without an extra process; 363 `mem_save` versus 36 searches (10:1) | Internal research (not published): memory and code intelligence |
| **Attack the fixed cost, not the storage** | Take the always-on protocol out of `CLAUDE.md`/`GEMINI.md`; through the CLI and a `memory` skill, no MCP; the session summary is saved by a `PreCompact` hook; `SessionStart` injects preferences and pinned items, capped at ~300 tokens | [0005](decisions/0005-engram-as-memory-backend.md), [0041](decisions/0041-engram-via-cli-and-hooks.md), [0042](decisions/0042-memory-save-policy.md) |
| **Split** | Native memory for per-project facts that are not in the repository (there are already 12 `MEMORY.md` files, one Godot game project's close to the 25 KB cap); Engram for what serves across projects: preferences and feedback, non-obvious tool gotchas, cross-project conventions; nothing the repository already records ([0042](decisions/0042-memory-save-policy.md)) | Internal research (not published): memory and code intelligence |
| **Do not adopt** | claude-mem (ingestion with its own LLM, consumes quota), mem0. basic-memory only in Phase 1 and if AGPL is accepted | Internal research (not published): memory and code intelligence |
| **Phase 1** (`dotai-mem`, 4–8 weeks) | Only if measurement shows gaps | [0005](decisions/0005-engram-as-memory-backend.md) |

Open Engram risks: Windows write bugs (#1937, #1949, #2016, open on v3.6; no real write failure in 936 saves, [0042](decisions/0042-memory-save-policy.md)), the fast-changing release surface (hence the pinned version, [0041](decisions/0041-engram-via-cli-and-hooks.md)) and a write-heavy use (852 saves against 104 reads; [0042](decisions/0042-memory-save-policy.md) limits what is saved).

### Code intelligence: chosen direction

| Decision | Detail |
|---|---|
| **Neither remove nor expand codegraph: a measured pilot** | The author's hypothesis is supported: it is poorly integrated, not useless, but only for TS/web (internal research (not published): memory and code intelligence) |
| **Correct configuration** | Update 0.9.8 → 1.6.2; `codegraph install` (adds the section that teaches **subagents**); `codegraph init -i` per project; registration **at project level**, not global (avoids ~1.1k tokens in projects without an index and in ~80 worktrees) |
| **Pilot** | Measured 2026-11-02 on the main web project (measurement 4, [0012](decisions/0012-memory-and-code-intelligence-keep-and-measure.md) update): −6% tokens, −37% tool calls, −3% cost, and all three factual errors in codegraph runs. Not in `web` or `tooling` by default; an opt-in pilot only in large TS/Go/Python repos (baseline ≥15 calls, roughly >2k files), with the `codegraph install` section when subagents work |
| **Godot** | Do not index (no GDScript). Serena is the only option with real support, but it requires an open editor: it clashes with the "no editor" rule and with agy |
| **Usage rule** | Conditional ("to trace flows across more than 3 files"), not "NEVER grep" |
| **No independent evidence** | Vendor: −62 % tokens; its own README admits +80 % residual context; a preprint measured quality at 83 % versus 92 % [H/C] |

### What had to be measured (from internal research (not published): memory and code intelligence, "What to measure")

1. ~~Real fixed cost of the first request~~: done 2026-11-02 on the assembled base, which carries no Engram or codegraph MCP (measurement 2, [0008](decisions/0008-always-on-budget-values.md) update; Engram through its CLI, [0041](decisions/0041-engram-via-cli-and-hooks.md); codegraph costs 1.1–1.8k per session, [0012](decisions/0012-memory-and-code-intelligence-keep-and-measure.md) update).
2. ~~Engram usage ratio~~ (done, [0042](decisions/0042-memory-save-policy.md)): of 363 `mem_save`, how many were retrieved and how many changed a decision.
3. ~~Native vs Engram coverage~~ (done, [0042](decisions/0042-memory-save-policy.md)): classify 20–30 observations (would they fit in a `MEMORY.md`? how many crossed over to agy?).
4. ~~codegraph A/B on the main web project~~: done 2026-11-02 (measurement 4, [0012](decisions/0012-memory-and-code-intelligence-keep-and-measure.md) update): an opt-in pilot, not a default.
5. ~~A/B delegating to a Sonnet subagent with the `codegraph install` section~~: done in the same trial (one delegated pair: −31% tokens, −7% cost; the section is required when subagents work, [0012](decisions/0012-memory-and-code-intelligence-keep-and-measure.md) update).
6. Pending: residual context at the end of a long session; index freshness after edits in worktrees.
7. Pending, low priority (Serena needs an open editor; Godot's LSP listens headless but Serena was not tried, [godot README](../profiles/godot/README.md)): Serena versus `rg` + Read on 5 questions, and whether the LSP responds when agy works delegated.

---

## 6. Workflows by task type

Revises the table in [0001](decisions/0001-workflows-by-task-type.md) (superseded by [0023](decisions/0023-workflows-by-task-type-v2.md)) using internal research (not published) on workflow alternatives and the SDD usage pattern: adds verification and a cap per row, and changes two rows.

| Task type | Workflow | Default verification | Cap | Source |
|---|---|---|---|---|
| Small change (the diff fits in one sentence) | Direct prompt, no plan | One executable check (`check` script) | 1 attempt + 1 correction; then `/clear` and rephrase | Internal research (not published) |
| Bug | Failing test → fix → verify | The reproducing test passes + a bounded suite | 2 failed corrections → clear the context | Internal research (not published) |
| Medium change | Plan mode → implement → fresh-context review (`plan-then-do`) | Check + 1 fresh reviewer focused on the dominant risk, correctness gaps only | 1 review pass + 1 correction | Internal research (not published) |
| Large feature | Interview → self-contained `SPEC.md` → new session (`interview-spec`) | End-to-end verification written at the end of the spec | One new session per milestone | Internal research (not published) |
| **High risk or many verifiable milestones** (changed) | `spec-gated`: per-change spec (delta) + milestones with criteria + fresh review; SDD is not installed ([0020](decisions/0020-drop-sdd-lightweight-task-router.md)) | Milestone by milestone + fresh review | 1 bounded correction, then escalate | Internal research (not published) |
| Exploratory / game feel | `explore-loop`: checkpoints, `/rewind`, minimal spec or none | Visual verification (GIF/capture); the owner decides | Taste: 1 round + 1 check. Engine correctness: gate measured against its noise band; phase budget (one Godot game project: 12 iterations, then an arbiter) | Internal research (not published) |
| **Autonomous backlog** (changed) | Adaptable ingredients (next table), not a fixed recipe | Executable check + separate verifier | Turn clause in `/goal`; "two rounds in a row with no improvement"; quota cap in config | Internal research (not published) |
| Audit / migration / research | Bounded workflow (`workflow-small`) | Adversarial verification | Pilot on one slice; `workflowSizeGuideline: small\|medium`; no human gates inside | Internal research (not published) |

Supporting rules: a spec-gated workflow is chosen by **verifiable milestones**, not by size (internal research (not published): SDD usage pattern); every scaffolding ingredient is re-evaluated with each model generation (internal research (not published): workflow alternatives); human gates go between runs, not inside a workflow ([0003](decisions/0003-workflows-yes-ultracode-off-by-default.md)). The analyzer assigns the default level by project type (godot → `explore-loop`; backend → `interview-spec`).

### Autonomous work: ingredients (not a template)

Versioned, dated knowledge that the agent combines and adapts per project, as the author's own briefs already do (Goal, Sources, Scope, Phases, Success criterion; internal research (not published): SDD usage pattern).

| Ingredient | Solves | Skip if |
|---|---|---|
| Phases (understand → design → milestones → verify) | Jumping into coding without understanding | Mechanical or already understood task |
| Measurable success criterion (end state + check + constraints) | Lets the work stop and someone else verify it | Never in autonomous mode |
| Separately verifiable milestones, each with its command | Advancing with evidence and resuming | Single-step task |
| Work list with status (JSON `passes` or checklist) | "Done" declared too early | Fewer than ~5 items |
| Progress and decisions file (`STATUS`, `HANDOFF`) | Fresh context per item without losing the thread | Single short session |
| One item per fresh context ([0004](decisions/0004-keep-1m-context-thin-orchestrator.md)) | Noise accumulation | Items highly dependent on each other |
| Round and turn caps | Loops and cost | Never in autonomous mode |
| Fresh-context verification | Self-evaluation is lenient | The check is 100 % deterministic |
| Evaluator calibration | An uncalibrated evaluator approves broken work (agy: 73 % fail) | The check is a script |
| Pilot on one slice | Measures the cost before committing to it | Cheap runs |
| Human review between runs | A workflow cannot ask questions | There are no human decisions |

The `/goal` evaluator does not execute anything: it only judges what Claude showed. The condition must ask for the check's output to be shown; if the app has to be run, a verifier with tools is needed (internal research (not published): workflow alternatives).

---

## 7. Delegate and quota routing

### What the research says

| Finding | Evidence |
|---|---|
| There are **two incompatible runners**: `agy_review.py` (Python, 95 % threshold, schema with `media`/`verdict`) and `agy-task.mjs` (Node, 85 % threshold, schema with `kind`/`specPath`), with hardcoded absolute user paths and a cp1252 bug (3 errors) | Internal research (not published): harness discovery |
| `agy-task.mjs` already routes: Gemini pool → third-party pool (Claude via agy) → **exit 3** ("use Claude's own plan"). 26 code jobs = 2.64M Gemini tokens that did not touch Claude's quota | Internal research (not published): harness discovery and component catalog |
| Reusable: choose the model by quota, "no changes" check by snapshot/diff, kill by PID tree when the timeout expires, spec by file if it exceeds 20k characters, "no shell" preamble in code mode | Internal research (not published): harness discovery |
| agy's quota lives in `~/.gemini/antigravity-cli/rate_limits.json` (two pools: Google and third party); Claude's in `~/.claude/rate_limits.json`, dumped by the statusline | Internal research (not published): harness discovery |
| Jobs live as atomic JSON in `~/.claude/agy-jobs/<project>/`; a per-job token ledger is missing | Internal research (not published): harness discovery |
| agy has no subagents: roles run in sequence as a skill. Modes: `default`, `accept-edits`, `plan`. Its own hooks (`.agents/hooks.json`, `PreToolUse`) | Internal research (not published): state of the art and workflow alternatives |
| The Oct-16 incident: Claude worked from OpenCode with the API, consumed the credits and left work half done. Never set `ANTHROPIC_API_KEY` globally | Internal research (not published): harness discovery |

### Proposed directional rule

| Hub | May delegate to | Never delegates to | Notes |
|---|---|---|---|
| **Claude Code** | agy, choosing between the Google pool and the third-party pool according to each one's 5 h and 7 d windows | — | If both pools are above the threshold: it does not delegate, runs on Sonnet/Haiku or defers. Reserved for orchestrating, designing and judging |
| **agy** (hub when Claude runs out) | Its other pool; scripts and shell tools | **Claude, under no circumstances** (neither via agy third-party if that consumes Claude's exhausted quota, nor via OpenCode with the API) | The current exit 3 ("use Claude") is inverted: in agy-hub the exhaustion exit is "defer and notify" |
| **OpenCode** | Free models and third-party/automation credits | Claude with the API for main-flow work | Minimal and occasional |

A single job schema, token ledger, forced UTF-8, timeouts and no absolute paths. The policy (thresholds, windows, preferred pool) is configuration, not chat ([P-04](decisions/0019-quota-cap-by-who-is-in-charge.md)); **update (2026-10-28):** it is configuration of the base `delegate` tool at user scope, not of a profile, and the backend is one `delegate-backend` tool per variant ([0034](decisions/0034-delegate-packaging-base-tool-variant-runners.md)). **Update (2026-10-26):** the job contract accepted in [0022](decisions/0022-delegate-visible-orca-backend.md) is `agy -p --output-format json` (`status`, `error`, `usage`, end of process), the model and effort declared per job and validated as a pair, and the long result written to a job file; it replaces the earlier `delegate run --harness agy|opencode --kind code|review --spec f.md` sketch. A `rate_limits.json` with a stale `ts` counts as unknown; unknown quota counts as available ([0022](decisions/0022-delegate-visible-orca-backend.md), update 2026-10-26).

### Global panel (layer 3, after v1)

- A Claude Code mod with tested pure logic (`logic.ts`) and a thin UI (`register.tsx`), following the design of an existing panel mod of the author (internal research (not published): harness discovery). It shows Claude's 5 h/7 d quotas and those of agy's two pools, pace, and active delegations with duration and tokens.
- Per-project extension sections (pending cards, workstreams, backlog status) registered from the profile.
- Risk: the mods API is new (documented since v2.1.290) and its stability was not evaluated (internal research (not published): state of the art, critique, gap 4). It only draws in the terminal.

### Delegate to-dos

- Confirm that agy's `rate_limits.json` exposes the 5 h and 7 d windows with their reset per pool (the research only documents two pools and thresholds).
- ~~Test headless agy as a full hub~~: viable (measurement 1, [0043](decisions/0043-v1-is-the-complete-pack.md) update 2026-11-02): shell, async subagents with a model setting (pin `gemini-*`), tasks, scheduling; ~19k tokens per subagent launch. No quota signal under `-p` (the statusline does not run); closed for v1 by counting an unknown quota as available and detecting the quota error ([0043](decisions/0043-v1-is-the-complete-pack.md) update 2026-11-19).
- agy as a visual judge: calibration before trusting it ([P-05](OPEN-QUESTIONS.md)); 12 or more consecutive frames for motion.
- `PreToolUse` support in agy for guards and RTK (unverified).
- `godot-gdscript` only exists for Claude Code: mirror it as a standard `SKILL.md` for agy.

---

## 8. Decisions

The decisions that were in this section were migrated to individual records (one file per decision) in [decisions/README.md](decisions/README.md). The engine's records stay in the dotai repository; each record here keeps its former dotai number in its `origin` field.

---

## 9. Open questions

Questions that require a decision from the maintainer or a measurement are in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md). Resolved ones were removed: they are recorded in the corresponding decisions.
