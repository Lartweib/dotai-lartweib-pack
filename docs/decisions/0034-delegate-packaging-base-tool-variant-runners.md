---
status: accepted
date: 2026-10-28
tags: [delegate, variants, quota, pack-format]
supersedes: [0009, 0019]   # partially: only "thresholds and the preferred pool are profile configuration"
---

# 0034 · `delegate` packaging: one base skill and tool, one runner per variant, thresholds in the tool

## Context

Three gaps appear when the `delegate` decisions are mapped onto [PACK-FORMAT](../../../dotai/docs/PACK-FORMAT.md):

1. [0009](0009-directional-delegation-with-quota-config.md) and [0019](0019-quota-cap-by-who-is-in-charge.md) make quota thresholds and the preferred pool "profile configuration". `delegate` is installed at user scope with the base and the variant, while profiles are project scope and cannot carry agy settings at all.
2. [0028](0028-standalone-and-orca-variants.md) keeps the cost policy (model/effort validation, pool choice) in the base, but the runner that applies it lives in `standalone`, and `orca` has no runner.
3. The content of the `orca` variant is undefined, and both variants must not redefine the same skill (one name, one owner).

PACK-FORMAT describes `dotai/tools/` and `dotai/runners/` only as "scripts and binaries the layer needs". It gives them no merge identity, no install path per scope, no runtime way to locate them (`${DOTAI_TOOLS}` is expanded only in `dotai/settings.yaml`), and no declared-override syntax for anything outside frontmatter.

## Decision

- **One `delegate` skill, in the base, backend-agnostic.** It calls a single backend command and never names Orca. No variant ships a skill, subagent or command named `delegate`.
- **Shared contract as a base tool** (`base/dotai/tools/`): model/effort pair validation, pool selection from `rate_limits.json` (stale counts as unknown, unknown counts as available, [0022](0022-delegate-visible-orca-backend.md)), quota-error detection, actual-model confirmation and the launch log. Both variants call it; no variant reimplements it.
- **One backend runner per variant** (`variants/<name>/dotai/runners/`), same command name in both, since only one variant is applied per user scope:
  - `standalone`: headless `agy -p --output-format json`, including parallel jobs with one job file each ([0032](0032-variant-parity-by-use-case.md)).
  - `orca`: `orca terminal create` running `agy -p` for a single delegation ([0031](0031-orca-single-delegation-terminal-agy-p.md)). For several workers, the runner prints a short guide (stub pattern of 0022) that points to Orca's `orchestration` skill by name and requires the base tool's checks before each `worker-start` and after startup; Orca's skills are never vendored and their names stay reserved ([0033](0033-coexist-with-orca-installed-skills.md)).
- **Thresholds and the preferred pool are configuration of the base `delegate` tool**, not a harness setting and not profile content. Defaults ship with the tool at user scope. They change only by editing that configuration, never from the chat (0019 otherwise stands).
- **Overrides.** v1: user scope only, base only; variants carry no threshold configuration. A variant override is allowed later only as a declared override, once the engine defines one for tool files. A per-project override is not offered: PACK-FORMAT has no project-scope configuration that a user-scope tool may read.

The layout above is conditional on the engine questions listed under Consequences; until they are answered it is the intended shape, not a verified one.

## Considered options

- **A (chosen):** base skill and tool, one runner per variant, thresholds in the base tool.
- **B:** each variant ships its own `delegate` skill with `overrides: true`. Rejected: two definitions of the policy drift, and the cost policy must not be droppable by a variant (0028).
- **C:** thresholds as `env` in `dotai/settings.yaml`. Rejected: per-harness (OpenCode drops `env`, agy has no project file), and `settings.yaml` in two layers is still `merge-pending`.

## Consequences

- Good: the cost policy has one owner; variants differ only in how agy is launched.
- Accepted cost: no per-project threshold in v1.
- Partially supersedes 0009 and 0019 (where thresholds live); their routing and soft/hard cap rules stand.
- Pending (engine, to be raised in the engine repository):
  - How a skill text, a hook command and a runner locate installed tools at runtime; `${DOTAI_TOOLS}` is only expanded in `dotai/settings.yaml`.
  - What distinguishes `runners/` from `tools/`, and their merge identity: a same file path in the base and the variant (error, override, union?), and whether `dotai validate` checks every variant or only the resolved one.
  - Whether a tool may ship non-executable configuration, and the declared-override syntax for it.

## Evidence

- Maintainer request, 2026-10-28; [PACK-FORMAT](../../../dotai/docs/PACK-FORMAT.md); [dotai 0025](../../../dotai/docs/decisions/0025-settings-as-per-harness-passthrough.md).

## Update 2026-11-01: engine answers

The engine answered the pending questions ([dotai 0030](../../../dotai/docs/decisions/0030-tools-paths-and-project-config.md), [dotai 0037](../../../dotai/docs/decisions/0037-tool-commands-resolved-per-os.md)).

- **Paths are resolved at install time, not at runtime.** `${DOTAI_TOOLS}` and `${DOTAI_PROJECT_TOOLS}` become absolute paths in every text file of the layers, skills and hooks included. In `settings.yaml`, `${DOTAI_TOOL:<name>}` becomes the full command for the OS.
- **`runners/` no longer exists.** The variant backend is a tool in `variants/<name>/dotai/tools/`. Base and variant are both user scope, and the same path in two layers of one scope is an error. So the base tool and the backend need different names: `delegate` (base: validation, pool selection, launch log) and `delegate-backend` (one per variant). Both variants may use the same name, because only one variant is applied.
- **Configuration files** may live next to a tool. A layer that adjusts another layer's tool config ships a file with a different name.
- **Project configuration now exists** (`.dotai/config.yaml`, found by walking up from the cwd). A per-project threshold override is therefore possible later; v1 stays user scope only.

## Update 2026-11-03: the shared contract is a base tool

The contract moved from a byte-identical copy in each variant to the base: `base/dotai/tools/delegate-core.mjs`. It is a library the backends import, not a command, so it ships no `.sh` or `.ps1` wrapper, and its name differs from `delegate-backend` as PACK-FORMAT requires for two layers of one scope. Each variant's `delegate-backend.mjs` loads it from `${DOTAI_TOOLS}` once staged, or from the base layer in the pack source, with the bootstrap the profile tools use for `hook-lib.mjs`; a missing core is one line on stderr and exit 1. A test checks that no variant ships the core and that both staged backends load the base one. The base statusline and the `Agent` hook use the same module for the launch log.
