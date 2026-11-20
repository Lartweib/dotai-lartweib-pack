// Run: node --test base/tests/
// Size-based Read hook (pack 0039): a full read of a large artifact is refused; ranges and small
// files pass. Patterns merge ~/.dotai/tools/read-size.*.txt and the project's .dotai/tools/.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { decide, decideSearch, readRequest, searchRequest } from '../dotai/tools/read-guard.mjs'
import { compilePatterns } from '../dotai/tools/hook-lib.mjs'

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
  assert.deepEqual(readRequest({ toolCall: { name: 'read_file', args: { Path: 'c' } } }), { path: 'c', partial: false })
  assert.deepEqual(readRequest({ toolCall: { name: 'read_file', args: { Path: 'c', StartLine: 1, EndLine: 3 } } }), { path: 'c', partial: true })
  assert.deepEqual(readRequest({ toolCall: { name: 'view_file', args: { AbsolutePath: 'c' } } }), { path: 'c', partial: false })
  assert.deepEqual(readRequest({ toolCall: { name: 'view_file', args: { AbsolutePath: 'c', StartLine: 1, EndLine: 9 } } }), { path: 'c', partial: true })
  // agy outline and code-item reads return part of a file: ranges.
  assert.deepEqual(readRequest({ toolCall: { name: 'view_file_outline', args: { AbsolutePath: 'c' } } }), { path: 'c', partial: true })
  assert.deepEqual(readRequest({ toolCall: { name: 'view_code_item', args: { File: 'c', NodePaths: ['A.b'] } } }), { path: 'c', partial: true })
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

test('agy content searches and scripts give their scope, includes and script; other tools none', () => {
  const tc = (name, args) => ({ toolCall: { name, args } })
  assert.deepEqual(searchRequest(tc('grep_search', { SearchPath: 'src', Query: 'K', Includes: ['*.js'] })), { kind: 'search', scopes: ['src'], includes: ['*.js'], script: '' })
  assert.deepEqual(searchRequest(tc('grep_search', { SearchPathUri: 'file:///w/a', Query: 'K' })), { kind: 'search', scopes: ['file:///w/a'], includes: [], script: '' })
  assert.deepEqual(searchRequest(tc('codebase_search', { Query: 'K', TargetDirectories: ['a', 'b'] })), { kind: 'search', scopes: ['a', 'b'], includes: [], script: '' })
  assert.deepEqual(searchRequest(tc('search_files', { Query: 'K' })), { kind: 'search', scopes: [], includes: [], script: '' })
  assert.deepEqual(searchRequest(tc('run_workflow', { Description: 'd', Script: 'print(1)' })), { kind: 'script', scopes: [], includes: [], script: 'print(1)' })
  for (const name of ['read_file', 'view_file', 'list_dir', 'run_command']) assert.equal(searchRequest(tc(name, { Path: 'x' })), null, name)
  assert.equal(searchRequest({ tool_name: 'Grep', tool_input: { pattern: 'K' } }), null)
})

function secretsProject() {
  const dir = mkdtempSync(join(tmpdir(), 'search guard '))
  mkdirSync(join(dir, '.git'))
  mkdirSync(join(dir, 'sub'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'sub', '.env'), 'K=1\n')
  writeFileSync(join(dir, 'src', 'app.js'), 'export {}\n')
  writeFileSync(join(dir, 'src', '.env.example'), 'K=\n')
  return dir
}

const denyFor = dir => {
  const m = compilePatterns(['.env', '.env.*', '!.env.example'])
  return abs => m(abs, dir)
}

test('a content search is denied when its scope holds a denied file, unless the includes leave it out', () => {
  const dir = secretsProject()
  try {
    const opts = { cwd: dir, workspaces: [dir], denied: denyFor(dir) }
    const s = (scopes, includes = []) => decideSearch({ kind: 'search', scopes, includes, script: '' }, opts)
    const root = s([dir])
    assert.equal(root?.decision, 'deny')
    assert.match(root.reason, /sub[\\/]\.env/)
    assert.match(root.reason, /do not retry with another reader/)
    assert.equal(s([])?.decision, 'deny', 'no scope is the workspace')
    assert.equal(s(['sub'])?.decision, 'deny', 'a relative scope resolves against the cwd')
    assert.equal(s([join(dir, 'sub', '.env')])?.decision, 'deny', 'the denied file itself')
    assert.equal(s([pathToFileURL(dir).href])?.decision, 'deny', 'a file:// scope')
    assert.equal(s([dir], ['*.js']), null, 'the includes leave the secret out')
    assert.equal(s([join(dir, 'src')]), null, 'no denied file there (.env.example is allowed)')
    assert.equal(s([join(dir, 'src')], ['.env'])?.decision, 'deny', 'an include that names a denied file')
    assert.equal(s([join(dir, 'src')], ['*.env*'])?.decision, 'deny', 'a wildcard include that names a denied file')
    assert.equal(s([join(dir, 'src')], ['*.ts']), null, 'a wildcard include that names none')
    assert.equal(s([join(dir, 'gone')]), null, 'a missing scope is the tool error')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a scope too large to check is denied, with advice to narrow it', () => {
  const dir = secretsProject()
  try {
    const d = decideSearch({ kind: 'search', scopes: [join(dir, 'src')], includes: [], script: '' }, { cwd: dir, workspaces: [dir], denied: denyFor(dir), maxEntries: 1 })
    assert.equal(d?.decision, 'deny')
    assert.match(d.reason, /narrow/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a script that names a denied path, or walks a tree holding one, is denied', () => {
  const dir = secretsProject()
  const clean = mkdtempSync(join(tmpdir(), 'search clean '))
  try {
    writeFileSync(join(clean, 'a.txt'), 'x\n')
    const run = (script, cwd = dir) => decideSearch({ kind: 'script', scopes: [], includes: [], script }, { cwd, workspaces: [cwd], denied: denyFor(cwd) })
    const walk = 'import os\nfor root, dirs, files in os.walk("."):\n    for f in files:\n        print(open(os.path.join(root, f)).read())\n'
    assert.equal(run(walk)?.decision, 'deny')
    assert.equal(run("print(open('sub/.env').read())")?.decision, 'deny')
    assert.equal(run('from pathlib import Path\nprint([p.read_text() for p in Path(".").rglob("*")])')?.decision, 'deny')
    assert.equal(run("print(open('src/app.js').read())"), null)
    assert.equal(run('print(1 + 1)'), null)
    assert.equal(run(walk, clean), null, 'no denied file in the workspace')
    assert.equal(run("print(open('.env').read())", clean)?.decision, 'deny', 'named even before it exists')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(clean, { recursive: true, force: true })
  }
})

test('the agy hook denies a content search and a script over a denied file', () => {
  const dir = secretsProject()
  try {
    const g = runHook({ toolCall: { name: 'grep_search', args: { SearchPath: dir, Query: 'K' } }, cwd: dir, workspacePaths: [dir] }, 'antigravity')
    assert.equal(g.json?.decision, 'deny')
    const w = runHook({ toolCall: { name: 'run_workflow', args: { Script: 'import os\nprint(list(os.walk(".")))' } }, cwd: dir, workspacePaths: [dir] }, 'antigravity')
    assert.equal(w.json?.decision, 'deny')
    const ok = runHook({ toolCall: { name: 'grep_search', args: { SearchPath: join(dir, 'src'), Query: 'K' } }, cwd: dir, workspacePaths: [dir] }, 'antigravity')
    assert.equal(ok.stdout, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a home path the harness left unexpanded is resolved against the home, not the cwd', () => {
  const home = join(tmpdir(), 'guard home')
  const cwd = join(tmpdir(), 'guard project')
  const match = compilePatterns(['~/.ssh/'], { home })
  const opts = { cwd, root: cwd, home, denied: abs => match(abs, cwd) }
  for (const path of ['~/.ssh/id_x', '%USERPROFILE%\\.ssh\\id_x', '$HOME/.ssh/id_x', '${HOME}/.ssh/id_x', '$env:USERPROFILE\\.ssh\\id_x']) {
    assert.equal(decide({ path, partial: false }, opts)?.decision, 'deny', path)
  }
  assert.equal(decide({ path: '~/notes.txt', partial: false }, opts), null)
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
