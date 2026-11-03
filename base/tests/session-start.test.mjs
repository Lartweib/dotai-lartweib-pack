// Run: node --test base/tests/
// SessionStart (pack 0040, 0042): suggest onboarding once when the project has no applied-profiles
// marker; inject the author's Engram preferences, capped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { onboardingHint } from '../dotai/tools/session-start.mjs'
import { fakeEngram } from './fake-engram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL = join(HERE, '..', 'dotai', 'tools', 'session-start.mjs')

function project() {
  const base = mkdtempSync(join(tmpdir(), 'session start '))
  const root = join(base, 'my game')
  mkdirSync(join(root, '.git'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  return { base, root, home: join(base, 'home') }
}

test('the hint appears without the engine marker and disappears with it or with the done marker', () => {
  const p = project()
  try {
    const opts = { env: {}, home: p.home }
    assert.match(onboardingHint(join(p.root, 'src'), opts), /dotai-analyze/)
    mkdirSync(join(p.root, '.dotai', 'packs', 'dotai-lartweib-pack'), { recursive: true })
    assert.match(onboardingHint(p.root, opts), /dotai-analyze/, 'an empty pack directory is not done')
    writeFileSync(join(p.root, '.dotai', 'packs', 'dotai-lartweib-pack', 'onboarded.json'), '{}')
    assert.equal(onboardingHint(p.root, opts), '')
    rmSync(join(p.root, '.dotai', 'packs'), { recursive: true })
    writeFileSync(join(p.root, '.dotai', 'state.json'), '{}')
    assert.equal(onboardingHint(p.root, opts), '')
  } finally {
    rmSync(p.base, { recursive: true, force: true })
  }
})

test('outside a project, or at the home directory, there is no hint', () => {
  const p = project()
  try {
    const loose = join(p.base, 'loose dir')
    mkdirSync(loose)
    assert.equal(onboardingHint(loose, { env: {}, home: p.home }), '')
    mkdirSync(join(p.home, '.git'), { recursive: true })
    assert.equal(onboardingHint(p.home, { env: {}, home: p.home }), '')
  } finally {
    rmSync(p.base, { recursive: true, force: true })
  }
})

// The pack home (hook-errors.log) is a scratch directory: the tests never touch the real one.
const PACK_HOME = mkdtempSync(join(tmpdir(), 'pack home '))
process.on('exit', () => rmSync(PACK_HOME, { recursive: true, force: true }))
function runHook(payload, harness, env) {
  return spawnSync(process.execPath, [TOOL, harness], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: '', DOTAI_DELEGATE_HOME: PACK_HOME, ...env },
  })
}

test('Claude Code gets plain text with the hint and the preferences, read-only and capped', () => {
  const p = project()
  const fake = fakeEngram({ out: `${'pref line\n'.repeat(60)}` })
  try {
    const r = runHook({ hook_event_name: 'SessionStart', source: 'startup', cwd: p.root }, 'claudecode', { ...fake.env, USERPROFILE: p.home, HOME: p.home })
    assert.equal(r.status, 0)
    assert.match(r.stdout, /dotai-analyze/)
    assert.match(r.stdout, /pref line/)
    assert.ok(r.stdout.length < 1600, `capped: ${r.stdout.length}`)
    const calls = fake.calls()
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], 'search')
    assert.ok(calls[0].includes('--type') && calls[0].includes('preference'))
    assert.ok(calls[0].includes('--scope') && calls[0].includes('personal'))
    assert.ok(!calls.some(c => c[0] === 'save'), 'never writes')
  } finally {
    rmSync(p.base, { recursive: true, force: true })
    rmSync(fake.dir, { recursive: true, force: true })
  }
})

test('agy gets injectSteps JSON; a resumed session gets nothing new', () => {
  const p = project()
  const fake = fakeEngram({ out: 'prefers brief answers\n' })
  try {
    const env = { ...fake.env, USERPROFILE: p.home, HOME: p.home }
    const agy = runHook({ conversationId: 'c', workspacePaths: [p.root] }, 'antigravity', env)
    const step = JSON.parse(agy.stdout).injectSteps[0].systemMessage.systemMessage
    assert.match(step, /dotai-analyze/)
    assert.match(step, /prefers brief answers/)
    const resumed = runHook({ source: 'resume', cwd: p.root }, 'claudecode', env)
    assert.equal(resumed.stdout, '')
    const compacted = runHook({ source: 'compact', cwd: p.root }, 'claudecode', env)
    assert.doesNotMatch(compacted.stdout, /dotai-analyze/, 'the hint is for a new session only')
    assert.match(compacted.stdout, /prefers brief answers/, 'preferences come back after compaction')
  } finally {
    rmSync(p.base, { recursive: true, force: true })
    rmSync(fake.dir, { recursive: true, force: true })
  }
})

test('a missing or failing engram, or no results, leaves only the hint', () => {
  const p = project()
  const failing = fakeEngram({ out: 'boom', exit: 3 })
  const empty = fakeEngram({ out: 'No memories found.\n' })
  try {
    for (const env of [{ PATH: join(p.base, 'nothing'), Path: join(p.base, 'nothing') }, failing.env, empty.env]) {
      const r = runHook({ source: 'startup', cwd: p.root }, 'claudecode', { ...env, USERPROFILE: p.home, HOME: p.home })
      assert.equal(r.status, 0)
      assert.match(r.stdout, /dotai-analyze/)
      assert.doesNotMatch(r.stdout, /boom|No memories/)
    }
  } finally {
    rmSync(p.base, { recursive: true, force: true })
    rmSync(failing.dir, { recursive: true, force: true })
    rmSync(empty.dir, { recursive: true, force: true })
  }
})

test('the last unsaved summary is reported once, in one line, then cleared', () => {
  const p = project()
  const fake = fakeEngram({ out: 'prefers brief answers\n' })
  try {
    const env = { ...fake.env, USERPROFILE: p.home, HOME: p.home }
    writeFileSync(
      join(PACK_HOME, 'hook-errors.log'),
      [{ ts: 1, tool: 'memory-compact', reason: 'old' }, { ts: 2, tool: 'memory-compact', reason: 'engram save failed (exit 2)' }].map(e => JSON.stringify(e)).join('\n') + '\n',
    )
    const first = runHook({ source: 'startup', cwd: p.root }, 'claudecode', env)
    const lines = first.stdout.split('\n').filter(l => l.startsWith('memory:'))
    assert.deepEqual(lines, ['memory: last summary not saved (engram save failed (exit 2))'])
    assert.ok(!existsSync(join(PACK_HOME, 'hook-errors.log')))
    const second = runHook({ source: 'startup', cwd: p.root }, 'claudecode', env)
    assert.doesNotMatch(second.stdout, /^memory:/m)
    writeFileSync(join(PACK_HOME, 'hook-errors.log'), JSON.stringify({ ts: 3, tool: 'memory-compact', reason: 'timeout' }) + '\n')
    const agy = runHook({ conversationId: 'c', workspacePaths: [p.root] }, 'antigravity', env)
    assert.match(JSON.parse(agy.stdout).injectSteps[0].systemMessage.systemMessage, /memory: last summary not saved \(timeout\)/)
  } finally {
    rmSync(p.base, { recursive: true, force: true })
    rmSync(fake.dir, { recursive: true, force: true })
  }
})

test('an engram that fails the preference search is recorded; a missing engram is not', () => {
  const p = project()
  const failing = fakeEngram({ out: 'boom', exit: 3 })
  try {
    rmSync(join(PACK_HOME, 'hook-errors.log'), { force: true })
    const nowhere = { PATH: join(p.base, 'nothing'), Path: join(p.base, 'nothing'), USERPROFILE: p.home, HOME: p.home }
    runHook({ source: 'startup', cwd: p.root }, 'claudecode', nowhere)
    assert.ok(!existsSync(join(PACK_HOME, 'hook-errors.log')))
    runHook({ source: 'startup', cwd: p.root }, 'claudecode', { ...failing.env, USERPROFILE: p.home, HOME: p.home })
    const next = runHook({ source: 'resume', cwd: p.root }, 'claudecode', nowhere)
    assert.match(next.stdout, /^memory: preferences not loaded last session \(engram search failed \(exit 3\)\)$/m)
  } finally {
    rmSync(p.base, { recursive: true, force: true })
    rmSync(failing.dir, { recursive: true, force: true })
  }
})
