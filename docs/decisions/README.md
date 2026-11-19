# Decision log

One file per decision (format based on MADR 4.0.0, see [template.md](template.md)). Only `accepted` decisions are binding; `proposed` is non-binding context; `superseded` is history only. An accepted record is not rewritten: it is replaced by a new one.

> This index is maintained by hand for now.

These records moved from the dotai engine repository on 2026-10-26 and were renumbered from 0001 in their original order. Each record's `origin` field keeps its former dotai number. Records split from a mixed dotai record hold only the pack half; the engine half stays in dotai.

Links to engine records use the sibling path `../../../dotai/docs/decisions/<file>`, so both repositories must be checked out side by side. They become URLs when the repositories are published.

## In force

| No. | Title | Status | Date |
|---|---|---|---|
| [0002](0002-built-in-cost-policy.md) | Built-in cost policy | accepted | 2026-10-19 |
| [0003](0003-workflows-yes-ultracode-off-by-default.md) | Workflows yes, ultracode off by default | accepted | 2026-10-19 |
| [0004](0004-keep-1m-context-thin-orchestrator.md) | The 1M context stays; the operating mode changes | accepted | 2026-10-19 |
| [0005](0005-engram-as-memory-backend.md) | Memory: engram as the backend, without cloning it (for now) | accepted | 2026-10-19 |
| [0008](0008-always-on-budget-values.md) | Always-on budget values (partially superseded by 0046) | accepted | 2026-10-26 |
| [0009](0009-directional-delegation-with-quota-config.md) | Directional delegation with quota as configuration (partially superseded by 0034 and 0050) | accepted | 2026-10-20 |
| [0010](0010-onboarding-profile-classification.md) | Onboarding in the reference pack: classification and analyzer (partially superseded by dotai 0023) | accepted | 2026-10-20 |
| [0011](0011-browser-tooling-split.md) | Browser tooling split | accepted | 2026-10-20 |
| [0012](0012-memory-and-code-intelligence-keep-and-measure.md) | Memory and code intelligence: keep and measure | accepted | 2026-10-20 |
| [0013](0013-autonomous-work-as-ingredients.md) | Autonomous work as ingredients, not a template | accepted | 2026-10-20 |
| [0014](0014-base-principles-scripts-hooks-deny.md) | Base principles: scripts, hooks and deny (partially superseded by 0039) | accepted | 2026-10-26 |
| [0016](0016-review-web-approval-by-criterion-type.md) | `review-web` approval depends on the type of criterion | accepted | 2026-10-20 |
| [0017](0017-statusline-in-base.md) | Statusline in the base | accepted | 2026-10-20 |
| [0019](0019-quota-cap-by-who-is-in-charge.md) | Quota cap by who is in charge (partially superseded by 0034) | accepted | 2026-10-23 |
| [0020](0020-drop-sdd-lightweight-task-router.md) | Drop SDD; own lightweight task router | accepted | 2026-10-23 |
| [0021](0021-orca-extend-dont-fork.md) | Orca: extend, don't fork | accepted | 2026-10-23 |
| [0022](0022-delegate-visible-orca-backend.md) | `delegate` with a visible backend in Orca | accepted | 2026-10-23 |
| [0023](0023-workflows-by-task-type-v2.md) | Workflows by task type (v2) | accepted | 2026-10-23 |
| [0024](0024-sessions-by-topic-clean-context.md) | Sessions by topic: the agent suggests a clean context | accepted | 2026-10-23 |
| [0026](0026-mods-incident-and-value.md) | Mods in the reference pack: incident and open value | accepted | 2026-10-23 |
| [0027](0027-review-rounds-preset-in-the-tracker.md) | Review cards are a `review-rounds` preset of the external tracker | accepted | 2026-10-24 |
| [0028](0028-standalone-and-orca-variants.md) | The reference pack's `standalone` and `orca` variants (partially superseded by 0031) | accepted | 2026-10-24 |
| [0030](0030-explicit-model-and-effort-enforcement.md) | Explicit model and effort: enforcement by definition | accepted | 2026-10-26 |
| [0031](0031-orca-single-delegation-terminal-agy-p.md) | Single delegation in the `orca` variant: Orca terminal running `agy -p` | accepted | 2026-10-26 |
| [0032](0032-variant-parity-by-use-case.md) | Variant parity by use case | accepted | 2026-10-26 |
| [0033](0033-coexist-with-orca-installed-skills.md) | Coexist with the skills Orca installs | accepted | 2026-10-28 |
| [0034](0034-delegate-packaging-base-tool-variant-runners.md) | `delegate` packaging: one base skill and tool, one runner per variant, thresholds in the tool | accepted | 2026-10-28 |
| [0035](0035-task-router-refinements.md) | Task router refinements | accepted | 2026-10-30 |
| [0036](0036-single-reviewer-by-focus.md) | One reviewer, chosen by focus and risk signals | accepted | 2026-10-30 |
| [0037](0037-base-subagent-roster.md) | Base subagent roster | accepted | 2026-10-30 |
| [0038](0038-base-bash-guards-ask-and-deny.md) | Base Bash guards: ask for destructive commands, deny for denied paths | accepted | 2026-10-31 |
| [0039](0039-artifact-reads-guarded-by-size.md) | Artifact reads are guarded by size, not denied | accepted | 2026-10-31 |
| [0040](0040-project-onboarding-and-on-demand-profiles.md) | Project onboarding by the pack, and profiles suggested on demand (partially superseded by 0047) | accepted | 2026-11-01 |
| [0041](0041-engram-via-cli-and-hooks.md) | Engram through its CLI and hooks, not an always-loaded MCP | accepted | 2026-11-01 |
| [0042](0042-memory-save-policy.md) | Memory save policy: Engram for the long term, `MEMORY.md` per project | accepted | 2026-11-01 |
| [0043](0043-v1-is-the-complete-pack.md) | v1 is the complete pack, profiles included | accepted | 2026-11-01 |
| [0044](0044-v1-profile-set.md) | The v1 profile set | accepted | 2026-11-01 |
| [0045](0045-godot-guards-with-load-based-cap.md) | Godot guards in every Godot project, with a load-based process cap | accepted | 2026-11-01 |
| [0046](0046-split-always-on-budget.md) | Split always-on budget: rules, listing, total | accepted | 2026-11-03 |
| [0047](0047-adopt-dotai-owned-onboarding.md) | Adopt dotai's project onboarding; the pack keeps only the clash cleanup | accepted | 2026-11-18 |
| [0048](0048-versioning-and-release.md) | Versioning and release | accepted | 2026-11-19 |
| [0049](0049-vercel-profile.md) | A `vercel` profile: CLI and skill, no MCP | accepted | 2026-11-19 |
| [0050](0050-delegation-direction-as-user-configuration.md) | Delegation direction as user configuration (`primary`) | accepted | 2026-11-19 |

## Superseded (history only)

| No. | Title | Status | Superseded by |
|---|---|---|---|
| [0001](0001-workflows-by-task-type.md) | Several workflows by task type; SDD is not the default | superseded | [0023](0023-workflows-by-task-type-v2.md) |
| [0006](0006-initial-profiles-modules-and-build-order.md) | Initial profiles, modules and build order | superseded | [0007](0007-five-layers-and-profiles.md) |
| [0007](0007-five-layers-and-profiles.md) | Five-layer product, v1 order and profiles | superseded | [0029](0029-reference-pack-v1-scope.md) |
| [0029](0029-reference-pack-v1-scope.md) | v1 scope of the reference pack | superseded | [0043](0043-v1-is-the-complete-pack.md) |
| [0018](0018-explicit-model-and-effort-per-delegation.md) | Explicit model and effort in every delegation | superseded | [0030](0030-explicit-model-and-effort-enforcement.md) |
| [0015](0015-review-web-in-base-local-server.md) | `review-web` in the base, with its own local server | superseded | [0027](0027-review-rounds-preset-in-the-tracker.md) |
| [0025](0025-common-base-two-execution-modes.md) | Common base and two execution modes (without Orca / with Orca) | superseded | [0028](0028-standalone-and-orca-variants.md) |

## See also

- [OPEN-QUESTIONS.md](../OPEN-QUESTIONS.md): open questions that are not decisions yet.
- [DESIGN.md](../DESIGN.md): consolidated design.
- [RUNTIME.md](../RUNTIME.md): the pack's runtime architecture.
- [Engine decision log](../../../dotai/docs/decisions/README.md).
