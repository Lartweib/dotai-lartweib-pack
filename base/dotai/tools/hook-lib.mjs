// Shared helpers for the profiles' hooks: payload parsing, decision output, config, capped runs.
// No dependencies. A base tool, so it installs once at user scope (~/.dotai/tools/). Profile
// tools at project scope import it through the user tools directory (dotai engine answer
// 2026-11-02 to build question 4); one owner, no copies per profile.
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

// ------------------------------------------------------------------ shared constants

export const PACK = 'dotai-lartweib-pack'
// The effort levels every harness here accepts (Claude Code agent definitions, agy --effort,
// OpenCode #variant); the delegate contract and the agent guard both read this one list.
export const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])

// The pack's user-scope state directory: launch log, quota state, delegate.yaml, hook errors.
export function packHome(env = process.env, home = homedir()) {
  return env.DOTAI_DELEGATE_HOME || join(home, '.dotai', 'packs', PACK)
}

// Reads the hook payload. A harness that never closes the pipe must not hang the hook, so the
// read gives up after `idleMs` without data and returns what it has (usually nothing).
export function readStdin(stream = process.stdin, idleMs = 2000) {
  if (stream.isTTY) return Promise.resolve('')
  return new Promise(done => {
    let raw = ''
    let timer = null
    const finish = () => {
      clearTimeout(timer)
      stream.off('data', onData)
      stream.off('end', finish)
      stream.off('error', finish)
      stream.pause?.()
      if (stream === process.stdin) stream.destroy?.()
      done(raw.replace(/^﻿/, ''))
    }
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(finish, idleMs)
    }
    const onData = chunk => {
      raw += chunk
      arm()
    }
    stream.setEncoding?.('utf8')
    stream.on('data', onData)
    stream.on('end', finish)
    stream.on('error', finish)
    arm()
  })
}

export const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

// Normalizes the PreToolUse payloads of the three harnesses.
// Claude Code: { tool_name: "Bash" | "PowerShell", tool_input: { command }, cwd }. The
//   PowerShell tool exists in Claude Code on Windows; hooks matching "PowerShell" fire on it
//   (community-confirmed, not in the hooks reference yet).
// OpenCode (rulesync plugin): same shape, tool name "bash" (2.0.30), or "shell", which the
//   rulesync plugin also matches as "bash"
// agy: { toolCall: { name: "run_command", args: { CommandLine, Cwd } }, ... } (agy 1.4.12 hooks
//   docs; TODO(trial): confirm at runtime)
export function parsePayload(raw) {
  let p = {}
  try {
    p = raw ? JSON.parse(raw) : {}
  } catch {
    p = {}
  }
  if (!isObject(p)) p = {}
  if (isObject(p.toolCall)) {
    const a = isObject(p.toolCall.args) ? p.toolCall.args : {}
    return {
      harness: 'antigravity',
      tool: String(p.toolCall.name ?? ''),
      command: String(a.CommandLine ?? a.commandLine ?? a.command ?? a.Command ?? ''),
      // A tool call without its own Cwd (agy's file tools) runs in the first workspace.
      cwd: String(a.Cwd ?? a.cwd ?? p.cwd ?? (Array.isArray(p.workspacePaths) ? p.workspacePaths[0] : undefined) ?? process.cwd()),
      payload: p,
    }
  }
  // agy events without a tool call (SessionStart, Stop) carry only its common fields
  // (conversationId, workspacePaths, ...; agy 1.4.12 hooks docs), and no cwd.
  if (typeof p.conversationId === 'string' || Array.isArray(p.workspacePaths)) {
    const ws = Array.isArray(p.workspacePaths) ? p.workspacePaths[0] : undefined
    return { harness: 'antigravity', tool: '', command: '', cwd: String(ws ?? p.cwd ?? process.cwd()), payload: p }
  }
  const tool = String(p.tool_name ?? '')
  const input = isObject(p.tool_input) ? p.tool_input : {}
  return {
    harness: /^(bash|shell)$/.test(tool) ? 'opencode' : 'claudecode',
    tool,
    command: String(input.command ?? input.cmd ?? ''),
    cwd: String(p.cwd ?? process.cwd()),
    payload: p,
  }
}

// Which shell will run the command: 'posix', 'powershell' or 'windows' (cmd, or PowerShell
// behind a tool that does not say so). Claude Code's Bash tool runs Git Bash on Windows; for the
// other harnesses on Windows the environment decides (TODO(trial): OpenCode's and agy's shell).
export function shellKind(parsed, env = process.env, platform = process.platform) {
  if (/^powershell$/i.test(parsed.tool ?? '')) return 'powershell'
  if (platform !== 'win32') return 'posix'
  if (parsed.harness === 'claudecode') return 'posix'
  if (env.MSYSTEM || /(^|[\\/])(ba|z|da)?sh(\.exe)?$/i.test(env.SHELL ?? '')) return 'posix'
  return 'windows'
}

const OPENCODE_ASK =
  "OpenCode cannot ask, so it is refused. If the user asked for this, they can run it themselves, or allow it in OpenCode's permission config."

// decision: null (no opinion), 'ask' or 'deny'. Returns the text to print on stdout; no
// decision prints nothing in every harness, so each keeps its own permission mode.
export function formatPreToolUse(harness, decision, reason) {
  if (!decision) return ''
  if (harness === 'antigravity') return JSON.stringify({ decision, reason })
  // OpenCode's rulesync plugin only understands deny; an ask there would run unasked.
  const rewritten = harness === 'opencode' && decision === 'ask'
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: rewritten ? 'deny' : decision,
      permissionDecisionReason: rewritten ? `${reason} ${OPENCODE_ASK}` : reason,
    },
  })
}

// SessionStart context. Claude Code and OpenCode add plain stdout to the context; agy drops
// plain text (logged as a protojson parse error) and takes only injectSteps JSON (agy 1.4.12
// hooks docs; HARNESS-NOTES, agy SessionStart output). Empty text prints nothing.
export function formatSessionStart(harness, text) {
  if (!text) return ''
  if (harness === 'antigravity') return JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: text } }] })
  return `${text}\n`
}

// Resolved, without a trailing separator (a root keeps its own), and on Windows with one
// separator style and no case, as the file system compares them there.
const pathKey = p => {
  let r = resolve(p)
  if (dirname(r) !== r) r = r.replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? r.replaceAll('/', '\\').toLowerCase() : r
}
export const samePath = (a, b) => pathKey(a) === pathKey(b)
// Whether `dir` is `root` or below it (lexically; callers resolve links first when it matters).
export const isInside = (dir, root) => {
  const rel = relative(pathKey(root), pathKey(dir))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
const inside = isInside

// The project root that bounds the config walk, in order: the harness's project dir when it
// contains `start` (Claude Code sets CLAUDE_PROJECT_DIR); else the nearest directory with
// `.git`; else the nearest with `.dotai/` (the engine applies outside git too). The search never
// reaches the home directory (unless it starts there) and ends at the drive root.
export function projectRootOf(start, env = process.env, home = homedir()) {
  const from = resolve(start || '.')
  const fromEnv = env.CLAUDE_PROJECT_DIR ? resolve(env.CLAUDE_PROJECT_DIR) : null
  if (fromEnv && inside(from, fromEnv)) return fromEnv
  const homeDir = resolve(home)
  const ancestors = []
  for (let dir = from; ; ) {
    if (samePath(dir, homeDir) && !samePath(dir, from)) break
    ancestors.push(dir)
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return ancestors.find(d => existsSync(join(d, '.git'))) ?? ancestors.find(d => existsSync(join(d, '.dotai'))) ?? null
}

// Finds the nearest .dotai/config.yaml from `start` up to the project root, never above it: a
// config in a parent directory belongs to someone else. With no root, only `start` is read.
export function findConfig(start, env = process.env, home = homedir()) {
  let dir = resolve(start || '.')
  const root = projectRootOf(dir, env, home) ?? dir
  for (;;) {
    const f = join(dir, '.dotai', 'config.yaml')
    if (existsSync(f)) return f
    const up = dirname(dir)
    if (samePath(dir, root) || up === dir) return null
    dir = up
  }
}

// Reads one section of .dotai/config.yaml. Supports the flat two-level subset only:
//   godot:
//     reserveMb: 4096
// Plain decimal numbers (4096, -1.5) become numbers; everything else stays a string.
export function readSection(text, section) {
  const out = {}
  let within = false
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue
    const top = /^([A-Za-z_][\w-]*):\s*(#.*)?$/.exec(line)
    if (top) {
      within = top[1] === section
      continue
    }
    if (/^\S/.test(line)) {
      within = false
      continue
    }
    if (!within) continue
    const kv = /^\s+([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!kv) continue
    let v = kv[2].trim()
    if (/^(["']).*\1$/.test(v)) out[kv[1]] = v.slice(1, -1)
    else {
      v = v.replace(/\s+#.*$/, '')
      out[kv[1]] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v
    }
  }
  return out
}

export function loadSection(start, section, env = process.env) {
  const f = findConfig(start, env)
  if (!f) return {}
  try {
    return readSection(readFileSync(f, 'utf8'), section)
  } catch {
    return {}
  }
}

// Coerces the numeric keys of a config section: a value that is not a finite number of at least
// zero falls back to its default, with one warning line for the hook's output.
export function numberSettings(cfg, defaults, section) {
  const values = { ...cfg }
  const warnings = []
  for (const [key, fallback] of Object.entries(defaults)) {
    const v = cfg[key]
    if (v === undefined || v === '') values[key] = fallback
    else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      values[key] = fallback
      warnings.push(`${section}.${key} in .dotai/config.yaml is "${v}"; it must be a number of at least 0 (such as 64 or 1.5); using ${fallback}.`)
    }
  }
  return { values, warnings }
}

// Caps text for the agent's context, by lines and then characters, and says what was cut.
export function capOutput(text, maxLines = 20, maxChars = Infinity) {
  const lines = String(text).replace(/\s+$/, '').split(/\r?\n/)
  let out = lines.slice(0, maxLines).join('\n')
  const cutLines = lines.length - Math.min(lines.length, maxLines)
  let note = cutLines > 0 ? `… (${cutLines} more lines cut)` : ''
  if (out.length > maxChars) {
    out = out.slice(0, maxChars)
    note = '… (cut at the character cap)'
  }
  return note ? `${out}\n${note}` : out
}

// Kills a child and everything it started. Windows: taskkill /T walks the tree. POSIX: the
// child was spawned detached, so it leads its own process group.
export function killTree(child) {
  if (!child?.pid) return
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore', timeout: 5000 })
    } else {
      process.kill(-child.pid, 'SIGKILL')
    }
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {}
  }
}

// Runs a program with a deadline and a bounded output buffer. Never rejects. Returns
// { code, stdout, stderr, out, truncated, timedOut, missing, error }. On timeout the whole
// process tree is killed; output past `maxBytes` (both streams together) is dropped, not lost
// to ENOBUFS. `shell: true` runs `file` as a command line (config commands only). `env` replaces
// the environment; `verbatim` passes the Windows command line as built (cliInvocation).
// `stdoutFile` sends stdout to that file instead, uncapped (a machine-readable result that a cap
// would corrupt), and `stdout` is read back from it at the end.
export function runCapped(file, args = [], { cwd, timeoutMs = 60000, shell = false, maxBytes = 1 << 20, env, verbatim = false, stdoutFile = null } = {}) {
  return new Promise(done => {
    let child
    let outFd = null
    try {
      if (stdoutFile) outFd = openSync(stdoutFile, 'w')
      child = spawn(file, args, {
        cwd,
        shell,
        env,
        windowsVerbatimArguments: verbatim,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', outFd ?? 'pipe', 'pipe'],
      })
    } catch (e) {
      if (outFd !== null) closeSync(outFd)
      done({ code: null, stdout: '', stderr: '', out: '', missing: e.code === 'ENOENT', error: e.code || e.message })
      return
    }
    // The child holds its own copy of the descriptor.
    if (outFd !== null) closeSync(outFd)
    const bufs = { stdout: '', stderr: '' }
    let size = 0
    let truncated = false
    let timedOut = false
    let settled = false
    const take = name => chunk => {
      if (size >= maxBytes) {
        truncated = true
        return
      }
      const s = String(chunk).slice(0, maxBytes - size)
      if (s.length < String(chunk).length) truncated = true
      size += s.length
      bufs[name] += s
    }
    child.stdout?.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout?.on('data', take('stdout'))
    child.stderr.on('data', take('stderr'))
    const finish = (code, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(grace)
      if (stdoutFile) {
        try {
          bufs.stdout = readFileSync(stdoutFile, 'utf8')
        } catch {}
      }
      const note = truncated ? '\n… (output cut at the byte cap)' : ''
      done({
        code,
        stdout: bufs.stdout,
        stderr: bufs.stderr,
        out: `${bufs.stdout}${bufs.stderr}${note}`,
        truncated,
        timedOut,
        missing: error === 'ENOENT',
        error,
      })
    }
    let grace = null
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
      // A grandchild that escaped the kill may still hold the pipes; do not wait for it.
      grace = setTimeout(() => {
        child.stdout?.destroy()
        child.stderr.destroy()
        finish(null, 'ETIMEDOUT')
      }, 2000)
    }, timeoutMs)
    child.on('error', e => finish(null, e.code || e.message))
    child.on('close', code => finish(timedOut ? null : code, timedOut ? 'ETIMEDOUT' : undefined))
  })
}

// ------------------------------------------------------------------ harness argument

// Hook commands name their harness as the first argument (`node <tool>.mjs opencode`), set by
// the per-harness blocks of hooks.jsonc; the payload shape is the fallback.
const HARNESS_ARGS = { claudecode: 'claudecode', opencode: 'opencode', antigravity: 'antigravity', 'antigravity-cli': 'antigravity', agy: 'antigravity' }
export function harnessArg(argv = process.argv) {
  return HARNESS_ARGS[String(argv[2] ?? '').toLowerCase()] ?? null
}

// ------------------------------------------------------------------ shell parsing

// Moved from the godot guard (pack 0045) so the base shell guard (0038) shares it.
// Words carry `v` (quotes removed, backslashes kept, as PowerShell and cmd read them) and `u`
// (unquoted backslash escapes applied, as POSIX shells read them). `$(...)` and backticks inside
// double quotes run commands too; their text is collected in `subs`. Redirections (`> f`, `2>&1`)
// are dropped with their targets, so cmd and POSIX syntax split alike. With `keepRedirs`, the
// target of a plain input redirection (`< f`, `0< f`: a file the command reads) stays as a word
// marked `redir: '<'`; heredocs (`<<`, `<<<`), process substitution (`<(`) and outputs are still
// dropped.
export function tokenize(cmd, { keepRedirs = false } = {}) {
  const toks = []
  const subs = []
  const n = cmd.length
  let i = 0
  const op = v => toks.push({ op: v })
  const closeParen = from => {
    let depth = 1
    let j = from
    while (j < n && depth) {
      if (cmd[j] === '(') depth++
      else if (cmd[j] === ')') depth--
      j++
    }
    return j
  }
  while (i < n) {
    const c = cmd[i]
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue }
    if (c === '>' || c === '<' || (c === '&' && cmd[i + 1] === '>')) {
      // A file descriptor written right before the operator (2>) belongs to it.
      const last = toks[toks.length - 1]
      if (last && !last.op && last.e === i && /^\d+$/.test(last.v)) toks.pop()
      const from = i
      i++
      while (cmd[i] === '>' || cmd[i] === '<') i++
      const opText = cmd.slice(from, i)
      if (cmd[i] === '&' && /[\d-]/.test(cmd[i + 1] ?? '')) {
        i += 2
        continue
      }
      while (cmd[i] === ' ' || cmd[i] === '\t') i++
      // The target word is skipped (or kept, for an input file) by marking the next word token.
      toks.push({ op: 'redir', input: opText === '<' && cmd[i] !== '(' })
      continue
    }
    if (c === '\n' || c === ';' || c === '(' || c === ')' || c === '`') { op(c); i++; continue }
    if (c === '&' || c === '|') {
      if (cmd[i + 1] === c) { op(c + c); i += 2 } else { op(c); i++ }
      continue
    }
    if (c === '$' && cmd[i + 1] === '(') { op('$('); i += 2; continue }
    if (c === '#') { while (i < n && cmd[i] !== '\n') i++; continue }
    const s = i
    let v = ''
    let u = ''
    let q = false
    while (i < n) {
      const d = cmd[i]
      if (d === "'") {
        q = true
        let j = cmd.indexOf("'", i + 1)
        if (j < 0) j = n
        v += cmd.slice(i + 1, j)
        u += cmd.slice(i + 1, j)
        i = j + 1
      } else if (d === '"') {
        q = true
        i++
        while (i < n && cmd[i] !== '"') {
          if (cmd[i] === '$' && cmd[i + 1] === '(') {
            const end = closeParen(i + 2)
            subs.push(cmd.slice(i + 2, end - 1))
            v += cmd.slice(i, end)
            u += cmd.slice(i, end)
            i = end
            continue
          }
          if (cmd[i] === '`') {
            let j = cmd.indexOf('`', i + 1)
            if (j < 0) j = n
            subs.push(cmd.slice(i + 1, j))
            v += cmd.slice(i, j + 1)
            u += cmd.slice(i, j + 1)
            i = j + 1
            continue
          }
          if (cmd[i] === '\\' && (cmd[i + 1] === '"' || cmd[i + 1] === '\\')) i++
          v += cmd[i]
          u += cmd[i++]
        }
        i++
      } else if (' \t\r\n;&|()`<>'.includes(d) || (d === '$' && cmd[i + 1] === '(')) {
        break
      } else if (d === '\\' && i + 1 < n) {
        v += d + cmd[i + 1]
        u += cmd[i + 1]
        i += 2
      } else {
        v += d
        u += d
        i++
      }
    }
    const prev = toks[toks.length - 1]
    if (prev?.op === 'redir') {
      toks.pop()
      if (keepRedirs && prev.input) toks.push({ v, u, q, s, e: Math.min(i, n), redir: '<' })
      continue
    }
    toks.push({ v, u, q, s, e: Math.min(i, n) })
  }
  return { toks: toks.filter(t => t.op !== 'redir'), subs }
}

export function segments(toks) {
  const out = []
  let cur = []
  for (const t of toks) {
    if (t.op) {
      if (cur.length) out.push(cur)
      cur = []
    } else cur.push(t)
  }
  if (cur.length) out.push(cur)
  return out
}

export const wordBase = w => String(w).split(/[\\/]/).pop().toLowerCase()
export const stripExt = w => String(w).replace(/\.(exe|cmd|bat|com)$/i, '')
export const commandName = t => stripExt(wordBase(t.u))

// Options that take a separate value, per wrapper; any other `-x` is a flag.
export const WRAPPER_VALUE_OPTS = {
  timeout: ['-k', '-s', '--kill-after', '--signal'],
  env: ['-u', '--unset', '-C', '--chdir'],
  nice: ['-n', '--adjustment'],
  sudo: ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T', '--user', '--group'],
  stdbuf: ['-i', '-o', '-e'],
  time: ['-f', '-o', '--format', '--output'],
  exec: ['-a'],
  xargs: ['-I', '-n', '-P', '-d', '-E', '-L', '-s', '-a', '--arg-file', '--delimiter', '--max-args', '--max-procs', '--max-lines', '--max-chars'],
}
const WRAPPERS = new Set(['nohup', 'setsid', 'command', 'exec', 'time', 'nice', 'sudo', 'doas', 'stdbuf', 'xargs'])
const SHELL_NAMES = new Set(['sh', 'bash', 'zsh', 'dash'])
const PWSH_NAMES = new Set(['powershell', 'pwsh'])
const CMD_KEYWORDS = new Set(['do', 'then', 'else', 'elif', '!', 'while', 'until', 'if', 'not'])
const DURATION_WORD = /^\d+(\.\d+)?[smhd]?$/

function skipWrapperOptions(seg, k, withValue = []) {
  while (k < seg.length && seg[k].v.startsWith('-') && seg[k].v !== '-') {
    const o = seg[k].v
    if (o === '--') return k + 1
    k += withValue.includes(o) ? 2 : 1
  }
  return k
}

// Every simple command a command line runs: { name, args, redirs, text }, looking through wrappers
// (sudo, env, nohup, timeout...), `sh -c`, `cmd /c`, `powershell -Command`, `iex`, command
// substitutions and PowerShell script blocks. `redirs` are the files read through `<`; input
// redirected into a wrapper or a shell, or into no command at all, comes as an entry with an
// empty name, so a guard still sees the file. A text filter for guards, not a shell: it
// recognizes the common shapes and does not guess.
export function simpleCommands(command, depth = 0) {
  const raw = String(command ?? '')
  if (depth > 5 || !raw.trim()) return []
  const { toks, subs } = tokenize(raw, { keepRedirs: true })
  const out = []
  for (const sub of subs) out.push(...simpleCommands(sub, depth + 1))
  const segs = []
  for (const seg of segments(toks)) {
    let cur = []
    for (const t of seg) {
      if (!t.q && (t.v === '{' || t.v === '}')) {
        if (cur.length) segs.push(cur)
        cur = []
      } else cur.push(t)
    }
    if (cur.length) segs.push(cur)
  }
  for (const all of segs) {
    const redirs = all.filter(t => t.redir)
    const seg = all.filter(t => !t.redir)
    const textOf = () => raw.slice(all[0].s, all[all.length - 1].e)
    const loose = () => {
      if (redirs.length) out.push({ name: '', word: null, args: [], redirs, text: textOf() })
    }
    let k = 0
    while (k < seg.length && !seg[k].q && CMD_KEYWORDS.has(seg[k].v.toLowerCase())) k++
    while (k < seg.length && /^[A-Za-z_]\w*=/.test(seg[k].v)) k++
    let nested = null
    let done = false
    while (k < seg.length && nested === null && !done) {
      const w = commandName(seg[k])
      if (w === 'timeout' || w === 'gtimeout') {
        k = skipWrapperOptions(seg, k + 1, WRAPPER_VALUE_OPTS.timeout)
        if (k < seg.length && DURATION_WORD.test(seg[k].v)) k++
      } else if (w === 'env') {
        k++
        while (k < seg.length && (seg[k].v.startsWith('-') || /^[A-Za-z_]\w*=/.test(seg[k].v))) {
          const o = seg[k].v
          if (o === '-S' || o === '--split-string') {
            nested = seg.slice(k + 1).map(t => t.v).join(' ')
            break
          }
          k += WRAPPER_VALUE_OPTS.env.includes(o) ? 2 : 1
        }
      } else if (w === 'command' && /^-[vV]$/.test(seg[k + 1]?.v ?? '')) {
        k = seg.length // a lookup, not a run
      } else if (WRAPPERS.has(w)) {
        k = skipWrapperOptions(seg, k + 1, WRAPPER_VALUE_OPTS[w] ?? [])
      } else if (SHELL_NAMES.has(w)) {
        const c = seg.findIndex((t, j) => j > k && /^-\w*c$/.test(t.v))
        if (c > 0 && seg[c + 1]) nested = seg[c + 1].v
        else done = true
      } else if (w === 'cmd') {
        const c = seg.findIndex((t, j) => j > k && /^\/\/?[ck]$/i.test(t.v))
        if (c > 0) nested = seg.slice(c + 1).map(t => t.v).join(' ')
        else done = true
      } else if (PWSH_NAMES.has(w)) {
        const c = seg.findIndex((t, j) => j > k && /^-(c|command)$/i.test(t.v))
        if (c > 0) nested = seg.slice(c + 1).map(t => t.v).join(' ')
        else done = true
      } else if (w === 'iex' || w === 'invoke-expression') {
        nested = seg.slice(k + 1).map(t => t.v).join(' ')
      } else done = true
    }
    if (nested !== null) {
      out.push(...simpleCommands(nested, depth + 1))
      loose()
      continue
    }
    if (k >= seg.length) {
      loose()
      continue
    }
    out.push({ name: commandName(seg[k]), word: seg[k], args: seg.slice(k + 1), redirs, text: textOf() })
  }
  return out
}

// ------------------------------------------------------------------ tool config lists

// The user tools directory (~/.dotai/tools/ once installed) is where hook-lib itself lives.
export const userToolsDir = () => dirname(fileURLToPath(import.meta.url))
// The project's tools directory (.dotai/tools/ at the project root), or null outside a project.
export function projectToolsDir(cwd, env = process.env, home = homedir()) {
  const root = projectRootOf(cwd, env, home)
  return root ? join(root, '.dotai', 'tools') : null
}

// Reads `<prefix>.*.txt` from each directory, in order (user tools first, then the project's:
// tools merge both, dotai 0030), one entry per line, `#` comments and blanks dropped, and
// duplicates kept once. A directory listed twice is read once. With `trustedDirs: n`, only the
// first n directories may undo a pattern with `!`; a `!` line from any later one is dropped. Deny
// lists use it: the last matching pattern decides, so a project file must never re-allow what the
// user scope denies.
export function readPatternFiles(prefix, dirs, { trustedDirs = Infinity } = {}) {
  const lines = []
  const files = []
  const seen = new Set()
  const read = []
  for (const [index, dir] of dirs.entries()) {
    if (!dir || read.some(d => samePath(d, dir))) continue
    read.push(dir)
    const mayNegate = index < trustedDirs
    let names = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names.filter(n => n.startsWith(`${prefix}.`) && n.endsWith('.txt') && n !== `${prefix}.txt`).sort()) {
      let text = ''
      try {
        text = readFileSync(join(dir, name), 'utf8')
      } catch {
        continue
      }
      files.push(join(dir, name))
      for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#') || seen.has(line) || (!mayNegate && line.startsWith('!'))) continue
        seen.add(line)
        lines.push(line)
      }
    }
  }
  return { lines, files }
}

const reEscape = s => s.replace(/[.+^${}()|[\]\\*?]/g, '\\$&')
function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      i++
      if (glob[i + 1] === '/') {
        i++
        re += '(?:.*/)?'
      } else re += '.*'
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += reEscape(c)
  }
  return re
}

// Compiles gitignore-style patterns into match(absPath, root) -> { matched, pattern }.
//   name or *.glob   any path component (the file or a directory above it), at any depth
//   dir/             a directory component at any depth (the path is inside it)
//   a/b, /a          anchored at the project root
//   ~/a              under the home directory
//   !pattern         undoes an earlier match (the last matching pattern decides)
// Windows compares without case and with either separator.
export function compilePatterns(lines, { home = homedir() } = {}) {
  const ci = process.platform === 'win32'
  const norm = p => {
    const s = String(p).replaceAll('\\', '/')
    return ci ? s.toLowerCase() : s
  }
  const rules = []
  for (let line of lines) {
    line = String(line).trim()
    if (!line || line.startsWith('#')) continue
    const pattern = line
    const neg = line.startsWith('!')
    if (neg) line = line.slice(1)
    const dirOnly = line.endsWith('/')
    line = line.replace(/\/+$/, '')
    if (!line) continue
    let kind
    let re
    const tail = dirOnly ? '/.+' : '(?:/.*)?'
    if (line.startsWith('~/')) {
      kind = 'abs'
      re = new RegExp(`^${reEscape(norm(resolve(home)).replace(/\/+$/, ''))}/${globToRegExp(norm(line.slice(2)))}${tail}$`)
    } else if (line.includes('/')) {
      kind = 'rel'
      re = new RegExp(`^${globToRegExp(norm(line.replace(/^\/+/, '')))}${tail}$`)
    } else {
      kind = 'name'
      re = new RegExp(`^${globToRegExp(norm(line))}$`)
    }
    rules.push({ pattern, neg, kind, re, dirOnly })
  }
  return (absPath, root) => {
    const abs = norm(resolve(absPath))
    let rel = null
    if (root) {
      const r = norm(relative(resolve(root), resolve(absPath)))
      if (r && !r.startsWith('..') && !isAbsolute(r)) rel = r
    }
    const parts = (rel ?? abs).split('/').filter(Boolean)
    let last = null
    for (const rule of rules) {
      let hit = false
      if (rule.kind === 'abs') hit = rule.re.test(abs)
      else if (rule.kind === 'rel') hit = rel !== null && rule.re.test(rel)
      else {
        const pool = rule.dirOnly ? parts.slice(0, -1) : parts
        hit = pool.some(p => rule.re.test(p))
      }
      if (hit) last = rule
    }
    return last && !last.neg ? { matched: true, pattern: last.pattern } : { matched: false, pattern: null }
  }
}

// The secrets matcher every guard shares (pack 0038): `deny-paths.*.txt` from the user tools
// directory (base and variant), then the project's (profiles, the project itself), where `!` is
// ignored. Returns { match(absPath) -> { matched, pattern }, root, lines }.
export function denyMatcher(cwd, { env = process.env, home = homedir() } = {}) {
  const { lines } = readPatternFiles('deny-paths', [userToolsDir(), projectToolsDir(cwd, env, home)], { trustedDirs: 1 })
  const root = projectRootOf(cwd, env, home)
  const compiled = compilePatterns(lines, { home })
  return { match: abs => compiled(abs, root), root, lines }
}

// ------------------------------------------------------------------ nested config, frontmatter

const scalar = raw => {
  let v = String(raw).trim()
  if (/^(["']).*\1$/.test(v)) return v.slice(1, -1)
  v = v.replace(/\s+#.*$/, '')
  if (/^(["']).*\1$/.test(v)) return v.slice(1, -1)
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v
}
const keyOf = raw => (/^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw)

// Reads a map two levels down in .dotai/config.yaml, such as
//   agents:
//     defaultEffort:
//       impeccable-manual-edit-applier: medium
// Keys may be quoted (a plugin agent "plugin:agent").
export function readSubsection(text, section, sub) {
  const out = {}
  let inSection = false
  let subIndent = -1
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue
    const indent = /^\s*/.exec(line)[0].length
    if (indent === 0) {
      inSection = new RegExp(`^${reEscape(section)}:\\s*(#.*)?$`).test(line)
      subIndent = -1
      continue
    }
    if (!inSection) continue
    const kv = /^\s+("[^"]*"|'[^']*'|[^\s:#"'][^:#]*?):\s*(.*)$/.exec(line)
    if (!kv) continue
    if (subIndent >= 0 && indent > subIndent) {
      if (kv[2] !== '') out[keyOf(kv[1])] = scalar(kv[2])
      continue
    }
    subIndent = keyOf(kv[1]) === sub && /^(#.*)?$/.test(kv[2]) ? indent : -1
  }
  return out
}

// The YAML frontmatter of a Markdown file: top-level scalar keys, plus the `claudecode:` block
// (rulesync source files keep per-harness values there).
export function frontmatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(String(text))
  if (!m) return { claudecode: {} }
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (kv && kv[2].trim() !== '') out[kv[1]] = scalar(kv[2])
  }
  out.claudecode = readSection(m[1], 'claudecode')
  return out
}

// ------------------------------------------------------------------ external CLIs

// Finds a program on PATH, with PATHEXT on Windows so an npm-style `.cmd` shim is found too.
// Returns the full path or null.
export function findOnPath(name, env = process.env, platform = process.platform) {
  const dirs = String(env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean)
  const exts = platform === 'win32' ? String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const f = join(dir, name + ext.toLowerCase())
      if (existsSync(f)) return f
    }
  }
  return null
}

// cmd.exe escaping for a batch file that forwards %* (the approach of cross-spawn): quote for the
// C runtime, then caret-escape cmd's metacharacters twice, since the line is parsed again when the
// batch expands %*. The text arrives exactly, `"` and `%` included. cmd cannot carry a line break
// inside an argument, so line breaks become " / ".
const CMD_META = /([()\][%!^"`<>&|;, *?])/g
export function cmdArg(arg) {
  let a = String(arg).replace(/\r?\n|\r/g, ' / ')
  a = a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')
  return `"${a}"`.replace(CMD_META, '^$1').replace(CMD_META, '^$1')
}

// How to run `file` with `args`: a .cmd or .bat shim runs through cmd.exe with every argument
// escaped by cmdArg (and the shim's path caret-escaped once); a real executable gets its
// arguments untouched.
export function cliInvocation(file, args, platform = process.platform, env = process.env) {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    const line = [String(file).replace(CMD_META, '^$1'), ...args.map(cmdArg)].join(' ')
    return { file: env.ComSpec || process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true }
  }
  return { file, args, verbatim: false }
}

// ------------------------------------------------------------------ hook errors

// Failures a hook cannot show in the session (PreCompact output goes nowhere) are kept in
// <pack home>/hook-errors.log, the newest HOOK_ERRORS_MAX lines, one JSON object each; the next
// session start reports the newest one and clears the file. Best effort: never throws.
const HOOK_ERRORS_MAX = 20
const hookErrorsFile = env => join(packHome(env), 'hook-errors.log')

export function recordHookError(tool, reason, env = process.env) {
  try {
    const file = hookErrorsFile(env)
    mkdirSync(dirname(file), { recursive: true })
    const entry = { ts: Date.now(), tool: String(tool), reason: String(reason).replace(/\s+/g, ' ').trim().slice(0, 300) }
    appendFileSync(file, `${JSON.stringify(entry)}\n`)
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    if (lines.length > HOOK_ERRORS_MAX) {
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, `${lines.slice(-HOOK_ERRORS_MAX).join('\n')}\n`)
      try {
        renameSync(tmp, file)
      } catch {
        rmSync(tmp, { force: true })
      }
    }
  } catch {}
}

// The newest recorded error ({ ts, tool, reason }) or null; the log is cleared once read.
export function takeHookError(env = process.env) {
  const file = hookErrorsFile(env)
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  try {
    rmSync(file, { force: true })
  } catch {}
  for (const line of text.split('\n').filter(Boolean).reverse()) {
    try {
      const e = JSON.parse(line)
      if (isObject(e) && e.reason) return { ts: e.ts, tool: String(e.tool ?? ''), reason: String(e.reason) }
    } catch {}
  }
  return null
}
