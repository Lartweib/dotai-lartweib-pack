# tooling profile

CLIs, scripts and developer tooling: one profile, with checks chosen per language by marker files (pack 0044). Not staged.

## Contents

| Path | What |
|---|---|
| `.rulesync/rules/tooling.md` | Verification commands by marker, invariants table (review focus comes from the base `reviewer`, pack 0036) |
| `.rulesync/hooks.jsonc` | Claude Code: `PostToolUse` lint of the edited file, matching its edit tools. agy: `Stop` lint of the files the turn changed (`tooling-check.mjs stop`), since agy's `PostToolUse` output never reaches the model (below). OpenCode gets none: rulesync 41.0.0 and 43.9.2 render a project `PostToolUse` in the OpenCode plugin as a bare `node` call with no payload, no `.nothrow().quiet()` and no timeout, which hangs OpenCode's `write` tool (trial 2026-11-04); restore it when rulesync pipes the payload |
| `dotai/tools/tooling-check.mjs` (+ `.sh`, `.ps1`) | `.go` + `go.mod`: `gofmt -l`, `go vet ./<pkg>`; `.py` + `pyproject.toml`/`ruff.toml`: `ruff check` with the venv's ruff (`.venv/Scripts/ruff.exe` or `.venv/bin/ruff`, also a parent workspace venv), else `uv run --no-sync ruff` when `uv` is on PATH and the project has `pyproject.toml` and `uv.lock` (`uv run` would create a `.venv` elsewhere), else skipped; never a bare `ruff` from PATH; JS/TS + `biome.json`: `biome check`, the project-local `@biomejs/biome` run through node (no `npx`, no shell; skipped when not installed locally); `.rs` + `Cargo.toml`: `rustfmt --check`. Silent when clean or when the tool is missing; 20-line cap. gofmt parse errors are reported as such, apart from formatting. All checks of one edit share a 75 s budget under the hook's 90 s timeout. With `stop` (agy): the same checks over git's changed tracked and untracked files under the workspace, one budget for all of them (120 s hook timeout), `go vet` once per package; a tree already checked (same files, same mtimes) is skipped, which ends the block loop, since agy's `Stop` has no `stop_hook_active`. The changed-files and stamp helpers are the base hook lib's, shared with the web profile's `web-check` |
| `../../base/dotai/tools/hook-lib.mjs` | Not in this profile: the shared hook lib (payload parsing, decision output, `.dotai/config.yaml` reader) is a base tool. The profile tools import it from the user tools directory, `${DOTAI_TOOLS}`, which staging writes into each tool |
| `dotai/tools/read-size.tooling.txt` | Build, cache and lockfile paths |
| `tests/` | `node --test "profiles/tooling/tests/*.test.mjs"` (a real `gofmt` run when Go is installed) |

## Optional: codegraph (opt-in pilot, pack 0012)

Not registered by this profile. Measurement 4 (pack 0012, update 2026-11-02) found no net gain on a 426-file TypeScript repo: about 6% fewer tokens and 3% lower cost, but all 3 factual errors of the trial were in codegraph runs, and the server costs about 1.1–1.8k tokens per session. Register it only as an opt-in pilot in a large TypeScript, Go or Python repo: roughly more than 2k files, where answering a question without it takes 15 or more tool calls. If a later pilot adopts it, `web` and `tooling` both ship this exact definition: the engine accepts the same MCP server in two profiles when the definitions are identical (engine answer, 2026-11-02; in a coming engine change). Keep this block identical to the one in the `web` README.

In a pilot project, register it by hand:

```jsonc
// .mcp.json (Claude Code, project scope); the same server in .rulesync/mcp.jsonc if adopted
{ "mcpServers": { "codegraph": { "type": "stdio", "command": "codegraph", "args": ["serve", "--mcp"] } } }
```

- Index each project once: `codegraph init -i`.
- Required when subagents work: `codegraph install`, which writes the `CLAUDE.md` section that makes subagents use it (in measurement 4 the delegated subagent used codegraph because of that section).
- Worktrees need their own index.
- Never in Godot projects (no GDScript support).

## External items (not shipped)

The engine can declare external skills, plugins and agents only after engine v1 (engine answer, 2026-11-02), so pack v1 documents them with manual install steps.

| Item | Source | License | Status |
|---|---|---|---|
| `go-testing` skill | Gentleman Programming | Apache-2.0 | Keep (in use); installable by name, so not vendored |
| gopls MCP | `gopls mcp` (Go team) | BSD-3 | Not loaded by default: its instructions (`gopls mcp -instructions`) cost ~1.2k tokens and its tool schemas ~1.1k, and the instructions make the agent run `go_workspace` and `go_vulncheck` every session (measurement 11, gopls v0.24). On demand, per project, for a large Go module |
| `gopls-lsp`, `rust-analyzer-lsp`, `typescript-lsp` | claude-plugins-official | not stated | TODO(trial): Windows bug report ("No LSP server available"); check that diagnostics appear in Git Bash, and measure with `claude plugin details` |
| cargo-nextest, clippy JSON, cargo-deny | Rust tooling | MIT / Apache-2.0 | Adopt when a Rust project appears; clippy on `Stop` is TODO(trial) |
| govulncheck, osv-scanner | Go team, Google | BSD-3, Apache-2.0 | In CI, not in hooks |
| `skill-creator`, `skill-improver`, `chained-pr`, `branch-pr` | various | various | On demand only, loaded temporarily |

## Hook commands and paths with spaces

The hooks run `node ${DOTAI_PROJECT_TOOLS}/<tool>.mjs` with the path bare, so a project whose path has a space breaks them. Quoting would fix Claude Code and OpenCode, but agy runs hook commands through `cmd /c` on Windows and every `"` reaches cmd as `\"`, so a quoted path fails. Rule for agy hook commands: unquoted paths, no spaces. The engine plans `${DOTAI_TOOL:<name>}` in hook commands (engine answer, 2026-11-02); even then, agy cannot run a hook from a path with spaces. Keep projects at paths without spaces.

## Dropped

SDD skills (0020), `judgment-day` and `jd-*`, the five `review-*` agents (the base `reviewer` takes the focus as a parameter), GitHub MCP (`gh` instead), RTK (unused).

## agy runs the check on Stop

Decided 2026-11-19 (agy 1.5.3 trials). On `PostToolUse` the hook fired (the edit tool was `edit_file` with `toolCall.args.Path`), but agy parses the output as its `PostToolHookResult` proto, whose only field is `overwriteResult`: `{decision: "block"}` was rejected ("unknown field \"decision\"") and an `overwriteResult` was accepted but the model still saw the original tool result. On `Stop`, `{decision: "block", reason}` reaches the model, which fixes the problem and stops again (web profile trial, then this profile's: see pack 0044). So the agy check runs once per turn over the changed files instead of once per edit.

## TODO(trial)

- `go vet` time per edit on a large module; drop it to `Stop` if it is slow.
