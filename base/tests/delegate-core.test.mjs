// Run: node --test base/tests/
// Unit tests of the shared delegate contract (base/dotai/tools/delegate-core.mjs), which both
// variants' backends import (checked in variants/orca/tests).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  DEFAULTS,
  agyIsolation,
  openCodeIsolation,
  isolatedEnv,
  appendLog,
  buildArgs,
  buildPrompt,
  checkPair,
  checkRoute,
  decide,
  detectCaller,
  isQuotaError,
  loadConfig,
  loadExhausted,
  markExhausted,
  parseAgyJson,
  parseArgs,
  parseOpenCodeJson,
  poolOf,
  readLog,
  readQuota,
  renderTree,
  resolveMode,
  statusLine,
} from '../dotai/tools/delegate-core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const tmp = () => mkdtempSync(join(tmpdir(), 'dotai core '))
const NOW = Date.parse('2026-11-02T12:00:00Z')

test('a Gemini id with a level needs that same effort, passed as --effort', () => {
  assert.deepEqual(checkPair('agy', 'gemini-3.8-flash-low', 'low'), { ok: true, effortFlag: 'low' })
  const bad = checkPair('agy', 'gemini-3.8-flash-low', 'high')
  assert.equal(bad.ok, false)
  assert.match(bad.reason, /low/)
  assert.deepEqual(checkPair('agy', 'gemini-3.8-pro', 'xhigh'), { ok: true, effortFlag: 'xhigh' })
})

test('Gemini always declares a level; third-party agy models take only "default"', () => {
  assert.equal(checkPair('agy', 'gemini-3.8-pro', 'default').ok, false)
  const r = checkPair('agy', 'claude-sonnet-4-6', 'low')
  assert.equal(r.ok, false)
  assert.match(r.reason, /default/)
  assert.deepEqual(checkPair('agy', 'claude-sonnet-4-6', 'default'), { ok: true, effortFlag: null })
  assert.deepEqual(checkPair('agy', 'gpt-oss-120b-medium', 'default'), { ok: true, effortFlag: null })
})

test('a missing model or effort, or an unknown effort, is rejected with the criterion', () => {
  for (const [m, e] of [[undefined, 'low'], ['gemini-3.8-flash-low', undefined], ['gemini-3.8-pro', 'turbo']]) {
    const r = checkPair('agy', m, e)
    assert.equal(r.ok, false, `${m} ${e}`)
    assert.match(r.reason, /model|effort/i)
  }
})

test('OpenCode takes provider/model, never a Claude model, effort as #variant', () => {
  assert.deepEqual(checkPair('opencode', 'openrouter/qwen3-coder', 'default'), { ok: true, effortFlag: null })
  assert.deepEqual(checkPair('opencode', 'openai/gpt-5.5', 'high'), { ok: true, effortFlag: 'high' })
  assert.equal(checkPair('opencode', 'anthropic/claude-sonnet-4-6', 'default').ok, false)
  assert.equal(checkPair('opencode', 'openrouter/anthropic/claude-x', 'default').ok, false)
  assert.equal(checkPair('opencode', 'qwen3', 'default').ok, false)
})

test('pools: gemini-* is the Gemini pool, any other agy model the third-party pool', () => {
  assert.equal(poolOf('agy', 'gemini-3.8-flash-low'), 'gemini')
  assert.equal(poolOf('agy', 'claude-opus-4-6-thinking'), 'third-party')
  assert.equal(poolOf('opencode', 'openai/gpt-5.5'), 'opencode')
})

test('directional routes (0009): only Claude Code may use the third-party pool; nobody targets Claude Code', () => {
  assert.equal(checkRoute('claudecode', 'agy', 'claude-sonnet-4-6').ok, true)
  assert.equal(checkRoute('claudecode', 'agy', 'gemini-3.8-flash-low').ok, true)
  assert.equal(checkRoute('claudecode', 'opencode', 'openai/gpt-5.5').ok, true)
  assert.equal(checkRoute('agy', 'agy', 'gemini-3.8-flash-low').ok, true)
  assert.equal(checkRoute('agy', 'opencode', 'openai/gpt-5.5').ok, true)
  for (const from of ['agy', 'opencode', 'unknown']) {
    const r = checkRoute(from, 'agy', 'claude-sonnet-4-6')
    assert.equal(r.ok, false, from)
    assert.match(r.reason, /gemini/)
  }
  for (const from of ['claudecode', 'agy', 'opencode', 'unknown']) assert.equal(checkRoute(from, 'claudecode', 'sonnet').ok, false)
  assert.equal(checkRoute('opencode', 'opencode', 'openai/gpt-5.5').ok, false)
})

test('the caller comes from the parent delegation, else Claude Code, else unknown', () => {
  assert.equal(detectCaller({ DOTAI_DELEGATE_CALLER: 'agy', CLAUDECODE: '1' }), 'agy')
  assert.equal(detectCaller({ CLAUDECODE: '1' }), 'claudecode')
  assert.equal(detectCaller({}), 'unknown')
  assert.equal(detectCaller({ DOTAI_DELEGATE_CALLER: 'bogus' }), 'unknown')
})

test('autonomous mode comes from the flag or DOTAI_AUTONOMOUS, never weakened by the flag', () => {
  assert.equal(resolveMode(undefined, {}), 'interactive')
  assert.equal(resolveMode('autonomous', {}), 'autonomous')
  assert.equal(resolveMode('interactive', { DOTAI_AUTONOMOUS: '1' }), 'autonomous')
  assert.throws(() => resolveMode('lazy', {}), /interactive|autonomous/)
})

test('rate_limits.json: fresh values per pool, stale or missing is unknown', () => {
  const d = tmp()
  try {
    const f = join(d, 'rate_limits.json')
    const env = { DOTAI_AGY_RATE_LIMITS: f }
    assert.deepEqual(readQuota({ env, home: d, now: NOW, staleMinutes: 15 }).gemini, { h5: null, d7: null, fresh: false })
    writeFileSync(f, JSON.stringify({ gemini_5h_pct: 40, gemini_7d_pct: 55, p3_5h_pct: 91, p3_7d_pct: 20, ts: (NOW - 60000) / 1000 }))
    const q = readQuota({ env, home: d, now: NOW, staleMinutes: 15 })
    assert.deepEqual(q.gemini, { h5: 40, d7: 55, fresh: true })
    assert.deepEqual(q['third-party'], { h5: 91, d7: 20, fresh: true })
    writeFileSync(f, JSON.stringify({ gemini_5h_pct: 40, ts: new Date(NOW - 3600000).toISOString() }))
    assert.equal(readQuota({ env, home: d, now: NOW, staleMinutes: 15 }).gemini.fresh, false)
    writeFileSync(f, JSON.stringify({ gemini_5h_pct: 40, ts: NOW - 1000 }))
    assert.equal(readQuota({ env, home: d, now: NOW, staleMinutes: 15 }).gemini.fresh, true)
    writeFileSync(f, '{not json')
    assert.equal(readQuota({ env, home: d, now: NOW, staleMinutes: 15 }).gemini.fresh, false)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('rate_limits.json: the newest of the normal and the isolated install wins', () => {
  const d = tmp()
  try {
    const normal = join(d, '.gemini', 'antigravity-cli')
    const iso = join(d, '.dotai', 'isolated', 'gemini', 'antigravity-cli')
    mkdirSync(normal, { recursive: true })
    mkdirSync(iso, { recursive: true })
    writeFileSync(join(normal, 'rate_limits.json'), JSON.stringify({ gemini_5h_pct: 10, ts: (NOW - 120000) / 1000 }))
    writeFileSync(join(iso, 'rate_limits.json'), JSON.stringify({ gemini_5h_pct: 70, ts: (NOW - 60000) / 1000 }))
    assert.equal(readQuota({ env: {}, home: d, now: NOW, staleMinutes: 15 }).gemini.h5, 70)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

const unknown = { gemini: { h5: null, d7: null, fresh: false }, 'third-party': { h5: null, d7: null, fresh: false } }
const over = pool => ({ ...unknown, [pool]: { h5: 95, d7: 10, fresh: true } })
const job = (extra = {}) => ({ target: 'agy', from: 'claudecode', model: 'gemini-3.8-flash-low', effort: 'low', ...extra })

test('unknown quota counts as available (0022)', () => {
  const r = decide({ job: job(), quota: unknown, exhausted: {}, cfg: DEFAULTS, mode: 'interactive' })
  assert.equal(r.action, 'launch')
  assert.equal(r.pool, 'gemini')
})

test('a pool over its threshold moves to the declared alternative on the other pool', () => {
  const r = decide({ job: job({ alt: 'claude-sonnet-4-6:default' }), quota: over('gemini'), exhausted: {}, cfg: DEFAULTS, mode: 'interactive' })
  assert.equal(r.action, 'launch')
  assert.equal(r.model, 'claude-sonnet-4-6')
  assert.equal(r.pool, 'third-party')
  assert.equal(r.usedAlt, true)
})

test('soft cap in interactive work: over the threshold asks, unless the user approved', () => {
  const ask = decide({ job: job(), quota: over('gemini'), exhausted: {}, cfg: DEFAULTS, mode: 'interactive' })
  assert.equal(ask.action, 'ask')
  assert.match(ask.reason, /95%/)
  const go = decide({ job: job(), quota: over('gemini'), exhausted: {}, cfg: DEFAULTS, mode: 'interactive', overCap: true })
  assert.equal(go.action, 'launch')
})

test('hard cap in autonomous work: over the threshold defers, approval or not (0019)', () => {
  const r = decide({ job: job(), quota: over('gemini'), exhausted: {}, cfg: DEFAULTS, mode: 'autonomous', overCap: true })
  assert.equal(r.action, 'defer')
})

test('a pool marked exhausted defers even with approval; the advice depends on the caller', () => {
  const cc = decide({ job: job(), quota: unknown, exhausted: { gemini: NOW + 1000 }, cfg: DEFAULTS, mode: 'interactive', overCap: true, now: NOW })
  assert.equal(cc.action, 'defer')
  assert.match(cc.reason, /Sonnet or Haiku/)
  const hub = decide({ job: job({ from: 'agy' }), quota: unknown, exhausted: { gemini: NOW + 1000 }, cfg: DEFAULTS, mode: 'interactive', now: NOW })
  assert.equal(hub.action, 'defer')
  assert.match(hub.reason, /notify/)
  assert.doesNotMatch(hub.reason, /Sonnet/)
})

test('an alternative that breaks the route or the pair is rejected before launch', () => {
  const r = decide({ job: job({ from: 'agy', alt: 'claude-sonnet-4-6:default' }), quota: over('gemini'), exhausted: {}, cfg: DEFAULTS, mode: 'interactive' })
  assert.equal(r.action, 'reject')
  const p = decide({ job: job({ alt: 'claude-sonnet-4-6:low' }), quota: unknown, exhausted: {}, cfg: DEFAULTS, mode: 'interactive' })
  assert.equal(p.action, 'reject')
})

test('thresholds come from the config: the 7-day window counts too', () => {
  const q = { ...unknown, gemini: { h5: 10, d7: 80, fresh: true } }
  assert.equal(decide({ job: job(), quota: q, exhausted: {}, cfg: DEFAULTS, mode: 'interactive' }).action, 'launch')
  assert.equal(decide({ job: job(), quota: q, exhausted: {}, cfg: { ...DEFAULTS, gemini7d: 75 }, mode: 'interactive' }).action, 'ask')
})

test('exhaustion marks expire', () => {
  const d = tmp()
  try {
    const f = join(d, 'quota-state.json')
    markExhausted(f, 'gemini', 60, NOW)
    assert.ok(loadExhausted(f, NOW + 1000).gemini)
    assert.equal(loadExhausted(f, NOW + 61 * 60000).gemini, undefined)
    writeFileSync(f, 'garbage')
    assert.deepEqual(loadExhausted(f, NOW), {})
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('agy JSON: status, usage, quota error (0022 detection rule)', () => {
  const ok = parseAgyJson(JSON.stringify({ status: 'SUCCESS', response: 'x', usage: { input_tokens: 10, output_tokens: 3, reasoning_tokens: 2 } }))
  assert.equal(ok.status, 'SUCCESS')
  assert.equal(ok.inTok, 10)
  assert.equal(ok.outTok, 5)
  assert.equal(isQuotaError(ok), false)
  const q = parseAgyJson('noise before\n' + JSON.stringify({ status: 'ERROR', error: 'RESOURCE_EXHAUSTED: out of quota until 12:00' }))
  assert.equal(isQuotaError(q), true)
  assert.equal(isQuotaError(parseAgyJson(JSON.stringify({ status: 'ERROR', error: 'boom' }))), false)
  assert.equal(parseAgyJson('not json').status, 'UNPARSED')
})

test('config: delegate.yaml overrides defaults; a bad value falls back with a warning', () => {
  const d = tmp()
  try {
    assert.deepEqual(loadConfig(d).values, DEFAULTS)
    writeFileSync(join(d, 'delegate.yaml'), 'delegate:\n  gemini5h: 70  # lower\n  maxParallel: lots\n  timeoutMin: 0.5\n')
    const { values, warnings } = loadConfig(d)
    assert.equal(values.gemini5h, 70)
    assert.equal(values.timeoutMin, 0.5)
    assert.equal(values.maxParallel, DEFAULTS.maxParallel)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /maxParallel/)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('the launch log rotates to .1 past its cap and keeps the newest entries', () => {
  const d = tmp()
  try {
    const f = join(d, 'launches.jsonl')
    for (let i = 0; i < 40; i++) appendLog(f, { id: `j${i}`, event: 'start', ts: NOW + i }, 10)
    const lines = readFileSync(f, 'utf8').trim().split('\n').filter(Boolean)
    assert.ok(lines.length <= 11, `${lines.length} lines`)
    assert.ok(existsSync(`${f}.1`), 'the previous generation is kept')
    const all = readLog(f)
    assert.ok(all.length > 10 && all.length <= 21, `${all.length} entries`)
    assert.equal(all.at(-1).id, 'j39')
    assert.deepEqual(all.map(e => Number(e.id.slice(1))), Array.from({ length: all.length }, (_, i) => 40 - all.length + i), 'in order, no gaps')
    assert.ok(!existsSync(`${f}.lock`))
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('concurrent writers never tear or reorder the log; rotation drops only the oldest', async () => {
  const d = tmp()
  try {
    const f = join(d, 'launches.jsonl')
    const core = pathToFileURL(join(HERE, '..', 'dotai', 'tools', 'delegate-core.mjs')).href
    const script = `const { appendLog } = await import(${JSON.stringify(core)}); for (let i = 0; i < 150; i++) appendLog(process.argv[1], { id: process.argv[2] + i, w: process.argv[2], i, event: 'start', ts: Date.now() }, 40)`
    const writer = w =>
      new Promise(done => {
        const c = spawn(process.execPath, ['--input-type=module', '-e', script, f, w], { stdio: ['ignore', 'ignore', 'pipe'] })
        let err = ''
        c.stderr.on('data', b => (err += b))
        c.on('close', code => done({ code, err }))
      })
    const results = await Promise.all([writer('a'), writer('b')])
    for (const r of results) assert.equal(r.code, 0, r.err)
    for (const name of [f, `${f}.1`]) {
      if (!existsSync(name)) continue
      for (const l of readFileSync(name, 'utf8').split('\n').filter(Boolean)) JSON.parse(l)
    }
    const all = readLog(f)
    assert.ok(all.length <= 2 * 40 + 2, `${all.length} entries`)
    for (const w of ['a', 'b']) {
      const seen = all.filter(e => e.w === w).map(e => e.i)
      if (!seen.length) continue
      assert.deepEqual(seen, Array.from({ length: seen.length }, (_, k) => 150 - seen.length + k), `${w}: a contiguous suffix`)
    }
    assert.ok(all.some(e => e.i === 149))
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('log and quota-state writes are best effort: they never throw', () => {
  const d = tmp()
  try {
    const blocker = join(d, 'a file')
    writeFileSync(blocker, 'x')
    assert.equal(appendLog(join(blocker, 'launches.jsonl'), { id: 'x' }, 10), false)
    assert.equal(markExhausted(join(blocker, 'quota-state.json'), 'gemini', 60, NOW), false)
    assert.equal(markExhausted(join(d, 'quota-state.json'), 'gemini', 60, NOW), true)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('quota detection: the JSON error names the quota; stderr counts only when stdout is not JSON', () => {
  const err = e => parseAgyJson(JSON.stringify({ status: 'ERROR', error: e }))
  for (const e of ['RESOURCE_EXHAUSTED', 'You are out of quota', 'Quota exceeded for model', 'you exceeded your quota']) assert.equal(isQuotaError(err(e)), true, e)
  for (const e of ['quota', 'rate limit exceeded, retry in 2s', 'boom']) assert.equal(isQuotaError(err(e)), false, e)
  assert.equal(isQuotaError(parseAgyJson('garbage'), 'Error: RESOURCE_EXHAUSTED (429)'), true)
  assert.equal(isQuotaError(err('boom'), 'RESOURCE_EXHAUSTED'), false, 'the JSON status is authoritative')
  assert.equal(isQuotaError(parseAgyJson(JSON.stringify({ status: 'SUCCESS' })), 'RESOURCE_EXHAUSTED'), false)
})

test('a model or alternative ending in a backslash or holding a control character is rejected', () => {
  assert.equal(checkPair('agy', 'gemini-3.8-pro\\', 'high').ok, false)
  assert.equal(checkPair('opencode', 'openai/gpt-5.5\\', 'high').ok, false)
  assert.equal(checkPair('agy', 'claude-sonnet-4-6\u0007', 'default').ok, false)
  assert.equal(decide({ job: job({ alt: 'claude-sonnet-4-6\\:default' }), quota: unknown, cfg: DEFAULTS }).action, 'reject')
})

test('the tree strips control characters from what it shows', () => {
  const entries = [{ id: 'a', event: 'start', ts: NOW - 1000, harness: 'claudecode', model: 'haiku\u001b[2J', effort: 'low', title: 'evil\u001b[31m\r\ntitle\u0007' }]
  const out = renderTree(entries, NOW)
  assert.doesNotMatch(out, /[\u0000-\u001f\u007f-\u009f]/)
  assert.match(out, /evil\[31mtitle/)
  assert.equal(out.split('\n').length, 1)
})

test('read-only kinds run agy in plan mode and OpenCode without --auto; code keeps auto-approval', () => {
  const d = { model: 'gemini-3.8-flash-low', effortFlag: 'low' }
  const cfg = { ...DEFAULTS, agyMode: 'accept-edits' }
  const cwd = join(tmpdir(), 'proj')
  const jobDir = join(cwd, '.dotai', 'jobs', 'x')
  const mode = args => args[args.indexOf('--mode') + 1]
  const oc = { model: 'openai/gpt-5.5', effortFlag: null }
  for (const kind of ['research', 'audit']) {
    assert.equal(mode(buildArgs('agy', d, 'p', cfg, jobDir, cwd, kind)), 'plan', kind)
    const ocArgs = buildArgs('opencode', oc, 'p', cfg, jobDir, cwd, kind)
    assert.ok(!ocArgs.includes('--auto'), kind)
    // Without --auto OpenCode 2.0.30 still writes, in and outside the project, since its default
    // edit permission is allow (trial 2026-11-19); its built-in plan agent denies edit.
    assert.equal(ocArgs[ocArgs.indexOf('--agent') + 1], 'plan', kind)
    assert.match(buildPrompt(jobDir, kind), /read-only.*reply with the complete result/i)
  }
  assert.ok(!buildArgs('opencode', oc, 'p', cfg, jobDir, cwd, 'code').includes('--agent'))
  assert.equal(mode(buildArgs('agy', d, 'p', cfg, jobDir, cwd, 'code')), 'accept-edits', 'agyMode is honored')
  // accept-edits refuses every shell command under -p (agy 1.5.3), and agy 1.5.12 drops --mode
  // auto for accounts without it ("not available for this account; continuing in the default
  // mode"), so code jobs skip the prompts and rely on the hooks (trial 2026-11-19).
  assert.equal(DEFAULTS.agyMode, 'skip-permissions')
  const skip = buildArgs('agy', d, 'p', { ...DEFAULTS }, jobDir, cwd, 'code')
  assert.ok(skip.includes('--dangerously-skip-permissions'))
  assert.ok(!skip.includes('--mode'), 'skip-permissions replaces --mode')
  const ro = buildArgs('agy', d, 'p', { ...DEFAULTS }, jobDir, cwd, 'research')
  assert.equal(mode(ro), 'plan')
  assert.ok(!ro.includes('--dangerously-skip-permissions'), 'read-only jobs never skip permissions')
  assert.equal(mode(buildArgs('agy', d, 'p', { ...DEFAULTS, agyMode: 'auto' }, jobDir, cwd, 'code')), 'auto', 'auto stays selectable')
  assert.ok(buildArgs('opencode', oc, 'p', cfg, jobDir, cwd, 'code').includes('--auto'))
  assert.match(buildPrompt(jobDir, 'code'), /Write the complete result to result\.md/)
  for (const kind of ['research', 'code']) {
    assert.match(buildPrompt(jobDir, kind), /job folder: .+$/)
    assert.doesNotMatch(buildPrompt(jobDir, kind), /["%\r\n]/)
  }
})

test('the tree shows nested launches, running and finished, agy and Claude alike', () => {
  const entries = [
    { id: 'a', event: 'start', ts: NOW - 60000, harness: 'agy', model: 'gemini-3.8-flash-low', effort: 'low', title: 'research docs', pid: process.pid },
    { id: 'b', event: 'start', ts: NOW - 30000, harness: 'agy', model: 'gemini-3.8-flash-low', effort: 'low', title: 'nested job', parent: 'a', pid: process.pid },
    { id: 'b', event: 'end', ts: NOW - 10000, status: 'OK', secs: 20, inTok: 16000, outTok: 1000 },
    { id: 'c', event: 'start', ts: NOW - 5000, harness: 'claudecode', model: 'haiku', effort: 'medium', title: 'explorer: map tools' },
  ]
  const out = renderTree(entries, NOW)
  assert.match(out, /research docs/)
  assert.match(out, /running/)
  assert.match(out, /\n\s{2,}.*nested job.*OK/)
  assert.match(out, /explorer: map tools/)
  assert.match(statusLine(entries, NOW), /1 running/)
})

test('arguments: flags, repeated job files and unknown flags', () => {
  const a = parseArgs(['run', '--model', 'gemini-3.8-flash-low', '--effort', 'low', '--spec', 'a b.md', '--over-cap'])
  assert.equal(a.cmd, 'run')
  assert.equal(a.flags.model, 'gemini-3.8-flash-low')
  assert.equal(a.flags.spec, 'a b.md')
  assert.equal(a.flags['over-cap'], true)
  assert.deepEqual(parseArgs(['run', '--jobs', 'x.json', 'y.json']).jobs, ['x.json', 'y.json'])
  assert.throws(() => parseArgs(['run', '--bogus', '1']), /bogus/)
})

// OpenCode `run --format json` prints one JSON event per line: {type, timestamp, sessionID, part}
// (text events carry part.text; step_start opens each step). The reply is the text of the last
// step that has any; earlier steps hold narration before tool calls.
const ev = (type, part = {}) => JSON.stringify({ type, timestamp: 1, sessionID: 's1', part })
test('parseOpenCodeJson takes the last step text from the event stream', () => {
  const out = [
    ev('step_start', { type: 'step-start' }),
    ev('text', { type: 'text', text: 'Let me read the spec.' }),
    ev('tool_use', { type: 'tool', tool: 'read', state: { status: 'completed' } }),
    ev('step_finish', { type: 'step-finish', tokens: { input: 1000, output: 50, reasoning: 5, cache: { read: 900, write: 0 } } }),
    ev('step_start', { type: 'step-start' }),
    ev('text', { type: 'text', text: '# Findings' }),
    ev('text', { type: 'text', text: 'Definición: ok.' }),
    ev('step_finish', { type: 'step-finish', tokens: { input: 2000, output: 300, reasoning: 0, cache: { read: 0, write: 0 } } }),
  ].join('\n')
  const p = parseOpenCodeJson(out, 0, '')
  assert.equal(p.status, 'SUCCESS')
  assert.equal(p.response, '# Findings\n\nDefinición: ok.')
  assert.equal(p.inTok, 3000)
  assert.equal(p.outTok, 355)
})

test('parseOpenCodeJson accepts common message shapes and ignores user and reasoning text', () => {
  const out = [
    JSON.stringify({ type: 'message', role: 'user', content: 'the prompt' }),
    JSON.stringify({ type: 'reasoning', part: { type: 'reasoning', text: 'thinking' } }),
    JSON.stringify({ type: 'message', role: 'assistant', content: [{ type: 'text', text: 'final answer' }] }),
    'not json',
  ].join('\n')
  assert.equal(parseOpenCodeJson(out, 0, '').response, 'final answer')
  assert.equal(parseOpenCodeJson(JSON.stringify({ type: 'text', text: 'flat' }), 0, '').response, 'flat')
})

test('parseOpenCodeJson: no text is an empty reply; an error event or a non-zero exit is an error', () => {
  assert.equal(parseOpenCodeJson(ev('step_start') + '\n' + ev('step_finish'), 0, '').response, '')
  const e = parseOpenCodeJson(JSON.stringify({ type: 'error', error: { name: 'APIError', data: { message: 'model not found' } } }), 0, '')
  assert.equal(e.status, 'ERROR')
  assert.match(e.error, /model not found/)
  const x = parseOpenCodeJson('', 1, 'boom\n')
  assert.equal(x.status, 'ERROR')
  assert.equal(x.error, 'boom')
})

// dotai run starts agy with --gemini_dir=<home>/.dotai/isolated/gemini and sets no variable
// (CLI-JSON run). In an isolated install (the install state, CLI-JSON), the pack's agy config,
// deny rules and hooks are only there, so a delegated agy must get the same flag.
test("a delegated agy runs with the isolated install's config, never the user's own", () => {
  const home = tmp()
  try {
    const state = obj => {
      mkdirSync(join(home, '.dotai'), { recursive: true })
      writeFileSync(join(home, '.dotai', 'state.json'), typeof obj === 'string' ? obj : JSON.stringify(obj))
    }
    const gemini = join(home, '.dotai', 'isolated', 'gemini')
    assert.deepEqual(agyIsolation(home), { geminiDir: null }, 'no install state: agy runs from its own directory')
    state({ schema: 'dotai.state/v1', mode: 'replace', harnesses: ['antigravity-cli'] })
    assert.deepEqual(agyIsolation(home), { geminiDir: null }, "replace install: the pack config is agy's own")
    state({ schema: 'dotai.state/v1', mode: 'isolated', harnesses: ['claudecode', 'antigravity-cli'] })
    assert.match(agyIsolation(home).error, /isolated.*gemini.*dotai install/s, 'isolated directory missing')
    mkdirSync(gemini, { recursive: true })
    assert.deepEqual(agyIsolation(home), { geminiDir: gemini })
    state({ schema: 'dotai.state/v1', mode: 'isolated', harnesses: ['claudecode'] })
    assert.match(agyIsolation(home).error, /not in the isolated install/)
    state('{ not json')
    assert.match(agyIsolation(home).error, /cannot read the install state/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

// dotai run isolates OpenCode through the environment (CLI-JSON run, the engine's opencode
// adapter): the four XDG_* directories under <home>/.dotai/isolated/opencode, OPENCODE_TEST_HOME
// at its home unless the variant shares skills, OPENCODE_DISABLE_CLAUDE_CODE=1, the OPENCODE_CONFIG*
// and OPENCODE_DB variables removed, and --standalone so that run never attaches to a background
// service that started with another configuration. A delegated OpenCode must get the same.
test("a delegated OpenCode runs with the isolated install's config, never the user's own", () => {
  const home = tmp()
  try {
    const state = obj => {
      mkdirSync(join(home, '.dotai'), { recursive: true })
      writeFileSync(join(home, '.dotai', 'state.json'), typeof obj === 'string' ? obj : JSON.stringify(obj))
    }
    const dir = join(home, '.dotai', 'isolated', 'opencode')
    assert.deepEqual(openCodeIsolation(home), { env: null }, 'no install state: OpenCode runs from its own directories')
    state({ schema: 'dotai.state/v1', mode: 'replace', harnesses: ['opencode'] })
    assert.deepEqual(openCodeIsolation(home), { env: null }, "replace install: the pack config is OpenCode's own")
    state({ schema: 'dotai.state/v1', mode: 'isolated', harnesses: ['claudecode', 'opencode'] })
    assert.match(openCodeIsolation(home).error, /isolated.*opencode.*dotai install/s, 'isolated directory missing')
    mkdirSync(join(dir, 'config', 'opencode'), { recursive: true })
    const iso = openCodeIsolation(home)
    assert.deepEqual(iso.env, {
      XDG_CONFIG_HOME: join(dir, 'config'),
      XDG_DATA_HOME: join(dir, 'data'),
      XDG_STATE_HOME: join(dir, 'state'),
      XDG_CACHE_HOME: join(dir, 'cache'),
      OPENCODE_TEST_HOME: join(dir, 'home'),
      OPENCODE_DISABLE_CLAUDE_CODE: '1',
    })
    assert.ok(existsSync(join(dir, 'home')), "OpenCode's service starts in OPENCODE_TEST_HOME, so it is created")
    assert.ok(iso.standalone)
    state({ schema: 'dotai.state/v1', mode: 'isolated', harnesses: ['opencode'], sharedSkills: true })
    assert.equal(openCodeIsolation(home).env.OPENCODE_TEST_HOME, undefined, 'a variant that shares skills keeps the real home')
    state({ schema: 'dotai.state/v1', mode: 'isolated', harnesses: ['claudecode'] })
    assert.match(openCodeIsolation(home).error, /not in the isolated install/)
    state('{ not json')
    assert.match(openCodeIsolation(home).error, /cannot read the install state/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("the isolated OpenCode environment replaces every inherited pointer, in any case on Windows", () => {
  const iso = { env: { XDG_CONFIG_HOME: '/i/config', OPENCODE_TEST_HOME: '/i/home', OPENCODE_DISABLE_CLAUDE_CODE: '1' }, standalone: true }
  const base = { PATH: '/bin', xdg_config_home: '/mine', OPENCODE_TEST_HOME: '/x', OPENCODE_CONFIG: '/c.json', opencode_config_dir: '/c', OPENCODE_DB: '/d', OPENCODE_CONFIG_CONTENT: '{}', OPENCODE_CLI_CONFIG_CONTENT: '{}', XDG_DATA_HOME: '/mine-data', KEEP: '1' }
  const win = isolatedEnv(base, iso, 'win32')
  assert.deepEqual(win, { PATH: '/bin', KEEP: '1', XDG_CONFIG_HOME: '/i/config', OPENCODE_TEST_HOME: '/i/home', OPENCODE_DISABLE_CLAUDE_CODE: '1' },
    'every XDG_* pointer is removed even when the install does not set it, and the config variables are dropped')
  const linux = isolatedEnv(base, iso, 'linux')
  assert.equal(linux.xdg_config_home, '/mine', 'outside Windows a variable name keeps its case')
  assert.equal(linux.OPENCODE_CONFIG, undefined)
  const shared = isolatedEnv({ OPENCODE_TEST_HOME: '/x' }, { env: { XDG_CONFIG_HOME: '/i/config' } }, 'linux')
  assert.deepEqual(shared, { XDG_CONFIG_HOME: '/i/config' }, 'an inherited OPENCODE_TEST_HOME is removed when the variant shares skills')
  assert.deepEqual(isolatedEnv(base, { env: null }, 'win32'), base, 'no isolation: the environment is unchanged')
})

test('an isolated OpenCode run is standalone', () => {
  const d = { model: 'opencode/big-pickle', effortFlag: null }
  const cwd = join(tmpdir(), 'proj')
  const jobDir = join(cwd, '.dotai', 'jobs', 'x')
  for (const kind of ['research', 'code']) {
    const args = buildArgs('opencode', d, 'p', DEFAULTS, jobDir, cwd, kind, { standalone: true })
    assert.deepEqual(args.slice(0, 2), ['run', '--standalone'], kind)
    assert.equal(args.at(-1), 'p')
  }
  assert.ok(!buildArgs('opencode', d, 'p', DEFAULTS, jobDir, cwd, 'code').includes('--standalone'))
})

test('the isolation flag comes first in the agy command, as dotai run passes it', () => {
  const d = { model: 'gemini-3.8-flash-low', effortFlag: 'low' }
  const cwd = join(tmpdir(), 'proj')
  const jobDir = join(cwd, '.dotai', 'jobs', 'x')
  const gemini = join(tmpdir(), 'home', '.dotai', 'isolated', 'gemini')
  for (const kind of ['research', 'code']) {
    const args = buildArgs('agy', d, 'p', DEFAULTS, jobDir, cwd, kind, { geminiDir: gemini })
    assert.equal(args[0], `--gemini_dir=${gemini}`, kind)
    assert.equal(args.filter(a => a.startsWith('--gemini_dir')).length, 1)
  }
  assert.ok(!buildArgs('agy', d, 'p', DEFAULTS, jobDir, cwd, 'code').some(a => a.startsWith('--gemini_dir')))
  assert.ok(!buildArgs('opencode', { model: 'openai/gpt-5.5', effortFlag: null }, 'p', DEFAULTS, jobDir, cwd, 'code', { geminiDir: gemini }).some(a => a.startsWith('--gemini_dir')))
})
