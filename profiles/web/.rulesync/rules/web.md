---
root: false
targets: ["*"]
description: "Web project rules (Astro, Next.js): commands, checks, dev servers, docs."
antigravity:
  trigger: always_on
---

# Web

- Commands come from `package.json` scripts and `AGENTS.md`; use the project's package manager (lockfile) and its `check` script when there is one.
- Checks: Astro `astro check` then `astro build`; Next `tsc --noEmit` then `next build`; Vite `tsc -b` then `vite build`. Tests: `vitest run` (never watch mode), with a terse reporter; read failures only.
- A Stop hook typechecks once per turn when web files changed. Fix what it reports before finishing.
- Dev servers: start in the background on a fixed port, note the PID, kill by PID when done.
- Never read `node_modules`, `dist`, `.astro`, `.next` or lockfiles whole: `rg`, a range, or the tool (`npm ls <pkg>`). Lighthouse JSON: extract scores with a script, never read the file.
- Framework docs: the version installed in `node_modules` (Next ships its docs in the package); for Astro, WebFetch the one docs page. No docs MCP.
