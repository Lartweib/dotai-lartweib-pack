#!/usr/bin/env node
// The pack's checks, run before each pull request and by CI (pack 0048). No dependencies.
//   node scripts/check.mjs
// One line per check: tests, `dotai validate --json` per variant, the git-pack tree check of
// dotai 0044, the privacy guard over tracked files, and the release tag check when HEAD has a
// `v*` tag. Exits 1 when any check fails; a check that cannot run says why and is skipped.
// The dotai binary is $DOTAI, else `dotai` on PATH.
// Privacy guard terms: $DOTAI_PRIVACY_TERMS (comma-separated), plus the local user name outside
// CI, so no personal name is written in this file.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MiB = 1024 * 1024
export const BOUNDS = Object.freeze({ files: 10000, bytes: 64 * MiB }) // dotai 0044: bounds of a pack copy
const TEST_TIMEOUT_MS = 240_000

// ------------------------------------------------------------------ tree check (dotai 0044)

// `git ls-tree -r -l -z <commit>`: "<mode> <type> <object> <size>\t<path>" records ending in NUL.
export function parseLsTree(out) {
  const entries = []
  for (const rec of String(out).split('\0')) {
    const m = /^(\d+) (\w+) [0-9a-f]+ +(-|\d+)\t(.*)$/s.exec(rec)
    if (m) entries.push({ mode: m[1], type: m[2], size: m[3] === '-' ? 0 : Number(m[3]), path: m[4] })
  }
  return entries
}

// What `dotai pack add` refuses before validating: links, submodules, a `.git` path component,
// and a tree over the copy bounds.
export function checkTree(entries, bounds = BOUNDS) {
  const problems = []
  let bytes = 0
  for (const e of entries) {
    if (e.mode === '120000') problems.push(`symbolic link: ${e.path}`)
    else if (e.mode === '160000') problems.push(`submodule: ${e.path}`)
    else if (e.path.split('/').some(c => c.toLowerCase() === '.git')) problems.push(`.git path: ${e.path}`)
    bytes += e.size
  }
  if (entries.length > bounds.files) problems.push(`${entries.length} files, over ${bounds.files}`)
  if (bytes > bounds.bytes) problems.push(`${(bytes / MiB).toFixed(1)} MiB, over ${bounds.bytes / MiB} MiB`)
  return problems
}

// ------------------------------------------------------------------ privacy guard

// Each pattern is built so its own source text does not match it.
const PATTERNS = [
  ['windows-home', new RegExp('[A-Za-z]:(\\\\){1,2}' + 'Users' + '(\\\\){1,2}', 'i')],
  ['msys-home', new RegExp('/[a-z]/' + 'Users/', 'i')],
]
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
// Addresses that name no person: GitHub's noreply forms, any noreply sender, and the SSH user of
// a GitHub URL, and the domains RFC 2606 reserves for examples.
const EMAIL_ALLOWED = [/noreply/i, /^git@github\.com$/i, /@([a-z0-9-]+\.)*example\.(com|org|net)$/i]

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// files: [{ path, text }]. Returns [{ path, line, pattern, excerpt }], one per line and pattern.
// A file holding a NUL byte is binary and is skipped.
export function privacyHits(files, { terms = [] } = {}) {
  const patterns = [...PATTERNS]
  const words = terms.map(t => String(t).trim()).filter(Boolean)
  if (words.length) patterns.push(['term', new RegExp(words.map(escapeRe).join('|'), 'i')])
  const hits = []
  for (const { path, text } of files) {
    if (String(text).includes('\0')) continue
    String(text)
      .split(/\r?\n/)
      .forEach((line, i) => {
        const at = (pattern, excerpt) => hits.push({ path, line: i + 1, pattern, excerpt: excerpt.slice(0, 120) })
        for (const [name, re] of patterns) if (re.test(line)) at(name, line.trim())
        const mails = (line.match(EMAIL) ?? []).filter(m => !EMAIL_ALLOWED.some(a => a.test(m)))
        if (mails.length) at('email', mails.join(' '))
      })
  }
  // Same order as the line: path patterns, then terms, then email.
  return hits
}

// ------------------------------------------------------------------ manifest and tag

export function manifestVersion(yaml) {
  const m = /^version:\s*["']?([^\s"'#]+)/m.exec(String(yaml))
  return m ? m[1] : null
}

// The keys of the top-level `variants:` map.
export function manifestVariants(yaml) {
  const out = []
  let inside = false
  for (const line of String(yaml).split(/\r?\n/)) {
    if (/^\S/.test(line)) inside = /^variants:\s*(#.*)?$/.test(line)
    else if (inside) {
      const m = /^ {2}([A-Za-z0-9][\w-]*):\s*(#.*)?$/.exec(line)
      if (m) out.push(m[1])
    }
  }
  return out
}

// tags: the tags on HEAD. Only `v*` tags count; each must be `v<version>`.
export function tagProblems(tags, version) {
  const release = tags.filter(t => /^v\d/.test(t))
  if (!release.length) return []
  if (!version) return [`HEAD is tagged ${release.join(', ')} but dotai.yaml has no version`]
  return release.filter(t => t !== `v${version}`).map(t => `tag ${t} does not match dotai.yaml version ${version} (expected v${version})`)
}

// ------------------------------------------------------------------ runner

// node --test TAP output: each `not ok` line with its `error:` and the first `stack:` frame from
// the YAML block under it, at most maxLines lines per failure.
export function tapFailures(out, maxLines = 15) {
  const lines = String(out).split(/\r?\n/)
  const failures = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^( *)not ok \d+ - /.exec(lines[i])
    if (!m) continue
    const ind = `${m[1]}  `
    const details = []
    if (lines[i + 1] === `${ind}---`) {
      for (let j = i + 2; j < lines.length && lines[j] !== `${ind}...`; j++) {
        if (!lines[j].startsWith(ind) || lines[j][ind.length] === ' ') continue
        const f = /^(error|stack): ?(.*)$/.exec(lines[j].slice(ind.length))
        if (!f) continue
        const deeper = `${ind}  `
        const block = f[2] && !f[2].startsWith('|') ? [f[2]] : []
        for (let k = j + 1; k < lines.length && lines[k].startsWith(deeper); k++) block.push(lines[k].slice(deeper.length))
        details.push(...(f[1] === 'stack' ? block.slice(0, 1).map(s => `at ${s}`) : block))
      }
    }
    failures.push({ line: lines[i].trim(), details: details.filter(l => l.trim()).slice(0, maxLines) })
  }
  return failures
}

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * MiB, windowsHide: true, ...opts })

function git(root, args) {
  const r = run('git', ['-C', root, ...args])
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.error?.message ?? r.stderr.trim()}`)
  return r.stdout
}

function checkTests(root) {
  const r = run(process.execPath, ['--test', '--test-concurrency=2'], { cwd: root, timeout: TEST_TIMEOUT_MS, killSignal: 'SIGKILL' })
  const count = k => Number(new RegExp(`^# ${k} (\\d+)`, 'm').exec(r.stdout ?? '')?.[1] ?? NaN)
  if (r.error?.code === 'ETIMEDOUT') return { status: 'fail', text: `tests: timed out after ${TEST_TIMEOUT_MS / 1000} s` }
  if (r.error) return { status: 'fail', text: `tests: ${r.error.message}` }
  const summary = `${count('tests')} tests, ${count('pass')} pass, ${count('fail')} fail`
  if (r.status === 0) return { status: 'ok', text: `tests: ${summary}` }
  const failed = tapFailures(r.stdout ?? '').slice(0, 20)
  return { status: 'fail', text: `tests: ${summary}`, details: failed.flatMap(f => [f.line, ...f.details.map(d => `  ${d}`)]) }
}

function dotaiBinary(env = process.env) {
  const bin = env.DOTAI || 'dotai'
  const r = run(bin, ['version', '--json'])
  return r.error || r.status !== 0 ? null : bin
}

function checkValidate(root, bin, variant) {
  const r = run(bin, ['validate', root, '--variant', variant, '--json'], { timeout: 120_000 })
  let j
  try {
    j = JSON.parse(r.stdout)
  } catch {
    return { status: 'fail', text: `validate ${variant}: no JSON (exit ${r.status}) ${String(r.stderr).trim().slice(0, 200)}` }
  }
  const diags = j.data?.diagnostics ?? []
  const warns = j.data?.warnings ?? []
  const fmt = d => `${d.code} ${d.file}:${d.line} ${d.message ?? ''}`.trim()
  if (!j.ok || diags.length) {
    return { status: 'fail', text: `validate ${variant}: ${diags.length} diagnostics${j.error ? `, ${j.error.code}: ${j.error.message}` : ''}`, details: diags.map(fmt) }
  }
  return { status: 'ok', text: `validate ${variant}: valid, ${warns.length} warnings`, details: warns.map(d => `warning ${fmt(d)}`) }
}

function privacyTerms(env = process.env) {
  const terms = String(env.DOTAI_PRIVACY_TERMS ?? '').split(',')
  if (!env.CI) {
    try {
      terms.push(userInfo().username)
    } catch {}
  }
  return terms.map(t => t.trim()).filter(t => t.length >= 3)
}

export async function main(root = join(dirname(fileURLToPath(import.meta.url)), '..'), env = process.env) {
  const results = []
  const add = (name, fn) => {
    try {
      results.push(fn())
    } catch (e) {
      results.push({ status: 'fail', text: `${name}: ${e.message}` })
    }
  }
  const manifest = readFileSync(join(root, 'dotai.yaml'), 'utf8')

  add('tests', () => checkTests(root))

  const bin = dotaiBinary(env)
  const variants = manifestVariants(manifest)
  if (!bin) results.push({ status: 'skip', text: `validate: no dotai binary (set DOTAI or put dotai on PATH); ${variants.join(', ')} not validated` })
  else for (const v of variants) add(`validate ${v}`, () => checkValidate(root, bin, v))

  add('tree', () => {
    const entries = parseLsTree(git(root, ['ls-tree', '-r', '-l', '-z', 'HEAD']))
    const problems = checkTree(entries)
    const mib = (entries.reduce((n, e) => n + e.size, 0) / MiB).toFixed(1)
    return problems.length
      ? { status: 'fail', text: `tree: ${problems.length} problems in HEAD`, details: problems }
      : { status: 'ok', text: `tree: HEAD has ${entries.length} files, ${mib} MiB, no links, submodules or .git paths` }
  })

  add('privacy', () => {
    const paths = git(root, ['ls-files', '-z']).split('\0').filter(Boolean)
    const files = []
    for (const path of paths) {
      try {
        files.push({ path, text: readFileSync(join(root, path), 'latin1') })
      } catch {} // listed but deleted in the working tree
    }
    const hits = privacyHits(files, { terms: privacyTerms(env) })
    if (!hits.length) return { status: 'ok', text: `privacy: ${files.length} tracked files, no hits` }
    const byFile = new Map()
    for (const h of hits) byFile.set(h.path, (byFile.get(h.path) ?? 0) + 1)
    return {
      status: 'fail',
      text: `privacy: ${hits.length} hits in ${byFile.size} of ${files.length} tracked files`,
      details: hits.map(h => `${h.path}:${h.line} ${h.pattern}`),
    }
  })

  add('tag', () => {
    const tags = git(root, ['tag', '--points-at', 'HEAD']).split(/\r?\n/).filter(Boolean)
    const problems = tagProblems(tags, manifestVersion(manifest))
    if (problems.length) return { status: 'fail', text: `tag: ${problems.join('; ')}` }
    const release = tags.filter(t => /^v\d/.test(t))
    return release.length ? { status: 'ok', text: `tag: ${release.join(', ')} matches dotai.yaml` } : { status: 'skip', text: 'tag: HEAD has no v* tag' }
  })

  const label = { ok: 'ok  ', fail: 'FAIL', skip: 'skip' }
  for (const r of results) {
    console.log(`${label[r.status]} ${r.text}`)
    for (const d of r.details ?? []) console.log(`       ${d}`)
  }
  return results.some(r => r.status === 'fail') ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main()
}
