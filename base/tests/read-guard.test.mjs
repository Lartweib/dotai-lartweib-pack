// Run: node --test base/tests/
// Size-based Read hook (pack 0039): a full read of a large artifact is refused; ranges and small
// files pass. Patterns merge ~/.dotai/tools/read-size.*.txt and the project's .dotai/tools/.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decide, readRequest } from '../dotai/tools/read-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const GUARD = join(HERE, '..', 'dotai', 'tools', 'read-guard.mjs')

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'read guard '))
  mkdirSync(join(dir, '.git'))
  mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(dir, 'package-lock.json'), 'x'.repeat(200 * 1024))
  writeFileSync(join(dir, 'node_modules', 'pkg', 'index.d.ts'), 'export {}\n')
  writeFileSync(join(dir, 'big-source.ts'), 'y'.repeat(200 * 1024))
  return dir
}

test('the request shape of each harness gives the path and whether it is a range', () => {
  assert.deepEqual(readRequest({ tool_input: { file_path: 'a', offset: 10 } }), { path: 'a', partial: true })
  assert.deepEqual(readRequest({ tool_input: { file_path: 'a' } }), { path: 'a', partial: false })
  assert.deepEqual(readRequest({ tool_input: { file_path: 'a.pdf', pages: '1-3' } }), { path: 'a.pdf', partial: true })
  assert.deepEqual(readRequest({ tool_input: { filePath: 'b', limit: 20 } }), { path: 'b', partial: true })
  assert.deepEqual(readRequest({ toolCall: { name: 'view_file', args: { AbsolutePath: 'c' } } }), { path: 'c', partial: false })
  assert.deepEqual(readRequest({ toolCall: { name: 'view_file', args: { AbsolutePath: 'c', StartLine: 1, EndLine: 9 } } }), { path: 'c', partial: true })
  assert.deepEqual(readRequest({}), { path: '', partial: false })
})

test('a full read of a large artifact is denied with the alternatives', () => {
  const dir = project()
  try {
    const d = decide({ path: join(dir, 'package-lock.json'), partial: false }, { cwd: dir, root: dir, patterns: ['package-lock.json'], maxKb: 64 })
    assert.equal(d.decision, 'deny')
    assert.match(d.reason, /200 KB/)
    assert.match(d.reason, /offset|range/)
    assert.match(d.reason, /rg/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ranges, small files, unmatched paths, directories and missing files pass', () => {
  const dir = project()
  try {
    const opts = { cwd: dir, root: dir, patterns: ['package-lock.json', 'node_modules/', '*.missing'], maxKb: 64 }
    assert.equal(decide({ path: 'package-lock.json', partial: true }, opts), null)
    assert.equal(decide({ path: join(dir, 'node_modules', 'pkg', 'index.d.ts'), partial: false }, opts), null)
    assert.equal(decide({ path: join(dir, 'big-source.ts'), partial: false }, opts), null)
    assert.equal(decide({ path: join(dir, 'node_modules'), partial: false }, opts), null)
    assert.equal(decide({ path: join(dir, 'gone.missing'), partial: false }, opts), null)
    assert.equal(decide({ path: '', partial: false }, opts), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function runHook(payload, harness) {
  const r = spawnSync(process.execPath, [GUARD, harness], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } })
  return { ...r, json: r.stdout ? JSON.parse(r.stdout) : null }
}

test('the hook merges the base list, the project list and the size from config.yaml', () => {
  const dir = project()
  try {
    // package-lock.json is in the base list; big-source.ts only in the project's list.
    const lock = runHook({ tool_name: 'Read', tool_input: { file_path: join(dir, 'package-lock.json') }, cwd: dir }, 'claudecode')
    assert.equal(lock.json.hookSpecificOutput.permissionDecision, 'deny')
    const src = runHook({ tool_name: 'Read', tool_input: { file_path: join(dir, 'big-source.ts') }, cwd: dir }, 'claudecode')
    assert.equal(src.stdout, '')
    mkdirSync(join(dir, '.dotai', 'tools'), { recursive: true })
    writeFileSync(join(dir, '.dotai', 'tools', 'read-size.local.txt'), 'big-source.ts\n')
    const src2 = runHook({ tool_name: 'read', tool_input: { filePath: 'big-source.ts' }, cwd: dir }, 'opencode')
    assert.equal(src2.json.hookSpecificOutput.permissionDecision, 'deny')
    writeFileSync(join(dir, '.dotai', 'config.yaml'), 'readSize:\n  maxKb: 512\n')
    const src3 = runHook({ tool_name: 'Read', tool_input: { file_path: join(dir, 'big-source.ts') }, cwd: dir }, 'claudecode')
    assert.equal(src3.stdout, '', 'a higher threshold lets it through')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a denied path is refused in every harness, whatever its size or range; .env.example passes', () => {
  const dir = project()
  try {
    for (const n of ['.env', '.env.local', '.env.prod', '.env.example']) writeFileSync(join(dir, n), 'K=1\n')
    mkdirSync(join(dir, '.dotai', 'tools'), { recursive: true })
    writeFileSync(join(dir, '.dotai', 'tools', 'deny-paths.zz.txt'), '!.env\n')
    const cc = runHook({ tool_name: 'Read', tool_input: { file_path: join(dir, '.env') }, cwd: dir }, 'claudecode')
    assert.equal(cc.json?.hookSpecificOutput.permissionDecision, 'deny', 'a project ! line does not re-allow it')
    assert.match(cc.json.hookSpecificOutput.permissionDecisionReason, /denied.*do not retry with another reader/i)
    const oc = runHook({ tool_name: 'read', tool_input: { filePath: '.env.local', offset: 1, limit: 2 }, cwd: dir }, 'opencode')
    assert.equal(oc.json?.hookSpecificOutput.permissionDecision, 'deny')
    const agy = runHook({ toolCall: { name: 'view_file', args: { AbsolutePath: join(dir, '.env.prod'), StartLine: 1, EndLine: 2 } }, workspacePaths: [dir] }, 'antigravity')
    assert.equal(agy.json?.decision, 'deny')
    const ok = runHook({ tool_name: 'Read', tool_input: { file_path: join(dir, '.env.example') }, cwd: dir }, 'claudecode')
    assert.equal(ok.stdout, '')
    const gone = runHook({ tool_name: 'Read', tool_input: { file_path: join(dir, 'secrets', '.env') }, cwd: dir }, 'claudecode')
    assert.equal(gone.json?.hookSpecificOutput.permissionDecision, 'deny', 'denied even before it exists')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a bad threshold falls back to the default with a warning, and bad input never blocks', () => {
  const dir = project()
  try {
    mkdirSync(join(dir, '.dotai'), { recursive: true })
    writeFileSync(join(dir, '.dotai', 'config.yaml'), 'readSize:\n  maxKb: lots\n')
    const r = runHook({ tool_name: 'Read', tool_input: { file_path: join(dir, 'package-lock.json') }, cwd: dir }, 'claudecode')
    assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /readSize\.maxKb/)
    const bad = spawnSync(process.execPath, [GUARD, 'claudecode'], { input: '{', encoding: 'utf8' })
    assert.equal(bad.status, 0)
    assert.equal(bad.stdout, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
