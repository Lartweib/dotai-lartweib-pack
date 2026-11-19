// Run: node --test base/tests/
// The base wiring: hooks.jsonc per harness and settings.yaml, checked against the conventions of
// PACK-FORMAT and HARNESS-NOTES that the engine's validate cannot see.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compilePatterns } from '../dotai/tools/hook-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = join(HERE, '..')
const TOOLS = join(BASE, 'dotai', 'tools')

// JSONC: line comments dropped outside strings; no trailing commas are used.
function jsonc(text) {
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      out += c
      if (c === '\\') out += text[++i]
      else if (c === '"') inStr = false
    } else if (c === '"') {
      inStr = true
      out += c
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else out += c
  }
  return JSON.parse(out)
}

const hooks = jsonc(readFileSync(join(BASE, '.rulesync', 'hooks.jsonc'), 'utf8'))
const blocks = { claudecode: hooks.claudecode?.hooks, opencode: hooks.opencode?.hooks, 'antigravity-cli': hooks['antigravity-cli']?.hooks }
const entries = h => Object.entries(blocks[h] ?? {}).flatMap(([event, list]) => list.map(e => ({ event, ...e })))
const harnessArgFor = { claudecode: 'claudecode', opencode: 'opencode', 'antigravity-cli': 'antigravity' }

test('no shared hooks: every hook sits in its harness block', () => {
  assert.equal(hooks.version, 1)
  assert.deepEqual(hooks.hooks ?? {}, {})
})

test('each harness gets its guards with its own tool names', () => {
  const find = (h, event, tool) => entries(h).find(e => e.event === event && e.command.includes(`/${tool}.mjs`))
  assert.equal(find('claudecode', 'preToolUse', 'shell-guard').matcher, 'Bash|PowerShell')
  assert.equal(find('claudecode', 'preToolUse', 'read-guard').matcher, 'Read')
  assert.equal(find('claudecode', 'preToolUse', 'agent-guard').matcher, 'Agent|Task')
  assert.equal(find('opencode', 'preToolUse', 'shell-guard').matcher, 'bash')
  assert.equal(find('opencode', 'preToolUse', 'read-guard').matcher, '^read$')
  assert.equal(find('antigravity-cli', 'preToolUse', 'shell-guard').matcher, 'run_command')
  // agy's matcher is a regular expression (".*" matched every tool, trial 2026-11-19): the read
  // guard takes every tool that returns file content, and none that returns names only.
  const agyRead = new RegExp(find('antigravity-cli', 'preToolUse', 'read-guard').matcher)
  for (const t of ['read_file', 'view_file', 'view_file_outline', 'view_code_item', 'grep_search', 'codebase_search', 'code_search', 'search_files', 'run_workflow']) assert.match(t, agyRead, t)
  for (const t of ['list_dir', 'find_by_name', 'file_search', 'run_command', 'write_file', 'edit_file', 'read_file_x', 'x_read_file']) assert.doesNotMatch(t, agyRead, t)
  for (const h of ['claudecode', 'antigravity-cli']) assert.ok(find(h, 'sessionStart', 'session-start'), h)
  assert.ok(find('claudecode', 'preCompact', 'memory-compact'))
  assert.equal(blocks.opencode.sessionStart, undefined, 'OpenCode drops sessionStart output')
  assert.equal(blocks.opencode.preCompact, undefined, 'OpenCode compaction gets no payload')
  assert.equal(blocks['antigravity-cli'].preCompact, undefined, 'agy has no PreCompact')
})

test('commands run node on a tools script that exists, name the harness, and have a timeout', () => {
  for (const h of Object.keys(blocks)) {
    for (const e of entries(h)) {
      const m = /^node "?\$\{DOTAI_TOOLS\}\/([\w.-]+)\.mjs"? (\S+)$/.exec(e.command)
      assert.ok(m, `${h} ${e.command}`)
      assert.ok(existsSync(join(TOOLS, `${m[1]}.mjs`)), m[1])
      assert.ok(existsSync(join(TOOLS, `${m[1]}.sh`)) && existsSync(join(TOOLS, `${m[1]}.ps1`)), `${m[1]} wrappers`)
      assert.equal(m[2], harnessArgFor[h])
      assert.ok(Number.isInteger(e.timeout) && e.timeout > 0 && e.timeout <= 60, `${h} ${e.event} timeout`)
    }
  }
})

test('agy commands carry no quotes; Claude Code and OpenCode quote the path', () => {
  for (const e of entries('antigravity-cli')) assert.doesNotMatch(e.command, /["']/, e.command)
  for (const h of ['claudecode', 'opencode']) for (const e of entries(h)) assert.match(e.command, /^node "\$\{DOTAI_TOOLS\}\//, e.command)
})

// Claude Code refreshes its statusline every 10 s, so it runs node on the .mjs directly (no
// PowerShell start-up per refresh); agy keeps the per-OS tool command, whose bare path it needs.
test('settings wire the statusline per harness: node directly for Claude Code, the tool variable for agy', () => {
  const yaml = readFileSync(join(BASE, 'dotai', 'settings.yaml'), 'utf8')
  assert.match(yaml, /^claudecode:\n/m)
  assert.match(yaml, /^antigravity-cli:\n/m)
  assert.match(yaml, /statusLine: \{ type: command, command: 'node "\$\{DOTAI_TOOLS\}\/statusline\.mjs" claudecode'/)
  assert.doesNotMatch(yaml, /DOTAI_TOOL:statusline\} claudecode/)
  assert.match(yaml, /statusLine: \{ type: command, command: "\$\{DOTAI_TOOL:statusline\} antigravity"/)
  assert.doesNotMatch(yaml, /^opencode:/m, 'OpenCode has no statusline setting')
  assert.match(yaml, /CLAUDE_CODE_SUBAGENT_MODEL: sonnet/)
  assert.ok(existsSync(join(TOOLS, 'statusline.sh')) && existsSync(join(TOOLS, 'statusline.ps1')))
})

// Secrets (DESIGN §3, 0038): permissions.jsonc denies the deny-paths.base.txt patterns for each
// harness in the form rulesync passes through (41.0.0, 43.9.2). Claude Code reads gitignore patterns with no `!`
// (deny wins over allow), so `.env.*` is spelled out per file and `.env.example` stays readable;
// OpenCode reads wildcards over the path, last match wins; agy takes plain paths only, no globs.
const ENV_VARIANTS = ['.env.local', '.env.prod', '.env.dev', '.env.preview', '.env.production', '.env.development', '.env.staging', '.env.test']

test('permissions.jsonc denies the shell guard secrets per harness', () => {
  const perms = jsonc(readFileSync(join(BASE, '.rulesync', 'permissions.jsonc'), 'utf8'))
  assert.deepEqual(perms.permission, {}, 'no shared categories: each harness has its own spelling')
  const lines = readFileSync(join(TOOLS, 'deny-paths.base.txt'), 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  const denied = lines.filter(l => !l.startsWith('!'))
  const read = h => perms[h]?.permission?.read ?? {}
  const denies = h => Object.entries(read(h)).filter(([, a]) => a === 'deny').map(([p]) => p)
  const dirGlob = p => (p.endsWith('/') ? `${p}**` : p)
  const cc = denies('claudecode')
  for (const p of denied) {
    if (p === '.env.*') for (const x of ENV_VARIANTS) assert.ok(cc.includes(x), `claudecode ${x}`)
    else assert.ok(cc.includes(dirGlob(p)), `claudecode ${p}`)
  }
  assert.ok(!cc.some(p => p.includes('example')))
  const oc = read('opencode')
  for (const p of denied) {
    const want = p.startsWith('~/') ? dirGlob(p).replace(/\*\*$/, '*') : `*${p.startsWith('.') || p.startsWith('*') ? p.replace(/^\*/, '') : p}`
    assert.equal(oc[want], 'deny', `opencode ${p} as ${want}`)
  }
  const keys = Object.keys(oc)
  assert.equal(oc['*.env.example'], 'allow')
  assert.equal(keys.at(-1), '*.env.example', 'last match wins in OpenCode')
  const agy = denies('antigravity-cli')
  // agy does not expand `~/`, so its home entries use the engine's `${DOTAI_HOME}`.
  const agyPath = p => p.replace(/\/$/, '').replace(/^~\//, '${DOTAI_HOME}/')
  for (const p of denied.filter(p => p.startsWith('~/') && !/[*?[]/.test(p))) assert.ok(agy.includes(agyPath(p)), `agy ${p}`)
  assert.ok(!agy.some(p => p.startsWith('~/')), 'agy has no ~/ entries')
  // agy 1.5.3's sandbox (auto mode) refuses a non-absolute deny path and then fails every shell
  // command, so agy gets absolute entries only; `.env` is left to the read and shell guards.
  for (const p of agy) assert.ok(p.startsWith('${DOTAI_HOME}/'), `agy entry is absolute: ${p}`)
  // The shell and read guards' list covers every variant through `.env.*`, and keeps the example.
  const match = compilePatterns(lines)
  for (const x of ENV_VARIANTS) assert.equal(match(join(BASE, x), BASE).matched, true, `deny-paths ${x}`)
  assert.equal(match(join(BASE, '.env.example'), BASE).matched, false)
  for (const p of agy) assert.ok(!/[*?[]/.test(p), `agy takes plain paths: ${p}`)
})
