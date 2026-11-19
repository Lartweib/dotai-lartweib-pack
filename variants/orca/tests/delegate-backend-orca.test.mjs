// Run: node --test "variants/*/tests/*.test.mjs"
// The orca variant's backend: single delegation in an Orca terminal running agy -p, headless
// fallback, the stub guide for several workers, and the contract checks around worker-start.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runTool, sandbox, spec } from '../../standalone/tests/fakes.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACK = join(HERE, '..', '..', '..')
const TOOL = join(HERE, '..', 'dotai', 'tools', 'delegate-backend.mjs')
const CC = { CLAUDECODE: '1' }
const base = s => ['run', '--model', 'gemini-3.8-flash-low', '--effort', 'low', '--spec', s, '--title', 'orca job']

test('a single delegation opens an Orca terminal running agy -p, then closes it', () => {
  const sb = sandbox(['agy', 'orca'])
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, CC)
    assert.equal(r.code, 0, r.out + r.err)
    assert.match(r.out, /^delegate \S+ OK agy gemini-3\.8-flash-low\/low .*via=orca:term_fake1 result=/m)
    const calls = sb.calls()
    const create = calls.find(c => c.name === 'orca' && c.argv[0] === 'terminal' && c.argv[1] === 'create')
    assert.ok(create, JSON.stringify(calls))
    const line = create.argv[create.argv.indexOf('--command') + 1]
    assert.match(line, /agy/)
    assert.match(line, /--output-format/)
    assert.match(line, /gemini-3\.8-flash-low/)
    if (process.platform === 'win32') assert.equal(create.argv[create.argv.indexOf('--shell') + 1], 'cmd.exe')
    const agy = calls.find(c => c.name === 'agy')
    assert.equal(agy.caller, 'agy')
    assert.ok(calls.some(c => c.name === 'orca' && c.argv[1] === 'close' && c.argv.includes('term_fake1')))
    const resultPath = /result=(.+)$/.exec(r.out.trim())[1]
    assert.equal(readFileSync(resultPath, 'utf8'), 'fake result: Definición')
  } finally {
    sb.cleanup()
  }
})

test('the typed line runs research in plan mode and a code job with --dangerously-skip-permissions', () => {
  const sb = sandbox(['agy', 'orca'])
  try {
    const s = spec(sb)
    assert.equal(runTool(TOOL, base(s), sb, CC).code, 0)
    assert.equal(runTool(TOOL, [...base(s), '--kind', 'code'], sb, CC).code, 0)
    const [research, code] = sb.calls().filter(c => c.name === 'orca' && c.argv[1] === 'create').map(c => c.argv[c.argv.indexOf('--command') + 1])
    assert.match(research, /"--mode" "plan"/)
    assert.doesNotMatch(research, /--dangerously-skip-permissions/)
    assert.match(code, /--dangerously-skip-permissions/)
    assert.doesNotMatch(code, /"--mode"/)
  } finally {
    sb.cleanup()
  }
})

test('the quota error is read from the JSON in the Orca terminal too', () => {
  const sb = sandbox(['agy', 'orca'])
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, { ...CC, FAKE_AGY: 'quota' })
    assert.equal(r.code, 3, r.out + r.err)
    assert.match(r.out, /DEFER .*exhausted/)
  } finally {
    sb.cleanup()
  }
})

test('with Orca unreachable the delegation runs headless (dotai never depends on Orca)', () => {
  const sb = sandbox(['agy', 'orca'])
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, { ...CC, FAKE_ORCA: 'down' })
    assert.equal(r.code, 0, r.out + r.err)
    assert.match(r.out, /OK agy .*headless/)
    assert.ok(!sb.calls().some(c => c.name === 'orca' && c.argv[1] === 'create'))
  } finally {
    sb.cleanup()
  }
})

test('without the orca CLI the delegation runs headless', () => {
  const sb = sandbox(['agy'])
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, CC)
    assert.equal(r.code, 0, r.out + r.err)
    assert.match(r.out, /headless/)
  } finally {
    sb.cleanup()
  }
})

test('several workers go through Orca orchestration: --jobs points to the guide', () => {
  const sb = sandbox(['agy', 'orca'])
  try {
    const r = runTool(TOOL, ['run', '--jobs', 'a.json', 'b.json'], sb, CC)
    assert.equal(r.code, 2)
    assert.match(r.out, /workers/)
    assert.equal(sb.calls().filter(c => c.name === 'agy').length, 0)
  } finally {
    sb.cleanup()
  }
})

test('the workers guide references orchestration by name and requires the checks', () => {
  const sb = sandbox(['agy', 'orca'])
  try {
    const r = runTool(TOOL, ['workers'], sb)
    assert.equal(r.code, 0)
    assert.match(r.out, /orca skills get orchestration/)
    assert.match(r.out, /delegate-backend\.mjs" check/)
    assert.match(r.out, /delegate-backend\.mjs" confirm/)
    assert.match(r.out, /job folder|result file/i)
    assert.ok(r.out.length < 1800, `${r.out.length} chars`)
  } finally {
    sb.cleanup()
  }
})

test('check prints the worker-start flags: --effort only where agy accepts it', () => {
  const sb = sandbox(['agy', 'orca'])
  try {
    const g = runTool(TOOL, ['check', '--model', 'gemini-3.8-flash-low', '--effort', 'low', '--title', 'w1'], sb, CC)
    assert.equal(g.code, 0, g.out)
    assert.match(g.out, /--agent antigravity --model gemini-3\.8-flash-low --effort low/)
    const t = runTool(TOOL, ['check', '--model', 'claude-sonnet-4-6', '--effort', 'default'], sb, CC)
    assert.equal(t.code, 0)
    assert.match(t.out, /--agent antigravity --model claude-sonnet-4-6(\s|$)/)
    assert.doesNotMatch(t.out, /--effort/)
    const hub = runTool(TOOL, ['check', '--model', 'claude-sonnet-4-6', '--effort', 'default', '--from', 'agy'], sb)
    assert.equal(hub.code, 2)
    assert.equal(sb.calls().filter(c => c.name === 'agy').length, 0)
  } finally {
    sb.cleanup()
  }
})

test('confirm checks the actual model from worker-read, since launch.effective is not evidence', () => {
  const sb = sandbox(['agy', 'orca'])
  try {
    const ok = runTool(TOOL, ['confirm', '--dispatch', 'd1', '--model', 'gemini-3.8-flash-low'], sb, { FAKE_ORCA_BANNER: 'Antigravity CLI · Gemini 3.8 Flash (Low) · ready' })
    assert.equal(ok.code, 0, ok.out + ok.err)
    assert.match(ok.out, /CONFIRMED/)
    // The pack statusline drops "Gemini".
    const line = runTool(TOOL, ['confirm', '--dispatch', 'd1', '--model', 'gemini-3.8-flash-low'], sb, { FAKE_ORCA_BANNER: 'agy 3.8 Flash (Low) · quota 80%' })
    assert.equal(line.code, 0, line.out + line.err)
    const bad = runTool(TOOL, ['confirm', '--dispatch', 'd1', '--model', 'claude-sonnet-4-6'], sb, { FAKE_ORCA_BANNER: 'Antigravity CLI · Gemini 3.8 Flash (Medium)' })
    assert.equal(bad.code, 1)
    assert.match(bad.out, /MISMATCH/)
    const unk = runTool(TOOL, ['confirm', '--dispatch', 'd1', '--model', 'gemini-3.8-flash-low'], sb, { FAKE_ORCA_BANNER: '' })
    assert.equal(unk.code, 1)
    assert.match(unk.out, /UNCONFIRMED/)
  } finally {
    sb.cleanup()
  }
})

// The contract is one base tool (0034, update 2026-11-03): no variant ships a copy, and each
// backend loads it from the user tools directory once staged (both are user scope), or from the
// base layer in the pack source.
const VARIANTS = ['standalone', 'orca']
const BASE_TOOLS = join(PACK, 'base', 'dotai', 'tools')

test('no variant ships the contract module; the base does', () => {
  assert.ok(existsSync(join(BASE_TOOLS, 'delegate-core.mjs')))
  for (const v of VARIANTS) assert.ok(!existsSync(join(PACK, 'variants', v, 'dotai', 'tools', 'delegate-core.mjs')), v)
})

test('both staged backends import the base core from the user tools directory', () => {
  const user = mkdtempSync(join(tmpdir(), 'dotai user tools '))
  try {
    for (const n of ['hook-lib.mjs', 'delegate-core.mjs']) copyFileSync(join(BASE_TOOLS, n), join(user, n))
    const userDir = user.replaceAll('\\', '/')
    for (const v of VARIANTS) {
      const src = readFileSync(join(PACK, 'variants', v, 'dotai', 'tools', 'delegate-backend.mjs'), 'utf8')
      assert.ok(src.includes("'${DOTAI_TOOLS}'") && !src.includes("'./delegate-core.mjs'"), v)
      const dir = mkdtempSync(join(tmpdir(), `dotai ${v} `))
      try {
        const staged = join(dir, 'delegate-backend.mjs')
        writeFileSync(staged, src.replaceAll('${DOTAI_TOOLS}', userDir))
        const r = spawnSync(process.execPath, [staged, 'status', '--line'], { cwd: dir, encoding: 'utf8', env: { ...process.env, DOTAI_DELEGATE_HOME: join(dir, 'home') }, timeout: 30000 })
        assert.equal(r.status, 0, `${v}: ${r.stderr}`)
        assert.match(r.stdout, /^delegate: 0 running/, v)
        const missing = join(dir, 'missing.mjs')
        writeFileSync(missing, src.replaceAll('${DOTAI_TOOLS}', join(dir, 'nowhere').replaceAll('\\', '/')))
        const m = spawnSync(process.execPath, [missing, 'status', '--line'], { cwd: dir, encoding: 'utf8', timeout: 30000 })
        assert.equal(m.status, 1, v)
        assert.match(m.stderr, /delegate-core\.mjs/, v)
        assert.equal(m.stdout, '', v)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  } finally {
    rmSync(user, { recursive: true, force: true })
  }
})

const ORCA_SKILLS = ['orca-cli', 'orchestration', 'computer-use', 'orca-jira', 'orca-linear', 'jira-tickets', 'linear-tickets', 'orca-emulator', 'orca-emulator-android', 'orca-per-workspace-env']

function walk(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? [p, ...walk(p)] : [p]
  })
}

test('no variant or delegate item takes an Orca name, and no variant ships a delegate item (0033, 0034)', () => {
  const roots = [join(PACK, 'variants'), join(PACK, 'base', '.rulesync')]
  for (const p of roots.flatMap(walk)) {
    const rel = relative(PACK, p).replace(/\\/g, '/')
    if (/\/tests(\/|$)/.test(rel)) continue
    const stem = rel.split('/').at(-1).replace(/\.(md|mjs|sh|ps1|jsonc?)$/, '')
    if (!/\.rulesync\/(skills|subagents|commands|rules)\//.test(rel) && !/dotai\/tools\//.test(rel)) continue
    assert.ok(!/^orca-/.test(stem) && !ORCA_SKILLS.includes(stem), `${rel} uses a name Orca reserves`)
    if (rel.startsWith('variants/')) assert.doesNotMatch(rel, /\.rulesync\/(skills|subagents|commands)\/delegate(\.md|\/)/, rel)
  }
})

const created = sb => sb.calls().filter(c => c.name === 'orca' && c.argv[1] === 'create')
const closedHandles = sb => sb.calls().filter(c => c.name === 'orca' && c.argv[1] === 'close').map(c => c.argv[c.argv.indexOf('--terminal') + 1])

test('a quota retry on --alt runs in its own attempt folder and terminal, and both terminals close', () => {
  const sb = sandbox(['agy', 'orca'])
  try {
    const r = runTool(TOOL, [...base(spec(sb)), '--alt', 'claude-sonnet-4-6:default'], sb, { ...CC, FAKE_AGY: 'quota-gemini' })
    assert.equal(r.code, 0, r.out + r.err)
    assert.match(r.out, /OK agy claude-sonnet-4-6\/default .*via=orca:term_fake2/)
    assert.equal(created(sb).length, 2)
    assert.deepEqual(closedHandles(sb).sort(), ['term_fake1', 'term_fake2'])
    const lines = created(sb).map(c => c.argv[c.argv.indexOf('--command') + 1])
    const outOf = l => /> "?'?([^"']*out\.json)/.exec(l)[1]
    assert.notEqual(outOf(lines[0]), outOf(lines[1]), 'each attempt writes its own out.json')
  } finally {
    sb.cleanup()
  }
})

// An Orca terminal starts with Orca's environment, not the delegate's, so the typed line itself
// runs the target and sets the isolated install's variables, clearing those it owns.
test('an OpenCode job in an Orca terminal runs opencode with the isolated environment', () => {
  const sb = sandbox(['opencode', 'orca'])
  try {
    mkdirSync(join(sb.home, '.dotai', 'isolated', 'opencode', 'config', 'opencode'), { recursive: true })
    writeFileSync(join(sb.home, '.dotai', 'state.json'), JSON.stringify({ schema: 'dotai.state/v1', mode: 'isolated', harnesses: ['opencode'] }))
    const r = runTool(TOOL, ['run', '--to', 'opencode', '--model', 'openai/gpt-5.5', '--effort', 'high', '--spec', spec(sb), '--title', 'orca job'], sb, CC)
    assert.equal(r.code, 0, r.out + r.err)
    assert.match(r.out, /via=orca:/)
    const line = created(sb)[0].argv[created(sb)[0].argv.indexOf('--command') + 1]
    const xdg = join(sb.home, '.dotai', 'isolated', 'opencode', 'config')
    if (process.platform === 'win32') {
      assert.ok(line.includes(`set "XDG_CONFIG_HOME=${xdg}"`), line)
      assert.ok(line.includes('set "OPENCODE_CONFIG="'), line)
      assert.match(line, /& opencode "run" "--standalone"/)
    } else {
      assert.ok(line.includes(`XDG_CONFIG_HOME='${xdg}'`), line)
      assert.match(line, /unset .*OPENCODE_CONFIG/)
      assert.match(line, / 'opencode' 'run' '--standalone'/)
    }
    const oc = sb.calls().find(c => c.name === 'opencode')
    assert.equal(oc.xdgConfig, xdg)
  } finally {
    sb.cleanup()
  }
})

test('the typed line enters the working directory first', () => {
  const sb = sandbox(['agy', 'orca'])
  try {
    assert.equal(runTool(TOOL, base(spec(sb)), sb, CC).code, 0)
    const line = created(sb)[0].argv[created(sb)[0].argv.indexOf('--command') + 1]
    if (process.platform === 'win32') assert.ok(line.startsWith(`cd /d "${sb.project}"`), line)
    else assert.ok(line.startsWith(`cd '${sb.project}'`), line)
  } finally {
    sb.cleanup()
  }
})

test('a terminal that disappears before done fails the run instead of waiting for the timeout', () => {
  const sb = sandbox(['agy', 'orca'])
  try {
    const t0 = Date.now()
    const r = runTool(TOOL, base(spec(sb)), sb, { ...CC, FAKE_ORCA: 'vanish', DOTAI_ORCA_PROBE_MS: '300' })
    assert.equal(r.code, 1, r.out + r.err)
    assert.match(r.out, /FAIL .*terminal closed/)
    assert.ok(Date.now() - t0 < 30000)
    assert.equal(sb.calls().filter(c => c.name === 'agy').length, 0)
  } finally {
    sb.cleanup()
  }
})

for (const [mode, reason] of [['create-hang', 'orca-create-timeout'], ['create-fail', 'orca-create-error']]) {
  test(`a terminal create that ${mode === 'create-hang' ? 'times out' : 'fails'} is closed, then the run goes headless`, () => {
    const sb = sandbox(['agy', 'orca'])
    try {
      const r = runTool(TOOL, base(spec(sb)), sb, { ...CC, FAKE_ORCA: mode, DOTAI_ORCA_CREATE_TIMEOUT_MS: '1500' })
      assert.equal(r.code, 0, r.out + r.err)
      assert.match(r.out, new RegExp(`OK agy .*via=headless:${reason}`))
      assert.deepEqual(closedHandles(sb), ['term_fake1'], 'the half-created terminal is closed')
      assert.equal(sb.calls().filter(c => c.name === 'agy').length, 1)
    } finally {
      sb.cleanup()
    }
  })
}

test('a working directory cmd.exe cannot take runs headless instead of failing', { skip: process.platform !== 'win32' }, () => {
  const sb = sandbox(['agy', 'orca'])
  try {
    const odd = join(sb.project, '100% done')
    mkdirSync(odd)
    const r = runTool(TOOL, base(spec(sb)), sb, CC, '', odd)
    assert.equal(r.code, 0, r.out + r.err)
    assert.match(r.out, /via=headless:orca-unquotable/)
    assert.equal(created(sb).length, 0)
  } finally {
    sb.cleanup()
  }
})

// The liveness probe: a terminal counts as closed only when `terminal list` answers with
// `result.terminals[]` and no entry has its handle, on two probes in a row. Anything else keeps
// waiting until the done marker.
const lists = sb => sb.calls().filter(c => c.name === 'orca' && c.argv[1] === 'list').length
const slow = { ...CC, FAKE_AGY: 'sleep', FAKE_AGY_SLEEP_MS: '2500', DOTAI_ORCA_PROBE_MS: '200' }

for (const [mode, why] of [
  ['list-error', 'terminal list fails'],
  ['flicker', 'the terminal is missing from one probe but not the next'],
]) {
  test(`a healthy run stays alive when ${why}`, () => {
    const sb = sandbox(['agy', 'orca'])
    try {
      const r = runTool(TOOL, base(spec(sb)), sb, { ...slow, FAKE_ORCA: mode })
      assert.equal(r.code, 0, r.out + r.err)
      assert.match(r.out, /OK agy .*via=orca:term_fake1/)
      assert.ok(lists(sb) >= 3, `probed ${lists(sb)} times`)
    } finally {
      sb.cleanup()
    }
  })
}

test('a terminal truly gone fails only after two probes in a row', () => {
  const sb = sandbox(['agy', 'orca'])
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, { ...CC, FAKE_ORCA: 'vanish', DOTAI_ORCA_PROBE_MS: '200' })
    assert.equal(r.code, 1, r.out + r.err)
    assert.match(r.out, /FAIL .*terminal closed/)
    assert.equal(lists(sb), 2)
  } finally {
    sb.cleanup()
  }
})

test('without a handle from create, the terminal is found by the job marker at the end and closed', () => {
  const sb = sandbox(['agy', 'orca'])
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, { ...CC, FAKE_ORCA: 'no-handle-late' })
    assert.equal(r.code, 0, r.out + r.err)
    assert.deepEqual(closedHandles(sb), ['term_fake1'])
    assert.equal(r.err, '')
  } finally {
    sb.cleanup()
  }
})

test('a terminal that cannot be found at all gets one line asking the user to close its tab', () => {
  const sb = sandbox(['agy', 'orca'])
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, { ...CC, FAKE_ORCA: 'no-handle-never' })
    assert.equal(r.code, 0, r.out + r.err)
    assert.deepEqual(closedHandles(sb), [])
    const id = /^delegate (\S+) OK/.exec(r.out)[1]
    const hint = r.err.trim().split(/\r?\n/)
    assert.equal(hint.length, 1, r.err)
    assert.ok(hint[0].includes(`[${id}]`) && /close the Orca tab/i.test(hint[0]), hint[0])
  } finally {
    sb.cleanup()
  }
})

// Against the JSON recorded from Orca 1.4.247 (fixtures/orca-1.4.247, fake-orca-recorded.mjs).
const RECORDED = join(HERE, 'fake-orca-recorded.mjs')
const FOREIGN = JSON.parse(readFileSync(join(HERE, 'fixtures', 'orca-1.4.247', 'list-running.json'), 'utf8')).result.terminals[0].handle

function recordedSandbox() {
  const sb = sandbox(['agy'])
  if (process.platform === 'win32') writeFileSync(join(sb.bin, 'orca.cmd'), `@node "${RECORDED}" %*\r\n`)
  else {
    writeFileSync(join(sb.bin, 'orca'), `#!/bin/sh\nexec node '${RECORDED}' "$@"\n`)
    chmodSync(join(sb.bin, 'orca'), 0o755)
  }
  return sb
}

test('the recorded create, list and close shapes: the run uses the create handle and closes only its own tab', () => {
  const sb = recordedSandbox()
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, { ...slow, FAKE_ORCA: 'foreign-mentions' })
    assert.equal(r.code, 0, r.out + r.err)
    assert.match(r.out, /OK agy .*via=orca:term_recorded1 /)
    assert.ok(lists(sb) >= 3, `probed ${lists(sb)} times`)
    assert.deepEqual(closedHandles(sb), ['term_recorded1'])
    assert.equal(r.err, '')
    const line = created(sb)[0].argv[created(sb)[0].argv.indexOf('--command') + 1]
    if (process.platform === 'win32') assert.match(line, /&& \(title orca job \[\d{8}-\d{6}-\w+\] & set /, 'cmd.exe gets the title back')
  } finally {
    sb.cleanup()
  }
})

test('another tab whose preview quotes the handle does not keep a vanished terminal alive', () => {
  const sb = recordedSandbox()
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, { ...CC, FAKE_ORCA: 'vanish foreign-mentions', DOTAI_ORCA_PROBE_MS: '200' })
    assert.equal(r.code, 1, r.out + r.err)
    assert.match(r.out, /FAIL .*terminal closed/)
    assert.equal(lists(sb), 2)
    assert.ok(!closedHandles(sb).includes(FOREIGN))
  } finally {
    sb.cleanup()
  }
})

test('after a create timeout the stray tab is found by its title, never by another tab quoting the job id', () => {
  const sb = recordedSandbox()
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, { ...CC, FAKE_ORCA: 'create-hang foreign-mentions', DOTAI_ORCA_CREATE_TIMEOUT_MS: '1500' })
    assert.equal(r.code, 0, r.out + r.err)
    assert.match(r.out, /OK agy .*via=headless:orca-create-timeout/)
    assert.deepEqual(closedHandles(sb), ['term_recorded1'])
  } finally {
    sb.cleanup()
  }
})

test('a truncated list proves nothing: the run keeps waiting for its done marker', () => {
  const sb = recordedSandbox()
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, { ...slow, FAKE_ORCA: 'truncated' })
    assert.equal(r.code, 0, r.out + r.err)
    assert.match(r.out, /OK agy .*via=orca:term_recorded1 /)
    assert.ok(lists(sb) >= 3, `probed ${lists(sb)} times`)
  } finally {
    sb.cleanup()
  }
})
