// Run: node --test profiles/vercel/tests/
// The vercel profile is a rule, a pack-owned skill and read-size paths: CLI only, no MCP (P1,
// pack 0049). These checks keep it small and keep the approval rule in both files.
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

test('the manifest declares vercel with its path, a description and tracked-file hints', () => {
  const entry = manifestEntry()
  assert.match(entry, /^    path: profiles\/vercel$/m)
  const description = /^    description:\s*(.+)$/m.exec(entry)?.[1] ?? ''
  assert.match(description, /deployed on Vercel/i, 'says it is for apps deployed on Vercel')
  assert.match(description, /CLI/)
  assert.ok(description.length <= 200, `description short (${description.length})`)
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
  assert.match(text, /no Vercel MCP/i)
})

test('the skill is pack-owned, with a short description and the CLI workflow', () => {
  const text = read(PROFILE, '.rulesync', 'skills', 'vercel', 'SKILL.md')
  const fm = frontmatter(text)
  assert.match(fm, /^name: vercel$/m)
  const description = /^description:\s*"?(.+?)"?$/m.exec(fm)?.[1] ?? ''
  assert.ok(description.length >= 40 && description.length <= 200, `description ${description.length} chars`)
  assert.ok(text.length <= 4500, `skill ${text.length} chars`)
  for (const cmd of [
    'vercel link',
    'vercel env pull',
    'vercel env add',
    'vercel env ls',
    'vercel deploy',
    '--prod',
    'vercel logs',
    'vercel inspect',
    'vercel promote',
    'vercel rollback',
    'vercel pull',
    'vercel build',
    '--prebuilt',
    '--scope',
  ]) {
    assert.ok(text.includes(cmd), `covers ${cmd}`)
  }
  assert.match(text, /approv/i)
  assert.doesNotMatch(text, /mcp\.vercel\.com/)
  assert.ok(!existsSync(join(PROFILE, '.rulesync', 'skills', 'vercel', 'LICENSE')), 'pack-owned: no vendored license')
})

test('the profile ships no MCP server', () => {
  assert.ok(!existsSync(join(PROFILE, '.rulesync', 'mcp.jsonc')))
})

test('read-size paths keep .vercel/ out of whole reads', () => {
  const lines = read(PROFILE, 'dotai', 'tools', 'read-size.vercel.txt').split(/\r?\n/)
  assert.ok(lines.includes('.vercel/'))
})

test('the docs record the profile: ADR 0049, its index entry, a pointer in 0044, the READMEs', () => {
  const adr = read(ROOT, 'docs', 'decisions', '0049-vercel-profile.md')
  assert.match(adr, /^# 0049 · /m)
  assert.match(adr, /mcp\.vercel\.com/)
  assert.match(adr, /P1/)
  assert.match(read(ROOT, 'docs', 'decisions', 'README.md'), /\(0049-vercel-profile\.md\)/)
  assert.match(read(ROOT, 'docs', 'decisions', '0044-v1-profile-set.md'), /\(0049-vercel-profile\.md\)/)
  const readme = read(ROOT, 'README.md')
  assert.match(readme, /^\| `vercel` \|/m)
  assert.match(readme, /ten project profiles/)
  assert.match(readme, /FW\["<b>\[profile\]<\/b> Web<br\/>web · ui · seo · cloudflare · vercel"\]/)
  assert.match(read(ROOT, 'docs', 'DESIGN.md'), /^\| `vercel` \| \[profiles\/vercel\]/m)
  assert.ok(existsSync(join(PROFILE, 'README.md')))
})
