// Run: node --test base/tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, utimesSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'

import {
  capOutput,
  changedFiles,
  findConfig,
  fingerprintFiles,
  formatPreToolUse,
  formatSessionStart,
  isObject,
  numberSettings,
  parsePayload,
  parsePorcelain,
  projectRootOf,
  readSection,
  readStdin,
  runCapped,
  shellKind,
  stampStore,
} from '../dotai/tools/hook-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', 'dotai', 'tools', 'hook-lib.mjs')
const PROFILES = join(HERE, '..', '..', 'profiles')

test('payloads of the three harnesses parse to one shape', () => {
  const cc = parsePayload(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'godot -e' } }))
  assert.deepEqual([cc.harness, cc.command], ['claudecode', 'godot -e'])
  for (const name of ['bash', 'shell']) {
    const oc = parsePayload(JSON.stringify({ tool_name: name, tool_input: { command: 'ls' } }))
    assert.deepEqual([oc.harness, oc.command], ['opencode', 'ls'], name)
  }
  const agy = parsePayload(JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: 'godot' } } }))
  assert.deepEqual([agy.harness, agy.command], ['antigravity', 'godot'])
  assert.equal(parsePayload('not json').command, '')
  const ps = parsePayload(JSON.stringify({ tool_name: 'PowerShell', tool_input: { command: 'godot -e' } }))
  assert.deepEqual([ps.harness, ps.tool, ps.command], ['claudecode', 'PowerShell', 'godot -e'])
})

test('agy session payloads (no toolCall) are recognized by their common fields', () => {
  const s = parsePayload(JSON.stringify({ conversationId: 'c1', workspacePaths: ['/w/game'], modelName: 'm' }))
  assert.deepEqual([s.harness, s.cwd, s.command], ['antigravity', '/w/game', ''])
  const cc = parsePayload(JSON.stringify({ session_id: 's', cwd: '/w/x', hook_event_name: 'SessionStart' }))
  assert.deepEqual([cc.harness, cc.cwd], ['claudecode', '/w/x'])
})

test('session start text is plain for Claude Code and OpenCode, injectSteps JSON for agy', () => {
  assert.equal(formatSessionStart('claudecode', 'state'), 'state\n')
  assert.equal(formatSessionStart('opencode', 'state'), 'state\n')
  assert.deepEqual(JSON.parse(formatSessionStart('antigravity', 'state')), {
    injectSteps: [{ systemMessage: { systemMessage: 'state' } }],
  })
  for (const h of ['claudecode', 'opencode', 'antigravity']) assert.equal(formatSessionStart(h, ''), '', h)
})

test('null and non-object payloads parse to an empty shape instead of throwing', () => {
  for (const raw of ['null', '42', '"text"', '[1,2]', 'true']) {
    const p = parsePayload(raw)
    assert.equal(p.command, '', raw)
    assert.equal(p.harness, 'claudecode', raw)
    assert.equal(typeof p.cwd, 'string', raw)
  }
  assert.equal(parsePayload(JSON.stringify({ tool_name: 'Bash', tool_input: null })).command, '')
})

test('the shell kind follows the tool, then the platform and environment', () => {
  const cc = { harness: 'claudecode', tool: 'Bash' }
  const ps = { harness: 'claudecode', tool: 'PowerShell' }
  const agy = { harness: 'antigravity', tool: 'run_command' }
  assert.equal(shellKind(ps, {}, 'linux'), 'powershell')
  assert.equal(shellKind(ps, {}, 'win32'), 'powershell')
  assert.equal(shellKind(agy, {}, 'linux'), 'posix')
  assert.equal(shellKind(cc, {}, 'win32'), 'posix') // Claude Code's Bash tool is Git Bash on Windows
  assert.equal(shellKind(agy, {}, 'win32'), 'powershell')
  assert.equal(shellKind(agy, { MSYSTEM: 'MINGW64' }, 'win32'), 'powershell') // agy uses PowerShell anyway
  const oc = { harness: 'opencode', tool: 'bash' }
  // OpenCode 2.0.30 on Windows runs $SHELL, and without it the first of pwsh, powershell, Git
  // Bash and cmd: SHELL unset with MSYSTEM inherited ran Windows PowerShell (trial 2026-11-19).
  assert.equal(shellKind(oc, {}, 'win32'), 'powershell')
  assert.equal(shellKind(oc, { MSYSTEM: 'MINGW64' }, 'win32'), 'powershell')
  assert.equal(shellKind(oc, { SHELL: '/usr/bin/bash' }, 'win32'), 'posix')
  assert.equal(shellKind(oc, { MSYSTEM: 'MINGW64', SHELL: 'C:\\Program Files\\Git\\bin\\bash.exe' }, 'win32'), 'posix')
  assert.equal(shellKind(oc, { SHELL: 'pwsh' }, 'win32'), 'powershell')
  assert.equal(shellKind(oc, { SHELL: 'C:\\Windows\\System32\\cmd.exe' }, 'win32'), 'windows')
  assert.equal(shellKind({ harness: 'opencode', tool: 'shell' }, { SHELL: '/usr/bin/zsh' }, 'win32'), 'posix')
})

test('stdin that never closes resolves empty after the idle deadline', async () => {
  const silent = new PassThrough()
  const t0 = Date.now()
  assert.equal(await readStdin(silent, 100), '')
  assert.ok(Date.now() - t0 < 2000)
  const talky = new PassThrough()
  const p = readStdin(talky, 1000)
  talky.write('﻿{"a":')
  talky.end('1}')
  assert.equal(await p, '{"a":1}')
})

test('decisions print in each harness format', () => {
  const cc = JSON.parse(formatPreToolUse('claudecode', 'ask', 'why'))
  assert.equal(cc.hookSpecificOutput.permissionDecision, 'ask')
  assert.equal(formatPreToolUse('claudecode', null, ''), '')
  const oc = JSON.parse(formatPreToolUse('opencode', 'ask', 'why'))
  assert.equal(oc.hookSpecificOutput.permissionDecision, 'deny')
  assert.deepEqual(JSON.parse(formatPreToolUse('antigravity', 'deny', 'x')), { decision: 'deny', reason: 'x' })
  // agy runs the command on ask under an allow rule or skip-permissions, which the hook cannot
  // see, so the guard denies instead.
  const agy = JSON.parse(formatPreToolUse('antigravity', 'ask', 'why'))
  assert.equal(agy.decision, 'deny')
  assert.match(agy.reason, /^why agy runs the command on ask when an allow rule or skip-permissions applies/)
  // No decision prints nothing in every harness, agy included.
  assert.equal(formatPreToolUse('antigravity', null, ''), '')
  assert.equal(formatPreToolUse('opencode', null, ''), '')
})

test('an ask rewritten to deny in OpenCode says what the user can do', () => {
  const r = JSON.parse(formatPreToolUse('opencode', 'ask', 'godot guard: this opens the editor.')).hookSpecificOutput
  assert.match(r.permissionDecisionReason, /^godot guard: this opens the editor\./)
  assert.match(r.permissionDecisionReason, /OpenCode cannot ask/)
  assert.match(r.permissionDecisionReason, /run it themselves/)
  assert.match(r.permissionDecisionReason, /permission config/)
  const deny = JSON.parse(formatPreToolUse('opencode', 'deny', 'no')).hookSpecificOutput
  assert.equal(deny.permissionDecisionReason, 'no')
})

test('config sections read the flat two-level subset', () => {
  const y = 'web:\n  check: npm run check\ngodot:\n  reserveMb: 6144  # tuned once\n  stateCommand: "python tools/state.py --brief"\nother: 1\n'
  assert.deepEqual(readSection(y, 'godot'), { reserveMb: 6144, stateCommand: 'python tools/state.py --brief' })
  assert.deepEqual(readSection(y, 'missing'), {})
})

test('only plain decimal values become numbers', () => {
  const y = 'godot:\n  a: 4096\n  b: -1.5\n  c: 4096MB\n  d: 0x10\n  e: 1e3\n  f: Infinity\n  g: " 12"\n'
  assert.deepEqual(readSection(y, 'godot'), { a: 4096, b: -1.5, c: '4096MB', d: '0x10', e: '1e3', f: 'Infinity', g: ' 12' })
})

test('numeric settings fall back to their defaults, with one warning each', () => {
  const r = numberSettings({ reserveMb: '4096MB', footprintMb: 900, other: 'x' }, { reserveMb: 1536, footprintMb: 1024 }, 'godot')
  assert.deepEqual(r.values, { reserveMb: 1536, footprintMb: 900, other: 'x' })
  assert.equal(r.warnings.length, 1)
  assert.match(r.warnings[0], /godot\.reserveMb.*4096MB.*1536/)
  assert.deepEqual(numberSettings({}, { a: 1 }, 's'), { values: { a: 1 }, warnings: [] })
})

test('the config walk stops at the project root', () => {
  const outer = mkdtempSync(join(tmpdir(), 'hooklib-cfg-'))
  try {
    mkdirSync(join(outer, '.dotai'))
    writeFileSync(join(outer, '.dotai', 'config.yaml'), 'godot:\n  reserveMb: 1\n')
    const proj = join(outer, 'proj')
    mkdirSync(join(proj, '.git'), { recursive: true })
    mkdirSync(join(proj, 'sub'))
    // A config above the repository is not the project's.
    assert.equal(findConfig(join(proj, 'sub'), {}), null)
    // The harness's project dir bounds the walk too, even without .git.
    const bare = join(outer, 'bare')
    mkdirSync(join(bare, 'sub'), { recursive: true })
    assert.equal(findConfig(join(bare, 'sub'), { CLAUDE_PROJECT_DIR: bare }), null)
    // No git: the nearest directory with .dotai/ (the applied project root) bounds the walk,
    // so a config placed above the project is ignored.
    mkdirSync(join(bare, '.dotai'))
    assert.equal(findConfig(join(bare, 'sub'), {}), null)
    writeFileSync(join(bare, '.dotai', 'config.yaml'), 'godot:\n  reserveMb: 3\n')
    assert.equal(findConfig(join(bare, 'sub'), {}), join(bare, '.dotai', 'config.yaml'))
    assert.equal(findConfig(outer, {}), join(outer, '.dotai', 'config.yaml'))
    // Inside the project the nearest config is found, at the root or below it.
    mkdirSync(join(proj, '.dotai'))
    writeFileSync(join(proj, '.dotai', 'config.yaml'), 'godot:\n  reserveMb: 2\n')
    assert.equal(findConfig(join(proj, 'sub'), {}), join(proj, '.dotai', 'config.yaml'))
    // An env project dir that does not contain the start is ignored.
    assert.equal(findConfig(join(proj, 'sub'), { CLAUDE_PROJECT_DIR: bare }), join(proj, '.dotai', 'config.yaml'))
  } finally {
    rmSync(outer, { recursive: true, force: true })
  }
})

test('the config walk compares paths without case on Windows', { skip: process.platform !== 'win32' }, () => {
  const outer = mkdtempSync(join(tmpdir(), 'hooklib-case-'))
  try {
    mkdirSync(join(outer, '.dotai'))
    writeFileSync(join(outer, '.dotai', 'config.yaml'), 'godot:\n  reserveMb: 1\n')
    const proj = join(outer, 'Proj')
    mkdirSync(join(proj, 'sub'), { recursive: true })
    const env = { CLAUDE_PROJECT_DIR: proj.toUpperCase() + '\\' }
    const start = join(proj, 'sub').toLowerCase()
    assert.equal(findConfig(start, env), null)
    mkdirSync(join(proj, '.dotai'))
    writeFileSync(join(proj, '.dotai', 'config.yaml'), 'godot:\n  reserveMb: 2\n')
    assert.equal(findConfig(start, env)?.toLowerCase(), join(proj, '.dotai', 'config.yaml').toLowerCase())
  } finally {
    rmSync(outer, { recursive: true, force: true })
  }
})

test('the config walk never reaches the home directory or goes past it', () => {
  // A fake home with its own .dotai/config.yaml (and .git, as a dotfiles repo would have).
  const home = mkdtempSync(join(tmpdir(), 'hooklib-home-'))
  try {
    mkdirSync(join(home, '.git'))
    mkdirSync(join(home, '.dotai'))
    writeFileSync(join(home, '.dotai', 'config.yaml'), 'godot:\n  reserveMb: 9\n')
    const start = join(home, 'code', 'loose', 'sub')
    mkdirSync(start, { recursive: true })
    assert.equal(projectRootOf(start, {}, home), null)
    assert.equal(findConfig(start, {}, home), null)
    // Started at home itself, home is the project.
    assert.equal(findConfig(home, {}, home), join(home, '.dotai', 'config.yaml'))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('output caps share one implementation and one truncation message', () => {
  const long = Array.from({ length: 50 }, (_, i) => `e${i}`).join('\n')
  const out = capOutput(long, 20)
  assert.equal(out.split('\n').length, 21)
  assert.match(out, /… \(30 more lines cut\)$/)
  assert.match(capOutput('x'.repeat(500), 10, 100), /… \(cut at the character cap\)$/)
  assert.equal(capOutput('a\nb\n'), 'a\nb')
})

test('runCapped passes argv without a shell and keeps both streams', async () => {
  const odd = 'a b (auth) & c.ts'
  const r = await runCapped(process.execPath, ['-e', 'console.log(process.argv[1]); console.error("E"); process.exit(3)', odd], { timeoutMs: 20000 })
  assert.equal(r.code, 3)
  assert.equal(r.stdout.trim(), odd)
  assert.equal(r.stderr.trim(), 'E')
  assert.match(r.out, /E/)
})

test('runCapped reports a missing program', async () => {
  const r = await runCapped('dotai-no-such-program-xyz', [], { timeoutMs: 5000 })
  assert.equal(r.missing, true)
})

test('runCapped caps huge output instead of losing it', async () => {
  const r = await runCapped(process.execPath, ['-e', 'process.stdout.write("x".repeat(5e6)); console.error("TAIL")'], { timeoutMs: 20000, maxBytes: 65536 })
  assert.equal(r.code, 0)
  assert.ok(r.out.length <= 65536 + 200, `${r.out.length}`)
  assert.equal(r.truncated, true)
})

test('runCapped kills the whole process tree on timeout', async () => {
  // The child starts a grandchild that would outlive a plain kill, then hangs.
  const script =
    'const c = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });' +
    'console.log(c.pid); setInterval(() => {}, 1000)'
  const t0 = Date.now()
  const r = await runCapped(process.execPath, ['-e', script], { timeoutMs: 1500 })
  assert.equal(r.timedOut, true)
  assert.ok(Date.now() - t0 < 15000)
  const pid = Number(r.stdout.trim())
  assert.ok(pid > 0, r.stdout)
  let alive = true
  for (let i = 0; i < 30 && alive; i++) {
    try {
      process.kill(pid, 0)
      await new Promise(res => setTimeout(res, 100))
    } catch {
      alive = false
    }
  }
  assert.equal(alive, false, `grandchild ${pid} survived`)
})

test('profile hooks follow the agy quoting rule and state the per-harness block convention', () => {
  for (const p of readdirSync(PROFILES)) {
    let text
    try {
      text = readFileSync(join(PROFILES, p, '.rulesync', 'hooks.jsonc'), 'utf8')
    } catch {
      continue
    }
    const hooks = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''))
    // agy runs hooks through cmd /c and every " reaches cmd as \", so its commands (its own
    // block and the shared hooks it inherits) carry no quotes.
    const agyEvents = [hooks.hooks ?? {}, hooks['antigravity-cli']?.hooks ?? {}]
    for (const events of agyEvents) {
      for (const list of Object.values(events)) {
        for (const h of list) assert.doesNotMatch(h.command, /["']/, `${p}: ${h.command}`)
      }
    }
    const perHarness = ['claudecode', 'opencode', 'antigravity-cli'].some(h => hooks[h])
    if (perHarness) assert.match(text, /per-harness block replaces the shared hooks of the same event/, p)
  }
})

test('every profile hooks file has the top-level hooks record rulesync 41 requires', () => {
  // rulesync 41 refuses a hooks file without it ("expected record" at ["hooks"]), which fails
  // the whole apply of that profile (trial 2026-11-19, tooling).
  for (const p of readdirSync(PROFILES)) {
    let text
    try {
      text = readFileSync(join(PROFILES, p, '.rulesync', 'hooks.jsonc'), 'utf8')
    } catch {
      continue
    }
    const hooks = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''))
    assert.ok(isObject(hooks.hooks), `${p}: .rulesync/hooks.jsonc needs "hooks": {}`)
  }
})

// The profile tools that import the lib, found by what they reference.
function consumers() {
  const out = []
  for (const p of readdirSync(PROFILES)) {
    const dir = join(PROFILES, p, 'dotai', 'tools')
    let names = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const n of names) {
      if (n.endsWith('.mjs') && readFileSync(join(dir, n), 'utf8').includes('hook-lib.mjs')) out.push(join(dir, n))
    }
  }
  return out
}

test('no profile ships its own copy of the lib', () => {
  for (const p of readdirSync(PROFILES)) {
    let names = []
    try {
      names = readdirSync(join(PROFILES, p, 'dotai', 'tools'))
    } catch {
      continue
    }
    assert.deepEqual(names.filter(n => /-lib\.mjs$/.test(n)), [], p)
  }
})

test('staged profile tools load the lib from the user tools directory', () => {
  const tools = consumers()
  assert.ok(tools.length >= 4, `found ${tools.length} consumers`)
  // Simulate staging: the user tools dir holds the lib, the project tools dir holds the tool
  // with the placeholder replaced by the user dir (forward slashes, as the engine writes it).
  const home = mkdtempSync(join(tmpdir(), 'hooklib-user-'))
  const project = mkdtempSync(join(tmpdir(), 'hooklib-project-'))
  try {
    copyFileSync(LIB, join(home, 'hook-lib.mjs'))
    const userDir = home.replaceAll('\\', '/')
    for (const src of tools) {
      const staged = join(project, src.split(/[\\/]/).pop())
      const text = readFileSync(src, 'utf8')
      assert.ok(text.includes('${DOTAI_TOOLS}'), src)
      writeFileSync(staged, text.replaceAll('${DOTAI_TOOLS}', userDir))
      // An empty payload in an empty directory: each tool stays silent and exits 0. If the lib
      // did not resolve from the user dir, the import throws (the source fallback is not there).
      const r = spawnSync('node', [staged], { input: '{}', cwd: project, encoding: 'utf8', timeout: 30000 })
      assert.equal(r.status, 0, `${src}: ${r.stderr}`)
      assert.equal(r.stdout.trim(), '', src)
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test('a tool whose lib is missing warns on stderr and exits 1, never silent', () => {
  const tools = consumers()
  const project = mkdtempSync(join(tmpdir(), 'hooklib-missing-'))
  try {
    const nowhere = join(project, 'no-such-dir').replaceAll('\\', '/')
    for (const src of tools) {
      const staged = join(project, src.split(/[\\/]/).pop())
      writeFileSync(staged, readFileSync(src, 'utf8').replaceAll('${DOTAI_TOOLS}', nowhere))
      const r = spawnSync('node', [staged], { input: '{}', cwd: project, encoding: 'utf8', timeout: 30000 })
      assert.equal(r.status, 1, `${src}: ${r.stderr}`)
      assert.match(r.stderr, /hook-lib\.mjs/, src)
      assert.equal(r.stderr.trim().split('\n').length, 1, src)
      assert.equal(r.stdout, '', src)
    }
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

// Moved from the web profile's web-check (2026-11-19): the tooling profile's agy Stop hook
// checks the changed files too, so both Stop hooks share one owner.
test('porcelain paths are joined to the repository root and filtered to the package', () => {
  const top = join('/', 'repo')
  const z = [' M packages/app/src/a.ts', '?? packages/other/b.ts', 'R  packages/app/src/new.ts', 'packages/app/src/old.ts', '?? README.md', ''].join('\0')
  assert.deepEqual(parsePorcelain(z, top, join(top, 'packages', 'app')), ['src/a.ts', 'src/new.ts'])
  assert.deepEqual(parsePorcelain(z, top, top).sort(), ['README.md', 'packages/app/src/a.ts', 'packages/app/src/new.ts', 'packages/other/b.ts'])
})

test('a real monorepo reports only the package changes (skipped without git)', t => {
  if (spawnSync('git', ['--version']).error) return t.skip('git not installed')
  const top = mkdtempSync(join(tmpdir(), 'hooklib-mono-'))
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


test("a fingerprint changes with a file's mtime and marks a deleted file", () => {
  const root = mkdtempSync(join(tmpdir(), 'hooklib-fp-'))
  try {
    writeFileSync(join(root, 'a.go'), 'package a\n')
    const one = fingerprintFiles(root, ['a.go', 'gone.go'])
    assert.equal(fingerprintFiles(root, ['gone.go', 'a.go']), one, 'order does not matter')
    utimesSync(join(root, 'a.go'), new Date(2001, 1, 1), new Date(2001, 1, 1))
    assert.notEqual(fingerprintFiles(root, ['a.go', 'gone.go']), one)
    assert.notEqual(fingerprintFiles(root, ['a.go']), fingerprintFiles(root, ['a.go', 'gone.go']))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a stamp is kept per tool and per root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hooklib-stamp-'))
  try {
    const a = stampStore('web-check', join(dir, 'p1'), dir)
    assert.equal(a.get(), null)
    a.set('fp1')
    assert.equal(a.get(), 'fp1')
    assert.equal(stampStore('web-check', join(dir, 'p1'), dir).get(), 'fp1')
    assert.equal(stampStore('tooling-check', join(dir, 'p1'), dir).get(), null)
    assert.equal(stampStore('web-check', join(dir, 'p2'), dir).get(), null)
    assert.ok(readdirSync(dir).some(f => /^dotai-web-check-[0-9a-f]{12}$/.test(f)), 'the web check keeps its stamp name')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
