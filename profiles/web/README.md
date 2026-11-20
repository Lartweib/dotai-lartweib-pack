# web profile

Web framework, build and checks for Astro and Next.js (pack 0044). Design, SEO and Cloudflare are separate profiles (`ui`, `seo`, `cloudflare`). Not staged.

## Contents

| Path | What |
|---|---|
| `.rulesync/rules/web.md` | Commands, checks, dev servers, docs rule |
| `.rulesync/hooks.jsonc` | `Stop` hook: one typecheck per turn when web files changed, in the Claude Code and agy blocks. OpenCode gets none: rulesync 41.0.0 and 43.9.2 render a project `Stop` in the OpenCode plugin as a bare `node` call with no payload, no `.nothrow().quiet()` and no timeout, which hangs OpenCode's `write` tool (trial 2026-11-04); restore it when rulesync pipes the payload |
| `dotai/tools/web-check.mjs` (+ `.sh`, `.ps1`) | `astro check`, `tsc --noEmit`, or `web.check` from `.dotai/config.yaml` (`off` disables). A root tsconfig with `references` (Vite's `files: []` shape, which `tsc --noEmit` does not check) runs `tsc -b --noEmit` on TypeScript 5.6 or later (earlier versions reject `--noEmit` with `--build`, TS5094), else `tsc -p <first non-node reference> --noEmit`; build mode writes only `.tsbuildinfo` files. 20-line cap; skips a second stop and an unchanged tree. Changed files come from the repository root (`git rev-parse --show-toplevel`), filtered to the package, so a monorepo package sees only its own changes. A check past its timeout is killed with its whole process tree |
| `../../base/dotai/tools/hook-lib.mjs` | Not in this profile: the shared hook lib (payload parsing, decision output, `.dotai/config.yaml` reader) is a base tool. The profile tools import it from the user tools directory, `${DOTAI_TOOLS}`, which staging writes into each tool |
| `dotai/tools/read-size.web.txt` | Paths for the base size-based Read hook |
| `tests/` | `node --test "profiles/web/tests/*.test.mjs"` |

## Configuration (`.dotai/config.yaml`, owned by the user)

```yaml
web:
  check: pnpm run check   # optional; "off" disables the hook
  checkTimeoutSec: 120    # clamped to 160 s, under the hook's 180 s timeout
```

The file is read only inside the project (the walk stops at `CLAUDE_PROJECT_DIR`, `.git` or `.dotai/`, and never reaches the home directory).

**Trust model.** `web.check` runs through the shell at the end of every turn with web changes. It is trusted because it comes only from `.dotai/config.yaml`, which is local, never committed, and written only by the user. Do not commit the file or copy one from an untrusted source.

## Optional: codegraph (opt-in pilot, pack 0012)

Not registered by this profile. Measurement 4 (pack 0012, update 2026-11-02) found no net gain on a 426-file TypeScript repo: about 6% fewer tokens and 3% lower cost, but all 3 factual errors of the trial were in codegraph runs, and the server costs about 1.1–1.8k tokens per session. Register it only as an opt-in pilot in a large TypeScript, Go or Python repo: roughly more than 2k files, where answering a question without it takes 15 or more tool calls. If a later pilot adopts it, `web` and `tooling` both ship this exact definition: the engine accepts the same MCP server in two profiles when the definitions are identical (engine answer, 2026-11-02; in a coming engine change). Keep this block identical to the one in the `tooling` README.

In a pilot project, register it by hand:

```jsonc
// .mcp.json (Claude Code, project scope); the same server in .rulesync/mcp.jsonc if adopted
{ "mcpServers": { "codegraph": { "type": "stdio", "command": "codegraph", "args": ["serve", "--mcp"] } } }
```

- Index each project once: `codegraph init -i`.
- Required when subagents work: `codegraph install`, which writes the `CLAUDE.md` section that makes subagents use it (in measurement 4 the delegated subagent used codegraph because of that section).
- Worktrees need their own index.
- Never in Godot projects (no GDScript support).

## On demand (external, not shipped)

The engine can declare external skills, plugins and agents only after engine v1 (engine answer, 2026-11-02), so pack v1 documents them with manual install steps.

| Item | Source | License | When |
|---|---|---|---|
| `web-perf` skill | Cloudflare skills (cloudflare plugin) | Apache-2.0 | Performance audits; needs the Chrome DevTools MCP, which the pack does not register by default |
| lychee | lycheeverse/lychee | MIT / Apache-2.0 | Link check of a built `dist/` before deploy |
| Next/Vercel/Supabase skills | the projects' own skills | — | Kept project-local (0044, option C) |
| Astro docs MCP | `https://mcp.docs.astro.build/mcp` (HTTP; agy takes it as `serverUrl`) | — | Not registered by default: one tool (~85 tokens listed), but ~7k tokens per search (measurement 11). WebFetch of the single docs page is the default; register it in a project only while working through many Astro docs questions |
| Next docs index | `npx @next/codemod agents-md` | MIT | Opt-in per project: the compressed index costs ~2.3k tokens per session against ~60 for the rule's one line (measurement 11, Next 16.3.4, bundled docs 3.14 MB) |

## Hook commands and paths with spaces

The hooks run `node ${DOTAI_PROJECT_TOOLS}/<tool>.mjs` with the path bare, so a project whose path has a space breaks them. Quoting would fix Claude Code and OpenCode, but agy runs hook commands through `cmd /c` on Windows and every `"` reaches cmd as `\"`, so a quoted path fails. Rule for agy hook commands: unquoted paths, no spaces. The engine plans `${DOTAI_TOOL:<name>}` in hook commands (engine answer, 2026-11-02); even then, agy cannot run a hook from a path with spaces. Keep projects at paths without spaces.

## Dropped

`context7` (never called; dropped by policy), Vercel and Supabase MCPs.

## TODO(trial)

- Cost of `astro check` per turn on the main web project (expected 10–30 s); raise `web.checkTimeoutSec` (up to 160 s) if it times out.

## Verified (trial 2026-11-19, Next 16.4.6)

- The bundled docs live in `node_modules/next/dist/docs/` (`index.md`, `01-app`, `02-pages`, `03-architecture`, `04-community`): 475 files, 4.3 MB, none over the read guard's 64 KB, so one page reads whole. The rule now names that path.

## Verified on agy (trial 2026-11-19, agy 1.5.3, Windows)

- `Stop` fires with `{hookEventName: "Stop", executionNum, terminationReason: "NO_TOOL_CALL", fullyIdle, continuationActive, error, cwd, modelName, conversationId, workspacePaths, ...}`; the top-level `cwd` is the project root (the hook process starts in `<project>/.agents`).
- `{decision: "block", reason}` is honored: agy re-entered the loop, the model fixed the type error, and the second `Stop` (`executionNum: 1`) passed. agy's own docs name only `"continue"` for this; `"block"` worked in 1.5.3.
- There is no `stop_hook_active`, and `continuationActive` was `false` on the second `Stop` although its docs say it is `true` after a hook kept the agent going. The loop is bounded by the fingerprint stamp (a tree already checked is not checked again), not by the payload.
