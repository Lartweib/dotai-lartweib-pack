// Run: node --test base/tests/
// Agent hook (pack 0030, 0037): every launch names its model; the agent's definition declares
// its effort; Opus only for allowlisted `<agent> <model>` entries.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decide, findAgent, modelFamily, parseAllow } from '../dotai/tools/agent-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const GUARD = join(HERE, '..', 'dotai', 'tools', 'agent-guard.mjs')
const md = (name, extra = '') => `---\nname: ${name}\ndescription: x\n${extra}---\nbody\n`

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'agent guard '))
  const config = join(base, 'claude config')
  const root = join(base, 'my project')
  mkdirSync(join(config, 'agents', 'nested'), { recursive: true })
  mkdirSync(join(root, '.git'), { recursive: true })
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true })
  writeFileSync(join(config, 'agents', 'explorer.md'), md('explorer', 'model: haiku\neffort: medium\n'))
  writeFileSync(join(config, 'agents', 'judge.md'), md('judge', 'model: opus\neffort: high\n'))
  writeFileSync(join(config, 'agents', 'nested', 'odd-file.md'), md('worker', 'model: sonnet\neffort: medium\n'))
  writeFileSync(join(config, 'agents', 'lazy.md'), md('lazy', 'model: sonnet\n'))
  writeFileSync(join(root, '.claude', 'agents', 'lazy.md'), md('lazy', 'model: sonnet\neffort: low\n'))
  const plug = join(config, 'plugins', 'cache', 'mk', 'plug', '1.0.0')
  mkdirSync(join(plug, 'agents'), { recursive: true })
  writeFileSync(join(plug, 'agents', 'applier.md'), md('applier', 'model: inherit\n'))
  writeFileSync(join(plug, 'agents', 'tuned.md'), md('tuned', 'model: inherit\neffort: low\n'))
  writeFileSync(join(config, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'plug@mk': [{ scope: 'user', installPath: plug }] } }))
  return { base, config, root }
}

const ALLOW = parseAllow(['judge opus', 'worker opus', 'bad line here', '# c'])

test('model names map to their family', () => {
  assert.equal(modelFamily('opus'), 'opus')
  assert.equal(modelFamily('claude-opus-5-5'), 'opus')
  assert.equal(modelFamily('Sonnet'), 'sonnet')
  assert.equal(modelFamily('haiku'), 'haiku')
  assert.equal(modelFamily(''), '')
  assert.deepEqual([...ALLOW], ['judge opus', 'worker opus'])
})

test('definitions are found in the project, the user directory and installed plugins', () => {
  const f = fixture()
  try {
    const opts = { root: f.root, configDir: f.config }
    assert.equal(findAgent('explorer', opts).fm.effort, 'medium')
    assert.equal(findAgent('worker', opts).fm.effort, 'medium', 'matched by frontmatter name')
    assert.equal(findAgent('lazy', opts).fm.effort, 'low', 'the project definition wins')
    assert.equal(findAgent('plug:tuned', opts).fm.effort, 'low')
    assert.equal(findAgent('plug:applier', opts).fm.effort, undefined)
    assert.equal(findAgent('general-purpose', opts), null)
    assert.equal(findAgent('other:tuned', opts), null)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('a launch without a model is denied with the selection criterion', () => {
  const f = fixture()
  try {
    const d = decide({ subagent_type: 'explorer', prompt: 'x' }, { root: f.root, configDir: f.config, allow: ALLOW })
    assert.equal(d.decision, 'deny')
    assert.match(d.reason, /model/)
    assert.match(d.reason, /haiku/)
    assert.match(d.reason, /sonnet/)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('agents without a declared effort are denied: built-ins, untyped launches, bare definitions', () => {
  const f = fixture()
  try {
    const opts = { root: f.root, configDir: f.config, allow: ALLOW }
    for (const input of [
      { subagent_type: 'general-purpose', model: 'sonnet' },
      { subagent_type: 'Explore', model: 'haiku' },
      { model: 'sonnet' },
      { subagent_type: 'plug:applier', model: 'sonnet' },
    ]) {
      const d = decide(input, opts)
      assert.equal(d?.decision, 'deny', JSON.stringify(input))
      assert.match(d.reason, /effort/)
    }
    assert.match(decide({ subagent_type: 'general-purpose', model: 'sonnet' }, opts).reason, /explorer|worker/)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('agents.defaultEffort accepts a named agent that declares no effort', () => {
  const f = fixture()
  try {
    const opts = { root: f.root, configDir: f.config, allow: ALLOW, defaultEffort: { applier: 'medium' } }
    assert.equal(decide({ subagent_type: 'plug:applier', model: 'sonnet' }, opts), null)
    assert.equal(decide({ subagent_type: 'plug:applier', model: 'sonnet' }, { ...opts, defaultEffort: { 'plug:applier': 'low' } }), null)
    assert.equal(decide({ subagent_type: 'general-purpose', model: 'sonnet' }, { ...opts, defaultEffort: { 'general-purpose': 'high' } }), null)
    assert.equal(decide({ subagent_type: 'plug:applier', model: 'sonnet' }, { ...opts, defaultEffort: { applier: 'bogus' } })?.decision, 'deny')
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('Opus passes only for allowlisted agents', () => {
  const f = fixture()
  try {
    const opts = { root: f.root, configDir: f.config, allow: ALLOW }
    assert.equal(decide({ subagent_type: 'judge', model: 'opus' }, opts), null)
    assert.equal(decide({ subagent_type: 'worker', model: 'opus' }, opts), null)
    const d = decide({ subagent_type: 'explorer', model: 'opus' }, opts)
    assert.equal(d.decision, 'deny')
    assert.match(d.reason, /judge opus/)
    assert.equal(decide({ subagent_type: 'explorer', model: 'haiku' }, opts), null)
    assert.equal(decide({ subagent_type: 'plug:tuned', model: 'sonnet' }, opts), null)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

function runHook(payload, env) {
  const r = spawnSync(process.execPath, [GUARD, 'claudecode'], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...env } })
  return { ...r, json: r.stdout ? JSON.parse(r.stdout) : null }
}

test('the hook merges model-allow files from both tools directories and reads defaultEffort', () => {
  const f = fixture()
  try {
    const env = { CLAUDE_CONFIG_DIR: f.config, USERPROFILE: f.base, HOME: f.base }
    const launch = (input, cwd = f.root) => runHook({ tool_name: 'Agent', tool_input: { prompt: 'p', ...input }, cwd }, env)
    assert.equal(launch({ subagent_type: 'judge', model: 'opus' }).stdout, '', 'judge opus ships in the base list')
    assert.equal(launch({ subagent_type: 'worker', model: 'opus' }).json.hookSpecificOutput.permissionDecision, 'deny')
    mkdirSync(join(f.root, '.dotai', 'tools'), { recursive: true })
    writeFileSync(join(f.root, '.dotai', 'tools', 'model-allow.godot.txt'), 'worker opus\n')
    assert.equal(launch({ subagent_type: 'worker', model: 'opus' }).stdout, '')
    assert.equal(launch({ subagent_type: 'plug:applier', model: 'sonnet' }).json.hookSpecificOutput.permissionDecision, 'deny')
    writeFileSync(join(f.root, '.dotai', 'config.yaml'), 'agents:\n  defaultEffort:\n    applier: medium\n')
    assert.equal(launch({ subagent_type: 'plug:applier', model: 'sonnet' }).stdout, '')
    const task = runHook({ tool_name: 'Task', tool_input: { subagent_type: 'explorer' }, cwd: f.root }, env)
    assert.equal(task.json.hookSpecificOutput.permissionDecision, 'deny', 'the old Task name too')
    const other = runHook({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: f.root }, env)
    assert.equal(other.stdout, '')
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('a broken payload never blocks', () => {
  const r = spawnSync(process.execPath, [GUARD, 'claudecode'], { input: '[]', encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
})

// One tree (0030, 0032; standalone README, launch log): an allowed launch is appended to the
// delegate launch log as a `start` entry with harness claudecode, capped like the backend's.
test('allowed launches are logged as claudecode start entries in the capped launch log; denied ones are not', () => {
  const f = fixture()
  try {
    const packHome = join(f.base, 'pack home')
    const env = { CLAUDE_CONFIG_DIR: f.config, USERPROFILE: f.base, HOME: f.base, DOTAI_DELEGATE_HOME: packHome }
    const logFile = join(packHome, 'launches.jsonl')
    const read = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])
    const ok = runHook({ tool_name: 'Agent', tool_input: { subagent_type: 'explorer', model: 'haiku', description: 'find the parser', prompt: 'p' }, cwd: f.root }, env)
    assert.equal(ok.stdout, '')
    const [e] = read()
    assert.equal(e.event, 'start')
    assert.equal(e.harness, 'claudecode')
    assert.equal(e.from, 'claudecode')
    assert.equal(e.model, 'haiku')
    assert.equal(e.effort, 'medium', 'the effort of the definition launched')
    assert.equal(e.title, 'find the parser')
    assert.equal(e.agent, 'explorer')
    assert.ok(e.id && Math.abs(e.ts - Date.now()) < 60000)
    runHook({ tool_name: 'Agent', tool_input: { subagent_type: 'explorer', prompt: 'no model' }, cwd: f.root }, env)
    assert.equal(read().length, 1, 'a denied launch is not logged')
    writeFileSync(join(packHome, 'delegate.yaml'), 'delegate:\n  logMax: 3\n')
    for (let i = 0; i < 6; i++) runHook({ tool_name: 'Agent', tool_input: { subagent_type: 'explorer', model: 'haiku', description: `n${i}`, prompt: 'p' }, cwd: f.root }, env)
    const all = read()
    assert.ok(all.length <= 4, `capped: ${all.length}`)
    assert.equal(all.at(-1).title, 'n5')
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})
