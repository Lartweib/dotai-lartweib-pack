# vercel profile

Apps deployed on Vercel, through the vercel CLI only (pack 0049). Not staged.

## Contents

| Path | What |
|---|---|
| `.rulesync/rules/vercel.md` | CLI only, check the target, approval for production and env changes, no secrets in the chat |
| `.rulesync/skills/vercel/` | Pack-owned: link, env, deploy and `--prod`, logs, inspect, promote, rollback, `vercel pull` + `vercel build` + `--prebuilt`, `--scope` |
| `dotai/tools/read-size.vercel.txt` | `.vercel/` (local state and build output) |

## Why pack-owned

Vercel ships an official `vercel-cli` skill in `https://github.com/vercel/vercel` (`skills/vercel-cli`, Apache-2.0, commit `84878e532142f0ac584953695658b324eb9e5b80`, 2026-10-27), also bundled in the `vercel/vercel-plugin` Claude Code plugin. It is not vendored: its description is about 640 characters, over the ~100-token listing entry of pack 0046, and the pack never edits vendored copies; it also covers 23 reference topics (flags, sandbox, firewall, MCP setup) the author does not use. `vercel-labs/agent-skills` was also checked: its README says MIT but the repository has no license file, and `vercel-cli-with-tokens` prints the token to find it. The pack skill was written from the official CLI docs (`https://vercel.com/docs/cli`, checked 2026-11-19) and that upstream skill.

## Dropped

The Vercel MCP (`https://mcp.vercel.com`): the CLI covers the used commands (P1, scripts and CLI before MCP).

## Onboarding

Many Vercel projects track no `vercel.json` or `vercel.ts`, and `.vercel/` is untracked, so the hints miss them; the description tells the profiling skill to ask.

## Onboarding clashes

The `vercel/vercel-plugin` Claude Code plugin (user scope) duplicates the skill under `vercel-cli` and adds the MCP: uninstall it when the profile is applied. `dotai-analyze` flags it; the user uninstalls it, since the cleanup never touches user-scope config.
