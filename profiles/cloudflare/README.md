# cloudflare profile

Cloudflare Workers and Pages through wrangler, the used subset only (pack 0044, OPEN-QUESTIONS 8). Not staged.

## Contents

| Path | What |
|---|---|
| `.rulesync/rules/cloudflare.md` | wrangler from the project, dry-run before deploy, secrets |
| `.rulesync/skills/wrangler/` | Vendored unmodified from the Cloudflare skills repo (Apache-2.0; `LICENSE`, `NOTICE`) |
| `.rulesync/skills/workers-best-practices/` | Same, with its `references/` |
| `dotai/tools/read-size.cloudflare.txt` | `.wrangler/` and generated types |

## Why vendored

The cloudflare plugin installs as one unit: 14 skills plus the Cloudflare MCP. Only this subset is used, and Apache-2.0 allows redistribution with the license and a notice. Upstream: `https://github.com/cloudflare/skills`, commit `d924cd8f59e75e08fd3dd52843bb2776de35c77e` (2026-09-05). Refresh by copying again; never edit the copies.

## Dropped

The other 12 plugin skills (0 calls) and the Cloudflare MCP (9 calls, needs OAuth). `web-perf` (the one skill used) needs the Chrome DevTools MCP and is not Cloudflare-specific; it is listed as on demand in the `web` README. `nextjs-on-cloudflare` comes back only if a Next-on-Cloudflare project appears.

## Docs retrieval

No MCP is assumed: `wrangler` uses the Cloudflare MCP `docs` tool only "if available", else fetches the linked page, and `workers-best-practices` only says to retrieve the docs (checked 2026-11-02 on the vendored copies).

## Onboarding clashes

The global `cloudflare` plugin (user scope) duplicates `cloudflare:wrangler` and `cloudflare:workers-best-practices`: uninstall it when the profile is applied. `dotai-analyze` must flag it; the user uninstalls it (`claude plugin uninstall cloudflare@cloudflare`), since the cleanup never touches user-scope config. `web-perf` (on demand in `web`) goes with the plugin; take it alone from the Cloudflare skills repo when needed.
