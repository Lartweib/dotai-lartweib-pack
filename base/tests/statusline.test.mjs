// Run: node --test base/tests/
// Statusline (pack 0017, update 2026-10-31): three aligned lines, Claude Code, agy and agy's
// third-party pool, with resets as `Xd Xh Xm`. Each harness writes its own quota snapshot and
// reads the other's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { formatDuration, fromAgy, fromClaude, render } from '../dotai/tools/statusline.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOLS = join(HERE, '..', 'dotai', 'tools')
const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '')
const NOW = 1_800_000_000
const H = 3600
const D = 86400

test('durations omit zero leading units and keep the rest', () => {
  assert.equal(formatDuration(2 * H + 13 * 60), '2h 13m')
  assert.equal(formatDuration(3 * D + 4 * H + 10 * 60 + 59), '3d 4h 10m')
  assert.equal(formatDuration(5 * H), '5h 0m')
  assert.equal(formatDuration(6 * D + H), '6d 1h 0m')
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

test('the three lines are aligned and carry the live values', () => {
  const lines = render({ cc: fromClaude(ccInput, NOW), agy: fromAgy(agyInput, NOW), now: NOW }).split('\n').map(plain)
  assert.equal(lines.length, 3)
  assert.match(lines[0], /^CC\s+5h 41% ↻ 2h 13m\s+│ wk 22% ↻ 3d 4h 10m\s+│ Opus · ctx 34%$/)
  assert.match(lines[1], /^agy\s+5h\s+8% ↻ 4h 2m\s+│ wk\s+5% ↻ 6d 1h 0m\s+│ 3\.8 Flash \(Medium\)$/)
  assert.match(lines[2], /^agy 3p\s+5h\s+0% ↻ 5h 0m\s+│ wk\s+0% ↻ 6d 1h 0m\s+│ updated now$/)
  const bars = lines.map(l => [...l.matchAll(/│/g)].map(m => m.index))
  assert.deepEqual(bars[1], bars[0])
  assert.deepEqual(bars[2], bars[0])
})

test('a stale or missing snapshot shows ? and its age', () => {
  const agy = { ...fromAgy(agyInput, NOW - 2 * H), ts: NOW - 2 * H }
  const lines = render({ cc: fromClaude(ccInput, NOW), agy, now: NOW }).split('\n').map(plain)
  assert.match(lines[1], /5h\s+\?% ↻ \?/)
  assert.match(lines[2], /updated 2h 0m ago/)
  const none = render({ cc: fromClaude(ccInput, NOW), agy: null, now: NOW }).split('\n').map(plain)
  assert.match(none[1], /5h\s+\?% ↻ \?/)
  assert.match(none[2], /no data/)
  const noCc = render({ cc: null, agy: fromAgy(agyInput, NOW), now: NOW }).split('\n').map(plain)
  assert.match(noCc[0], /^CC\s+5h\s+\?% ↻ \?/)
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

test('the Claude Code snapshot lives in CLAUDE_CONFIG_DIR when set, for both harnesses', () => {
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
    const agy = run(['antigravity'], agyInput, h, { CLAUDE_CONFIG_DIR: config })
    assert.match(agy.stdout, /^CC\s+5h 63%/, 'agy reads the snapshot from the same directory')
  } finally {
    rmSync(h, { recursive: true, force: true })
  }
})

test('Claude Code writes its snapshot and reads agy, agy writes its own with absolute resets', () => {
  const h = home()
  try {
    const now = Math.floor(Date.now() / 1000)
    const cc = run(['claudecode'], { ...ccInput, rate_limits: { five_hour: { used_percentage: 41, resets_at: now + H }, seven_day: { used_percentage: 22, resets_at: now + D } } }, h)
    assert.equal(cc.status, 0, cc.stderr)
    assert.equal(cc.stdout.trim().split('\n').length, 3)
    const ccSnap = JSON.parse(readFileSync(join(h, '.claude', 'rate_limits.json'), 'utf8'))
    assert.equal(ccSnap.five_hour_pct, 41)
    assert.equal(ccSnap.seven_day_resets, now + D)
    assert.ok(Math.abs(ccSnap.ts - now) < 30)
    assert.match(cc.stdout, /no data/)

    const agy = run(['antigravity'], agyInput, h)
    assert.equal(agy.status, 0, agy.stderr)
    const snap = JSON.parse(readFileSync(join(h, '.gemini', 'antigravity-cli', 'rate_limits.json'), 'utf8'))
    assert.equal(snap.gemini_5h_pct, 8)
    assert.equal(snap.p3_7d_pct, 0)
    assert.ok(Math.abs(snap.gemini_5h_resets - (now + 4 * H + 120)) < 30)
    assert.equal(snap.model, '3.8 Flash (Medium)')
    assert.match(agy.stdout, /^CC\s+5h 41%/, 'agy shows Claude from its snapshot')

    const cc2 = run(['claudecode'], ccInput, h)
    assert.match(cc2.stdout.split('\n')[1], /5h\s+8%/, 'Claude Code shows agy from its snapshot')
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
    const t0 = Date.now()
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(TOOLS, 'statusline.ps1'), 'claudecode'], {
      input: JSON.stringify(ccInput),
      encoding: 'utf8',
      env: { ...process.env, USERPROFILE: h, HOME: h, NO_COLOR: '1' },
    })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /^CC\s+5h 41%/)
    assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`)
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
    assert.equal(run(['claudecode'], ccInput, h, env).stdout.trim().split('\n').length, 3, 'no log: no line')
    mkdirSync(packHome, { recursive: true })
    writeFileSync(join(packHome, 'launches.jsonl'), '')
    assert.equal(run(['claudecode'], ccInput, h, env).stdout.trim().split('\n').length, 3, 'empty log: no line')
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
      assert.equal(lines.length, 4, harness)
      assert.match(lines[3], /^delegate: 0 running · last OK 2m ago$/, harness)
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
    assert.match(noQuota.stdout.split('\n')[1], /5h\s+8%/, 'the last values still show')

    assert.equal(run(['claudecode'], ccInput, h).status, 0)
    const ccFile = join(h, '.claude', 'rate_limits.json')
    const ccBefore = readFileSync(ccFile, 'utf8')
    const noLimits = run(['claudecode'], { model: { display_name: 'Opus' }, context_window: { used_percentage: 5 } }, h)
    assert.equal(readFileSync(ccFile, 'utf8'), ccBefore)
    assert.match(noLimits.stdout.split('\n')[0], /^CC\s+5h 41%.*ctx 5%/)
    const emptyLimits = run(['claudecode'], { model: { display_name: 'Opus' }, context_window: { used_percentage: 6 }, rate_limits: {} }, h)
    assert.equal(emptyLimits.status, 0, emptyLimits.stderr)
    assert.equal(readFileSync(ccFile, 'utf8'), ccBefore, 'an empty rate_limits object is no quota block')
    assert.match(emptyLimits.stdout.split('\n')[0], /^CC\s+5h 41%.*ctx 6%/)
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
