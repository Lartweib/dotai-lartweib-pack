// Run: node --test "variants/*/tests/*.test.mjs"
// End-to-end tests of the standalone backend with fake CLIs on PATH, in paths with spaces.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runTool, sandbox, spec } from './fakes.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL = join(HERE, '..', 'dotai', 'tools', 'delegate-backend.mjs')
const SKILL = join(HERE, '..', '..', '..', 'base', '.rulesync', 'skills', 'delegate', 'SKILL.md')
const CC = { CLAUDECODE: '1' }
const base = s => ['run', '--model', 'gemini-3.8-flash-low', '--effort', 'low', '--spec', s, '--title', 'research docs']
const log = sb => {
  const f = join(sb.env.DOTAI_DELEGATE_HOME, 'launches.jsonl')
  return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []
}

test('a delegation runs agy headless with explicit model and effort and returns one line', () => {
  const sb = sandbox()
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, CC)
    assert.equal(r.code, 0, r.err + r.out)
    const lines = r.out.trim().split('\n')
    assert.equal(lines.length, 1)
    assert.match(lines[0], /^delegate \S+ OK agy gemini-3\.8-flash-low\/low/)
    assert.match(lines[0], /in=16\.5k out=1\.2k/)
    const resultPath = /result=(.+)$/.exec(lines[0])[1]
    assert.equal(readFileSync(resultPath, 'utf8'), 'fake result: Definición')
    assert.ok(resultPath.startsWith(join(sb.project, '.dotai', 'jobs')))
    const [call] = sb.calls()
    assert.equal(call.name, 'agy')
    for (const a of ['-p', '--model', 'gemini-3.8-flash-low', '--effort', 'low', '--output-format', 'json']) assert.ok(call.argv.includes(a), a)
    assert.equal(readFileSync(join(dirname(resultPath), 'spec.md'), 'utf8'), '# Task\nSummarize the repo.\n')
    const events = log(sb).map(e => e.event)
    assert.deepEqual(events, ['start', 'end'])
    assert.equal(log(sb)[0].from, 'claudecode')
  } finally {
    sb.cleanup()
  }
})

test('an invalid pair or a forbidden route never reaches the CLI (exit 2)', () => {
  const sb = sandbox()
  try {
    const s = spec(sb)
    const bad = runTool(TOOL, ['run', '--model', 'claude-sonnet-4-6', '--effort', 'low', '--spec', s], sb, CC)
    assert.equal(bad.code, 2)
    assert.match(bad.out, /^delegate REJECT/m)
    const hub = runTool(TOOL, ['run', '--model', 'claude-sonnet-4-6', '--effort', 'default', '--spec', s, '--from', 'agy'], sb)
    assert.equal(hub.code, 2)
    assert.match(hub.out, /gemini/)
    const missing = runTool(TOOL, ['run', '--effort', 'low', '--spec', s], sb, CC)
    assert.equal(missing.code, 2)
    assert.deepEqual(sb.calls(), [])
    assert.ok(log(sb).every(e => e.event === 'refused'))
  } finally {
    sb.cleanup()
  }
})

test('a quota error marks the pool exhausted, and the next run defers without calling agy', () => {
  const sb = sandbox()
  try {
    const s = spec(sb)
    const r = runTool(TOOL, base(s), sb, { ...CC, FAKE_AGY: 'quota' })
    assert.equal(r.code, 3, r.out + r.err)
    assert.match(r.out, /^delegate \S+ DEFER .*gemini.*exhausted/m)
    const again = runTool(TOOL, base(s), sb, { ...CC, FAKE_AGY: 'ok' })
    assert.equal(again.code, 3)
    assert.match(again.out, /Sonnet or Haiku/)
    assert.equal(sb.calls().length, 1)
  } finally {
    sb.cleanup()
  }
})

test('a quota error retries once on the declared alternative of the other pool', () => {
  const sb = sandbox()
  try {
    const r = runTool(TOOL, [...base(spec(sb)), '--alt', 'claude-sonnet-4-6:default'], sb, { ...CC, FAKE_AGY: 'quota-gemini' })
    assert.equal(r.code, 0, r.out + r.err)
    assert.match(r.out, /OK agy claude-sonnet-4-6\/default/)
    const calls = sb.calls()
    assert.equal(calls.length, 2)
    assert.ok(!calls[1].argv.includes('--effort'), 'third-party models take no --effort')
  } finally {
    sb.cleanup()
  }
})

test('soft cap: fresh quota over the threshold asks (exit 4) until the user approves', () => {
  const sb = sandbox()
  try {
    sb.rateLimits({ gemini_5h_pct: 95, gemini_7d_pct: 50, p3_5h_pct: 10, p3_7d_pct: 10, ts: Date.now() / 1000 })
    const s = spec(sb)
    const ask = runTool(TOOL, base(s), sb, CC)
    assert.equal(ask.code, 4)
    assert.match(ask.out, /^delegate ASK .*95%/m)
    assert.equal(sb.calls().length, 0)
    const go = runTool(TOOL, [...base(s), '--over-cap'], sb, CC)
    assert.equal(go.code, 0, go.out + go.err)
  } finally {
    sb.cleanup()
  }
})

test('hard cap: autonomous work over the threshold defers even with --over-cap', () => {
  const sb = sandbox()
  try {
    sb.rateLimits({ gemini_5h_pct: 95, ts: Date.now() / 1000 })
    const r = runTool(TOOL, [...base(spec(sb)), '--over-cap'], sb, { ...CC, DOTAI_AUTONOMOUS: '1' })
    assert.equal(r.code, 3)
    assert.match(r.out, /DEFER/)
    assert.equal(sb.calls().length, 0)
  } finally {
    sb.cleanup()
  }
})

test('a run past its deadline is killed and reported as a timeout', () => {
  const sb = sandbox()
  try {
    sb.config('delegate:\n  timeoutMin: 0.03\n')
    const r = runTool(TOOL, base(spec(sb)), sb, { ...CC, FAKE_AGY: 'sleep' })
    assert.equal(r.code, 1)
    assert.match(r.out, /FAIL .*timeout/i)
    assert.equal(log(sb).at(-1).status, 'TIMEOUT')
  } finally {
    sb.cleanup()
  }
})

test('an agy error is a failure with its message, exit 1', () => {
  const sb = sandbox()
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, { ...CC, FAKE_AGY: 'error' })
    assert.equal(r.code, 1)
    assert.match(r.out, /FAIL .*boom/)
  } finally {
    sb.cleanup()
  }
})

test('several jobs run in parallel, one job file and one result line each', () => {
  const sb = sandbox()
  try {
    const jobs = ['job a.json', 'job b.json'].map((name, i) => {
      const f = join(sb.project, name)
      writeFileSync(f, JSON.stringify({ spec: `spec ${i}.md`, model: 'gemini-3.8-flash-low', effort: 'low', title: `worker ${i}` }))
      spec(sb, `spec ${i}.md`)
      return f
    })
    const r = runTool(TOOL, ['run', '--jobs', ...jobs], sb, CC)
    assert.equal(r.code, 0, r.out + r.err)
    const lines = r.out.trim().split('\n')
    assert.equal(lines.length, 2)
    assert.ok(lines.every(l => / OK /.test(l)))
    assert.equal(sb.calls().length, 2)
  } finally {
    sb.cleanup()
  }
})

test('the child knows who called it: nested delegations from agy are restricted', () => {
  const sb = sandbox()
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, { ...CC, FAKE_AGY: 'env' })
    const resultPath = /result=(.+)$/.exec(r.out.trim())[1]
    const id = /^delegate (\S+)/.exec(r.out)[1]
    assert.equal(readFileSync(resultPath, 'utf8'), `caller=agy parent=${id}`)
  } finally {
    sb.cleanup()
  }
})

test('OpenCode is an optional target: provider/model#variant, JSON output', () => {
  const sb = sandbox()
  try {
    const r = runTool(TOOL, ['run', '--to', 'opencode', '--model', 'openai/gpt-5.5', '--effort', 'high', '--spec', spec(sb)], sb, CC)
    assert.equal(r.code, 0, r.out + r.err)
    assert.match(r.out, /OK opencode openai\/gpt-5\.5\/high/)
    const [call] = sb.calls()
    assert.equal(call.name, 'opencode')
    assert.deepEqual(call.argv.slice(0, 5), ['run', '--model', 'openai/gpt-5.5#high', '--format', 'json'])
  } finally {
    sb.cleanup()
  }
})

test('a missing CLI is reported, not hidden', () => {
  const sb = sandbox(['opencode'])
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, CC)
    assert.equal(r.code, 1)
    assert.match(r.out, /FAIL .*agy.*not found/i)
  } finally {
    sb.cleanup()
  }
})

test('status shows the tree of launches and a one-line summary for the statusline', () => {
  const sb = sandbox()
  try {
    runTool(TOOL, base(spec(sb)), sb, CC)
    const tree = runTool(TOOL, ['status'], sb)
    assert.equal(tree.code, 0)
    assert.match(tree.out, /research docs/)
    assert.match(tree.out, /OK/)
    assert.match(tree.out, /gemini/)
    const line = runTool(TOOL, ['status', '--line'], sb)
    assert.equal(line.out.trim().split('\n').length, 1)
    assert.match(line.out, /0 running/)
  } finally {
    sb.cleanup()
  }
})

test('check validates a job without launching; workers explains parallel jobs', () => {
  const sb = sandbox()
  try {
    const ok = runTool(TOOL, ['check', '--model', 'gemini-3.8-flash-low', '--effort', 'low'], sb, CC)
    assert.equal(ok.code, 0)
    assert.match(ok.out, /^delegate CHECK OK pool=gemini/m)
    const bad = runTool(TOOL, ['check', '--model', 'gemini-3.8-flash-low', '--effort', 'high'], sb, CC)
    assert.equal(bad.code, 2)
    const guide = runTool(TOOL, ['workers'], sb)
    assert.equal(guide.code, 0)
    assert.match(guide.out, /--jobs/)
    assert.equal(sb.calls().length, 0)
  } finally {
    sb.cleanup()
  }
})

test('help is short and names every command', () => {
  const sb = sandbox()
  try {
    const r = runTool(TOOL, ['--help'], sb)
    assert.equal(r.code, 0)
    for (const c of ['run', 'check', 'status', 'workers']) assert.match(r.out, new RegExp(`\\b${c}\\b`))
    const u = runTool(TOOL, ['bogus'], sb)
    assert.equal(u.code, 2)
  } finally {
    sb.cleanup()
  }
})

test('the base delegate skill names the final command, has no TODO and stays short', () => {
  const text = readFileSync(SKILL, 'utf8')
  assert.doesNotMatch(text, /TODO/)
  assert.match(text, /\$\{DOTAI_TOOLS\}\/delegate-backend\.mjs/)
  assert.doesNotMatch(text, /\borca\b/i, 'the base skill never names Orca (0034)')
  const description = /description:\s*"?(.+?)"?\s*$/m.exec(text)[1]
  assert.ok(description.length <= 160, `description is ${description.length} chars`)
  assert.ok(text.length <= 2600, `skill is ${text.length} chars`)
})

test('a research job runs agy in plan mode and OpenCode without --auto; a code job auto-approves', () => {
  const sb = sandbox()
  try {
    const s = spec(sb)
    assert.equal(runTool(TOOL, base(s), sb, CC).code, 0)
    assert.equal(runTool(TOOL, [...base(s), '--kind', 'code'], sb, CC).code, 0)
    assert.equal(runTool(TOOL, ['run', '--to', 'opencode', '--model', 'openai/gpt-5.5', '--effort', 'high', '--spec', s, '--kind', 'audit'], sb, CC).code, 0)
    assert.equal(runTool(TOOL, ['run', '--to', 'opencode', '--model', 'openai/gpt-5.5', '--effort', 'high', '--spec', s, '--kind', 'code'], sb, CC).code, 0)
    const [research, code, audit, ocCode] = sb.calls()
    const mode = c => c.argv[c.argv.indexOf('--mode') + 1]
    assert.equal(mode(research), 'plan')
    assert.equal(mode(code), 'accept-edits')
    assert.ok(!audit.argv.includes('--auto'))
    assert.ok(ocCode.argv.includes('--auto'))
  } finally {
    sb.cleanup()
  }
})

test('a nested caller cannot claim another caller through --from or a job file', () => {
  const sb = sandbox()
  try {
    const s = spec(sb)
    const env = { ...CC, DOTAI_DELEGATE_CALLER: 'agy' }
    const flag = runTool(TOOL, ['run', '--model', 'claude-sonnet-4-6', '--effort', 'default', '--spec', s, '--from', 'claudecode'], sb, env)
    assert.equal(flag.code, 2, flag.out)
    assert.match(flag.out, /agy caller uses only gemini/)
    const jobFile = join(sb.project, 'spoof.json')
    writeFileSync(jobFile, JSON.stringify({ spec: 'task spec.md', model: 'claude-sonnet-4-6', effort: 'default', from: 'claudecode' }))
    const file = runTool(TOOL, ['run', '--jobs', jobFile], sb, env)
    assert.equal(file.code, 2, file.out)
    assert.match(file.out, /agy caller uses only gemini/)
    assert.equal(sb.calls().length, 0)
  } finally {
    sb.cleanup()
  }
})

test('the spec must be inside the project or the pack home and never a denied path', () => {
  const sb = sandbox()
  try {
    const outside = join(sb.root, 'outside spec.md')
    writeFileSync(outside, '# task\n')
    const r = runTool(TOOL, base(outside), sb, CC)
    assert.equal(r.code, 2, r.out)
    assert.match(r.out, /REJECT .*outside the project/)
    const env = join(sb.project, '.env')
    writeFileSync(env, 'API_KEY=1\n')
    const d = runTool(TOOL, base(env), sb, CC)
    assert.equal(d.code, 2, d.out)
    assert.match(d.out, /REJECT .*denied pattern \.env/)
    const jobFile = join(sb.project, 'job.json')
    writeFileSync(jobFile, JSON.stringify({ spec: '../outside spec.md', model: 'gemini-3.8-flash-low', effort: 'low' }))
    const j = runTool(TOOL, ['run', '--jobs', jobFile], sb, CC)
    assert.equal(j.code, 2, j.out)
    assert.match(j.out, /outside the project/)
    const inHome = join(sb.env.DOTAI_DELEGATE_HOME, 'specs', 'task.md')
    mkdirSync(dirname(inHome), { recursive: true })
    writeFileSync(inHome, '# task\n')
    assert.equal(runTool(TOOL, base(inHome), sb, CC).code, 0, 'the pack home is allowed')
    assert.equal(sb.calls().length, 1)
  } finally {
    sb.cleanup()
  }
})

test('an unwritable launch log never replaces the verdict line or stops a valid launch', () => {
  const sb = sandbox()
  try {
    const blocker = join(sb.home, 'blocker')
    writeFileSync(blocker, 'x')
    const env = { ...CC, DOTAI_DELEGATE_HOME: join(blocker, 'pack home') }
    const bad = runTool(TOOL, ['run', '--model', 'claude-sonnet-4-6', '--effort', 'low', '--spec', spec(sb)], sb, env)
    assert.equal(bad.code, 2)
    assert.match(bad.out, /^delegate REJECT/m)
    assert.ok(bad.err.trim().split('\n').length <= 2, bad.err)
    const ok = runTool(TOOL, base(spec(sb)), sb, { ...env, FAKE_AGY: 'quota' })
    assert.equal(ok.code, 3, ok.out + ok.err)
    assert.match(ok.out, /DEFER/)
  } finally {
    sb.cleanup()
  }
})

test('check entries go to their own log and never evict launches', () => {
  const sb = sandbox()
  try {
    sb.config('delegate:\n  logMax: 3\n')
    runTool(TOOL, base(spec(sb)), sb, CC)
    for (let i = 0; i < 8; i++) runTool(TOOL, ['check', '--model', 'gemini-3.8-flash-low', '--effort', 'low'], sb, CC)
    assert.deepEqual(log(sb).map(e => e.event), ['start', 'end'])
    const checks = join(sb.env.DOTAI_DELEGATE_HOME, 'checks.jsonl')
    assert.ok(existsSync(checks) || existsSync(`${checks}.1`))
  } finally {
    sb.cleanup()
  }
})

test('a result larger than any pipe cap is parsed whole from the job folder', () => {
  const sb = sandbox()
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, { ...CC, FAKE_AGY: 'huge' })
    assert.equal(r.code, 0, r.out + r.err)
    const resultPath = /result=(.+)$/.exec(r.out.trim())[1]
    assert.equal(readFileSync(resultPath, 'utf8').length, 5 * 1024 * 1024)
  } finally {
    sb.cleanup()
  }
})

test('a quota error on stderr counts when stdout is not JSON', () => {
  const sb = sandbox()
  try {
    const r = runTool(TOOL, base(spec(sb)), sb, { ...CC, FAKE_AGY: 'quota-stderr' })
    assert.equal(r.code, 3, r.out + r.err)
    assert.match(r.out, /DEFER .*gemini pool exhausted/)
  } finally {
    sb.cleanup()
  }
})

test('job folders older than seven days are pruned when a run starts', () => {
  const sb = sandbox()
  try {
    const jobs = join(sb.project, '.dotai', 'jobs')
    const old = join(jobs, '20260101-120000-abcd')
    const fresh = join(jobs, '20991231-120000-wxyz')
    const mine = join(jobs, 'keep me')
    for (const d of [old, fresh, mine]) mkdirSync(d, { recursive: true })
    writeFileSync(join(old, 'result.md'), 'old')
    const past = new Date(Date.now() - 8 * 86400000)
    utimesSync(join(old, 'result.md'), past, past)
    utimesSync(old, past, past)
    utimesSync(mine, past, past)
    assert.equal(runTool(TOOL, base(spec(sb)), sb, CC).code, 0)
    assert.ok(!existsSync(old), 'old job pruned')
    assert.ok(existsSync(fresh))
    assert.ok(existsSync(mine), 'only job ids are pruned')
  } finally {
    sb.cleanup()
  }
})

const ocAudit = s => ['run', '--to', 'opencode', '--model', 'openai/gpt-5.5', '--effort', 'high', '--spec', s, '--kind', 'audit']

test('a read-only OpenCode job saves the final reply from the JSON event stream to result.md', () => {
  const sb = sandbox(['opencode'])
  try {
    const r = runTool(TOOL, ocAudit(spec(sb)), sb, CC)
    assert.equal(r.code, 0, r.out + r.err)
    assert.match(r.out, /OK opencode .* in=2\.4k out=160/)
    const resultPath = /result=(.+)$/.exec(r.out.trim())[1]
    assert.equal(readFileSync(resultPath, 'utf8'), 'opencode reply: Definición')
  } finally {
    sb.cleanup()
  }
})

test('a run with no reply text and no result.md fails instead of reporting OK with (none)', () => {
  const sb = sandbox()
  try {
    const oc = runTool(TOOL, ocAudit(spec(sb)), sb, { ...CC, FAKE_OPENCODE: 'silent' })
    assert.equal(oc.code, 1, oc.out + oc.err)
    assert.match(oc.out, /FAIL opencode .*no reply/)
    const agy = runTool(TOOL, base(spec(sb)), sb, { ...CC, FAKE_AGY: 'empty' })
    assert.equal(agy.code, 1, agy.out + agy.err)
    assert.match(agy.out, /FAIL agy .*no reply/)
    assert.doesNotMatch(oc.out + agy.out, /\(none\)/)
  } finally {
    sb.cleanup()
  }
})
