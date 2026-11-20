// Run: node --test profiles/vercel/tests/
// The vercel profile is a rule, a pack-owned skill and read-size paths: CLI only, no MCP (P1,
// pack 0049). These checks keep the always-on rule small, keep the approval rule in both files,
// and keep the profile wired in the manifest.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROFILE = join(HERE, '..')
const ROOT = join(PROFILE, '..', '..')
const read = (...p) => readFileSync(join(...p), 'utf8')

const frontmatter = text => /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
const body = text => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')

// The vercel entry of the manifest's profiles block.
function manifestEntry() {
  const lines = read(ROOT, 'dotai.yaml').split(/\r?\n/)
  const start = lines.findIndex(l => /^  vercel:\s*$/.test(l))
  assert.ok(start >= 0, 'dotai.yaml declares the vercel profile')
  const entry = []
  for (const line of lines.slice(start + 1)) {
    if (!/^    /.test(line)) break
    entry.push(line)
  }
  return entry.join('\n')
}

test('the manifest declares vercel with its path and tracked-file hints', () => {
  const entry = manifestEntry()
  assert.match(entry, /^    path: profiles\/vercel$/m)
  const hints = /^    hints:\s*\[([^\]]*)\]/m.exec(entry)?.[1].split(',').map(h => h.trim()) ?? []
  assert.deepEqual(hints, ['vercel.json', 'vercel.ts'])
})

test('the rule is small, always on, and needs approval for production and env changes', () => {
  const text = read(PROFILE, '.rulesync', 'rules', 'vercel.md')
  const fm = frontmatter(text)
  assert.match(fm, /^root: false$/m)
  assert.match(fm, /^targets: \["\*"\]$/m)
  assert.match(fm, /trigger: always_on/)
  assert.ok(body(text).length <= 900, `rule body ${body(text).length} chars`)
  assert.match(text, /--prod/)
  assert.match(text, /approv/i)
  assert.match(text, /vercel env/)
})

test('the skill keeps a short description and the approval rule', () => {
  const text = read(PROFILE, '.rulesync', 'skills', 'vercel', 'SKILL.md')
  const fm = frontmatter(text)
  assert.match(fm, /^name: vercel$/m)
  const description = /^description:\s*"?(.+?)"?$/m.exec(fm)?.[1] ?? ''
  assert.ok(description.length >= 40 && description.length <= 200, `description ${description.length} chars`)
  assert.match(text, /--prod/)
  assert.match(text, /approv/i)
})

test('the profile ships no MCP server', () => {
  assert.ok(!existsSync(join(PROFILE, '.rulesync', 'mcp.jsonc')))
})
