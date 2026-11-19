import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CHECK_BUDGET_MS, checkFile, checkFiles, decideStop, filePathOf, interpret, planChecks } from '../dotai/tools/tooling-check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOLS = join(HERE, '..', 'dotai', 'tools')
const P = (...xs) => join('/repo', ...xs)
const markers = list => f => list.includes(f.replace(/\\/g, '/'))
const BIOME_BIN = 'node_modules/@biomejs/biome/bin/biome'

test('the edited file path is read from each harness payload', () => {
  assert.equal(filePathOf({ tool_input: { file_path: 'a.go' } }), 'a.go')
  assert.equal(filePathOf({ tool_input: { filePath: 'b.py' } }), 'b.py')
  assert.equal(filePathOf({ toolCall: { args: { TargetFile: 'c.ts' } } }), 'c.ts')
  assert.equal(filePathOf({ toolCall: { name: 'write_file', args: { Path: 'd.ts', Content: 'x' } } }), 'd.ts') // agy 1.4.12, seen at runtime
  assert.equal(filePathOf({}), '')
  assert.equal(filePathOf(null), '')
})

test('checks are chosen by extension and the nearest marker file', () => {
  const ex = markers(['/repo/go.mod', '/repo/pyproject.toml', '/repo/.venv/bin/ruff', '/repo/web/biome.json', `/repo/web/${BIOME_BIN}`, '/repo/Cargo.toml'])
  const go = planChecks(P('cmd', 'x', 'main.go'), ex)
  assert.deepEqual(go.map(c => c.label), ['gofmt', 'go vet'])
  assert.deepEqual(go[1].args, ['vet', './cmd/x'])
  assert.deepEqual(planChecks(P('tool.py'), ex).map(c => c.label), ['ruff'])
  assert.deepEqual(planChecks(P('web', 'src', 'a.tsx'), ex).map(c => c.label), ['biome'])
  assert.deepEqual(planChecks(P('src', 'lib.rs'), ex).map(c => c.label), ['rustfmt'])
})

test('ruff comes from the project venv first, Windows or POSIX layout, also a parent workspace venv', () => {
  const noUv = () => null
  const win = planChecks(P('src', 'a.py'), markers(['/repo/pyproject.toml', '/repo/.venv/Scripts/ruff.exe']), noUv)
  assert.equal(win[0].cmd.replace(/\\/g, '/'), '/repo/.venv/Scripts/ruff.exe')
  assert.deepEqual(win[0].args, ['check', '--quiet', '--output-format', 'concise', P('src', 'a.py')])
  assert.equal(win[0].cwd, P())
  const posix = planChecks(P('a.py'), markers(['/repo/ruff.toml', '/repo/.venv/bin/ruff']), noUv)
  assert.equal(posix[0].cmd.replace(/\\/g, '/'), '/repo/.venv/bin/ruff')
  const ws = planChecks(P('pkg', 'a.py'), markers(['/repo/pkg/pyproject.toml', '/repo/.venv/bin/ruff']), noUv)
  assert.equal(ws[0].cmd.replace(/\\/g, '/'), '/repo/.venv/bin/ruff')
  assert.equal(ws[0].cwd, P('pkg'))
})

test('without a venv ruff, a uv project runs uv run --no-sync ruff', () => {
  const uv = name => (name === 'uv' ? '/bin/uv' : null)
  const [c] = planChecks(P('a.py'), markers(['/repo/pyproject.toml', '/repo/uv.lock']), uv)
  assert.equal(c.cmd, '/bin/uv')
  assert.deepEqual(c.args, ['run', '--no-sync', 'ruff', 'check', '--quiet', '--output-format', 'concise', P('a.py')])
  assert.equal(c.cwd, P())
})

test('no venv ruff and no uv project: ruff is skipped silently, never run bare from PATH', () => {
  const all = name => `/bin/${name}`
  assert.deepEqual(planChecks(P('a.py'), markers(['/repo/pyproject.toml', '/repo/uv.lock']), () => null), [])
  // uv run creates a .venv when there is none, so a pyproject without uv.lock is not uv's.
  assert.deepEqual(planChecks(P('a.py'), markers(['/repo/pyproject.toml']), all), [])
  assert.deepEqual(planChecks(P('a.py'), markers(['/repo/ruff.toml', '/repo/uv.lock']), all), [])
})

test('uv without ruff in the project environment is not a lint problem', () => {
  const c = { label: 'ruff' }
  assert.equal(interpret(c, { code: 2, out: 'error: Failed to spawn: `ruff`\n  Caused by: program not found' }), null)
  assert.match(interpret(c, { code: 1, out: 'a.py:1:8: F401 `os` imported but unused' }), /F401/)
})

test('biome runs the project-local binary through node, with the file as one argv element', () => {
  const file = P('web', 'src', '(auth)', 'a & b.tsx')
  const [c] = planChecks(file, markers(['/repo/web/biome.json', `/repo/${BIOME_BIN}`]))
  assert.equal(c.cmd, process.execPath)
  assert.equal(c.args[0].replace(/\\/g, '/'), `/repo/${BIOME_BIN}`)
  assert.deepEqual(c.args.slice(1), ['check', file])
  assert.equal(c.shell, undefined)
})

test('biome without a local install is skipped, not reported', () => {
  assert.deepEqual(planChecks(P('web', 'a.ts'), markers(['/repo/web/biome.json'])), [])
})

test('no marker, no check: a stray file outside a project is left alone', () => {
  const none = markers([])
  for (const f of ['a.go', 'b.py', 'c.ts', 'd.rs', 'e.md']) assert.deepEqual(planChecks(P(f), none), [])
})

test('gofmt reports unformatted files apart from errors; other tools by exit code', () => {
  assert.match(interpret({ label: 'gofmt' }, { code: 0, stdout: '/repo/a.go\n', stderr: '', out: '/repo/a.go\n' }), /gofmt -w/)
  assert.equal(interpret({ label: 'gofmt' }, { code: 0, stdout: '', stderr: '', out: '' }), null)
  const syntax = interpret({ label: 'gofmt' }, { code: 2, stdout: '', stderr: "a.go:1:1: expected 'package', found 'EOF'", out: '' })
  assert.doesNotMatch(syntax, /not gofmt-formatted/)
  assert.match(syntax, /expected 'package'/)
  assert.match(interpret({ label: 'ruff' }, { code: 1, out: 'a.py:1:1: F401 unused' }), /F401/)
  assert.equal(interpret({ label: 'ruff' }, { code: 0, out: 'All checks passed!' }), null)
  assert.equal(interpret({ label: 'ruff' }, { missing: true }), null)
})

test('problems are capped at 20 lines', async () => {
  const run = async () => ({ code: 1, out: Array.from({ length: 60 }, (_, i) => `x.py:${i}:1: E1`).join('\n') })
  const r = await checkFile(P('x.py'), markers(['/repo/pyproject.toml', '/repo/.venv/bin/ruff']), run)
  assert.ok(r.split('\n').length <= 23)
  assert.match(r, /more lines cut/)
})

test('all checks of one edit fit inside the hook timeout', async () => {
  const hooks = readFileSync(join(HERE, '..', '.rulesync', 'hooks.jsonc'), 'utf8')
  for (const m of hooks.matchAll(/"timeout": (\d+)/g)) assert.ok(CHECK_BUDGET_MS < Number(m[1]) * 1000, m[0])
  // Each check takes its whole timeout: together they still stay within the budget.
  let clock = 0
  const given = []
  const run = async (check, timeoutMs) => {
    given.push(timeoutMs)
    clock += timeoutMs
    return { code: 0, stdout: '', stderr: '', out: '' }
  }
  await checkFile(P('cmd', 'main.go'), markers(['/repo/go.mod']), run, () => clock)
  assert.equal(given.length, 2)
  assert.ok(given.reduce((a, b) => a + b, 0) <= CHECK_BUDGET_MS, given.join('+'))
})

test('a path with spaces, parentheses and & reaches biome intact (no shell)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tooling check (auth) & co '))
  try {
    writeFileSync(join(dir, 'biome.json'), '{}')
    const bin = join(dir, ...BIOME_BIN.split('/'))
    mkdirSync(dirname(bin), { recursive: true })
    // A stand-in biome: prints the file argument it received and fails.
    writeFileSync(bin, 'console.log("GOT<" + process.argv[3] + ">"); process.exit(1)\n')
    const file = join(dir, 'src', '(auth)', 'a & b.ts')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, 'export {}\n')
    const r = await checkFile(file)
    assert.ok(r.includes(`GOT<${file}>`), r)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a real Go module with a misformatted file is reported (skipped without go)', t => {
  if (spawnSync('gofmt', ['-h']).error) return t.skip('gofmt not installed')
  const dir = mkdtempSync(join(tmpdir(), 'tooling-check-'))
  try {
    writeFileSync(join(dir, 'go.mod'), 'module example.com/x\n\ngo 1.21\n')
    mkdirSync(join(dir, 'p'))
    const f = join(dir, 'p', 'p.go')
    writeFileSync(f, 'package p\nfunc  F( ) int {return 1}\n')
    const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: f } })
    const r = spawnSync('node', [join(TOOLS, 'tooling-check.mjs')], { input: payload, encoding: 'utf8', timeout: 90000 })
    assert.equal(r.status, 0, r.stderr)
    const out = JSON.parse(r.stdout)
    assert.equal(out.decision, 'block')
    assert.match(out.reason, /gofmt/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('both wrappers exit 0 and stay silent for a file with no check', () => {
  const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(tmpdir(), 'notes.md') } })
  const runs = [['sh', join(TOOLS, 'tooling-check.sh')]]
  if (process.platform === 'win32') runs.push(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(TOOLS, 'tooling-check.ps1')])
  for (const argv of runs) {
    const r = spawnSync(argv[0], argv.slice(1), { input: payload, encoding: 'utf8', timeout: 30000 })
    assert.equal(r.status, 0, `${argv[0]}: ${r.stderr}`)
    assert.equal(r.stdout, '')
  }
})

// rulesync 41.0.0 renders the OpenCode project plugin's postToolUse as a bare `node` call with
// no payload, no nothrow and no timeout: it hangs OpenCode's write tool (trial 2026-11-04).
// agy 1.5.3 drops {decision} on PostToolUse but honors it on Stop (trial 2026-11-19), so agy's
// check runs on Stop over the files the turn changed.
test('Claude Code lints on PostToolUse, agy on Stop, OpenCode never', () => {
  const hooks = JSON.parse(readFileSync(join(HERE, '..', '.rulesync', 'hooks.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, ''))
  assert.deepEqual(hooks.hooks ?? {}, {}, 'no shared hooks')
  assert.equal(hooks.opencode, undefined, 'OpenCode has no hook')
  const cc = hooks.claudecode.hooks
  assert.deepEqual(Object.keys(cc), ['postToolUse'])
  assert.match(cc.postToolUse[0].command, /\/tooling-check\.mjs$/)
  const agy = hooks['antigravity-cli'].hooks
  assert.deepEqual(Object.keys(agy), ['stop'], 'no agy postToolUse: its output never reaches the model')
  assert.equal(agy.stop.length, 1)
  assert.equal(agy.stop[0].matcher, undefined)
  assert.match(agy.stop[0].command, /^node \S+\/tooling-check\.mjs stop$/)
  assert.doesNotMatch(agy.stop[0].command, /"/, 'agy commands carry no quotes')
})

function stopDeps(over = {}) {
  const runs = []
  let stamp = null
  return {
    runs,
    exists: markers(['/repo/go.mod', '/repo/pyproject.toml', '/repo/.venv/bin/ruff']),
    changed: () => [P('a.go'), P('README.md'), P('tool.py')],
    fingerprint: files => files.join('|'),
    stamp: { get: () => stamp, set: v => (stamp = v) },
    run: async check => (runs.push(check.label), { code: 0, stdout: '', stderr: '', out: '' }),
    ...over,
  }
}

test('on Stop, only changed files with a check are checked, once per tree', async () => {
  const deps = stopDeps()
  assert.equal(await decideStop({}, deps), null)
  assert.deepEqual(deps.runs, ['gofmt', 'go vet', 'ruff'])
  assert.equal(await decideStop({}, deps), null, 'same tree: not checked again')
  assert.equal(deps.runs.length, 3)
})

test('on Stop, problems block with a reason naming the file and the check', async () => {
  const deps = stopDeps({
    changed: () => [P('p', 'a.go')],
    run: async c => (c.label === 'gofmt' ? { code: 0, stdout: 'a.go\n', stderr: '', out: 'a.go\n' } : { code: 0, stdout: '', stderr: '', out: '' }),
  })
  const r = await decideStop({}, deps)
  assert.match(r.reason, /^tooling check: .*Fix these, then finish/)
  assert.ok(r.reason.includes(P('p', 'a.go')), r.reason)
  assert.match(r.reason, /gofmt: not gofmt-formatted/)
  // The stamp is set even on a block: an unchanged tree ends the loop (agy has no stop_hook_active).
  assert.equal(await decideStop({}, deps), null)
})

test('on Stop, a second stop in the same turn or a turn with no checked files does nothing', async () => {
  const deps = stopDeps()
  assert.equal(await decideStop({ stop_hook_active: true }, deps), null)
  const none = stopDeps({ changed: () => [P('README.md'), P('notes.txt')] })
  assert.equal(await decideStop({}, none), null)
  assert.equal(deps.runs.length + none.runs.length, 0)
})

test('several files share one time budget', async () => {
  let clock = 0
  const given = []
  const run = async (check, timeoutMs) => {
    given.push(timeoutMs)
    clock += timeoutMs
    return { code: 0, stdout: '', stderr: '', out: '' }
  }
  const r = await checkFiles([P('p', 'a.go'), P('p', 'b.go'), P('q', 'c.go')], markers(['/repo/go.mod']), run, () => clock)
  assert.ok(given.reduce((a, b) => a + b, 0) <= CHECK_BUDGET_MS, given.join('+'))
  assert.match(r, /skipped, the hook's time budget is used up/)
})

test('go vet runs once per package across the changed files', async () => {
  const seen = []
  const run = async check => (seen.push(`${check.label} ${check.args.join(' ')}`), { code: 0, stdout: '', stderr: '', out: '' })
  assert.equal(await checkFiles([P('p', 'a.go'), P('p', 'b.go'), P('q', 'c.go')], markers(['/repo/go.mod']), run), null)
  assert.deepEqual(seen.filter(x => x.startsWith('go vet')), ['go vet vet ./p', 'go vet vet ./q'])
  assert.equal(seen.filter(x => x.startsWith('gofmt')).length, 3)
})

test('the Stop report of many files is capped at 20 lines', async () => {
  const run = async () => ({ code: 1, out: 'x.py:1:1: E1\nx.py:2:1: E2' })
  const files = Array.from({ length: 30 }, (_, i) => P(`f${i}.py`))
  const r = await checkFiles(files, markers(['/repo/pyproject.toml', '/repo/.venv/bin/ruff']), run)
  assert.ok(r.split('\n').length <= 23, r)
  assert.match(r, /more lines cut/)
})

test('agy Stop in a real git repo: a misformatted Go file blocks once (skipped without git or go)', t => {
  if (spawnSync('git', ['--version']).error) return t.skip('git not installed')
  if (spawnSync('gofmt', ['-h']).error) return t.skip('gofmt not installed')
  const dir = mkdtempSync(join(tmpdir(), 'tooling-stop-'))
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(join(dir, 'go.mod'), 'module example.com/x\n\ngo 1.21\n')
    writeFileSync(join(dir, 'notes.md'), '# notes\n')
    mkdirSync(join(dir, 'p'))
    writeFileSync(join(dir, 'p', 'p.go'), 'package p\nfunc  F( ) int {return 1}\n')
    // agy's Stop payload: common fields only, the project in workspacePaths; the hook starts in
    // <project>/.agents (trial 2026-11-19).
    mkdirSync(join(dir, '.agents'))
    const payload = JSON.stringify({ conversationId: 'c1', workspacePaths: [dir] })
    const stop = () => spawnSync('node', [join(TOOLS, 'tooling-check.mjs'), 'stop'], { cwd: join(dir, '.agents'), input: payload, encoding: 'utf8', timeout: 90000 })
    const r = stop()
    assert.equal(r.status, 0, r.stderr)
    const out = JSON.parse(r.stdout)
    assert.equal(out.decision, 'block')
    assert.match(out.reason, /p\.go/)
    assert.match(out.reason, /gofmt/)
    const again = stop()
    assert.equal(again.status, 0, again.stderr)
    assert.equal(again.stdout, '', 'an unchanged tree is not checked again')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('agy Stop outside a git repository is silent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tooling-nogit-'))
  try {
    const payload = JSON.stringify({ conversationId: 'c1', workspacePaths: [dir] })
    const env = { ...process.env, GIT_CEILING_DIRECTORIES: dirname(dir) }
    const r = spawnSync('node', [join(TOOLS, 'tooling-check.mjs'), 'stop'], { input: payload, encoding: 'utf8', timeout: 30000, env })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
