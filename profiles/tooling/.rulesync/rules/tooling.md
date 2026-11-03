---
root: false
targets: ["*"]
description: "CLI and tooling projects (Go, Python, Node, Rust): verification commands, invariants."
antigravity:
  trigger: always_on
---

# Tooling

## Verification

Use the exact commands in `AGENTS.md`. Without them, by marker file, always with `timeout`:

| Marker | Test | Lint / types |
|---|---|---|
| `go.mod` | `timeout 600 go test ./... -count=1` | `go vet ./...`, `golangci-lint run` if configured |
| `pyproject.toml` | `timeout 600 uv run pytest -q -x` | `uv run ruff check`, `uv run mypy` if configured |
| `package.json` | `timeout 600 npx vitest run` | `npx tsc --noEmit`, `npx biome check` if configured |
| `Cargo.toml` | `timeout 600 cargo nextest run` (else `cargo test`) | `cargo clippy -- -D warnings` |

Read the output, not the exit code. A suite must terminate: no watch mode. A hook lints each edited file; fix what it reports.

## Invariants

When the project's `AGENTS.md` has an invariants table (invariant, guard test), a change that touches an invariant runs its guard test, and a new invariant gets a row and a test.
