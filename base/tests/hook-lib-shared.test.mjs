// Run: node --test base/tests/
// The helpers added to hook-lib for the base hooks: shell parsing (moved from the godot guard),
// gitignore-style pattern lists merged from both tools directories, nested config and
// frontmatter. The original exports are covered by hook-lib.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  commandName,
  compilePatterns,
  frontmatter,
  harnessArg,
  readPatternFiles,
  readSubsection,
  segments,
  simpleCommands,
  tokenize,
  userToolsDir,
} from '../dotai/tools/hook-lib.mjs'

const scratch = () => mkdtempSync(join(tmpdir(), 'dotai lib '))
const names = cmd => simpleCommands(cmd).map(c => c.name)
const argsOf = (cmd, i = 0) => simpleCommands(cmd)[i].args.map(t => t.u)

test('the shared tokenizer splits on operators and drops redirections', () => {
  const { toks } = tokenize('git stash 2>&1 > out.txt && echo "a b" | rg x')
  const segs = segments(toks).map(s => s.map(t => t.v))
  assert.deepEqual(segs, [['git', 'stash'], ['echo', 'a b'], ['rg', 'x']])
  assert.equal(commandName({ u: 'C:\\Windows\\System32\\taskkill.exe' }), 'taskkill')
})

test('simple commands look through wrappers, shells, cmd and PowerShell', () => {
  assert.deepEqual(names('sudo -u me env A=1 nohup git stash'), ['git'])
  assert.deepEqual(names('timeout 30 git reset --hard'), ['git'])
  assert.deepEqual(names(`bash -lc "cd x && git stash"`), ['cd', 'git'])
  assert.deepEqual(names('cmd /c "taskkill /IM godot.exe /F"'), ['taskkill'])
  assert.deepEqual(names(`powershell -NoProfile -Command "Stop-Process -Name godot"`), ['stop-process'])
  assert.deepEqual(names('echo "$(git stash pop)"'), ['git', 'echo'])
  assert.deepEqual(names('Get-Process godot | ForEach-Object { Stop-Process $_ }'), ['get-process', 'foreach-object', 'stop-process'])
  assert.deepEqual(names('iex "git stash"'), ['git'])
  assert.deepEqual(names('A=1 B=2 python -c "print(1)"'), ['python'])
  assert.deepEqual(argsOf('git -C "my dir" stash list'), ['-C', 'my dir', 'stash', 'list'])
  assert.deepEqual(names(''), [])
  assert.deepEqual(names('command -v git'), [])
})

test('patterns follow gitignore rules: names at any depth, anchored paths, dirs, negation', () => {
  const root = join(tmpdir(), 'proj with space')
  const m = compilePatterns(['node_modules/', '*.lock', 'seo-reports/*.json', '/top.txt', '.env', '.env.*', '!.env.example'], {
    home: join(tmpdir(), 'home'),
  })
  const at = p => m(join(root, p), root).matched
  assert.equal(at('node_modules/a/b.js'), true)
  assert.equal(at('pkg/node_modules/x.js'), true)
  assert.equal(at('node_modules'), false, 'a dir pattern does not match a file of that name')
  assert.equal(at('yarn.lock'), true)
  assert.equal(at('deep/Cargo.lock'), true)
  assert.equal(at('seo-reports/a.json'), true)
  assert.equal(at('x/seo-reports/a.json'), false, 'a pattern with a slash is anchored at the root')
  assert.equal(at('top.txt'), true)
  assert.equal(at('sub/top.txt'), false)
  assert.equal(at('.env'), true)
  assert.equal(at('.env.local'), true)
  assert.equal(at('.env.example'), false)
  assert.equal(at('src/index.ts'), false)
  assert.equal(m(join(root, 'yarn.lock'), root).pattern, '*.lock')
})

test('home patterns match under the home directory, whatever the case on Windows', () => {
  const home = join(tmpdir(), 'Home Dir')
  const m = compilePatterns(['~/.ssh/', '~/.claude/.credentials.json', '**/secrets/*.txt'], { home })
  assert.equal(m(join(home, '.ssh', 'id_ed25519'), null).matched, true)
  assert.equal(m(join(home, '.claude', '.credentials.json'), null).matched, true)
  assert.equal(m(join(home, '.claude', 'settings.json'), null).matched, false)
  assert.equal(m(join(tmpdir(), 'r', 'a', 'secrets', 'k.txt'), join(tmpdir(), 'r')).matched, true)
  if (process.platform === 'win32') assert.equal(m(join(home, '.SSH', 'config').toUpperCase(), null).matched, true)
})

test('pattern files merge from the user and the project tools directories, in that order', () => {
  const user = scratch()
  const project = scratch()
  try {
    writeFileSync(join(user, 'read-size.base.txt'), '# comment\nnode_modules/\n\n*.lock\n')
    writeFileSync(join(project, 'read-size.web.txt'), '.next/\n*.lock\r\n')
    writeFileSync(join(project, 'read-size.txt'), 'ignored/\n')
    writeFileSync(join(project, 'model-allow.web.txt'), 'x opus\n')
    const { lines, files } = readPatternFiles('read-size', [user, project, user, join(user, 'missing')])
    assert.deepEqual(lines, ['node_modules/', '*.lock', '.next/'])
    assert.equal(files.length, 2)
  } finally {
    rmSync(user, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test('the user tools directory is the one hook-lib lives in', () => {
  assert.match(userToolsDir().replaceAll('\\', '/'), /base\/dotai\/tools$/)
})

test('nested config sections read three levels, quoted keys included', () => {
  const yaml = [
    'agents:',
    '  defaultEffort:',
    '    impeccable-manual-edit-applier: medium',
    '    "plug:other": low # why',
    '  other: 1',
    'godot:',
    '  reserveMb: 1',
  ].join('\n')
  assert.deepEqual(readSubsection(yaml, 'agents', 'defaultEffort'), { 'impeccable-manual-edit-applier': 'medium', 'plug:other': 'low' })
  assert.deepEqual(readSubsection(yaml, 'agents', 'missing'), {})
  assert.deepEqual(readSubsection('', 'agents', 'defaultEffort'), {})
})

test('frontmatter gives top-level keys and the claudecode block', () => {
  const md = '---\r\nname: explorer\r\nmodel: haiku\r\neffort: "medium"\r\nclaudecode:\r\n  effort: low\r\n---\r\nbody: no\r\n'
  const fm = frontmatter(md)
  assert.equal(fm.name, 'explorer')
  assert.equal(fm.effort, 'medium')
  assert.equal(fm.claudecode.effort, 'low')
  assert.deepEqual(frontmatter('no frontmatter'), { claudecode: {} })
})

test('a harness named on the command line wins; anything else is ignored', () => {
  assert.equal(harnessArg(['node', 'x', 'opencode']), 'opencode')
  assert.equal(harnessArg(['node', 'x', 'antigravity']), 'antigravity')
  assert.equal(harnessArg(['node', 'x', 'antigravity-cli']), 'antigravity')
  assert.equal(harnessArg(['node', 'x', 'claudecode']), 'claudecode')
  assert.equal(harnessArg(['node', 'x', 'bogus']), null)
  assert.equal(harnessArg(['node', 'x']), null)
})

test('an agy tool call without its own Cwd runs in the first workspace', async () => {
  const { parsePayload } = await import('../dotai/tools/hook-lib.mjs')
  const p = parsePayload(JSON.stringify({ toolCall: { name: 'view_file', args: { AbsolutePath: '/w/a' } }, workspacePaths: ['/w'] }))
  assert.equal(p.cwd, '/w')
  const q = parsePayload(JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: 'x', Cwd: '/c' } }, workspacePaths: ['/w'] }))
  assert.equal(q.cwd, '/c')
})

test('input redirection targets are kept as inspected words; heredocs and outputs are not', () => {
  const c = simpleCommands('base64 < .env')[0]
  assert.equal(c.name, 'base64')
  assert.deepEqual(c.args.map(t => t.u), [])
  assert.deepEqual(c.redirs.map(t => t.u), ['.env'])
  assert.deepEqual(simpleCommands('cat 0<secrets/.env.local')[0].redirs.map(t => t.u), ['secrets/.env.local'])
  assert.deepEqual(simpleCommands('sort -u <"my dir/.env" > out.txt')[0].redirs.map(t => t.u), ['my dir/.env'])
  assert.deepEqual(simpleCommands('cat <<EOF')[0].redirs, [])
  assert.deepEqual(simpleCommands('cat <<< "x"')[0].redirs, [])
  assert.deepEqual(simpleCommands('echo x > .env 2>&1')[0].redirs, [])
  assert.ok(names('diff <(cat .env) b').includes('cat'), 'a process substitution is a command, not a file')
  // The plain tokenizer still drops every redirection (the godot guard relies on it).
  assert.deepEqual(segments(tokenize('cat < .env').toks).map(s => s.map(t => t.v)), [['cat']])
})

test('deny lists: only the trusted directories may undo a pattern with !', () => {
  const user = scratch()
  const project = scratch()
  try {
    writeFileSync(join(user, 'deny-paths.base.txt'), '.env\n.env.*\n!.env.example\n')
    writeFileSync(join(project, 'deny-paths.web.txt'), '!.env\n!.env.local\nservice-account.json\n')
    const { lines } = readPatternFiles('deny-paths', [user, project], { trustedDirs: 1 })
    assert.deepEqual(lines, ['.env', '.env.*', '!.env.example', 'service-account.json'])
    const all = readPatternFiles('read-size', [user, project]).lines
    assert.deepEqual(all, [], 'other prefixes are unaffected')
  } finally {
    rmSync(user, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test('small shared helpers have one owner in hook-lib', async () => {
  const lib = await import('../dotai/tools/hook-lib.mjs')
  const core = await import('../dotai/tools/delegate-core.mjs')
  const guard = await import('../dotai/tools/agent-guard.mjs')
  assert.equal(lib.PACK, 'dotai-lartweib-pack')
  assert.deepEqual(lib.EFFORTS, ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.equal(core.EFFORTS, lib.EFFORTS)
  assert.equal(core.PACK, lib.PACK)
  assert.equal(guard.EFFORTS, lib.EFFORTS)
  assert.equal(core.packHome, lib.packHome)
  assert.equal(lib.isObject({}), true)
  assert.equal(lib.isObject([]), false)
  assert.equal(lib.isObject(null), false)
  assert.equal(lib.samePath(join(tmpdir(), 'a', '..', 'b'), join(tmpdir(), 'b')), true)
  assert.equal(lib.isInside(join(tmpdir(), 'b', 'c'), join(tmpdir(), 'b')), true)
  assert.equal(lib.isInside(join(tmpdir(), 'bc'), join(tmpdir(), 'b')), false)
  assert.equal(lib.packHome({ DOTAI_DELEGATE_HOME: 'X' }, 'H'), 'X')
  assert.equal(lib.packHome({}, join(tmpdir(), 'h')), join(tmpdir(), 'h', '.dotai', 'packs', 'dotai-lartweib-pack'))
})

test('hook errors are recorded in the pack home, capped, and taken once', async () => {
  const { recordHookError, takeHookError } = await import('../dotai/tools/hook-lib.mjs')
  const home = scratch()
  try {
    const env = { DOTAI_DELEGATE_HOME: join(home, 'pack home') }
    assert.equal(takeHookError(env), null)
    for (let i = 0; i < 60; i++) recordHookError('memory-compact', `reason ${i}`, env)
    const log = readFileSync(join(env.DOTAI_DELEGATE_HOME, 'hook-errors.log'), 'utf8').trim().split('\n')
    assert.ok(log.length <= 20, `${log.length} lines`)
    const last = takeHookError(env)
    assert.equal(last.tool, 'memory-compact')
    assert.equal(last.reason, 'reason 59')
    assert.equal(takeHookError(env), null, 'cleared once taken')
    recordHookError('x', 'line\nbreak', { DOTAI_DELEGATE_HOME: join(home, 'file', 'under', '\0bad') })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a .cmd shim gets every argument through cmd.exe exactly; line breaks become " / "', { skip: process.platform !== 'win32' }, async () => {
  const { cliInvocation, runCapped } = await import('../dotai/tools/hook-lib.mjs')
  const dir = scratch()
  try {
    const echo = join(dir, 'echo args.mjs')
    writeFileSync(echo, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n')
    const shim = join(dir, 'echo 100%.cmd')
    writeFileSync(shim, `@"${process.execPath}" "${echo}" %*\r\n`)
    const args = ['plain', 'a "quoted" b', '100% %PATH% !x!', 'a & b | c > d', 'caret ^ (paren)', 'trail\\','two\nlines']
    const inv = cliInvocation(shim, args)
    const r = await runCapped(inv.file, inv.args, { verbatim: inv.verbatim, timeoutMs: 20000 })
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(JSON.parse(r.stdout), [...args.slice(0, -1), 'two / lines'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the numeric settings warning says what a valid value is', async () => {
  const { numberSettings } = await import('../dotai/tools/hook-lib.mjs')
  const r = numberSettings({ a: -1 }, { a: 5 }, 'x')
  assert.doesNotMatch(r.warnings[0], /not a plain number/)
  assert.match(r.warnings[0], /x\.a .*"-1".*number of at least 0.*using 5/)
})
