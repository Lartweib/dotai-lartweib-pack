// PostToolUse hook: quick lint of the file just edited, chosen by extension and by the
// nearest marker file. Silent when clean or when the tool is not installed;
// on problems it returns them to the agent, capped at 20 lines.
//   .go  + go.mod                      -> gofmt -l <file>, go vet ./<package>
//   .py  + pyproject.toml / ruff.toml  -> ruff check <file>: the venv's ruff, else
//                                         `uv run --no-sync ruff` in a uv project, else nothing
//   .ts/.js/... + biome.json(c)        -> biome check <file>, project-local install only
//   .rs  + Cargo.toml                  -> rustfmt --check <file>   (TODO(trial): clippy on Stop)
// No shell anywhere: the file path is one argv element, so spaces, `(auth)` or `&` are safe.
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// The hook lib is a base tool, installed at user scope. Staging writes the user tools
// directory into TOOLS (PACK-FORMAT, 0030); from the pack source, as in the tests, the
// placeholder is still there and the base layer's copy is used. A missing lib is reported
// (stderr, exit 1: Claude Code shows it and goes on) instead of passing silently.
const TOOLS = '${DOTAI_TOOLS}'
const LIB = TOOLS.startsWith('$')
  ? new URL('../../../../base/dotai/tools/hook-lib.mjs', import.meta.url)
  : pathToFileURL(`${TOOLS}/hook-lib.mjs`)
let lib
try {
  lib = await import(LIB.href)
} catch (e) {
  process.stderr.write(`tooling check: cannot load hook-lib.mjs from ${LIB.href} (${e.code || e.message}); no lint until the base pack is reinstalled.\n`)
  process.exit(1)
}
const { capOutput, findOnPath, parsePayload, readStdin, runCapped } = lib

// The hook's timeout is 90 s (.rulesync/hooks.jsonc). All checks of one edit share this budget,
// so the hook ends, with its report, before the harness kills it.
export const CHECK_BUDGET_MS = 75000
const PER_CHECK_MS = 60000
// The biome package's JS entry point: run with this node, no .cmd shim, no shell, no npx.
const BIOME_BIN = 'node_modules/@biomejs/biome/bin/biome'

export function filePathOf(p) {
  const a = p?.toolCall?.args
  if (a) return String(a.Path ?? a.TargetFile ?? a.AbsolutePath ?? a.file_path ?? '')
  const i = p?.tool_input ?? {}
  return String(i.file_path ?? i.filePath ?? i.path ?? '')
}

function findUp(start, names, exists) {
  let dir = start
  for (;;) {
    if (names.some(n => exists(join(dir, n)))) return dir
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

const VENV_RUFF = ['.venv/Scripts/ruff.exe', '.venv/bin/ruff']
// `uv run` exits 2 with this when the project environment has no ruff.
const UV_NO_RUFF = /Failed to spawn: `?ruff`?/

export function planChecks(file, exists, which = name => findOnPath(name)) {
  const dir = dirname(file)
  const ext = (/\.([^.\\/]+)$/.exec(file)?.[1] ?? '').toLowerCase()
  if (ext === 'go') {
    const root = findUp(dir, ['go.mod'], exists)
    if (!root) return []
    const rel = relative(root, dir).replace(/\\/g, '/')
    return [
      { label: 'gofmt', cmd: 'gofmt', args: ['-l', file], cwd: root },
      { label: 'go vet', cmd: 'go', args: ['vet', rel ? `./${rel}` : '.'], cwd: root },
    ]
  }
  if (ext === 'py') {
    const root = findUp(dir, ['pyproject.toml', 'ruff.toml', '.ruff.toml'], exists)
    if (!root) return []
    const args = ['check', '--quiet', '--output-format', 'concise', file]
    // ruff is rarely on PATH: it lives in the project venv (or a parent workspace venv).
    const venv = findUp(dir, VENV_RUFF, exists)
    if (venv) return [{ label: 'ruff', cmd: join(venv, VENV_RUFF.find(n => exists(join(venv, n)))), args, cwd: root }]
    // A uv project without a venv ruff: `uv run` finds ruff in the project environment. Only with
    // uv.lock, since `uv run` creates a .venv in a project that has none.
    const uv = which('uv')
    if (uv && exists(join(root, 'pyproject.toml')) && exists(join(root, 'uv.lock'))) {
      return [{ label: 'ruff', cmd: uv, args: ['run', '--no-sync', 'ruff', ...args], cwd: root }]
    }
    return []
  }
  if (/^(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(ext)) {
    const root = findUp(dir, ['biome.json', 'biome.jsonc'], exists)
    if (!root) return []
    // Not installed in the project (or a parent workspace): not a lint problem, so no check.
    const installed = findUp(dir, [BIOME_BIN], exists)
    if (!installed) return []
    return [{ label: 'biome', cmd: process.execPath, args: [join(installed, BIOME_BIN), 'check', file], cwd: root }]
  }
  if (ext === 'rs') {
    const root = findUp(dir, ['Cargo.toml'], exists)
    return root ? [{ label: 'rustfmt', cmd: 'rustfmt', args: ['--check', '--edition', '2021', file], cwd: root }] : []
  }
  return []
}

// r: { code, stdout, stderr, out } or { missing: true } when the tool is not installed.
export function interpret(check, r) {
  if (r.missing) return null
  if (check.label === 'gofmt') {
    // gofmt -l lists unformatted files on stdout; a parse error exits non-zero on stderr.
    if (r.code !== 0) return `gofmt could not parse it: ${(r.stderr || r.out || '').trim() || `exit ${r.code}`}`
    return (r.stdout ?? r.out ?? '').trim() ? 'not gofmt-formatted; run gofmt -w on it' : null
  }
  if (check.label === 'ruff' && r.code !== 0 && UV_NO_RUFF.test(r.out ?? '')) return null
  return r.code === 0 ? null : (r.out ?? '').trim() || `${check.label} exited ${r.code}`
}

async function realRun(check, timeoutMs) {
  const r = await runCapped(check.cmd, check.args, { cwd: check.cwd, timeoutMs })
  if (r.missing) return { missing: true }
  if (r.timedOut) return { code: 1, stdout: '', stderr: '', out: `${check.label} did not finish within ${Math.round(timeoutMs / 1000)} s` }
  if (r.error) return { code: 1, stdout: '', stderr: '', out: `${check.label} did not finish (${r.error})` }
  return r
}

export async function checkFile(file, exists = existsSync, run = realRun, clock = Date.now) {
  const problems = []
  const start = clock()
  for (const c of planChecks(file, exists)) {
    const left = CHECK_BUDGET_MS - (clock() - start)
    if (left < 1000) {
      problems.push(`${c.label}: skipped, the hook's time budget is used up`)
      continue
    }
    const why = interpret(c, await run(c, Math.min(PER_CHECK_MS, left)))
    if (why) problems.push(`${c.label}: ${why}`)
  }
  return problems.length ? capOutput(`${file}\n${problems.join('\n')}`, 20) : null
}

async function main() {
  const parsed = parsePayload(await readStdin())
  let file = filePathOf(parsed.payload)
  if (!file) return
  if (!isAbsolute(file)) file = resolve(parsed.cwd, file)
  let r = null
  try {
    r = await checkFile(file)
  } catch {
    r = null
  }
  // Claude Code reads {decision: "block", reason} on PostToolUse as feedback to the agent.
  // agy 1.5.3 rejects this on PostToolUse ("unknown field decision"; its result proto has only
  // overwriteResult, which did not reach the model either), so agy gets no feedback here
  // (TODO(trial): pick agy's path, README). OpenCode runs postToolUse without a payload.
  if (r) process.stdout.write(JSON.stringify({ decision: 'block', reason: `tooling check:\n${r}` }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
