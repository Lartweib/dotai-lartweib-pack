// Run: node --test base/tests/
// Statusline (pack 0017, update 2026-11-21): one line for the harness that runs it, with its own
// quota only; each window a bar, a percentage and a reset of at most two units, and a window with
// no data left out. Each harness writes its own quota snapshot.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { formatDuration, fromClaude, render } from '../dotai/tools/statusline.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOLS = join(HERE, '..', 'dotai', 'tools')
const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '')
const NOW = 1_800_000_000
const H = 3600
const D = 86400

test('durations omit zero leading units and keep the rest', () => {
  assert.equal(formatDuration(2 * H + 13 * 60), '2h 13m')
  assert.equal(formatDuration(3 * D + 4 * H + 10 * 60 + 59), '3d 4h')
  assert.equal(formatDuration(5 * H), '5h 0m')
  assert.equal(formatDuration(6 * D + H), '6d 1h')
  assert.equal(formatDuration(42 * 60), '42m')
  assert.equal(formatDuration(30), '0m')
  assert.equal(formatDuration(0), 'now')
  assert.equal(formatDuration(-5), 'now')
  assert.equal(formatDuration(null), '?')
})

const ccInput = {
  model: { display_name: 'Opus' },
  context_window: { used_percentage: 34.4 },
  rate_limits: {
    five_hour: { used_percentage: 41, resets_at: NOW + 2 * H + 13 * 60 },
    seven_day: { used_percentage: 22, resets_at: NOW + 3 * D + 4 * H + 10 * 60 },
  },
}
const agyInput = {
  model: { display_name: 'Gemini 3.8 Flash (Medium)' },
  context_window: { used_percentage: 12 },
  quota: {
    'gemini-5h': { remaining_fraction: 0.92, reset_in_seconds: 4 * H + 2 * 60 },
    'gemini-weekly': { used_percentage: 5, reset_time: new Date((NOW + 6 * D + H) * 1000).toISOString() },
    '3p-5h': { used_percentage: 0, reset_in_seconds: 5 * H },
    '3p-weekly': { used_percentage: 0, reset_in_seconds: 6 * D + H },
  },
}

test('one line: label, both windows with bar, percentage and reset, then model and context', () => {
  const line = plain(render({ label: 'Claude', snap: fromClaude(ccInput, NOW), now: NOW }))
  assert.match(line, /^Claude │ 5h ███░░░░░  41% ↻ 2h 13m │ 7d ██░░░░░░  22% ↻ 3d 4h\s+│ Opus · ctx 34%$/)
  const red = render({ label: 'Claude', snap: { ...fromClaude(ccInput, NOW), week: { pct: 85, reset: null } }, now: NOW })
  assert.match(red, /\x1b\[31m\s*85%/, 'red from 80%')
})

test('a window the plan does not report, or with no data, is left out', () => {
  const sevenOnly = { ...ccInput, rate_limits: { seven_day: ccInput.rate_limits.seven_day } }
  const line = plain(render({ label: 'Claude', snap: fromClaude(sevenOnly, NOW), now: NOW }))
  assert.match(line, /^Claude │ 7d ██░░░░░░  22% ↻ 3d 4h\s+│ Opus · ctx 34%$/)
  const bare = plain(render({ label: 'Claude', snap: fromClaude({ model: { display_name: 'Opus' } }, NOW), now: NOW }))
  assert.equal(bare, 'Claude │ Opus')
  assert.doesNotMatch(line + bare, /\?|···|—/)
})

test('a stale snapshot keeps its values and shows its age instead of the model', () => {
  const snap = { ...fromClaude(ccInput, NOW - 2 * H), ts: NOW - 2 * H }
  assert.match(plain(render({ label: 'Claude', snap, now: NOW })), /5h ███░░░░░  41%.*│ 2h 0m ago$/)
})

function home() {
  const dir = mkdtempSync(join(tmpdir(), 'status home '))
  mkdirSync(join(dir, '.claude'), { recursive: true })
  mkdirSync(join(dir, '.gemini', 'antigravity-cli'), { recursive: true })
  return dir
}
const run = (args, input, h, extra = {}) =>
  spawnSync(process.execPath, [join(TOOLS, 'statusline.mjs'), ...args], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, USERPROFILE: h, HOME: h, NO_COLOR: '1', ...extra },
  })

test('the Claude Code snapshot lives in CLAUDE_CONFIG_DIR when set', () => {
  const h = home()
  try {
    const config = join(h, 'isolated claude')
    mkdirSync(config, { recursive: true })
    const now = Math.floor(Date.now() / 1000)
    const input = { ...ccInput, rate_limits: { five_hour: { used_percentage: 63, resets_at: now + H }, seven_day: { used_percentage: 9, resets_at: now + D } } }
    const cc = run(['claudecode'], input, h, { CLAUDE_CONFIG_DIR: config })
    assert.equal(cc.status, 0, cc.stderr)
    assert.equal(JSON.parse(readFileSync(join(config, 'rate_limits.json'), 'utf8')).five_hour_pct, 63)
    assert.deepEqual(readdirSync(join(h, '.claude')), [], 'the default snapshot is left alone')
    assert.match(cc.stdout, /^Claude │ 5h \S+\s+63%/)
  } finally {
    rmSync(h, { recursive: true, force: true })
  }
})

test('each harness writes its own snapshot and shows only its own quota; agy keeps absolute resets', () => {
  const h = home()
  try {
    const now = Math.floor(Date.now() / 1000)
    const cc = run(['claudecode'], { ...ccInput, rate_limits: { five_hour: { used_percentage: 41, resets_at: now + H }, seven_day: { used_percentage: 22, resets_at: now + D } } }, h)
    assert.equal(cc.status, 0, cc.stderr)
    assert.equal(cc.stdout.trim().split('\n').length, 1)
    const ccSnap = JSON.parse(readFileSync(join(h, '.claude', 'rate_limits.json'), 'utf8'))
    assert.equal(ccSnap.five_hour_pct, 41)
    assert.equal(ccSnap.seven_day_resets, now + D)
    assert.ok(Math.abs(ccSnap.ts - now) < 30)
    assert.doesNotMatch(cc.stdout, /Gemini/)

    const agy = run(['antigravity'], agyInput, h)
    assert.equal(agy.status, 0, agy.stderr)
    const snap = JSON.parse(readFileSync(join(h, '.gemini', 'antigravity-cli', 'rate_limits.json'), 'utf8'))
    assert.equal(snap.gemini_5h_pct, 8)
    assert.equal(snap.p3_7d_pct, 0)
    assert.ok(Math.abs(snap.gemini_5h_resets - (now + 4 * H + 120)) < 30)
    assert.equal(snap.model, '3.8 Flash (Medium)')
    assert.match(agy.stdout, /^Gemini │ 5h \S+\s+8% .*│ 3\.8 Flash \(Medium\) · ctx 12%$/m)
    assert.doesNotMatch(agy.stdout, /Claude/)
  } finally {
    rmSync(h, { recursive: true, force: true })
  }
})

test('without a harness argument the input shape decides; empty or broken input prints nothing', () => {
  const h = home()
  try {
    assert.match(run([], agyInput, h).stdout, /3\.8 Flash/)
    const empty = spawnSync(process.execPath, [join(TOOLS, 'statusline.mjs')], { input: '', encoding: 'utf8', env: { ...process.env, USERPROFILE: h, HOME: h } })
    assert.equal(empty.status, 0)
    assert.equal(empty.stdout, '')
    const broken = spawnSync(process.execPath, [join(TOOLS, 'statusline.mjs')], { input: '{', encoding: 'utf8', env: { ...process.env, USERPROFILE: h, HOME: h } })
    assert.equal(broken.status, 0)
    assert.equal(broken.stdout, '')
  } finally {
    rmSync(h, { recursive: true, force: true })
  }
})

test('the PowerShell wrapper passes stdin and arguments through', { skip: process.platform !== 'win32' }, () => {
  const h = home()
  try {
    const env = { ...process.env, USERPROFILE: h, HOME: h, NO_COLOR: '1' }
    // PowerShell's own startup varies by host (over 5 s cold on a CI runner, CI 2026-11-20): a
    // bare launch first absorbs the cold start and gives the baseline the wrapper is held to.
    const b0 = Date.now()
    const bare = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'exit 0'], { env, timeout: 60000 })
    assert.equal(bare.status, 0, String(bare.error ?? bare.stderr))
    const baseline = Date.now() - b0
    const t0 = Date.now()
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(TOOLS, 'statusline.ps1'), 'claudecode'], {
      input: JSON.stringify(ccInput),
      encoding: 'utf8',
      env,
      timeout: 60000,
    })
    const took = Date.now() - t0
    assert.equal(r.status, 0, String(r.error ?? r.stderr))
    assert.match(r.stdout, /^Claude │ 5h \S+\s+41%/)
    assert.ok(took < baseline + 3000, `took ${took} ms, a bare PowerShell launch ${baseline} ms`)
  } finally {
    rmSync(h, { recursive: true, force: true })
  }
})

// The delegate line (standalone README, TODO closed 2026-11-03): read from the launch log the
// backend writes, with no subprocess; no log, no line.
test('a fourth line shows delegate state from the launch log, and is omitted without one', () => {
  const h = home()
  try {
    const packHome = join(h, 'pack home')
    const env = { DOTAI_DELEGATE_HOME: packHome }
    assert.equal(run(['claudecode'], ccInput, h, env).stdout.trim().split('\n').length, 1, 'no log: no line')
    mkdirSync(packHome, { recursive: true })
    writeFileSync(join(packHome, 'launches.jsonl'), '')
    assert.equal(run(['claudecode'], ccInput, h, env).stdout.trim().split('\n').length, 1, 'empty log: no line')
    const ts = Date.now() - 120000
    writeFileSync(
      join(packHome, 'launches.jsonl'),
      [
        { id: 'a', event: 'start', ts, harness: 'agy', model: 'gemini-3.8-flash-low', effort: 'low', pid: 999999 },
        { id: 'a', event: 'end', ts: ts + 1000, status: 'OK', secs: 1 },
        'not json',
      ]
        .map(e => (typeof e === 'string' ? e : JSON.stringify(e)))
        .join('\n') + '\n',
    )
    for (const harness of ['claudecode', 'antigravity']) {
      const lines = run([harness], harness === 'claudecode' ? ccInput : agyInput, h, env).stdout.trim().split('\n')
      assert.equal(lines.length, 2, harness)
      assert.match(lines[1], /^delegate: 0 running · last OK 2m ago$/, harness)
    }
  } finally {
    rmSync(h, { recursive: true, force: true })
  }
})

test('a payload without quota keeps the last good snapshot instead of overwriting it with nulls', () => {
  const h = home()
  try {
    assert.equal(run(['antigravity'], agyInput, h).status, 0)
    const agyFile = join(h, '.gemini', 'antigravity-cli', 'rate_limits.json')
    const before = readFileSync(agyFile, 'utf8')
    const noQuota = run(['antigravity'], { model: agyInput.model, context_window: { used_percentage: 20 } }, h)
    assert.equal(noQuota.status, 0, noQuota.stderr)
    assert.equal(readFileSync(agyFile, 'utf8'), before)
    assert.match(noQuota.stdout.split('\n')[0], /5h \S+\s+8%/, 'the last values still show')

    assert.equal(run(['claudecode'], ccInput, h).status, 0)
    const ccFile = join(h, '.claude', 'rate_limits.json')
    const ccBefore = readFileSync(ccFile, 'utf8')
    const noLimits = run(['claudecode'], { model: { display_name: 'Opus' }, context_window: { used_percentage: 5 } }, h)
    assert.equal(readFileSync(ccFile, 'utf8'), ccBefore)
    assert.match(noLimits.stdout.split('\n')[0], /^Claude │ 5h \S+\s+41%.*ctx 5%/)
    const emptyLimits = run(['claudecode'], { model: { display_name: 'Opus' }, context_window: { used_percentage: 6 }, rate_limits: {} }, h)
    assert.equal(emptyLimits.status, 0, emptyLimits.stderr)
    assert.equal(readFileSync(ccFile, 'utf8'), ccBefore, 'an empty rate_limits object is no quota block')
    assert.match(emptyLimits.stdout.split('\n')[0], /^Claude │ 5h \S+\s+41%.*ctx 6%/)
  } finally {
    rmSync(h, { recursive: true, force: true })
  }
})

test('a snapshot that cannot be renamed into place leaves no temp file and no half-written file', () => {
  const h = home()
  try {
    mkdirSync(join(h, '.claude', 'rate_limits.json'))
    const r = run(['claudecode'], ccInput, h)
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(readdirSync(join(h, '.claude')), ['rate_limits.json'])
  } finally {
    rmSync(h, { recursive: true, force: true })
  }
})
