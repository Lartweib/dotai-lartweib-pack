// Stop hook: typecheck once per turn when web files changed (principle P2).
// Runs `astro check` in Astro projects, `tsc --noEmit` where there is a tsconfig (build mode
// when it has references, as in Vite), or the
// command in .dotai/config.yaml (web.check; "off" disables). Output capped at 20 lines.
// Skips a second stop in the same turn and a tree already checked in this state.
//   web:
//     check: pnpm run check
//     checkTimeoutSec: 120      # clamped to MAX_CHECK_SEC, under the hook's own timeout
// Trust: web.check runs through the shell. It comes only from .dotai/config.yaml, which is
// local (never committed), written by onboarding or the user, and read only inside the project.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// The hook lib is a base tool, installed at user scope. Staging writes the user tools
// directory into TOOLS (PACK-FORMAT, 0030); from the pack source, as in the tests, the
// placeholder is still there and the base layer's copy is used. A missing lib is reported
// (stderr, exit 1: Claude Code shows it and goes on) instead of passing silently.
const TOOLS = '${DOTAI_TOOLS}'
const LIB = TOOLS.startsWith('$')
  ? new URL('../../../../base/dotai/tools/hook-lib.mjs', import.meta.url)
  : pathToFileURL(`${TOOLS}/hook-lib.mjs`)
let lib
try {
  lib = await import(LIB.href)
} catch (e) {
  process.stderr.write(`web check: cannot load hook-lib.mjs from ${LIB.href} (${e.code || e.message}); no typecheck until the base pack is reinstalled.\n`)
  process.exit(1)
}
const { capOutput, loadSection, parsePayload, readStdin, runCapped } = lib

const WEB_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|astro|vue|svelte)$/i
const ASTRO = ['astro.config.mjs', 'astro.config.ts', 'astro.config.js', 'astro.config.cjs', 'astro.config.mts']
const DEFAULT_CHECK_SEC = 120
// The stop hook's timeout is 180 s (.rulesync/hooks.jsonc); the check must end before it, with
// room for git and node, or the harness kills the hook and the errors are lost.
export const MAX_CHECK_SEC = 160

// tsconfig is JSONC: drops comments and trailing commas outside strings, then parses.
function parseJsonc(text) {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      const end = /"(?:[^"\\]|\\.)*"/y
      end.lastIndex = i
      const m = end.exec(text)
      if (!m) return null
      out += m[0]
      i += m[0].length - 1
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2)
      if (i < 0) return null
      i++
    } else out += c
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
  } catch {
    return null
  }
}

// Reference paths go into a shell command, so only plain path characters pass.
const SAFE_PATH = /^[\w./@-]+$/

export function tsReferences(text) {
  const cfg = text ? parseJsonc(text) : null
  if (!cfg || !Array.isArray(cfg.references)) return []
  return cfg.references.map(r => r?.path).filter(p => typeof p === 'string' && SAFE_PATH.test(p))
}

// `tsc -b` rejects --noEmit before TypeScript 5.6 (TS5094, measured on 5.4.5 and 5.5.4).
export function buildAcceptsNoEmit(version) {
  const m = /^(\d+)\.(\d+)/.exec(String(version ?? ''))
  return !!m && (Number(m[1]) > 5 || (Number(m[1]) === 5 && Number(m[2]) >= 6))
}

// A root tsconfig with references (Vite: `files: []`) checks nothing under `tsc --noEmit`.
// Build mode checks every referenced project; it writes only .tsbuildinfo files. Before 5.6,
// or with an unknown version, the first app config (not the `node` one) is checked instead.
function typecheck(read, tsVersion) {
  const refs = tsReferences(read('tsconfig.json'))
  if (!refs.length) return 'npx --no-install tsc --noEmit'
  if (buildAcceptsNoEmit(tsVersion())) return 'npx --no-install tsc -b --noEmit'
  const app = refs.find(p => !/node/i.test(p.split('/').pop())) ?? refs[0]
  return `npx --no-install tsc -p ${app} --noEmit`
}

export function pickCheck(cfg, exists, read = () => null, tsVersion = () => null) {
  if (typeof cfg.check === 'string' && cfg.check.trim()) {
    return cfg.check.trim() === 'off' ? null : { cmd: cfg.check.trim() }
  }
  if (ASTRO.some(exists)) return { cmd: 'npx --no-install astro check' }
  if (exists('tsconfig.json')) return { cmd: typecheck(read, tsVersion) }
  return null
}

export function checkTimeoutMs(cfg) {
  const sec = typeof cfg.checkTimeoutSec === 'number' && cfg.checkTimeoutSec > 0 ? cfg.checkTimeoutSec : DEFAULT_CHECK_SEC
  return Math.min(sec, MAX_CHECK_SEC) * 1000
}

// deps: { exists, changed, fingerprint, stamp: {get,set}, run } (injected for tests)
export async function decideStop(payload, cfg, deps) {
  if (payload?.stop_hook_active) return null
  const check = pickCheck(cfg, deps.exists, deps.read ?? (() => null), deps.tsVersion ?? (() => null))
  if (!check) return null
  const files = deps.changed().filter(f => WEB_FILE.test(f))
  if (!files.length) return null
  const fp = deps.fingerprint(files)
  if (deps.stamp.get() === fp) return null
  const r = await deps.run(check.cmd, checkTimeoutMs(cfg))
  deps.stamp.set(fp)
  if (r.code === 0) return null
  const what = check.cmd.replace(/^npx --no-install /, '')
  return { reason: `web check: ${what} failed. Fix these, then finish:\n${capOutput(r.out, 20)}` }
}

function packageRoot(start) {
  let dir = resolve(start)
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const up = dirname(dir)
    if (up === dir) return resolve(start)
    dir = up
  }
}

// `git status --porcelain -z` paths are relative to the repository root, not to the current
// directory. Joins them to `toplevel` and keeps those under `root`, relative to it (forward
// slashes). Renames list the new path first and the old one as the next entry.
export function parsePorcelain(z, toplevel, root) {
  const out = []
  const entries = String(z).split('\0')
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.length < 4) continue
    if (/^[RC]/.test(e)) i++
    const rel = relative(root, resolve(toplevel, e.slice(3)))
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) out.push(rel.replace(/\\/g, '/'))
  }
  return out
}

export function changedFiles(root) {
  const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true })
  const top = git(['rev-parse', '--show-toplevel'])
  if (top.status !== 0) return []
  const st = git(['status', '--porcelain', '-z', '-uall'])
  if (st.status !== 0) return []
  return parsePorcelain(st.stdout, top.stdout.trim(), root)
}

export function realDeps(root) {
  const stampFile = join(tmpdir(), `dotai-web-check-${createHash('sha1').update(root).digest('hex').slice(0, 12)}`)
  return {
    exists: f => existsSync(join(root, f)),
    read(f) {
      try {
        return readFileSync(join(root, f), 'utf8')
      } catch {
        return null
      }
    },
    // Resolved like node does from the package, so a hoisted monorepo copy is found too.
    tsVersion() {
      try {
        const pkg = createRequire(join(root, 'package.json')).resolve('typescript/package.json')
        return JSON.parse(readFileSync(pkg, 'utf8')).version ?? null
      } catch {
        return null
      }
    },
    changed: () => changedFiles(root),
    fingerprint(files) {
      const h = createHash('sha1')
      for (const f of files.sort()) {
        let m = 'gone'
        try {
          m = String(statSync(join(root, f)).mtimeMs)
        } catch {}
        h.update(`${f}\0${m}\n`)
      }
      return h.digest('hex')
    },
    stamp: {
      get: () => {
        try {
          return readFileSync(stampFile, 'utf8')
        } catch {
          return null
        }
      },
      set: v => {
        try {
          writeFileSync(stampFile, v)
        } catch {}
      },
    },
    async run(cmd, timeoutMs) {
      const r = await runCapped(cmd, [], { cwd: root, shell: true, timeoutMs })
      if (r.timedOut) return { code: 1, out: `${r.out}\ntimed out after ${timeoutMs / 1000} s (web.checkTimeoutSec)` }
      if (r.error) return { code: 1, out: `could not finish: ${r.error}` }
      return { code: r.code ?? 1, out: r.out }
    },
  }
}

async function main() {
  const parsed = parsePayload(await readStdin())
  const root = packageRoot(parsed.cwd)
  let r = null
  try {
    r = await decideStop(parsed.payload, loadSection(root, 'web'), realDeps(root))
  } catch {
    r = null
  }
  if (!r) return
  // Claude Code (and OpenCode via rulesync) read {decision: "block"} on Stop.
  // agy 1.5.3 honors the same JSON on Stop (trial 2026-11-19); its payload has no
  // stop_hook_active, so there the stamp alone ends the loop.
  process.stdout.write(JSON.stringify({ decision: 'block', reason: r.reason }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
