---
root: false
targets: ["*"]
description: "Vercel through the vercel CLI: linking, env vars, preview and production deploys."
antigravity:
  trigger: always_on
---

# Vercel

- The vercel CLI only, no Vercel MCP; the `vercel` skill holds the commands. Check the target first (`vercel project inspect`, `--scope <team>`).
- `vercel deploy` is a preview. `--prod`, `vercel promote`, `vercel rollback` and `vercel env add`/`update`/`rm` only with the user's approval.
- Never print env values or tokens; a pulled `.env.local` stays untracked.
- Never read `.vercel/` whole; it is local state.
