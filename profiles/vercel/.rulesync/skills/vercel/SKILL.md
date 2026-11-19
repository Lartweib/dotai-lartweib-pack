---
name: vercel
description: "Vercel CLI: link a project, pull or change env vars, preview and production deploys, logs, inspect, promote and rollback, local builds."
---

# vercel

The vercel CLI, the used subset. Commands checked against https://vercel.com/docs/cli (2026-11-19). For any flag not listed here, run `vercel <command> --help`; never guess one.

## Approval

Ask the user, naming the exact command, before any of these: `vercel deploy --prod` (or `--environment=production`), `vercel promote`, `vercel rollback`, `vercel env add`, `vercel env update`, `vercel env rm`, `vercel link` in a directory not linked yet. A preview `vercel deploy` and the read commands need no approval.

## Target

- `vercel whoami` shows the account, not the project. `vercel project inspect` from the app directory shows the linked project; stop if it is not the intended one.
- `vercel link` writes `.vercel/project.json` for one directory; `vercel link --repo` maps a monorepo in `.vercel/repo.json`. Many commands link on their own when `.vercel/` is missing, so link explicitly first.
- `--scope <team-slug>` (`-S`) runs one command against a team without switching; `--project <name>` targets a project without linking.
- Auth: an existing `vercel login`, or `VERCEL_TOKEN` in the environment. Never pass `--token` on the command line or echo a token.

## Env vars

- `vercel env ls [--environment preview]`: names and targets.
- `vercel env pull [file]`: development values into `.env.local` (or `file`); `--environment=preview|production` for others. It merges into an existing file. Secret values come back as placeholders.
- `vercel env add <NAME> --environment <env>`: value from stdin or a file (`< file`), never `echo` (shell history). `--sensitive` stores it as a Secret.
- `vercel env run -e <env> -- <command>`: runs with the values without writing a file.

## Deploy

- `vercel deploy` (or `vercel`): a preview; stdout is the deployment URL.
- `vercel deploy --prod`: production (with approval). `--prod --skip-domain` builds production without moving the domains; `vercel promote <url>` moves them later.
- `vercel promote <url-or-id>`: makes a deployment current (with approval).
- `vercel rollback [url-or-id]`: back to an earlier production deployment (with approval); Hobby can only go back one. `vercel rollback status` shows a pending one.
- Wait for the result: `vercel inspect <url> --wait`; a started build is not a success.

## Local build

`vercel pull` (settings and env under `.vercel/`; `--environment=production` for production), then `vercel build` (`--prod` for production env vars), then `vercel deploy --prebuilt`. Without `--prebuilt` the local output is ignored. A local build also shows a build error without deploying.

## Debug

- `vercel inspect <url>`: deployment details; `--logs` for the build log.
- `vercel logs`: runtime logs, last 30 minutes by default. `--deployment <url-or-id>`, `--environment production`, `--since 1h`, `--query 'level:error'`, `--json`. `vercel logs requests --query 'httpStatus >= 500'` for request records.
- `vercel list`: recent deployments of the project.

Never read `.vercel/output/` whole; open the one file you need.
