import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MAX_CHECK_SEC, changedFiles, checkTimeoutMs, decideStop, parsePorcelain, pickCheck, realDeps } from '../dotai/tools/web-check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOLS = join(HERE, '..', 'dotai', 'tools')

test('the check follows the project: config, then Astro, then TypeScript', () => {
  const has = names => f => names.includes(f)
  assert.equal(pickCheck({ check: 'pnpm run check' }, has([])).cmd, 'pnpm run check')
  assert.match(pickCheck({}, has(['astro.config.mjs', 'tsconfig.json'])).cmd, /astro check/)
  assert.match(pickCheck({}, has(['tsconfig.json'])).cmd, /tsc --noEmit/)
  assert.equal(pickCheck({}, has(['package.json'])), null)
  assert.equal(pickCheck({ check: 'off' }, has(['tsconfig.json'])), null)
})

// The Vite template's root tsconfig checks nothing on its own: `files: []` plus references.
const VITE_ROOT = `{
  // solution file
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
  ]
}`

test('a tsconfig with references is checked in build mode on TypeScript 5.6 or later', () => {
  const has = f => f === 'tsconfig.json'
  for (const v of ['5.6.3', '5.9.3', '6.0.3', '7.0.2']) {
    const read = f => (f === 'tsconfig.json' ? VITE_ROOT : null)
    assert.equal(pickCheck({}, has, read, () => v).cmd, 'npx --no-install tsc -b --noEmit', v)
  }
})

test('before 5.6 (no --noEmit with --build) or an unknown version, the first app tsconfig is checked', () => {
  const has = f => f === 'tsconfig.json'
  const read = f => (f === 'tsconfig.json' ? VITE_ROOT : null)
  assert.equal(pickCheck({}, has, read, () => '5.5.4').cmd, 'npx --no-install tsc -p ./tsconfig.app.json --noEmit')
  assert.equal(pickCheck({}, has, read, () => null).cmd, 'npx --no-install tsc -p ./tsconfig.app.json --noEmit')
  const nodeFirst = '{"files":[],"references":[{"path":"./tsconfig.node.json"},{"path":"./tsconfig.web.json"}]}'
  assert.equal(pickCheck({}, has, () => nodeFirst, () => '5.4.5').cmd, 'npx --no-install tsc -p ./tsconfig.web.json --noEmit')
})

test('a plain tsconfig, an unreadable one, or an unsafe reference path keeps tsc --noEmit', () => {
  const has = f => f === 'tsconfig.json'
  assert.equal(pickCheck({}, has, () => '{"compilerOptions":{"strict":true}}', () => '5.9.3').cmd, 'npx --no-install tsc --noEmit')
  assert.equal(pickCheck({}, has, () => '{ not json', () => '5.9.3').cmd, 'npx --no-install tsc --noEmit')
  assert.equal(pickCheck({}, has, () => null, () => null).cmd, 'npx --no-install tsc --noEmit')
  const evil = '{"files":[],"references":[{"path":"./a.json & calc"}]}'
  assert.equal(pickCheck({}, has, () => evil, () => '5.4.5').cmd, 'npx --no-install tsc --noEmit')
})

test('the project TypeScript version is resolved from the package, hoisted or not', () => {
  const top = mkdtempSync(join(tmpdir(), 'web-tsv-'))
  try {
    const app = join(top, 'packages', 'app')
    mkdirSync(join(top, 'node_modules', 'typescript'), { recursive: true })
    mkdirSync(app, { recursive: true })
    writeFileSync(join(top, 'node_modules', 'typescript', 'package.json'), '{"name":"typescript","version":"5.5.4"}')
    writeFileSync(join(app, 'package.json'), '{}')
    assert.equal(realDeps(app).tsVersion(), '5.5.4')
    const bare = mkdtempSync(join(tmpdir(), 'web-tsv-none-'))
    writeFileSync(join(bare, 'package.json'), '{}')
    assert.equal(realDeps(bare).tsVersion(), null)
    rmSync(bare, { recursive: true, force: true })
    writeFileSync(join(app, 'tsconfig.json'), VITE_ROOT)
    assert.equal(realDeps(app).read('tsconfig.json'), VITE_ROOT)
    assert.equal(realDeps(app).read('missing.json'), null)
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
})

function fakeDeps(over = {}) {
  const calls = []
  return {
    calls,
    exists: f => f === 'tsconfig.json',
    read: () => null,
    tsVersion: () => null,
    changed: () => ['src/a.ts'],
    fingerprint: () => 'fp1',
    stamp: { get: () => null, set: () => {} },
    run: async (cmd, timeoutMs) => (calls.push({ cmd, timeoutMs }), { code: 0, out: '' }),
    ...over,
  }
}

test('a second stop in the same turn never runs the check', async () => {
  const deps = fakeDeps()
  assert.equal(await decideStop({ stop_hook_active: true }, {}, deps), null)
  assert.equal(deps.calls.length, 0)
})

test('no changed web files means no check', async () => {
  const deps = fakeDeps({ changed: () => ['README.md'] })
  assert.equal(await decideStop({}, {}, deps), null)
  assert.equal(deps.calls.length, 0)
})

test('an unchanged tree since the last check is not checked again', async () => {
  const deps = fakeDeps({ stamp: { get: () => 'fp1', set: () => {} } })
  assert.equal(await decideStop({}, {}, deps), null)
  assert.equal(deps.calls.length, 0)
})

test('a failing check blocks the stop once, with capped errors', async () => {
  let saved = null
  const deps = fakeDeps({
    stamp: { get: () => null, set: v => (saved = v) },
    run: async () => ({ code: 2, out: Array.from({ length: 40 }, (_, i) => `src/a.ts(${i},1): error TS2322`).join('\n') }),
  })
  const r = await decideStop({}, {}, deps)
  assert.match(r.reason, /tsc --noEmit failed/)
  assert.ok(r.reason.split('\n').length <= 23)
  assert.match(r.reason, /more lines cut/)
  assert.equal(saved, 'fp1')
})

test('a Vite project runs build mode and names it in the failure', async () => {
  const deps = fakeDeps({
    read: f => (f === 'tsconfig.json' ? VITE_ROOT : null),
    tsVersion: () => '5.9.3',
    run: async cmd => (deps.calls.push({ cmd }), { code: 2, out: 'src/a.ts(1,1): error TS2322' }),
  })
  const r = await decideStop({}, {}, deps)
  assert.equal(deps.calls[0].cmd, 'npx --no-install tsc -b --noEmit')
  assert.match(r.reason, /tsc -b --noEmit failed/)
})

test('a passing check stays silent', async () => {
  assert.equal(await decideStop({}, {}, fakeDeps()), null)
})

test('the check timeout is clamped below the hook timeout', async () => {
  const hook = JSON.parse(readFileSync(join(HERE, '..', '.rulesync', 'hooks.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, ''))
  const hookSec = hook.claudecode.hooks.stop[0].timeout
  assert.ok(MAX_CHECK_SEC < hookSec, `${MAX_CHECK_SEC} < ${hookSec}`)
  assert.equal(checkTimeoutMs({}), 120000)
  assert.equal(checkTimeoutMs({ checkTimeoutSec: 30 }), 30000)
  assert.equal(checkTimeoutMs({ checkTimeoutSec: 1000 }), MAX_CHECK_SEC * 1000)
  assert.equal(checkTimeoutMs({ checkTimeoutSec: '2 min' }), 120000)
  const deps = fakeDeps()
  await decideStop({}, { checkTimeoutSec: 9999 }, deps)
  assert.equal(deps.calls[0].timeoutMs, MAX_CHECK_SEC * 1000)
})

test('porcelain paths are joined to the repository root and filtered to the package', () => {
  const top = join('/', 'repo')
  const z = [' M packages/app/src/a.ts', '?? packages/other/b.ts', 'R  packages/app/src/new.ts', 'packages/app/src/old.ts', '?? README.md', ''].join('\0')
  assert.deepEqual(parsePorcelain(z, top, join(top, 'packages', 'app')), ['src/a.ts', 'src/new.ts'])
  assert.deepEqual(parsePorcelain(z, top, top).sort(), ['README.md', 'packages/app/src/a.ts', 'packages/app/src/new.ts', 'packages/other/b.ts'])
})

test('a real monorepo reports only the package changes (skipped without git)', t => {
  if (spawnSync('git', ['--version']).error) return t.skip('git not installed')
  const top = mkdtempSync(join(tmpdir(), 'web-mono-'))
  try {
    const git = (...a) => spawnSync('git', a, { cwd: top, encoding: 'utf8' })
    git('init', '-q')
    const app = join(top, 'packages', 'app')
    mkdirSync(join(app, 'src'), { recursive: true })
    mkdirSync(join(top, 'packages', 'other'), { recursive: true })
    writeFileSync(join(app, 'package.json'), '{}')
    writeFileSync(join(app, 'src', 'my file.ts'), 'export {}\n')
    writeFileSync(join(top, 'packages', 'other', 'b.ts'), 'export {}\n')
    writeFileSync(join(top, 'README.md'), '#\n')
    assert.deepEqual(changedFiles(app).sort(), ['package.json', 'src/my file.ts'])
  } finally {
    rmSync(top, { recursive: true, force: true })
  }
})

test('a check past its timeout is killed with its process tree and reported', async () => {
  const root = mkdtempSync(join(tmpdir(), 'web-timeout-'))
  try {
    const t0 = Date.now()
    const r = await realDeps(root).run('node -e "setInterval(() => {}, 1000)"', 1000)
    assert.ok(Date.now() - t0 < 15000)
    assert.notEqual(r.code, 0)
    assert.match(r.out, /timed out|ETIMEDOUT/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the entry point and both wrappers exit 0 on an empty payload', () => {
  const runs = [['node', join(TOOLS, 'web-check.mjs')], ['sh', join(TOOLS, 'web-check.sh')]]
  if (process.platform === 'win32') runs.push(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(TOOLS, 'web-check.ps1')])
  for (const argv of runs) {
    const r = spawnSync(argv[0], argv.slice(1), { input: '{"stop_hook_active":true}', encoding: 'utf8', timeout: 30000 })
    assert.equal(r.status, 0, `${argv[0]}: ${r.stderr}`)
    assert.equal(r.stdout, '')
  }
})

// rulesync 41.0.0 renders a project stop hook for OpenCode as a bare `node` call with no payload,
// no nothrow and no timeout (trial 2026-11-04), so stop sits in the Claude Code and agy blocks.
test('the stop hook is wired for Claude Code and agy only, never OpenCode', () => {
  const hooks = JSON.parse(readFileSync(join(HERE, '..', '.rulesync', 'hooks.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, ''))
  assert.deepEqual(hooks.hooks ?? {}, {}, 'no shared hooks: OpenCode would get them')
  assert.equal(hooks.opencode, undefined, 'no OpenCode block')
  for (const h of ['claudecode', 'antigravity-cli']) {
    const [e, ...rest] = hooks[h]?.hooks?.stop ?? []
    assert.equal(rest.length, 0, h)
    assert.equal(e?.command, 'node ${DOTAI_PROJECT_TOOLS}/web-check.mjs', h)
    assert.equal(e.timeout, 180, h)
  }
})
