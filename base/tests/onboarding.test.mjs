// Run: node --test base/tests/
// Onboarding is dotai's (dotai 0045, pack 0047): its generated dotai-profiles skill proposes
// profiles from each profile's description and hints, and its session-start hook says when. The
// pack keeps only the clash cleanup, and checks here what dotai validate cannot see.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = join(HERE, '..')
const ROOT = join(BASE, '..')
const read = (...p) => readFileSync(join(...p), 'utf8')

// The profiles block of dotai.yaml, read line by line: name, description and hints of each.
function profiles() {
  const lines = read(ROOT, 'dotai.yaml').split(/\r?\n/)
  const out = {}
  let inProfiles = false
  let cur
  for (const line of lines) {
    if (/^profiles:/.test(line)) inProfiles = true
    else if (/^\S/.test(line)) inProfiles = false
    if (!inProfiles) continue
    const name = /^  ([\w-]+):\s*$/.exec(line)
    if (name) out[(cur = name[1])] = { description: '', hints: null }
    const desc = /^    description:\s*(.+)$/.exec(line)
    if (desc && cur) out[cur].description = desc[1].trim()
    const hints = /^    hints:\s*\[([^\]]*)\]/.exec(line)
    if (hints && cur) out[cur].hints = hints[1].split(',').map(h => h.trim()).filter(Boolean)
  }
  return out
}

test('every profile has a description and its hints in the manifest', () => {
  const p = profiles()
  assert.ok(Object.keys(p).length >= 9, Object.keys(p).join(','))
  for (const [name, { description, hints }] of Object.entries(p)) {
    assert.ok(description.length >= 20, `${name}: a description the profiling skill can use`)
    assert.ok(description.length <= 200, `${name}: description short (${description.length})`)
    assert.ok(Array.isArray(hints), `${name}: hints`)
  }
})

test('hints are tracked paths path.Match can match: no node_modules, no **', () => {
  for (const [name, { hints }] of Object.entries(profiles())) {
    for (const h of hints) {
      assert.ok(!h.startsWith('node_modules/'), `${name}: ${h} is never in git ls-files`)
      assert.ok(!h.includes('**'), `${name}: ${h} (profile-hint-invalid)`)
    }
  }
  assert.doesNotMatch(read(ROOT, 'dotai.yaml'), /node_modules/)
})

test('a profile without hints says when to suggest it', () => {
  const p = profiles()
  for (const name of ['autonomous-orchestra', 'seo']) {
    assert.deepEqual(p[name].hints, [], name)
    assert.match(p[name].description, /suggest .*only when/i, name)
  }
})

test('the core rules carry no profile catalog: dotai-profiles lists the profiles', () => {
  const core = read(BASE, '.rulesync', 'rules', 'core.md')
  assert.doesNotMatch(core, /catalog/i)
  for (const name of Object.keys(profiles())) assert.ok(!core.includes(`\`${name}\``), name)
})

test('dotai-analyze is only the clash cleanup: no profile choice, apply or done marker', () => {
  const skill = read(BASE, '.rulesync', 'skills', 'dotai-analyze', 'SKILL.md')
  const detection = read(BASE, '.rulesync', 'skills', 'dotai-analyze', 'references', 'detection.md')
  assert.match(skill, /^name: dotai-analyze$/m)
  assert.doesNotMatch(skill, /^description:.*(onboard|suggest profiles|detect its stack)/im)
  for (const text of [skill, detection]) {
    assert.doesNotMatch(text, /onboarded\.json|done marker|sync mode/i)
    assert.doesNotMatch(text, /dotai apply/)
    assert.doesNotMatch(text, /node_modules\//)
  }
  assert.match(skill, /dotai-profiles/, 'points profile choice to the engine skill')
  assert.doesNotMatch(detection, /^## Stack to profile/m)
})
