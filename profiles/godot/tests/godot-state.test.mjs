import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { MAX_STATE_SEC, STATE_DEFAULTS, stateFor, stateTimeoutMs } from '../dotai/tools/godot-state.mjs'

const TOOL = join(dirname(fileURLToPath(import.meta.url)), '..', 'dotai', 'tools', 'godot-state.mjs')

function project(yaml) {
  const dir = mkdtempSync(join(tmpdir(), 'godot-state-'))
  mkdirSync(join(dir, '.git'))
  mkdirSync(join(dir, '.dotai'))
  if (yaml !== null) writeFileSync(join(dir, '.dotai', 'config.yaml'), yaml)
  mkdirSync(join(dir, 'sub'))
  return dir
}

test('the caps have one source of defaults', () => {
  assert.deepEqual(STATE_DEFAULTS, { stateMaxLines: 30, stateMaxChars: 1600, stateTimeoutSec: 10 })
})

test('the state timeout is configurable and clamped below the hook timeout', () => {
  assert.ok(MAX_STATE_SEC < 15, 'the hook timeout in .rulesync/hooks.jsonc is 15 s')
  assert.equal(stateTimeoutMs({}), 10000)
  assert.equal(stateTimeoutMs({ stateTimeoutSec: 5 }), 5000)
  assert.equal(stateTimeoutMs({ stateTimeoutSec: 0 }), 10000)
  assert.equal(stateTimeoutMs({ stateTimeoutSec: 600 }), MAX_STATE_SEC * 1000)
})

test('a command past godot.stateTimeoutSec is cut and the key is named', async () => {
  const dir = project('godot:\n  stateCommand: node -e "setTimeout(() => {}, 8000)"\n  stateTimeoutSec: 1\n')
  try {
    const t0 = Date.now()
    const out = await stateFor(dir)
    assert.ok(Date.now() - t0 < 6000, 'the configured 1 s timeout applied, not the 10 s default')
    assert.match(out, /timed out after 1 s \(godot\.stateTimeoutSec\)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('without a configured command it prints nothing (zero tokens)', async () => {
  const dir = project('godot:\n  reserveMb: 2048\n')
  try {
    assert.equal(await stateFor(join(dir, 'sub')), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the configured command runs from the project root, capped', async () => {
  const dir = project('godot:\n  stateCommand: node -e "console.log(process.cwd()); for (let i=0;i<50;i++) console.log(i)"\n  stateMaxLines: 5\n')
  try {
    const out = await stateFor(join(dir, 'sub'))
    assert.match(out, /^Project state \(godot\.stateCommand, capped\):/)
    assert.ok(out.toLowerCase().includes(dir.toLowerCase()))
    assert.match(out, /more lines cut/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a non-numeric cap falls back to its default and says so', async () => {
  const dir = project('godot:\n  stateCommand: node -e "for (let i=0;i<40;i++) console.log(i)"\n  stateMaxLines: lots\n')
  try {
    const out = await stateFor(dir)
    assert.match(out, /godot\.stateMaxLines.*lots.*30/)
    assert.match(out, /10 more lines cut/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failing command reports one line and never throws', async () => {
  const dir = project('godot:\n  stateCommand: node -e "process.exit(3)"\n')
  try {
    assert.match(await stateFor(dir), /failed \(exit 3\)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the hook entry point exits 0 with an empty payload', () => {
  const r = spawnSync('node', [TOOL], { input: '', encoding: 'utf8', timeout: 20000 })
  assert.equal(r.status, 0)
})

test('the state reaches each harness in its own format', () => {
  const dir = project('godot:\n  stateCommand: node -e "console.log(\'STATE-MARK\')"\n')
  try {
    const runWith = payload => spawnSync('node', [TOOL], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 20000 })
    // Claude Code and OpenCode: plain text on stdout.
    for (const payload of [{ session_id: 's', cwd: dir, hook_event_name: 'SessionStart' }, { cwd: dir }]) {
      const r = runWith(payload)
      assert.equal(r.status, 0, r.stderr)
      assert.match(r.stdout, /^Project state .*\nSTATE-MARK\n$/)
    }
    // agy: plain text is dropped, so the state goes in injectSteps.
    const agy = runWith({ conversationId: 'c1', workspacePaths: [dir] })
    assert.equal(agy.status, 0, agy.stderr)
    const msg = JSON.parse(agy.stdout).injectSteps[0].systemMessage.systemMessage
    assert.match(msg, /STATE-MARK/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// OpenCode's rulesync plugin runs a sessionStart command with no payload and drops its output
// (base hooks.jsonc), so the state hook sits in the Claude Code and agy blocks only.
test('the state hook is wired for Claude Code and agy only, never OpenCode', () => {
  const hooks = JSON.parse(readFileSync(join(dirname(TOOL), '..', '..', '.rulesync', 'hooks.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, ''))
  assert.deepEqual(hooks.hooks ?? {}, {}, 'no shared hooks: OpenCode would get them')
  assert.equal(hooks.opencode?.hooks?.sessionStart, undefined, 'OpenCode has no sessionStart')
  for (const h of ['claudecode', 'antigravity-cli']) {
    const [e, ...rest] = hooks[h]?.hooks?.sessionStart ?? []
    assert.equal(rest.length, 0, h)
    assert.equal(e?.command, 'node ${DOTAI_PROJECT_TOOLS}/godot-state.mjs', h)
    assert.equal(e.timeout, 15, h)
  }
})
