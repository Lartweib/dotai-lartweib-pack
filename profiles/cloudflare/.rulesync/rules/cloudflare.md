---
root: false
targets: ["*"]
description: "Cloudflare Workers and Pages through wrangler: commands, secrets, deploys."
antigravity:
  trigger: always_on
---

# Cloudflare

- Use the project's wrangler (`npx wrangler`), never a global one, and no Cloudflare MCP. The `wrangler` and `workers-best-practices` skills hold the details.
- Before a deploy: `npx wrangler deploy --dry-run` (Workers) or a local build (Pages); deploy only when asked.
- Pages: `npx wrangler pages deploy <build dir>`.
- Secrets: `npx wrangler secret put <NAME>`; never in `wrangler.jsonc`, `.dev.vars` commits or the chat.
- Never read `.wrangler/` whole; it is local state.
