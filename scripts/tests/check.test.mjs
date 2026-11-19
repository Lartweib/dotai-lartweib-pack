// Run: node --test "scripts/tests/*.test.mjs"
// The pure parts of scripts/check.mjs: the git-pack tree check (dotai 0044), the privacy guard,
// the release tag check and the manifest reads. Sample paths and addresses are built by
// concatenation, so this file never matches the guard itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { checkTree, manifestVariants, manifestVersion, parseLsTree, privacyHits, tagProblems } from '../check.mjs'

const MiB = 1024 * 1024
const row = (mode, type, size, path) => `${mode} ${type} 0123456789abcdef0123456789abcdef01234567 ${String(size).padStart(7)}\t${path}`

test('parseLsTree reads `git ls-tree -r -l -z` records', () => {
  const out = [row('100644', 'blob', 12, 'a b.md'), row('120000', 'blob', 5, 'link'), row('160000', 'commit', '-', 'sub')].join('\0') + '\0'
  assert.deepEqual(parseLsTree(out), [
    { mode: '100644', type: 'blob', size: 12, path: 'a b.md' },
    { mode: '120000', type: 'blob', size: 5, path: 'link' },
    { mode: '160000', type: 'commit', size: 0, path: 'sub' },
  ])
  assert.deepEqual(parseLsTree(''), [])
})

test('checkTree passes a plain tree', () => {
  assert.deepEqual(checkTree([{ mode: '100644', type: 'blob', size: 10, path: 'base/x.md' }, { mode: '100755', type: 'blob', size: 10, path: 'run.sh' }]), [])
})

test('checkTree refuses links, submodules and .git path components', () => {
  const problems = checkTree([
    { mode: '120000', type: 'blob', size: 4, path: 'base/link' },
    { mode: '160000', type: 'commit', size: 0, path: 'vendor/sub' },
    { mode: '100644', type: 'blob', size: 1, path: 'x/.git/config' },
    { mode: '100644', type: 'blob', size: 1, path: '.GIT' },
    { mode: '100644', type: 'blob', size: 1, path: 'docs/.github-notes.md' },
  ])
  assert.equal(problems.length, 4)
  assert.match(problems[0], /symbolic link: base\/link/)
  assert.match(problems[1], /submodule: vendor\/sub/)
  assert.match(problems[2], /\.git path: x\/\.git\/config/)
  assert.match(problems[3], /\.git path: \.GIT/)
})

test('checkTree enforces the copy bounds: 10,000 files and 64 MiB', () => {
  const files = n => Array.from({ length: n }, (_, i) => ({ mode: '100644', type: 'blob', size: 1, path: `f${i}` }))
  assert.deepEqual(checkTree(files(10000)), [])
  assert.match(checkTree(files(10001))[0], /10001 files, over 10000/)
  assert.deepEqual(checkTree([{ mode: '100644', type: 'blob', size: 64 * MiB, path: 'big' }]), [])
  assert.match(checkTree([{ mode: '100644', type: 'blob', size: 64 * MiB + 1, path: 'big' }])[0], /over 64 MiB/)
})

const winHome = 'C:' + '\\' + 'Users' + '\\' + 'someone'
const msysHome = '/c' + '/Users/someone'
const mail = (user, domain) => user + '@' + domain

test('privacyHits finds Windows and MSYS home paths, with file and line', () => {
  const hits = privacyHits([{ path: 'a.md', text: `ok\nsee ${winHome}\\x and ${msysHome}/y\n` }])
  assert.deepEqual(hits.map(h => [h.path, h.line, h.pattern]), [
    ['a.md', 2, 'windows-home'],
    ['a.md', 2, 'msys-home'],
  ])
})

test('privacyHits matches a JSON-escaped Windows home and any drive letter', () => {
  const escaped = 'D:' + '\\\\' + 'Users' + '\\\\' + 'x'
  assert.equal(privacyHits([{ path: 'a.json', text: escaped }])[0]?.pattern, 'windows-home')
})

test('privacyHits finds email addresses but allows noreply and git@github.com', () => {
  const text = [mail('ana', 'mail.test.org'), mail('123+bot', 'users.noreply.github.com'), mail('git', 'github.com') + ':o/r', mail('noreply', 'anthropic.com'), 'agent-browser' + '@0.41.2', '@scope' + '/pkg'].join('\n')
  const hits = privacyHits([{ path: 'm.md', text }])
  assert.deepEqual(hits.map(h => [h.line, h.pattern]), [[1, 'email']])
})

test('privacyHits allows the reserved example domains (RFC 2606) only', () => {
  const text = [mail('t', 'example.com'), mail('a', 'mail.example.org'), mail('b', 'example.net'), mail('c', 'myexample.com'), mail('d', 'example.com.evil.io')].join('\n')
  const hits = privacyHits([{ path: 'e.md', text }])
  assert.deepEqual(hits.map(h => h.line), [4, 5])
})

test('privacyHits takes extra terms, case-insensitive, and reports each line once per pattern', () => {
  const hits = privacyHits([{ path: 'n.txt', text: 'Zed and zed\nnone\nZED' }], { terms: ['zed'] })
  assert.deepEqual(hits.map(h => [h.line, h.pattern]), [[1, 'term'], [3, 'term']])
  assert.deepEqual(privacyHits([{ path: 'n.txt', text: 'zed' }], { terms: [''] }), [])
})

test('privacyHits skips binary files', () => {
  const hits = privacyHits([{ path: 'b.png', text: 'x\0' + winHome }])
  assert.deepEqual(hits, [])
})

test('tagProblems: a v* tag on HEAD must equal the manifest version', () => {
  assert.deepEqual(tagProblems([], '0.1.0'), [])
  assert.deepEqual(tagProblems(['v0.1.0', 'other'], '0.1.0'), [])
  assert.match(tagProblems(['v0.2.0'], '0.1.0')[0], /v0\.2\.0.*0\.1\.0/)
  assert.match(tagProblems(['v0.1.0'], null)[0], /no version/)
})

test('manifest reads: version and variant names from dotai.yaml', () => {
  const y = 'schema: x\nversion: 1.2.3 # c\nprofiles:\n  web:\n    path: p\nvariants:\n  standalone:\n    path: a\n    default: true\n  orca:\n    path: b\n    detect: { command: orca }\n'
  assert.equal(manifestVersion(y), '1.2.3')
  assert.equal(manifestVersion('name: x\n'), null)
  assert.deepEqual(manifestVariants(y), ['standalone', 'orca'])
  assert.deepEqual(manifestVariants('name: x\n'), [])
})

test('dotai.yaml: rulesync 43.9.2 and the harness fields of dotai 0047', () => {
  // The engine embeds the checksums of one rulesync (43.9.2) and removed `optional-harnesses`:
  // `harnesses` lists the compatible ones, `requires` the subset an install cannot do without.
  // OpenCode is a preview harness, managed only when chosen, so it is compatible, never required.
  const y = readFileSync(new URL('../../dotai.yaml', import.meta.url), 'utf8')
  const field = k => new RegExp(`^${k}:\\s*(.*?)\\s*(#.*)?$`, 'm').exec(y)?.[1]
  const list = k => (field(k) ?? '').replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean)
  assert.equal(field('rulesync'), '43.9.2')
  assert.equal(field('optional-harnesses'), undefined)
  assert.deepEqual(list('harnesses'), ['claudecode', 'antigravity-cli', 'opencode'])
  assert.deepEqual(list('requires'), ['claudecode', 'antigravity-cli'])
})
