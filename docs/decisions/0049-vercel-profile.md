---
status: accepted
date: 2026-11-19
tags: [profiles, vercel]
---

# 0049 · A `vercel` profile: CLI and skill, no MCP

## Context

[0044](0044-v1-profile-set.md) rejected a Next/Vercel/Supabase profile: usage was near zero. The author now has two projects deployed on Vercel and wants agents to work them through the vercel CLI.

Vercel offers three agent surfaces: an official `vercel-cli` skill in the `vercel/vercel` repository (Apache-2.0, also bundled in the `vercel/vercel-plugin` Claude Code plugin), the `vercel-labs/agent-skills` collection, and the Vercel MCP at `https://mcp.vercel.com`.

## Decision

A tenth profile, `vercel`, is added: a short always-on rule, a pack-owned `vercel` skill and the read-size path `.vercel/`. No MCP server. Its hints are `vercel.json` and `vercel.ts`; the description says it is for apps deployed on Vercel, since many such projects track neither file and `.vercel/` is untracked.

The rule and the skill require the user's approval for every production change (`--prod`, `promote`, `rollback`) and every env var change.

## Considered options

- **A (chosen):** a pack-owned skill written from the official CLI docs and the upstream skill.
- **B:** vendor `vercel/vercel` `skills/vercel-cli`. Rejected: its description is about 640 characters, over the ~100-token listing entry of [0046](0046-split-always-on-budget.md), the pack never edits vendored copies, and most of its 23 reference topics are unused.
- **C:** vendor from `vercel-labs/agent-skills`. Rejected: no license file in the repository (the README says MIT), and `vercel-cli-with-tokens` prints the token.
- **D:** the Vercel MCP. Left out per P1 (scripts and CLI before MCP, [DESIGN](../DESIGN.md)): the CLI covers the used commands, and the MCP needs OAuth.

## Consequences

- Good: Vercel projects get the CLI workflow and a production guard at a small always-on cost.
- Accepted cost: the pack maintains the skill by hand against CLI changes; it points to `vercel <command> --help` for anything else.
- Pending: a real-session trial in a throwaway Vercel project.

## Evidence

- Vercel CLI docs, https://vercel.com/docs/cli (deploy, env, pull, build, logs, inspect, promote, rollback, link, global options), checked 2026-11-19.
- https://github.com/vercel/vercel/tree/main/skills/vercel-cli, commit `84878e532142f0ac584953695658b324eb9e5b80`.
- https://github.com/vercel-labs/agent-skills, commit `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62`.
- Author request, 2026-11-19.
