// PreToolUse guard for shell commands in Godot projects (pack decision 0045).
//   1. Opening the editor (or a game window) asks the user.
//   2. A Godot launch without a deadline (`timeout`, or the pack's `godot-run`) is denied; the
//      reason shows the wrapped command in a form the shell that runs it understands.
//   3. A new launch is denied only when it would leave less free memory than the reserve,
//      using the footprint of the Godot processes already running plus the launches allowed in
//      the last seconds that may not show yet. No fixed count.
// Never denies on its own failure: a broken guard must not wedge the agent. Unknown command
// shapes pass; the parser recognizes the common ones and does not guess.
// Entry point for every harness: `node godot-guard.mjs` with the hook payload on stdin.
import { execFile } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { cpus, freemem, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
  process.stderr.write(`godot guard: cannot load hook-lib.mjs from ${LIB.href} (${e.code || e.message}); the guard is off until the base pack is reinstalled.\n`)
  process.exit(1)
}
const { commandName, formatPreToolUse, loadSection, numberSettings, parsePayload, readStdin, segments, shellKind, stripExt, tokenize, wordBase } = lib

export const DEFAULTS = {
  reserveMb: 1536, // memory left free after the new process starts (the one tunable; TODO(trial): tune once)
  footprintMb: 1024, // assumed size of a Godot process when none is running to measure
}
// Seconds in the suggested wrap: long enough for an import plus a headless test suite on the
// author's projects, short enough that a hung run frees its memory within minutes.
const SUGGESTED_TIMEOUT = 300
// CPU percentage treated as saturated. Not 100: sampling for 250 ms rarely reads a full 100 on
// a busy machine, and at 97+ another Godot process only slows the running ones. Not configurable.
const CPU_SATURATED = 97
// How long an allowed launch counts as running before it shows in the process list.
export const RESERVATION_TTL_MS = 20000
// The pack's deadline runner, next to this guard once staged (`.dotai/tools/`).
const GODOT_RUN = fileURLToPath(new URL('./godot-run.mjs', import.meta.url)).replaceAll('\\', '/')

// ------------------------------------------------------------------ parsing

// The tokenizer (words, operators, command substitutions) is shared with the base shell guard
// and lives in hook-lib (tokenize, segments, wordBase, stripExt, commandName).
const basename = wordBase
const GODOT_BIN = /^godot(3|4)?(_v\d[\w.-]*|\.(windows|linux|linuxbsd|macos|x11)[\w.-]*)?$/i
const GODOT_VAR = /^\$\{?(env:)?godot\w*\}?$/i
const GODOT_RUN_NAME = /^godot-run(\.(mjs|sh|ps1))?$/i

export function isGodotBinary(word) {
  if (GODOT_VAR.test(word)) return true
  return GODOT_BIN.test(stripExt(basename(word)))
}
const isGodotToken = t => isGodotBinary(t.v) || isGodotBinary(t.u)
const isGodotRun = t => !!t && GODOT_RUN_NAME.test(basename(t.u))

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash'])
const PWSH = new Set(['powershell', 'pwsh'])
const KEYWORDS = new Set(['do', 'then', 'else', 'elif', '!', '{', 'while', 'until'])
const DURATION = /^\d+(\.\d+)?[smhd]?$/

// Options that take a separate value, per wrapper; any other `-x` is a flag.
const VALUE_OPTS = {
  timeout: ['-k', '-s', '--kill-after', '--signal'],
  'godot-run': ['-k', '--kill-after'],
  env: ['-u', '--unset', '-C', '--chdir'],
  nice: ['-n', '--adjustment'],
  sudo: ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T', '--user', '--group'],
  stdbuf: ['-i', '-o', '-e'],
  time: ['-f', '-o', '--format', '--output'],
  exec: ['-a'],
  xargs: ['-I', '-n', '-P', '-d', '-E', '-L', '-s', '-a', '--arg-file', '--delimiter', '--max-args', '--max-procs', '--max-lines', '--max-chars'],
}
const SIMPLE_WRAPPERS = new Set(['nohup', 'setsid', 'command', 'exec', 'time', 'nice', 'sudo', 'stdbuf', 'xargs', 'env'])

// Skips the options of wrapper `w` starting at k; returns the index of its command.
function skipOptions(seg, k, w) {
  const withValue = VALUE_OPTS[w] ?? []
  while (k < seg.length && seg[k].v.startsWith('-') && seg[k].v !== '-') {
    const o = seg[k].v
    if (o === '--') return k + 1
    k += withValue.includes(o) ? 2 : 1
  }
  return k
}

const quoteArg = a => (/[\s"]/.test(a) || a === '' ? `"${a.replace(/"/g, '\\"')}"` : a)

// PowerShell Start-Process: -FilePath (or the first positional) and -ArgumentList (or the
// second positional, a comma or space separated list). Returns a command line, or null.
const PS_SWITCHES = new Set(['-wait', '-nonewwindow', '-passthru', '-usenewenvironment', '-loaduserprofile'])
function startProcessCommand(rest) {
  let file = null
  let args = null
  const positional = []
  for (let j = 0; j < rest.length; j++) {
    const name = rest[j].v.toLowerCase()
    if (!name.startsWith('-') || name.startsWith('--')) positional.push(rest[j].v)
    else if (PS_SWITCHES.has(name)) continue
    else if (['-filepath', '-pspath', '-path'].includes(name)) file = rest[++j]?.v ?? null
    else if (['-argumentlist', '-args'].includes(name)) args = rest[++j]?.v ?? null
    else j++ // any other parameter takes a value
  }
  file ??= positional.shift() ?? null
  if (!file) return null
  const list = (args ?? positional.join(' ')).split(/[\s,]+/).filter(Boolean)
  return [file, ...list].map(quoteArg).join(' ')
}

// cmd's start: an optional quoted title, /options (/D takes a value), then the command.
function cmdStartCommand(rest) {
  let j = 0
  if (rest[0]?.q && rest.length > 1) j = 1
  while (j < rest.length && rest[j].v.startsWith('/')) j += /^\/d$/i.test(rest[j].v) ? 2 : 1
  return rest.slice(j).map(t => quoteArg(t.v)).join(' ')
}

// Batch modes that run and exit without opening a window.
const isBatchFlag = a => ['--headless', '--script', '-s', '--check-only', '--doctool', '--write-movie'].includes(a) || a.startsWith('--export')

// Returns one entry per Godot launch: { text, prefix, command, args, hasTimeout, editor }.
// `prefix` is the part before the program (variable assignments), where a wrap goes after.
export function analyze(command, inheritedTimeout = false) {
  const raw = String(command)
  const { toks, subs } = tokenize(raw)
  const launches = []
  for (const sub of subs) launches.push(...analyze(sub, inheritedTimeout))
  for (const seg of segments(toks)) {
    let k = 0
    while (k < seg.length && KEYWORDS.has(seg[k].v) && !seg[k].q) k++
    if (seg[k]?.v === 'if' && !seg[k].q) {
      k++
      const next = seg[k]?.v.toLowerCase()
      if (next === 'not') k++
      if (['exist', 'errorlevel', 'defined'].includes(seg[k]?.v.toLowerCase())) k += 2
    }
    while (k < seg.length && /^[A-Za-z_]\w*=/.test(seg[k].v)) k++
    const head = k
    let hasTimeout = inheritedTimeout
    let nested = null
    while (k < seg.length) {
      const w = commandName(seg[k])
      if (w === 'timeout' || w === 'gtimeout' || isGodotRun(seg[k])) {
        k = skipOptions(seg, k + 1, w === 'gtimeout' ? 'timeout' : isGodotRun(seg[k]) ? 'godot-run' : w)
        // A zero duration disables the deadline (coreutils `timeout 0`, and godot-run alike).
        if (k < seg.length && DURATION.test(seg[k].v)) {
          if (parseFloat(seg[k].v) > 0) hasTimeout = true
          k++
        } else hasTimeout = true
      } else if (w === 'node' && isGodotRun(seg[k + 1])) {
        k++
      } else if (w === 'env') {
        k++
        while (k < seg.length && (seg[k].v.startsWith('-') || /^[A-Za-z_]\w*=/.test(seg[k].v))) {
          const o = seg[k].v
          if (o === '-S' || o === '--split-string') {
            nested = seg.slice(k + 1).map(t => t.v).join(' ')
            break
          }
          if (/^(-S|--split-string=)./.test(o)) {
            nested = [o.replace(/^(-S|--split-string=)/, ''), ...seg.slice(k + 1).map(t => t.v)].join(' ')
            break
          }
          k += VALUE_OPTS.env.includes(o) ? 2 : 1
        }
        if (nested !== null) break
      } else if (w === 'command' && /^-[vV]$/.test(seg[k + 1]?.v ?? '')) {
        k = seg.length // a lookup, not a launch
      } else if (SIMPLE_WRAPPERS.has(w)) {
        k = skipOptions(seg, k + 1, w)
      } else if (SHELLS.has(w)) {
        if (isGodotRun(seg[k + 1])) {
          k++
          continue
        }
        const c = seg.findIndex((t, j) => j > k && /^-\w*c$/.test(t.v))
        if (c > 0 && seg[c + 1]) nested = seg[c + 1].v
        break
      } else if (w === 'cmd') {
        const c = seg.findIndex((t, j) => j > k && /^\/\/?[ck]$/i.test(t.v))
        if (c > 0) nested = seg.slice(c + 1).map(t => t.v).join(' ')
        break
      } else if (PWSH.has(w)) {
        const run = seg.findIndex((t, j) => j > k && isGodotRun(t))
        if (run > 0) {
          k = run
          continue
        }
        const c = seg.findIndex((t, j) => j > k && /^-(c|command)$/i.test(t.v))
        if (c > 0) nested = seg.slice(c + 1).map(t => t.v).join(' ')
        break
      } else if (w === 'start-process' || w === 'saps' || (w === 'start' && seg.slice(k + 1).some(t => /^-(filepath|argumentlist)$/i.test(t.v)))) {
        nested = startProcessCommand(seg.slice(k + 1))
        break
      } else if (w === 'start') {
        nested = cmdStartCommand(seg.slice(k + 1))
        break
      } else break
    }
    if (nested !== null) {
      launches.push(...analyze(nested, hasTimeout))
      continue
    }
    if (k >= seg.length || !isGodotToken(seg[k])) continue
    const args = seg.slice(k + 1).map(t => t.v)
    const has = (...xs) => args.some(a => xs.includes(a))
    const batch = args.some(isBatchFlag)
    const editor =
      args.length === 0 ||
      has('-e', '--editor', '-p', '--project-manager') ||
      (!batch && (has('--path') || args.some(a => /(^|[\\/])project\.godot$/i.test(a))))
    const start = seg[0].s
    const end = seg[seg.length - 1].e
    const at = seg[head]?.s ?? start
    launches.push({
      text: raw.slice(start, end),
      prefix: raw.slice(start, at),
      command: raw.slice(at, end),
      args,
      hasTimeout,
      editor,
    })
  }
  return launches
}

// The launch with a deadline, in the syntax of the shell that will run it: coreutils
// `timeout` for POSIX shells; the pack's godot-run elsewhere, since `timeout` in cmd and
// PowerShell is the Windows wait command and does not run anything.
export function wrapLaunch(launch, shell = 'posix') {
  if (shell === 'posix') return `${launch.prefix}timeout ${SUGGESTED_TIMEOUT} ${launch.command}`
  return `${launch.prefix}node ${quoteArg(GODOT_RUN)} ${SUGGESTED_TIMEOUT} ${launch.command}`
}

// ------------------------------------------------------------------ the cap

// state: { freeMb, cpuPct, procs: [{ name, rssMb }] }; reserved: [{ footprintMb }] for launches
// allowed in the last RESERVATION_TTL_MS. Returns { reason, footprintMb }.
export function capCheck(state, config = DEFAULTS, reserved = []) {
  const { reserveMb, footprintMb } = { ...DEFAULTS, ...config }
  // Godot's *_console.exe is a small launcher that starts the real process and waits for it;
  // counting it would double the process count and give a footprint of a few MB.
  const workers = state.procs.filter(p => !/_console/i.test(p.name))
  const n = workers.length
  const footprint = Math.round(n ? Math.max(...workers.map(p => p.rssMb)) : footprintMb)
  if (n && state.cpuPct >= CPU_SATURATED) {
    return {
      reason: `CPU is saturated (${Math.round(state.cpuPct)}%) with ${n} Godot process(es) running. Wait for one to finish, then retry.`,
      footprintMb: footprint,
    }
  }
  const pending = reserved.length
  const free = Math.round(state.freeMb - reserved.reduce((sum, r) => sum + (Number(r.footprintMb) || 0), 0))
  if (free - footprint < reserveMb) {
    return {
      reason:
        `Not enough free memory for another Godot process: ${free} MB free, one uses about ${footprint} MB, ` +
        `reserve ${reserveMb} MB (godot.reserveMb in .dotai/config.yaml); ${n} running, ${pending} launch(es) starting. ` +
        'Wait for one to finish, then retry.',
      footprintMb: footprint,
    }
  }
  return { reason: null, footprintMb: footprint }
}

export const capReason = (state, config, reserved) => capCheck(state, config, reserved).reason

// A reservation counts only with a time inside the window (a little clock skew allowed) and a
// numeric footprint, clamped to a sane size; anything else (a planted or broken file) is null,
// so it can never block launches for longer than the TTL.
const RESERVATION_SKEW_MS = 2000
const MAX_FOOTPRINT_MB = 65536
function validReservation(r, now, ttlMs) {
  if (r === null || typeof r !== 'object') return null
  const { at, footprintMb } = r
  if (!Number.isFinite(at) || at > now + RESERVATION_SKEW_MS || now - at > ttlMs) return null
  if (typeof footprintMb !== 'number' || !Number.isFinite(footprintMb)) return null
  return { at, footprintMb: Math.min(MAX_FOOTPRINT_MB, Math.max(0, footprintMb)) }
}

// Launches allowed in the last ttlMs, one file each in a shared temp directory, so parallel
// hook runs see each other before the new processes show up in the process list.
export function fileReservations(dir = join(tmpdir(), 'dotai-godot'), ttlMs = RESERVATION_TTL_MS) {
  return {
    active(now) {
      const out = []
      let names = []
      try {
        names = readdirSync(dir)
      } catch {
        return out
      }
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const f = join(dir, name)
        let r = null
        try {
          r = validReservation(JSON.parse(readFileSync(f, 'utf8')), now, ttlMs)
        } catch {}
        if (r) out.push(r)
        else {
          try {
            unlinkSync(f)
          } catch {}
        }
      }
      return out
    },
    add(footprintMb, now) {
      mkdirSync(dir, { recursive: true })
      for (let attempt = 0; attempt < 5; attempt++) {
        const name = `${now}-${process.pid}-${Math.random().toString(36).slice(2, 10)}.json`
        try {
          writeFileSync(join(dir, name), JSON.stringify({ at: now, footprintMb }), { flag: 'wx' })
          return
        } catch (e) {
          if (e.code !== 'EEXIST') throw e
        }
      }
    },
  }
}

// ------------------------------------------------------------------ probes

// Windows: "<ProcessName> <WorkingSet64 bytes>" per line, from Get-Process
// (about 0.45 s against 1.8 s for tasklist, measured 2026-11-01).
export function parseGetProcess(out) {
  const procs = []
  for (const line of String(out).split(/\r?\n/)) {
    const m = /^\s*(\S+)\s+(\d+)\s*$/.exec(line)
    if (m && isGodotBinary(m[1])) procs.push({ name: m[1], rssMb: Number(m[2]) / 1048576 })
  }
  return procs
}

export function parsePs(out) {
  const procs = []
  for (const line of String(out).split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line)
    if (m && isGodotBinary(m[2])) procs.push({ name: basename(m[2]), rssMb: Number(m[1]) / 1024 })
  }
  return procs
}

// macOS: os.freemem() counts only free pages, far below what is available; free + inactive +
// speculative is what a new process can get. NaN when the output is not understood.
export function parseVmStat(out) {
  const text = String(out)
  const page = /page size of (\d+) bytes/.exec(text)
  const pages = name => {
    const m = new RegExp(`^Pages ${name}:\\s+(\\d+)`, 'm').exec(text)
    return m ? Number(m[1]) : NaN
  }
  if (!page) return NaN
  const speculative = pages('speculative')
  return ((pages('free') + pages('inactive') + (Number.isNaN(speculative) ? 0 : speculative)) * Number(page[1])) / 1048576
}

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 5000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))))
  })
}

function cpuTimes() {
  let idle = 0
  let total = 0
  for (const c of cpus()) {
    for (const v of Object.values(c.times)) total += v
    idle += c.times.idle
  }
  return { idle, total }
}

async function sampleCpu(ms = 250) {
  const a = cpuTimes()
  await new Promise(r => setTimeout(r, ms))
  const b = cpuTimes()
  const total = b.total - a.total
  return total > 0 ? 100 * (1 - (b.idle - a.idle) / total) : 0
}

const GET_PROCESS =
  'Get-Process godot* -ErrorAction SilentlyContinue | ForEach-Object { "$($_.ProcessName) $($_.WorkingSet64)" }'

export const systemProbe = {
  async load() {
    const list =
      process.platform === 'win32'
        ? run('powershell', ['-NoProfile', '-Command', GET_PROCESS]).then(parseGetProcess)
        : run('ps', ['-A', '-o', 'rss=', '-o', 'comm=']).then(parsePs)
    const free =
      process.platform === 'darwin'
        ? run('vm_stat', []).then(parseVmStat, () => NaN)
        : Promise.resolve(freemem() / 1048576)
    const [procs, cpuPct, freeMb] = await Promise.all([list, sampleCpu(), free])
    return { freeMb, cpuPct, procs }
  },
}

// ------------------------------------------------------------------ decision

// shell: 'posix' | 'powershell' | 'windows' (hook-lib shellKind); reservations: null (tests,
// no shared state) or fileReservations().
export async function decide(command, { probe = systemProbe, config = {}, shell = 'posix', reservations = null, now = Date.now() } = {}) {
  const launches = analyze(command)
  if (!launches.length) return null
  const bare = launches.find(l => !l.editor && !l.hasTimeout)
  if (bare) {
    return { decision: 'deny', reason: `godot guard: wrap every Godot launch in a timeout. Run instead: ${wrapLaunch(bare, shell)}` }
  }
  const editor = launches.find(l => l.editor)
  if (editor) {
    return {
      decision: 'ask',
      reason: `godot guard: this opens the Godot editor or a game window (${editor.text}). Agents run Godot headless; approve only if you asked for it.`,
    }
  }
  let state
  try {
    state = await probe.load()
  } catch {
    return null
  }
  // Free memory that could not be read (0, negative, NaN) is unknown, and unknown allows.
  if (!state || !Number.isFinite(state.freeMb) || state.freeMb <= 0) return null
  let pending = []
  try {
    pending = reservations?.active(now) ?? []
  } catch {}
  const added = []
  for (let i = 0; i < launches.length; i++) {
    const { reason, footprintMb } = capCheck(state, config, [...pending, ...added])
    if (reason) return { decision: 'deny', reason: `godot guard: ${reason}` }
    added.push({ at: now, footprintMb })
  }
  for (const r of added) {
    try {
      reservations?.add(r.footprintMb, now)
    } catch {}
  }
  return null
}

async function main() {
  const parsed = parsePayload(await readStdin())
  let decision = null
  let warnings = []
  try {
    const settings = numberSettings(loadSection(parsed.cwd, 'godot'), DEFAULTS, 'godot')
    warnings = settings.warnings
    decision = await decide(parsed.command, { config: settings.values, shell: shellKind(parsed), reservations: fileReservations() })
  } catch {
    decision = null
  }
  for (const w of warnings) process.stderr.write(`godot guard: ${w}\n`)
  const reason = decision && warnings.length ? `${decision.reason} (${warnings.join(' ')})` : (decision?.reason ?? '')
  const out = formatPreToolUse(parsed.harness, decision?.decision ?? null, reason)
  if (out) process.stdout.write(out)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
