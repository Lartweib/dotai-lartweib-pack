// Run: node --test base/tests/
// PreCompact session summary (pack 0041, 0042): built from the transcript and saved with the
// Engram CLI. The fake CLI on PATH keeps the real store untouched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { engramProject, redact, summarize } from '../dotai/tools/memory-compact.mjs'
import { fakeEngram } from './fake-engram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL = join(HERE, '..', 'dotai', 'tools', 'memory-compact.mjs')

const line = o => JSON.stringify(o)
function transcript(root) {
  return [
    line({ type: 'user', message: { role: 'user', content: 'Fix the "save" bug at 100% load in the inventory' } }),
    line({ type: 'user', isMeta: true, message: { role: 'user', content: 'meta noise' } }),
    line({ type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' } }),
    line({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Looking at it.' },
          { type: 'tool_use', name: 'Edit', input: { file_path: join(root, 'src', 'inventory.gd') } },
          { type: 'tool_use', name: 'Write', input: { file_path: join(root, 'tests', 'test_inventory.gd') } },
        ],
      },
    }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Now run the tests' }] } }),
    'not json',
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Tests pass; the save bug is fixed.' }] } }),
  ].join('\n')
}

test('the summary keeps the goal, the recent prompts, the edited files and the last state', () => {
  const root = join(tmpdir(), 'proj x')
  const s = summarize(transcript(root), { root })
  assert.match(s, /Goal: Fix the "save" bug/)
  assert.match(s, /Now run the tests/)
  assert.match(s, /src\/inventory\.gd/)
  assert.match(s, /tests\/test_inventory\.gd/)
  assert.match(s, /Last state: Tests pass/)
  assert.doesNotMatch(s, /meta noise|command-name/)
  assert.equal(summarize('', { root }), '')
  assert.equal(summarize(line({ type: 'assistant', message: { content: 'only me' } }), { root }), '', 'no prompt, nothing to save')
})

test('a long session is capped', () => {
  const root = join(tmpdir(), 'p')
  const many = Array.from({ length: 300 }, (_, i) => line({ type: 'user', message: { content: `prompt ${i} ${'x'.repeat(500)}` } })).join('\n')
  const s = summarize(many, { root })
  assert.ok(s.length <= 2000, String(s.length))
  assert.match(s, /prompt 0/)
  assert.match(s, /prompt 299/)
})

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'pre compact '))
  const root = join(base, 'My Game')
  mkdirSync(join(root, '.git'), { recursive: true })
  const t = join(base, 'session log.jsonl')
  writeFileSync(t, transcript(root))
  return { base, root, t }
}

// The pack home (hook-errors.log) is a scratch directory: the tests never write the real one.
const PACK_HOME = mkdtempSync(join(tmpdir(), 'pack home '))
process.on('exit', () => rmSync(PACK_HOME, { recursive: true, force: true }))
const runHook = (payload, harness, env) =>
  spawnSync(process.execPath, [TOOL, harness], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '', DOTAI_DELEGATE_HOME: PACK_HOME, ...env } })
const hookErrors = () => {
  const f = join(PACK_HOME, 'hook-errors.log')
  const lines = existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
  rmSync(f, { force: true })
  return lines
}

// Engram 1.20.0 (mem_current_project, trial 2026-11-19): the origin remote's repository name
// (git_remote), else the git root's directory name (git_root), else the directory's (dir_basename),
// each lowercased.
test("the project name follows Engram's own detection", () => {
  const base = mkdtempSync(join(tmpdir(), 'mc-project-'))
  try {
    const repo = join(base, 'MyRepo_X')
    mkdirSync(join(repo, '.git'), { recursive: true })
    assert.equal(engramProject(repo), 'myrepo_x', 'no remote: the root directory name')
    const config = url => writeFileSync(join(repo, '.git', 'config'),
      `[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://example.invalid/org/Wrong.git\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`)
    config('https://example.invalid/org/Other-Name.git')
    assert.equal(engramProject(repo), 'other-name')
    config('example.invalid:org/Ssh_Name.git')
    assert.equal(engramProject(repo), 'ssh_name')
    config('https://example.invalid/org/plain/')
    assert.equal(engramProject(repo), 'plain')
    const wt = join(base, 'Worktree')
    mkdirSync(join(repo, '.git', 'worktrees', 'wt'), { recursive: true })
    writeFileSync(join(repo, '.git', 'worktrees', 'wt', 'commondir'), '../..\n')
    mkdirSync(wt)
    writeFileSync(join(wt, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'wt')}\n`)
    assert.equal(engramProject(wt), 'plain', 'a worktree reads the shared config')
    assert.equal(engramProject(join(base, 'Plain Dir')), 'plain dir', 'no repository: the directory name')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('PreCompact saves one session summary through the CLI, typed and keyed by session', () => {
  const s = setup()
  const fake = fakeEngram()
  try {
    const r = runHook({ hook_event_name: 'PreCompact', session_id: 'abc12345-xyz', transcript_path: s.t, cwd: s.root, trigger: 'auto' }, 'claudecode', fake.env)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '')
    const calls = fake.calls()
    assert.equal(calls.length, 1)
    const [cmd, title, content, ...flags] = calls[0]
    assert.equal(cmd, 'save')
    assert.match(title, /Session summary: my game/)
    assert.match(content, /save/)
    assert.match(content, /inventory\.gd/)
    const flag = name => flags[flags.indexOf(name) + 1]
    assert.equal(flag('--type'), 'session_summary')
    assert.equal(flag('--project'), 'my game')
    assert.equal(flag('--topic'), 'session-summary/abc12345-xyz')
  } finally {
    rmSync(s.base, { recursive: true, force: true })
    rmSync(fake.dir, { recursive: true, force: true })
  }
})

test('nothing is saved without a transcript or prompts, and a failing CLI never fails the hook', () => {
  const s = setup()
  const fake = fakeEngram()
  const failing = fakeEngram({ exit: 2 })
  try {
    assert.equal(runHook({ session_id: 's', cwd: s.root }, 'claudecode', fake.env).status, 0)
    assert.equal(runHook({ session_id: 's', transcript_path: join(s.base, 'gone.jsonl'), cwd: s.root }, 'opencode', fake.env).status, 0)
    const emptyT = join(s.base, 'empty.jsonl')
    writeFileSync(emptyT, '')
    assert.equal(runHook({ session_id: 's', transcript_path: emptyT, cwd: s.root }, 'claudecode', fake.env).status, 0)
    assert.equal(fake.calls().length, 0)
    const r = runHook({ session_id: 's', transcript_path: s.t, cwd: s.root }, 'claudecode', failing.env)
    assert.equal(r.status, 0)
    assert.match(r.stderr, /engram/)
    const none = runHook({ session_id: 's', transcript_path: s.t, cwd: s.root }, 'claudecode', { PATH: s.base, Path: s.base })
    assert.equal(none.status, 0)
  } finally {
    rmSync(s.base, { recursive: true, force: true })
    rmSync(fake.dir, { recursive: true, force: true })
    rmSync(failing.dir, { recursive: true, force: true })
  }
})

const SECRETS = [
  'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx',
  'ghp_0123456789abcdefghijABCDEFGHIJ',
  'gho_0123456789abcdefghijABCDEFGHIJ',
  'github_pat_11ABCDEFG0123456789_abcdefghijklmnop',
  'AKIAIOSFODNN7EXAMPLE',
  'xoxb-1234567890-abcdefghij',
  'q8Zr3kLm9Xv2Tn7Bw4Yc1Hd6Gf0Js5Ka',
]

test('secrets are redacted: known token shapes, key=value assignments, PEM blocks, long random strings', () => {
  for (const sec of SECRETS) {
    const out = redact(`use ${sec} now`)
    assert.ok(!out.includes(sec), `${sec} -> ${out}`)
    assert.match(out, /\[redacted\]/)
  }
  assert.equal(redact('Authorization: Bearer abc.def-ghi_123'), 'Authorization: Bearer [redacted]')
  assert.equal(redact('set API_KEY=hunter2 and DB_PASSWORD="p w"'), 'set API_KEY=[redacted] and DB_PASSWORD=[redacted]')
  assert.equal(redact('export GITHUB_TOKEN=abc; SECRET=x'), 'export GITHUB_TOKEN=[redacted]; SECRET=[redacted]')
  assert.match(redact('-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----'), /^\[redacted\]$/)
  assert.match(redact('key: -----BEGIN RSA PRIVATE KEY----- AAAA cut'), /\[redacted\]/)
  for (const keep of ['Fix the save bug at 100% load', 'src/components/inventory-panel-list.tsx', 'sort key order', 'commit 1a2b3c4', 'impeccable-manual-edit-applier-and-friends-long']) {
    assert.equal(redact(keep), keep)
  }
})

test('the summary carries no secret and lists no denied file', () => {
  const root = join(tmpdir(), 'proj s')
  const jsonl = [
    line({ type: 'user', message: { content: `deploy with API_KEY=${'z'.repeat(8)} and ${SECRETS[0]}` } }),
    line({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: `done; token ${SECRETS[1]}` },
          { type: 'tool_use', name: 'Edit', input: { file_path: join(root, '.env.local') } },
          { type: 'tool_use', name: 'Edit', input: { file_path: join(root, 'src', 'app.ts') } },
        ],
      },
    }),
  ].join('\n')
  const s = summarize(jsonl, { root, isDenied: p => /\.env/.test(p) })
  for (const sec of [SECRETS[0], SECRETS[1], 'z'.repeat(8)]) assert.ok(!s.includes(sec), sec)
  assert.match(s, /src\/app\.ts/)
  assert.doesNotMatch(s, /\.env\.local/)
})

test('the saved summary is redacted, and denied files from the base list are left out', () => {
  const s = setup()
  const fake = fakeEngram()
  try {
    const t = join(s.base, 'secret session.jsonl')
    writeFileSync(
      t,
      [
        line({ type: 'user', message: { content: `rotate ${SECRETS[2]} please` } }),
        line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: join(s.root, '.env') } }, { type: 'text', text: 'ok' }] } }),
      ].join('\n'),
    )
    const r = runHook({ session_id: 'sec1', transcript_path: t, cwd: s.root }, 'claudecode', fake.env)
    assert.equal(r.status, 0, r.stderr)
    const [, , content] = fake.calls()[0]
    assert.ok(!content.includes(SECRETS[2]))
    assert.doesNotMatch(content, /Files edited: .*\.env/)
  } finally {
    rmSync(s.base, { recursive: true, force: true })
    rmSync(fake.dir, { recursive: true, force: true })
  }
})

test('a summary that could not be saved is recorded for the next session start', () => {
  const s = setup()
  const failing = fakeEngram({ exit: 2 })
  try {
    hookErrors()
    runHook({ session_id: 's', transcript_path: s.t, cwd: s.root }, 'claudecode', failing.env)
    const [e] = hookErrors()
    assert.equal(e.tool, 'memory-compact')
    assert.match(e.reason, /engram save failed/)
    runHook({ session_id: 's', transcript_path: s.t, cwd: s.root }, 'claudecode', { PATH: s.base, Path: s.base })
    assert.match(hookErrors()[0].reason, /not on PATH/)
    runHook({ session_id: 's', cwd: s.root }, 'claudecode', failing.env)
    assert.deepEqual(hookErrors(), [], 'nothing to save is not an error')
  } finally {
    rmSync(s.base, { recursive: true, force: true })
    rmSync(failing.dir, { recursive: true, force: true })
  }
})

test('quotes and percent signs reach a .cmd engram exactly', () => {
  const s = setup()
  const fake = fakeEngram()
  try {
    runHook({ session_id: 'q', transcript_path: s.t, cwd: s.root }, 'claudecode', fake.env)
    const [, , content] = fake.calls()[0]
    assert.match(content, /Fix the "save" bug at 100% load/)
  } finally {
    rmSync(s.base, { recursive: true, force: true })
    rmSync(fake.dir, { recursive: true, force: true })
  }
})
