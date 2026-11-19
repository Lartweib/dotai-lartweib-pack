// Run: node --test "variants/*/tests/*.test.mjs"
// End-to-end tests of the standalone backend with fake CLIs on PATH, in paths with spaces.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
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
    const hub = runTool(TOOL, ['run', '--to', 'opencode', '--model', 'openai/gpt-5.5', '--effort', 'high', '--spec', s, '--from', 'agy'], sb)
    assert.equal(hub.code, 2)
    assert.match(hub.out, /only the primary/, 'agy is not the primary by default')
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
    assert.match(again.out, /Claude Code .*cost policy/)
    assert.doesNotMatch(again.out, /Sonnet|Haiku/)
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

// The isolated install's OpenCode config is reached only through the environment dotai run sets,
// so a delegated OpenCode gets the same, and is not started when that config is missing.
test("under an isolated install a delegated OpenCode runs on the install's config, standalone", () => {
  const sb = sandbox()
  try {
    mkdirSync(join(sb.home, '.dotai'), { recursive: true })
    writeFileSync(join(sb.home, '.dotai', 'state.json'), JSON.stringify({ schema: 'dotai.state/v1', mode: 'isolated', harnesses: ['opencode'] }))
    const args = ['run', '--to', 'opencode', '--model', 'openai/gpt-5.5', '--effort', 'high', '--spec', spec(sb)]
    const missing = runTool(TOOL, args, sb, CC)
    assert.equal(missing.code, 1)
    assert.match(missing.out, /FAIL .*isolated OpenCode directory .*missing/)
    assert.equal(sb.calls().length, 0, 'OpenCode is not started on the user config')
    const dir = join(sb.home, '.dotai', 'isolated', 'opencode')
    mkdirSync(join(dir, 'config', 'opencode'), { recursive: true })
    const r = runTool(TOOL, args, sb, { ...CC, XDG_CONFIG_HOME: join(sb.home, '.config'), OPENCODE_CONFIG: join(sb.home, 'mine.json') })
    assert.equal(r.code, 0, r.out + r.err)
    const [call] = sb.calls()
    assert.deepEqual(call.argv.slice(0, 2), ['run', '--standalone'])
    assert.equal(call.xdgConfig, join(dir, 'config'))
    assert.equal(call.testHome, join(dir, 'home'))
    assert.equal(call.config, undefined)
    assert.equal(call.disableClaude, '1')
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
    assert.ok(!research.argv.includes('--dangerously-skip-permissions'), 'read-only jobs never skip permissions')
    assert.ok(code.argv.includes('--dangerously-skip-permissions'), 'code jobs default to skip-permissions (pack 0034, update 2026-11-19)')
    assert.ok(!code.argv.includes('--mode'), 'skip-permissions replaces --mode')
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
    assert.match(flag.out, /only the primary/)
    const jobFile = join(sb.project, 'spoof.json')
    writeFileSync(jobFile, JSON.stringify({ spec: 'task spec.md', model: 'openai/gpt-5.5', effort: 'high', to: 'opencode', from: 'claudecode' }))
    const file = runTool(TOOL, ['run', '--jobs', jobFile], sb, env)
    assert.equal(file.code, 2, file.out)
    assert.match(file.out, /only the primary/)
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

// Pack 0050: `primary: agy` in delegate.yaml turns the direction around; the agy caller passes
// --from agy, since agy sets no marker a child could read (trial pending).
const AGY_PRIMARY = 'delegate:\n  primary: agy\n'
const toClaude = s => ['run', '--from', 'agy', '--model', 'sonnet', '--effort', 'high', '--spec', s, '--title', 'from agy']

test('an agy primary delegates to Claude Code through claude -p (default target: the secondary)', () => {
  const sb = sandbox(['agy', 'claude'])
  try {
    sb.config(AGY_PRIMARY)
    const r = runTool(TOOL, toClaude(spec(sb)), sb)
    assert.equal(r.code, 0, r.out + r.err)
    assert.match(r.out, /^delegate \S+ OK claudecode sonnet\/high .*in=1\.5k out=420/m)
    const resultPath = /result=(.+)$/.exec(r.out.trim())[1]
    assert.equal(readFileSync(resultPath, 'utf8'), 'claude reply: Definición', 'a read-only reply is saved to result.md')
    const [call] = sb.calls()
    assert.equal(call.name, 'claude')
    assert.equal(call.caller, 'claudecode', 'a nested delegation from the child is refused (not the primary)')
    for (const a of ['-p', '--output-format', 'json', '--permission-mode', 'plan']) assert.ok(call.argv.includes(a), a)
    assert.equal(log(sb)[0].from, 'agy')
  } finally {
    sb.cleanup()
  }
})

test('an agy primary without --from is unknown and refused; agy -> agy is refused for its subagents', () => {
  const sb = sandbox(['agy', 'claude'])
  try {
    sb.config(AGY_PRIMARY)
    const s = spec(sb)
    const unknown = runTool(TOOL, ['run', '--model', 'sonnet', '--effort', 'high', '--spec', s], sb)
    assert.equal(unknown.code, 2, unknown.out)
    assert.match(unknown.out, /--from agy/)
    const self = runTool(TOOL, ['run', '--to', 'agy', '--from', 'agy', '--model', 'gemini-3.8-flash-low', '--effort', 'low', '--spec', s], sb)
    assert.equal(self.code, 2, self.out)
    assert.match(self.out, /subagents/)
    const cc = runTool(TOOL, base(s), sb, CC)
    assert.equal(cc.code, 2, 'Claude Code is the secondary now')
    assert.match(cc.out, /only the primary/)
    const oc = runTool(TOOL, ['run', '--from', 'opencode', '--model', 'sonnet', '--effort', 'high', '--spec', s], sb)
    assert.match(oc.out, /target only/)
    assert.deepEqual(sb.calls(), [])
  } finally {
    sb.cleanup()
  }
})

test('a Claude quota error marks the claude pool; the agy primary does the task itself or defers', () => {
  const sb = sandbox(['agy', 'claude'])
  try {
    sb.config(AGY_PRIMARY)
    const s = spec(sb)
    const r = runTool(TOOL, toClaude(s), sb, { FAKE_CLAUDE: 'quota' })
    assert.equal(r.code, 3, r.out + r.err)
    assert.match(r.out, /DEFER .*claude pool exhausted.*in agy .*cost policy/)
    assert.doesNotMatch(r.out, /Sonnet|Haiku/)
    assert.equal(runTool(TOOL, toClaude(s), sb).code, 3, 'the next run defers without calling claude')
    assert.equal(sb.calls().length, 1)
    rmSync(join(sb.env.DOTAI_DELEGATE_HOME, 'quota-state.json'))
    const e = runTool(TOOL, toClaude(s), sb, { FAKE_CLAUDE: 'error' })
    assert.equal(e.code, 1, e.out)
    assert.match(e.out, /FAIL claudecode .*boom/, 'any other error is a failure, not the quota')
  } finally {
    sb.cleanup()
  }
})

test('under an isolated install the delegated Claude Code gets CLAUDE_CONFIG_DIR; a missing config fails', () => {
  const sb = sandbox(['agy', 'claude'])
  try {
    sb.config(AGY_PRIMARY)
    const s = spec(sb)
    mkdirSync(join(sb.home, '.dotai'), { recursive: true })
    writeFileSync(join(sb.home, '.dotai', 'state.json'), JSON.stringify({ schema: 'dotai.state/v1', mode: 'isolated', harnesses: ['claudecode', 'antigravity-cli'] }))
    const missing = runTool(TOOL, toClaude(s), sb)
    assert.equal(missing.code, 1, missing.out)
    assert.match(missing.out, /FAIL .*isolated Claude Code directory/)
    const dir = join(sb.home, '.dotai', 'isolated', 'claude')
    mkdirSync(dir, { recursive: true })
    const ok = runTool(TOOL, [...toClaude(s), '--kind', 'code'], sb, { CLAUDE_CONFIG_DIR: join(sb.home, 'mine') })
    assert.equal(ok.code, 0, ok.out + ok.err)
    const [call] = sb.calls()
    assert.equal(call.claudeConfig, dir)
    assert.ok(call.argv.includes('acceptEdits'))
    assert.equal(readFileSync(/result=(.+)$/.exec(ok.out.trim())[1], 'utf8'), 'claude result')
  } finally {
    sb.cleanup()
  }
})

test('a child that empties DOTAI_DELEGATE_CALLER is still a delegated child: --from cannot make it the primary', () => {
  const sb = sandbox()
  try {
    const r = runTool(TOOL, [...base(spec(sb)), '--from', 'claudecode'], sb, { ...CC, DOTAI_DELEGATE_CALLER: '' })
    assert.equal(r.code, 2, r.out)
    assert.match(r.out, /only the primary/)
    assert.deepEqual(sb.calls(), [])
  } finally {
    sb.cleanup()
  }
})

test('every launched harness gets DOTAI_DELEGATE_CALLER, so its hooks know it is delegated', () => {
  const sb = sandbox(['agy', 'claude', 'opencode'])
  try {
    const s = spec(sb)
    assert.equal(runTool(TOOL, base(s), sb, CC).code, 0)
    assert.equal(runTool(TOOL, ['run', '--to', 'opencode', '--model', 'openai/gpt-5.5', '--effort', 'high', '--spec', s], sb, CC).code, 0)
    sb.config(AGY_PRIMARY)
    assert.equal(runTool(TOOL, toClaude(s), sb).code, 0)
    assert.deepEqual(sb.calls().map(c => [c.name, c.caller]), [['agy', 'agy'], ['opencode', 'opencode'], ['claude', 'claudecode']])
  } finally {
    sb.cleanup()
  }
})

test('a delegate.yaml that cannot be parsed, or names an unknown primary, fails closed', () => {
  const sb = sandbox()
  try {
    const s = spec(sb)
    for (const text of ['delegate:\n  primary: opencode\n', 'delegate:\n  primary agy\n']) {
      sb.config(text)
      const r = runTool(TOOL, base(s), sb, CC)
      assert.equal(r.code, 2, r.out)
      assert.match(r.out, /^delegate REJECT .*delegate\.yaml/m)
      assert.equal(runTool(TOOL, ['check', '--model', 'gemini-3.8-flash-low', '--effort', 'low'], sb, CC).code, 2)
      assert.equal(runTool(TOOL, ['status'], sb).code, 0, 'status still works')
    }
    assert.deepEqual(sb.calls(), [])
  } finally {
    sb.cleanup()
  }
})

test('a primary that is not installed warns and delegates nothing (no failure)', () => {
  const sb = sandbox(['opencode'])
  try {
    sb.config(AGY_PRIMARY)
    const r = runTool(TOOL, ['run', '--from', 'agy', '--to', 'opencode', '--model', 'openai/gpt-5.5', '--effort', 'high', '--spec', spec(sb)], sb)
    assert.equal(r.code, 2, r.out)
    assert.match(r.out, /REJECT .*primary agy is not installed/)
    assert.match(r.err, /primary/)
    const c = runTool(TOOL, ['check', '--from', 'agy', '--to', 'opencode', '--model', 'openai/gpt-5.5', '--effort', 'high'], sb)
    assert.equal(c.code, 2)
    assert.equal(runTool(TOOL, ['status'], sb).code, 0, 'status still works')
    sb.config('delegate:\n  primary: claudecode\n')
    assert.match(runTool(TOOL, base(spec(sb)), sb, CC).out, /primary claudecode is not installed/)
    assert.deepEqual(sb.calls(), [])
  } finally {
    sb.cleanup()
  }
})

test('under an isolated install the delegated agy gets --gemini_dir; without agy installed there, none runs', () => {
  const sb = sandbox()
  try {
    const s = spec(sb)
    const state = harnesses => {
      mkdirSync(join(sb.home, '.dotai'), { recursive: true })
      writeFileSync(join(sb.home, '.dotai', 'state.json'), JSON.stringify({ schema: 'dotai.state/v1', mode: 'isolated', harnesses }))
    }
    const gemini = join(sb.home, '.dotai', 'isolated', 'gemini')
    mkdirSync(gemini, { recursive: true })
    state(['claudecode', 'antigravity-cli'])
    const ok = runTool(TOOL, [...base(s), '--kind', 'code'], sb, CC)
    assert.equal(ok.code, 0, ok.err + ok.out)
    assert.equal(sb.calls()[0].argv[0], `--gemini_dir=${gemini}`)
    state(['claudecode'])
    const leak = runTool(TOOL, base(s), sb, CC)
    assert.equal(leak.code, 1, leak.out)
    assert.match(leak.out, /FAIL .*not in the isolated install/)
    assert.equal(sb.calls().length, 1, "agy never ran with the user's own config")
  } finally {
    sb.cleanup()
  }
})
