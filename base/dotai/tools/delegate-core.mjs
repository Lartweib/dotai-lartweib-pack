// The delegate contract shared by both variants (pack 0009, 0019, 0022, 0030, 0034, 0050): the
// caller->target route, the model/effort pair, pool choice from the quota and its caps, the
// launch, the capped launch log and the one-line result. A base tool at user scope (0034,
// update 2026-11-03): each variant's delegate-backend.mjs imports it from the user tools
// directory and adds only how the target is launched; the base statusline and agent guard read and
// write the same launch log. A library, not a command, so it ships no .sh/.ps1 wrapper. No
// dependencies; the hook lib sits next to it in the same layer, in the pack source and installed.
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { EFFORTS, cliInvocation, denyMatcher, findOnPath, isInside, packHome, projectRootOf, readSection, runCapped } from './hook-lib.mjs'

export { EFFORTS, PACK, findOnPath, packHome } from './hook-lib.mjs'
export const TARGETS = ['agy', 'claudecode', 'opencode']
export const CALLERS = ['claudecode', 'agy', 'opencode']
// The harnesses that may be the primary (0050): the only one that delegates, to the other one
// (the secondary) or to OpenCode. OpenCode is a target only.
export const PRIMARIES = ['claudecode', 'agy']
const NAMES = { claudecode: 'Claude Code', agy: 'agy', opencode: 'OpenCode' }
const EXE = { claudecode: 'claude', agy: 'agy', opencode: 'opencode' }
const STATE_ID = { claudecode: 'claudecode', agy: 'antigravity-cli' }
export const secondaryOf = primary => (primary === 'agy' ? 'claudecode' : 'agy')
export const DEFAULTS = Object.freeze({
  primary: 'claudecode',
  gemini5h: 85, // % of the 5 h window at which a pool counts as over its threshold
  gemini7d: 90,
  thirdParty5h: 85,
  thirdParty7d: 90,
  claude5h: 85, // Claude Code's own quota, when it is the secondary
  claude7d: 90,
  staleMinutes: 15, // an older rate_limits.json is unknown, and unknown counts as available
  exhaustedMinutes: 60, // how long a quota error keeps a pool out
  timeoutMin: 30,
  maxParallel: 3,
  logMax: 500, // launch log entries per generation (launches.jsonl and launches.jsonl.1)
  // Code jobs only; research and audit always run in plan mode. Under -p, accept-edits refuses
  // every shell command at once (agy 1.5.3), and agy 1.5.12 drops --mode auto for accounts that
  // lack it, falling back to the default mode, which refuses them too. skip-permissions passes
  // --dangerously-skip-permissions instead: agy still honors the hooks' deny with the pack's
  // config (trials 2026-11-19), so the shell and read guards hold (pack 0034, update 2026-11-19).
  agyMode: 'skip-permissions',
})
const JOB_MAX_AGE_DAYS = 7 // job folders older than this are pruned when a run starts
const AGY_MODES = ['accept-edits', 'auto', 'plan', 'skip-permissions']

// ---------- arguments and configuration

const VALUE_FLAGS = ['model', 'effort', 'spec', 'prompt', 'title', 'alt', 'to', 'from', 'mode', 'kind', 'dispatch']
const BOOL_FLAGS = ['over-cap', 'line', 'watch', 'all', 'help']

export function parseArgs(argv) {
  const out = { cmd: null, flags: {}, jobs: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') out.flags.help = true
    else if (a === '--jobs') while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out.jobs.push(argv[++i])
    else if (a.startsWith('--')) {
      const name = a.slice(2)
      if (BOOL_FLAGS.includes(name)) out.flags[name] = true
      else if (VALUE_FLAGS.includes(name)) {
        if (i + 1 >= argv.length) throw new Error(`--${name} needs a value`)
        out.flags[name] = argv[++i]
      } else throw new Error(`unknown flag --${name}`)
    } else if (!out.cmd) out.cmd = a
    else throw new Error(`unexpected argument "${a}"`)
  }
  return out
}

// User-scope configuration (0034): <pack home>/delegate.yaml, section `delegate:`, edited by
// hand only, never from the chat (0019). A bad threshold or mode keeps its default, with a warning.
// Fails closed (0050): a file that exists but cannot be read or parsed, or an unknown `primary`,
// is `error`, and run and check refuse; a missing file is the defaults.
export function loadConfig(dir) {
  const file = join(dir, 'delegate.yaml')
  let raw = {}
  let error = null
  if (existsSync(file)) {
    try {
      const text = readFileSync(file, 'utf8')
      const bad = unparsedLine(text, 'delegate')
      if (bad) error = `cannot parse ${file}: "${bad.trim().slice(0, 60)}" is not a section or a key: value line`
      else raw = readSection(text, 'delegate')
    } catch (e) {
      error = `cannot read ${file} (${e.code || e.message})`
    }
  }
  const values = { ...DEFAULTS }
  const warnings = []
  const explicit = []
  const choices = { primary: PRIMARIES, agyMode: AGY_MODES }
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const v = raw[key]
    if (v === undefined || v === '') continue
    const ok = typeof fallback === 'number' ? typeof v === 'number' && Number.isFinite(v) && v > 0 : choices[key].includes(v)
    if (ok) {
      values[key] = v
      explicit.push(key)
    } else if (key === 'primary') error ??= `delegate.primary in ${file} is "${v}", not ${PRIMARIES.join(' or ')}`
    else warnings.push(`delegate.${key} in ${file} is "${v}"; using ${fallback}.`)
  }
  return { values, warnings, file, explicit, error }
}

// The first line readSection would skip silently: at the top level anything but a `name:` header,
// inside `section` anything but `key: value`. Comments and blank lines are fine.
function unparsedLine(text, section) {
  let within = false
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue
    const top = /^([A-Za-z_][\w-]*):\s*(#.*)?$/.exec(line)
    if (top) within = top[1] === section
    else if (/^\S/.test(line)) return line
    else if (within && !/^\s+[A-Za-z_][\w-]*:(\s|$)/.test(line)) return line
  }
  return null
}

// A primary set in delegate.yaml must be installed (0050): its CLI on PATH and, when an install
// state lists harnesses, among them. Otherwise delegation is off, with a warning, not a failure.
export function primaryProblem(primary, { env = process.env, home = homedir() } = {}) {
  let listed = true
  try {
    const s = JSON.parse(readFileSync(join(home, '.dotai', 'state.json'), 'utf8'))
    if (Array.isArray(s?.harnesses)) listed = s.harnesses.includes(STATE_ID[primary])
  } catch {}
  if (listed && findOnPath(EXE[primary], env)) return null
  return `delegate.primary ${primary} is not installed, so delegation is off; set primary to the harness you use, or install ${NAMES[primary]}`
}

// ---------- policy

// A delegated child: DOTAI_DELEGATE_CALLER is present, even emptied (0050), so a child that blanks
// it still cannot pass for the primary with --from. Unsetting it is what the shell guard denies.
export const isDelegated = (env = process.env) => env.DOTAI_DELEGATE_CALLER !== undefined

export function detectCaller(env = process.env) {
  if (isDelegated(env)) return CALLERS.includes(env.DOTAI_DELEGATE_CALLER) ? env.DOTAI_DELEGATE_CALLER : 'unknown'
  if (env.CLAUDECODE === '1') return 'claudecode'
  return 'unknown'
}

// Who is in charge (0019): autonomous work has a hard cap. DOTAI_AUTONOMOUS=1, set by the runs
// that own autonomous work (autonomous, autonomous-orchestra), cannot be weakened by a flag.
export function resolveMode(flag, env = process.env) {
  if (flag !== undefined && !['interactive', 'autonomous'].includes(flag)) throw new Error(`--mode is interactive or autonomous, not "${flag}"`)
  if (env.DOTAI_AUTONOMOUS === '1') return 'autonomous'
  return flag ?? 'interactive'
}

const isGemini = m => /^gemini-/i.test(m)
const isClaude = m => /claude|anthropic/i.test(m)

// Claude Code's --model takes an alias or a full id (claude --help, 2.1.328).
const CLAUDE_MODEL = /^(sonnet|opus|haiku|fable|opusplan)(\[1m\])?$|^claude-[\w.-]+(\[1m\])?$/i

export function poolOf(target, model) {
  if (target === 'opencode') return 'opencode'
  if (target === 'claudecode') return 'claude'
  return isGemini(model) ? 'gemini' : 'third-party'
}

const CRITERION = 'Declare both: --model and --effort (low, medium, high, xhigh, max; "default" where the model id holds the level).'

// The model/effort pair (0022, 0030). agy: a Gemini id may carry its level (gemini-3.8-flash-low),
// which must match the effort, and goes as --effort; third-party ids (claude-*, gpt-*) carry their
// own level and agy rejects --effort for them, so they take "default". OpenCode: provider/model,
// effort as the #variant, never a Claude model (0009). Claude Code (an agy primary's secondary,
// 0050): Claude models only, effort as --effort (low..max), "default" leaves it to Claude Code.
export function checkPair(target, model, effort) {
  if (!model) return { ok: false, reason: `no model. ${CRITERION}` }
  // A trailing backslash would escape the closing quote of a cmd.exe or C-runtime argument, and a
  // control character has no place in a model id.
  if (/\\$|[\u0000-\u001f\u007f]/.test(model)) return { ok: false, reason: `"${JSON.stringify(model).slice(1, -1)}" is not a model id.` }
  if (!effort) return { ok: false, reason: `no effort. ${CRITERION}` }
  if (effort !== 'default' && !EFFORTS.includes(effort)) return { ok: false, reason: `effort "${effort}" is not one of ${EFFORTS.join(', ')} or default.` }
  if (target === 'opencode') {
    if (!/^[\w.-]+\/\S+$/.test(model)) return { ok: false, reason: `OpenCode models are provider/model, not "${model}".` }
    if (isClaude(model)) return { ok: false, reason: 'OpenCode never runs Claude models through the API (0009).' }
    return { ok: true, effortFlag: effort === 'default' ? null : effort }
  }
  if (target === 'claudecode') {
    if (!CLAUDE_MODEL.test(model)) return { ok: false, reason: `Claude Code runs Claude models only (an alias such as sonnet, or claude-*), not "${model}".` }
    return { ok: true, effortFlag: effort === 'default' ? null : effort }
  }
  if (target !== 'agy') return { ok: false, reason: `unknown target "${target}"; use agy, claudecode or opencode.` }
  if (isGemini(model)) {
    const level = /-(low|medium|high|xhigh|max)$/i.exec(model)?.[1]?.toLowerCase()
    if (effort === 'default') return { ok: false, reason: `Gemini models take an explicit effort${level ? ` (${level} for ${model})` : ''}.` }
    if (level && level !== effort) return { ok: false, reason: `${model} runs at ${level}; declare --effort ${level} or pick the ${effort} id.` }
    return { ok: true, effortFlag: effort }
  }
  if (effort !== 'default') return { ok: false, reason: `agy rejects --effort for ${model}; its level is in the id, so declare --effort default.` }
  return { ok: true, effortFlag: null }
}

// One-way routes (0009, 0050): only the primary delegates, and only to another harness (the
// secondary, or OpenCode). A delegated child is never the primary, so nesting and cycles are
// refused, and the primary's quota is never spent on the secondary's behalf. Within one harness
// the pack's subagents do the job. An agy primary is known only by --from agy (agy sets no marker).
export function checkRoute(from, target, primary = DEFAULTS.primary) {
  if (from === 'opencode') return { ok: false, reason: 'OpenCode is a target only, never a caller (0050).' }
  if (from !== primary) {
    const hint = from === 'unknown' ? `; the caller is unknown: run it from ${NAMES[primary]}${primary === 'agy' ? ' with --from agy' : ''}` : ''
    return { ok: false, reason: `only the primary (${primary}, delegate.yaml) delegates, not ${from} (0050)${hint}.` }
  }
  if (from === target) return { ok: false, reason: `${NAMES[from]} does not delegate to itself; use its own subagents, which the pack ships.` }
  return { ok: true }
}

// ---------- quota

const toMs = ts => {
  if (ts === undefined || ts === null || ts === '') return null
  const n = typeof ts === 'number' ? ts : /^\d+(\.\d+)?$/.test(String(ts)) ? Number(ts) : Date.parse(String(ts))
  if (!Number.isFinite(n)) return null
  return n < 1e11 ? n * 1000 : n
}
const pct = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// The newest readable snapshot of `files`, and whether it is fresh.
function newest(files, now, staleMinutes) {
  let best = null
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(f, 'utf8'))
      const ts = toMs(j.ts)
      if (j && typeof j === 'object' && (!best || (ts ?? 0) > (best.ts ?? 0))) best = { j, ts, f }
    } catch {}
  }
  if (!best) return null
  const age = best.ts === null ? Infinity : now - best.ts
  return { ...best, fresh: age <= staleMinutes * 60000 && age >= -5 * 60000 }
}

// agy's quota, written by the statusline of an interactive agy session only (0022): the newest
// of the normal and the isolated install. Claude Code's (0050), written by its statusline, also
// interactive sessions only, so mostly stale under an agy primary: the newest of CLAUDE_CONFIG_DIR,
// ~/.claude and the isolated install. Stale or missing is unknown.
export function readQuota({ env = process.env, home = homedir(), now = Date.now(), staleMinutes = DEFAULTS.staleMinutes } = {}) {
  const agyFiles = env.DOTAI_AGY_RATE_LIMITS
    ? [env.DOTAI_AGY_RATE_LIMITS]
    : [join(home, '.gemini', 'antigravity-cli', 'rate_limits.json'), join(home, '.dotai', 'isolated', 'gemini', 'antigravity-cli', 'rate_limits.json')]
  const claudeDirs = [env.CLAUDE_CONFIG_DIR, join(home, '.claude'), join(home, '.dotai', 'isolated', 'claude')].filter(Boolean)
  const a = newest(agyFiles, now, staleMinutes)
  const c = newest(claudeDirs.map(d => join(d, 'rate_limits.json')), now, staleMinutes)
  const blank = { h5: null, d7: null, fresh: false }
  return {
    gemini: a ? { h5: pct(a.j.gemini_5h_pct), d7: pct(a.j.gemini_7d_pct), fresh: a.fresh } : { ...blank },
    'third-party': a ? { h5: pct(a.j.p3_5h_pct), d7: pct(a.j.p3_7d_pct), fresh: a.fresh } : { ...blank },
    claude: c ? { h5: pct(c.j.five_hour_pct), d7: pct(c.j.seven_day_pct), fresh: c.fresh } : { ...blank },
    source: a?.f ?? null,
    ts: a?.ts,
  }
}

export function loadExhausted(file, now = Date.now()) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    return Object.fromEntries(Object.entries(j).filter(([, until]) => typeof until === 'number' && until > now))
  } catch {
    return {}
  }
}

// Best effort: a state file that cannot be written costs one stderr line, never the verdict.
// Returns whether the mark was saved.
export function markExhausted(file, pool, minutes, now = Date.now()) {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    const state = loadExhausted(file, now)
    state[pool] = now + minutes * 60000
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(tmp, JSON.stringify(state))
    renameSync(tmp, file)
    return true
  } catch (e) {
    try {
      rmSync(tmp, { force: true })
    } catch {}
    process.stderr.write(`delegate: quota state not saved (${e.code || e.message})\n`)
    return false
  }
}

const LIMITS = { gemini: ['gemini5h', 'gemini7d'], 'third-party': ['thirdParty5h', 'thirdParty7d'], claude: ['claude5h', 'claude7d'] }

function verdict(pool, quota, exhausted, cfg, now) {
  if (pool === 'opencode') return { state: 'ok' }
  if ((exhausted[pool] ?? 0) > now) return { state: 'exhausted', reason: `${pool} pool exhausted (quota error)` }
  const q = quota[pool]
  if (!q?.fresh) return { state: 'ok', unknown: true }
  const [k5, k7] = LIMITS[pool]
  const shown = `${pool} pool at ${q.h5 ?? '?'}% (5 h) / ${q.d7 ?? '?'}% (7 d)`
  if ((q.h5 ?? 0) >= 100 || (q.d7 ?? 0) >= 100) return { state: 'exhausted', reason: `${shown}, exhausted` }
  if ((q.h5 ?? 0) >= cfg[k5] || (q.d7 ?? 0) >= cfg[k7]) return { state: 'over', reason: `${shown}, threshold ${cfg[k5]}% / ${cfg[k7]}%` }
  return { state: 'ok' }
}

// Only the primary gets here (checkRoute). The work never moves on by itself: the primary does it
// on the model its cost policy fits the task, or defers and tells the user (0009, 0050).
const fallbackAdvice = primary => `Do it yourself in ${NAMES[primary] ?? primary} on the model the cost policy fits the task, or defer and tell the user.`

export function parseAlt(alt) {
  const i = alt.lastIndexOf(':')
  return i > 0 ? { model: alt.slice(0, i), effort: alt.slice(i + 1) } : { model: alt, effort: undefined }
}

// The whole pre-launch decision: reject, launch (maybe on the alternative), ask or defer.
export function decide({ job, quota, exhausted = {}, cfg = DEFAULTS, mode = 'interactive', overCap = false, now = Date.now() }) {
  const primary = cfg.primary ?? DEFAULTS.primary
  const target = job.target ?? secondaryOf(primary)
  const from = job.from ?? 'unknown'
  const route = checkRoute(from, target, primary)
  if (!route.ok) return { action: 'reject', reason: route.reason }
  const pair = checkPair(target, job.model, job.effort)
  if (!pair.ok) return { action: 'reject', reason: pair.reason }
  let alt = null
  if (job.alt) {
    alt = parseAlt(job.alt)
    const p = checkPair(target, alt.model, alt.effort)
    if (!p.ok) return { action: 'reject', reason: `--alt ${job.alt}: ${p.reason}` }
    alt.effortFlag = p.effortFlag
  }
  const pool = poolOf(target, job.model)
  const launch = (m, e, flag, usedAlt) => ({ action: 'launch', model: m, effort: e, effortFlag: flag, pool: poolOf(target, m), usedAlt })
  const v = verdict(pool, quota, exhausted, cfg, now)
  if (v.state === 'ok') return launch(job.model, job.effort, pair.effortFlag, false)
  if (alt && poolOf(target, alt.model) !== pool && verdict(poolOf(target, alt.model), quota, exhausted, cfg, now).state === 'ok') {
    return launch(alt.model, alt.effort, alt.effortFlag, true)
  }
  if (v.state === 'exhausted') return { action: 'defer', pool, reason: `${v.reason}. ${fallbackAdvice(from)}` }
  if (mode === 'autonomous') return { action: 'defer', pool, reason: `${v.reason}. Autonomous work has a hard cap (0019): stop, save state and report. ${fallbackAdvice(from)}` }
  if (overCap) return launch(job.model, job.effort, pair.effortFlag, false)
  return { action: 'ask', pool, reason: `${v.reason}. Soft cap: ask the user; rerun with --over-cap only if they approve. Otherwise: ${fallbackAdvice(from)}` }
}

// ---------- agy and OpenCode output

export function parseAgyJson(text) {
  const s = String(text ?? '').trim()
  let j = null
  for (const candidate of [s, s.slice(Math.max(0, s.indexOf('{')))]) {
    try {
      j = JSON.parse(candidate)
      break
    } catch {}
  }
  if (!j) {
    for (const line of s.split(/\r?\n/).reverse()) {
      try {
        j = JSON.parse(line)
        break
      } catch {}
    }
  }
  if (!j || typeof j !== 'object') return { status: 'UNPARSED', error: s.slice(-300) || 'no output', inTok: 0, outTok: 0 }
  const usage = j.usage && typeof j.usage === 'object' ? j.usage : {}
  let inTok = 0
  let outTok = 0
  for (const [k, v] of Object.entries(usage)) {
    if (typeof v !== 'number' || /cache/i.test(k)) continue
    if (/^(input|prompt)/i.test(k)) inTok += v
    else if (/^(output|completion|reasoning|thought)/i.test(k)) outTok += v
  }
  return {
    status: String(j.status ?? 'UNPARSED').toUpperCase(),
    error: j.error ? (typeof j.error === 'string' ? j.error : JSON.stringify(j.error)) : '',
    response: typeof j.response === 'string' ? j.response : '',
    model: typeof j.model === 'string' ? j.model : null,
    inTok,
    outTok,
  }
}

// `claude -p --output-format json` prints one result object: {type: "result", subtype, is_error,
// result, usage: {input_tokens, output_tokens, cache_*}, ...}. ASSUMED from the documented shape,
// not recorded (0050, trial pending; base/tests/fixtures/claude-p-assumed), so it is read
// defensively: noise before the JSON, one object per line, or an array of messages whose `result`
// entry counts. is_error wins over subtype; an error's text is in `result` (or `error`).
export function parseClaudeJson(text) {
  const s = String(text ?? '').trim()
  const tries = [s, s.slice(Math.max(0, s.indexOf('{'))), ...s.split(/\r?\n/).reverse()]
  let j = null
  for (const candidate of tries) {
    try {
      j = JSON.parse(candidate)
      if (j && typeof j === 'object') break
    } catch {}
    j = null
  }
  if (Array.isArray(j)) j = j.filter(m => m && typeof m === 'object' && m.type === 'result').at(-1) ?? null
  if (!j || typeof j !== 'object' || (j.type !== undefined && j.type !== 'result')) return { status: 'UNPARSED', error: s.slice(-300) || 'no output', inTok: 0, outTok: 0 }
  const usage = j.usage && typeof j.usage === 'object' ? j.usage : {}
  const failed = j.is_error === true || (typeof j.subtype === 'string' && j.subtype !== 'success')
  const said = typeof j.result === 'string' ? j.result : ''
  const error = j.error ? (typeof j.error === 'string' ? j.error : JSON.stringify(j.error)) : ''
  return {
    status: failed ? 'ERROR' : 'SUCCESS',
    error: failed ? error || said || String(j.subtype ?? 'error') : '',
    response: failed ? '' : said,
    model: null, // the reply names no single model (aliases, background models), so none is checked
    inTok: Number(usage.input_tokens) || 0,
    outTok: Number(usage.output_tokens) || 0,
  }
}

// OpenCode `run --format json` prints one event per line, {type, timestamp, sessionID, ...data}
// (checked in the installed CLI, 2026-11-03): `text` events carry part.text, `step_start` opens
// each step, `step_finish` carries part.tokens, `error` carries error. The reply is the text of the
// last step that has any (earlier steps hold narration before tool calls). Other common shapes
// (a flat `text`, a `message` with role assistant and string or part content) are accepted too.
const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(textOf).filter(Boolean).join('\n\n') : c && typeof c === 'object' && (c.type ?? 'text') === 'text' ? textOf(c.text) : '')
export function parseOpenCodeJson(text, code, stderr = '') {
  const steps = [[]]
  let inTok = 0
  let outTok = 0
  let error = ''
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    let e
    try {
      e = JSON.parse(raw)
    } catch {
      continue
    }
    if (!e || typeof e !== 'object') continue
    const part = e.part && typeof e.part === 'object' ? e.part : {}
    const type = String(e.type ?? '').replace(/-/g, '_')
    if (type === 'step_start') steps.push([])
    else if (type === 'step_finish') {
      const t = part.tokens ?? {}
      inTok += Number(t.input) || 0
      outTok += (Number(t.output) || 0) + (Number(t.reasoning) || 0)
    } else if (type === 'error') error = typeof e.error === 'string' ? e.error : e.error?.data?.message ?? e.error?.message ?? JSON.stringify(e.error ?? e)
    else if (type === 'text' && (part.type ?? 'text') === 'text') steps.at(-1).push(textOf(part.text ?? e.text))
    else if (type === 'message' && (e.role ?? part.role) === 'assistant') steps.at(-1).push(textOf(e.content ?? part.content ?? e.text))
  }
  const last = steps.map(s => s.map(t => t.trim()).filter(Boolean)).filter(s => s.length).at(-1) ?? []
  const lastLine = t => String(t).trim().split(/\r?\n/).at(-1) ?? ''
  const failed = code !== 0 || error
  return {
    status: failed ? 'ERROR' : 'SUCCESS',
    error: failed ? error || lastLine(stderr || text || '') : '',
    response: last.join('\n\n'),
    inTok,
    outTok,
  }
}

// 0022 (measurement 1): exhausted when the status is not SUCCESS and the error names the quota:
// RESOURCE_EXHAUSTED (Google's code, which a 429 carries too), "out of quota", "quota exceeded"
// or "exceeded your quota". A bare "rate limit" is not matched: it is transient, and marking the
// pool exhausted would keep it out for exhaustedMinutes. Stderr is read only when stdout held no
// JSON; otherwise the JSON status is authoritative.
// TODO(trial): confirm on the first real exhaustion; no real sample yet.
// Claude Code (0050) words its plan limits differently: "Claude AI usage limit reached|<epoch>",
// "You've hit your limit · resets 3pm", "5-hour limit reached", "Weekly limit reached".
// TODO(trial): ASSUMED texts; no real sample, and no session was spent to get one.
const QUOTA_TEXT = /out of quota|RESOURCE_EXHAUSTED|quota exceeded|exceeded (your |the )?quota/i
const CLAUDE_QUOTA_TEXT = /usage limit reached|hit your (usage )?limit|(5-hour|weekly|session|opus) limit reached|out of (extra )?usage/i
export const isQuotaError = (r, stderr = '', target = 'agy') => {
  const re = target === 'claudecode' ? CLAUDE_QUOTA_TEXT : QUOTA_TEXT
  return r.status !== 'SUCCESS' && (re.test(r.error ?? '') || (r.status === 'UNPARSED' && re.test(String(stderr))))
}

// ---------- processes

// Runs a CLI found by findOnPath with hook-lib's capped runner; a .cmd shim goes through cmd.exe
// with every argument escaped (hook-lib cliInvocation). `stdoutFile` keeps stdout uncapped.
export function runCli(file, args, { cwd, env, timeoutMs, stdoutFile = null } = {}) {
  const inv = cliInvocation(file, args, process.platform, env ?? process.env)
  return runCapped(inv.file, inv.args, { cwd, env, timeoutMs, verbatim: inv.verbatim, stdoutFile })
}

// ---------- launch log

// Append-only, so concurrent writers (parallel jobs, the agent guard, several sessions) never
// lose or tear an entry. Past `max` lines the file is renamed to `<file>.1`, replacing the older
// generation, under a lock file taken with `wx` (a lock older than LOCK_STALE_MS is broken); a
// process still appending to the renamed file writes into `.1`, which readLog reads first. Best
// effort: a log that cannot be written costs one stderr line, never the caller's result.
// Returns whether the entry was written.
const LOCK_STALE_MS = 10000
const MIN_ENTRY_BYTES = 32

export function appendLog(file, entry, max = DEFAULTS.logMax) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify(entry) + '\n')
  } catch (e) {
    process.stderr.write(`delegate: launch log not written (${e.code || e.message})\n`)
    return false
  }
  try {
    rotateIfFull(file, max)
  } catch {}
  return true
}

const lineCount = file => {
  let n = 0
  for (const c of readFileSync(file, 'utf8')) if (c === '\n') n++
  return n
}

function takeLock(lock) {
  try {
    closeSync(openSync(lock, 'wx'))
    return true
  } catch (e) {
    if (e.code !== 'EEXIST') return false
  }
  try {
    if (Date.now() - statSync(lock).mtimeMs < LOCK_STALE_MS) return false
    rmSync(lock, { force: true })
    closeSync(openSync(lock, 'wx'))
    return true
  } catch {
    return false
  }
}

function rotateIfFull(file, max) {
  if (statSync(file).size <= max * MIN_ENTRY_BYTES || lineCount(file) <= max) return
  const lock = `${file}.lock`
  if (!takeLock(lock)) return // another writer is rotating; the next append retries
  try {
    if (lineCount(file) > max) renameSync(file, `${file}.1`)
  } finally {
    rmSync(lock, { force: true })
  }
}

const parseLines = text =>
  text.split('\n').flatMap(l => {
    try {
      return l ? [JSON.parse(l)] : []
    } catch {
      return []
    }
  })

// Both generations, oldest first.
export function readLog(file) {
  const out = []
  for (const f of [`${file}.1`, file]) {
    try {
      out.push(...parseLines(readFileSync(f, 'utf8')))
    } catch {}
  }
  return out
}

const alive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}
const kTok = n => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n ?? 0))
const ago = ms => (ms < 90000 ? `${Math.round(ms / 1000)}s` : ms < 5400000 ? `${Math.round(ms / 60000)}m` : `${Math.round(ms / 3600000)}h`)

function launches(entries, now) {
  const byId = new Map()
  for (const e of entries) {
    if (e.event === 'start') byId.set(e.id, { ...e, children: [] })
    else if (e.event === 'end' && byId.has(e.id)) Object.assign(byId.get(e.id), { status: e.status, secs: e.secs, inTok: e.inTok, outTok: e.outTok, result: e.result, done: true })
  }
  for (const l of byId.values()) {
    if (l.done) l.state = l.status
    else if (l.kind === 'subagent' || !l.pid) l.state = 'launched' // agent-guard entries: no pid to watch
    else l.state = alive(l.pid) && now - l.ts < 24 * 3600000 ? 'running' : 'lost'
  }
  return byId
}

// Log fields come from job files and other writers: control characters (escape sequences, line
// breaks) are dropped before they reach a terminal.
const shownText = v => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '')

// The live tree of launched agents (0032): agy and OpenCode from this tool, Claude Code
// subagents from any writer of the same log (see the README for the entry shape).
export function renderTree(entries, now = Date.now(), { limit = 20 } = {}) {
  const byId = launches(entries, now)
  const roots = []
  for (const l of byId.values()) {
    const p = l.parent && byId.get(l.parent)
    if (p) p.children.push(l)
    else roots.push(l)
  }
  const out = []
  const line = (l, depth) => {
    const t = l.done ? `${l.secs ?? '?'}s${l.inTok ? ` in=${kTok(l.inTok)} out=${kTok(l.outTok)}` : ''}` : ago(now - l.ts)
    out.push(`${'  '.repeat(depth)}- ${shownText(l.title) || '(untitled)'}  [${shownText(l.harness)} ${shownText(l.model)}/${shownText(l.effort)}]  ${shownText(l.state)} ${t}`)
    for (const c of l.children.sort((a, b) => a.ts - b.ts)) line(c, depth + 1)
  }
  for (const r of roots.sort((a, b) => a.ts - b.ts).slice(-limit)) line(r, 0)
  return out.length ? out.join('\n') : '(no launches yet)'
}

export function statusLine(entries, now = Date.now()) {
  const all = [...launches(entries, now).values()]
  const running = all.filter(l => l.state === 'running').length
  const last = all.filter(l => l.done && l.kind !== 'subagent').sort((a, b) => a.ts - b.ts).at(-1)
  return `delegate: ${running} running${last ? ` · last ${last.status} ${ago(now - last.ts)} ago` : ''}`
}

export function quotaLine(q) {
  const one = name => {
    const p = q[name]
    if (p.h5 === null && p.d7 === null) return `${name} ?`
    return `${name} ${p.h5 ?? '?'}%/${p.d7 ?? '?'}%${p.fresh ? '' : ' (stale)'}`
  }
  return `quota (5 h/7 d): ${one('gemini')} · ${one('third-party')}${q.claude ? ` · ${one('claude')}` : ''}`
}

// ---------- jobs

const newId = (now = new Date()) => {
  const p = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`
}

export const KINDS = ['research', 'audit', 'code']
const READ_ONLY = new Set(['research', 'audit'])

// The prompt holds no quote, percent sign or line break, so it survives every shell. A code job
// writes the long result to a file, which keeps accented characters (agy's -p output loses them,
// 0022). Research and audit run read-only (agy plan mode, the OpenCode plan agent), so the agent
// cannot write result.md: its reply is the result, saved there by this tool. agy 1.5.3 plan mode
// read the job folder and kept the accents of its JSON reply (trial 2026-11-19). Plan mode denies
// shell commands; agy 1.5.13 reached for one to read a file and replied with nothing (trial
// 2026-11-22), so the read-only prompt names the file tools. A code job gets the rules whose
// breaking stops a worker at the shell guard or a permission prompt (2026-11-22).
export function buildPrompt(jobDir, kind = 'research') {
  if (READ_ONLY.has(kind) || !KINDS.includes(kind)) {
    return `Read spec.md in the job folder and do the task it describes. This is a read-only run: edit no file and reply with the complete result, which is saved to result.md. Read files with your file-reading tools, no shell commands: they are denied here. job folder: ${jobDir}`
  }
  return `Read spec.md and do the task it describes. Write the complete result to result.md (UTF-8). Both files are in the job folder. Edit only what the task names, with your file-editing tools, not through the shell. Stop only processes you started, by their PID, never by name, and end them all before you finish. Never run git stash. Reply with one short line. job folder: ${jobDir}`
}

// Where the delegated agy reads its config. `dotai run` starts agy with
// --gemini_dir=<home>/.dotai/isolated/gemini and sets no variable that a child could see (dotai
// CLI-JSON, run), so the launch reads the install state (<home>/.dotai/state.json, CLI-JSON):
// in an isolated install the pack's agy config, with its deny rules and hooks, is only in that
// directory, and an agy started without the flag would run on the user's own config. A replace
// install, or none, leaves agy on its own directory. Fails closed: an unreadable state, or an
// isolated install without agy, is an error and agy is not started.
export function agyIsolation(home = homedir()) {
  const s = isolatedState(home, 'antigravity-cli', 'agy')
  if (s.error) return { error: s.error }
  if (!s.isolated) return { geminiDir: null }
  const dir = join(home, '.dotai', 'isolated', 'gemini')
  if (isDir(dir)) return { geminiDir: dir }
  return { error: `the isolated agy directory ${dir} (gemini) is missing; run dotai install again` }
}

const isDir = p => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

// The install state (<home>/.dotai/state.json, CLI-JSON) as it concerns the harness id: not
// isolated (no install, or a replace install), isolated with it, or an error that fails closed.
function isolatedState(home, id, name) {
  const file = join(home, '.dotai', 'state.json')
  let state
  try {
    state = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') return { isolated: false }
    return { error: `cannot read the install state ${file} (${e.code || 'invalid JSON'}); run dotai install again` }
  }
  if (state?.mode !== 'isolated') return { isolated: false }
  if (!Array.isArray(state.harnesses) || !state.harnesses.includes(id)) {
    return { error: `${name} is not in the isolated install, so it would run on your own ${name} config without the pack rules and hooks; install the pack for ${name} (dotai install) or delegate to another target` }
  }
  return { isolated: true, sharedSkills: state.sharedSkills === true }
}

// What `dotai run opencode` sets (CLI-JSON run; the engine's opencode adapter, checked on 2.0.30):
// the pointers, each removed from the inherited environment even when the install does not set it,
// the fixed variables, and the variables dropped because each points OpenCode at another config.
const OPENCODE_DIRS = { XDG_CONFIG_HOME: 'config', XDG_DATA_HOME: 'data', XDG_STATE_HOME: 'state', XDG_CACHE_HOME: 'cache' }
const OPENCODE_FIXED = { OPENCODE_DISABLE_CLAUDE_CODE: '1' }
const OPENCODE_REMOVED = [...Object.keys(OPENCODE_DIRS), 'OPENCODE_TEST_HOME', ...Object.keys(OPENCODE_FIXED),
  'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_CLI_CONFIG_CONTENT', 'OPENCODE_DB']

// Where the delegated OpenCode reads its config. `dotai run opencode` isolates it through the
// environment, which a delegation started from a dotai run session does not inherit for another
// harness (and a Claude Code session never has), so the launch reads the install state as for agy:
// in an isolated install, the XDG_* directories under <home>/.dotai/isolated/opencode,
// OPENCODE_TEST_HOME at its home (created, as OpenCode's service starts in it) unless the variant
// shares skills, OPENCODE_DISABLE_CLAUDE_CODE=1, and --standalone, so that `run` never attaches to
// a background service started with the user's own config (environment variables do not reach a
// running service, HARNESS-NOTES). Fails closed like agyIsolation.
export function openCodeIsolation(home = homedir()) {
  const s = isolatedState(home, 'opencode', 'OpenCode')
  if (s.error) return { error: s.error }
  if (!s.isolated) return { env: null }
  const dir = join(home, '.dotai', 'isolated', 'opencode')
  if (!isDir(join(dir, 'config', 'opencode'))) {
    return { error: `the isolated OpenCode directory ${join(dir, 'config', 'opencode')} (opencode) is missing; run dotai install again` }
  }
  const env = Object.fromEntries(Object.entries(OPENCODE_DIRS).map(([k, sub]) => [k, join(dir, sub)]))
  if (!s.sharedSkills) {
    const testHome = join(dir, 'home')
    try {
      mkdirSync(testHome, { recursive: true })
    } catch (e) {
      return { error: `cannot create the isolated OpenCode home ${testHome} (${e.code || e.message})` }
    }
    env.OPENCODE_TEST_HOME = testHome
  }
  return { env: { ...env, ...OPENCODE_FIXED }, owned: OPENCODE_REMOVED, standalone: true }
}

// Where the delegated Claude Code reads its config (0050): `dotai run claudecode` points
// CLAUDE_CONFIG_DIR at <home>/.dotai/isolated/claude in an isolated install, and a child never
// sees that, so the launch reads the install state as for agy. Fails closed like agyIsolation.
export function claudeIsolation(home = homedir()) {
  const s = isolatedState(home, 'claudecode', 'Claude Code')
  if (s.error) return { error: s.error }
  if (!s.isolated) return { env: null }
  const dir = join(home, '.dotai', 'isolated', 'claude')
  if (!isDir(dir)) return { error: `the isolated Claude Code directory ${dir} (claude) is missing; run dotai install again` }
  return { env: { CLAUDE_CONFIG_DIR: dir }, owned: ['CLAUDE_CONFIG_DIR'] }
}

// The child's environment: base without every variable the isolation owns (by name, and on Windows
// in any case, as there a variable name has none), then the isolation's own. No isolation: base.
export function isolatedEnv(base, iso, platform = process.platform) {
  if (!iso?.env) return base
  const key = platform === 'win32' ? k => k.toUpperCase() : k => k
  const removed = new Set((iso.owned ?? OPENCODE_REMOVED).map(key))
  const env = Object.fromEntries(Object.entries(base).filter(([k]) => !removed.has(key(k))))
  return { ...env, ...iso.env }
}

// The same as variables to type into a shell that has another environment (an Orca terminal):
// the ones to set, and the others the isolation owns, to clear. null without isolation.
export function isolationVars(iso) {
  if (!iso?.env) return null
  return { set: iso.env, unset: (iso.owned ?? OPENCODE_REMOVED).filter(k => !(k in iso.env)) }
}

// Auto-approval only for code jobs (0019): research and audit run agy in plan mode and OpenCode
// with its plan agent and without --auto, so neither can edit the project with its edit tools.
export function buildArgs(target, d, prompt, cfg, jobDir, cwd, kind = 'research', { geminiDir = null, standalone = false } = {}) {
  const readOnly = kind !== 'code'
  if (target === 'opencode') {
    // Without --auto a permission that asks is rejected at once ("This non-interactive run cannot
    // ask the user for permission"), but OpenCode 2.0.30's default edit permission is allow, so a
    // run without --auto still wrote files in and outside the project (trial 2026-11-19). The
    // built-in plan agent denies edit (write, edit, patch); its shell is not restricted, so a
    // read-only job is read-only for the edit tools, and the shell guard still applies.
    return ['run', ...(standalone ? ['--standalone'] : []), '--model', d.effortFlag ? `${d.model}#${d.effortFlag}` : d.model, '--format', 'json', ...(readOnly ? ['--agent', 'plan'] : ['--auto']), prompt]
  }
  if (target === 'claudecode') {
    // claude -p (flags from `claude --help`, 2.1.328; 0050). -p is a switch and the prompt the
    // positional argument. Read-only kinds run in plan mode; code in acceptEdits with nothing
    // left to prompt (a prompt is denied at once, never waited on), so the pack's permissions and
    // hooks decide the rest; never bypassPermissions. --add-dir takes several values, so it goes last.
    // TODO(trial): whether a code job's shell commands pass under acceptEdits in -p.
    const args = ['-p', prompt, '--model', d.model, ...(d.effortFlag ? ['--effort', d.effortFlag] : []), '--output-format', 'json', '--no-session-persistence']
    args.push('--permission-mode', readOnly ? 'plan' : 'acceptEdits', ...(readOnly ? [] : ['--permission-prompts', 'none']))
    const rel = relative(cwd, jobDir)
    if (rel.startsWith('..') || isAbsolute(rel)) args.push('--add-dir', jobDir)
    return args
  }
  // First, in one argument, as dotai run passes it (agy needs the absolute path).
  const args = [...(geminiDir ? [`--gemini_dir=${geminiDir}`] : []), '-p', prompt, '--model', d.model]
  if (d.effortFlag) args.push('--effort', d.effortFlag)
  const agyMode = readOnly ? 'plan' : cfg.agyMode
  args.push('--output-format', 'json', ...(agyMode === 'skip-permissions' ? ['--dangerously-skip-permissions'] : ['--mode', agyMode]))
  const rel = relative(cwd, jobDir)
  if (rel.startsWith('..') || isAbsolute(rel)) args.push('--add-dir', jobDir)
  return args
}

function line(id, word, rest) {
  return ['delegate', id, word, rest].filter(Boolean).join(' ')
}

function makeCtx(env) {
  const home = homedir()
  const dir = packHome(env, home)
  const { values, warnings, explicit, error } = loadConfig(dir)
  for (const w of warnings) process.stderr.write(`delegate: ${w}\n`)
  return {
    env,
    home,
    dir,
    cfg: values,
    // A delegate.yaml that fails closed, or a primary named there but not installed (0050): run and
    // check refuse, with a warning; status and workers still work.
    off: error ?? (explicit.includes('primary') ? primaryProblem(values.primary, { env, home }) : null),
    log: join(dir, 'launches.jsonl'),
    checks: join(dir, 'checks.jsonl'), // check and confirm entries, apart so they never evict launches
    quotaState: join(dir, 'quota-state.json'),
  }
}

// A delegation started by a delegated agent carries DOTAI_DELEGATE_CALLER (set by attempt); then
// that is the caller, whatever --from or a job file claims, so a delegated child can never pass
// for the primary (0009, 0050).
function callerOf(claimed, env) {
  return isDelegated(env) ? detectCaller(env) : (claimed ?? detectCaller(env))
}

function jobFromFlags(f, env, primary = DEFAULTS.primary) {
  return {
    target: f.to ?? secondaryOf(primary),
    from: callerOf(f.from, env),
    model: f.model,
    effort: f.effort,
    alt: f.alt,
    spec: f.spec,
    prompt: f.prompt,
    title: f.title,
    kind: f.kind ?? 'research',
  }
}

const realOr = p => {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

// The spec is copied into the job folder for another agent to read, so it must be the user's own
// task: a file (links resolved) inside the project root or the pack home, and never a path the
// secrets list denies (deny-paths.*.txt, the shell guard's list). Returns { ok, path } or
// { ok: false, reason }.
export function checkSpec(file, { cwd = process.cwd(), env = process.env, home = homedir(), packDir = packHome(env, home) } = {}) {
  let real
  try {
    real = realpathSync(file)
    if (!statSync(real).isFile()) return { ok: false, reason: `spec ${file} is not a file.` }
  } catch {
    return { ok: false, reason: `spec file not found: ${file}` }
  }
  const root = projectRootOf(cwd, env, home) ?? cwd
  if (![root, packDir].some(dir => isInside(real, realOr(dir)))) {
    return { ok: false, reason: `spec file ${file} is outside the project (${root}) and the pack home; copy it into the project first.` }
  }
  const deny = denyMatcher(cwd, { env, home })
  const hit = [resolve(file), real].map(p => deny.match(p)).find(h => h.matched)
  if (hit) return { ok: false, reason: `spec file ${file} matches the denied pattern ${hit.pattern}; delegated agents never read secrets.` }
  return { ok: true, path: real }
}

const JOB_ID = /^\d{8}-\d{6}-[a-z0-9]{4}$/

// Deletes job folders (named by job id only) last changed more than maxAgeDays ago. Best effort.
export function pruneJobs(jobsDir, now = Date.now(), maxAgeDays = JOB_MAX_AGE_DAYS) {
  let names = []
  try {
    names = readdirSync(jobsDir)
  } catch {
    return 0
  }
  let pruned = 0
  for (const name of names) {
    if (!JOB_ID.test(name)) continue
    const dir = join(jobsDir, name)
    try {
      const st = statSync(dir)
      if (st.isDirectory() && now - st.mtimeMs > maxAgeDays * 86400000) {
        rmSync(dir, { recursive: true, force: true })
        pruned++
      }
    } catch {}
  }
  return pruned
}

const jobsDirOf = (cwd, ctx) => {
  const root = projectRootOf(cwd, ctx.env, ctx.home)
  return root ? join(root, '.dotai', 'jobs') : join(ctx.dir, 'jobs')
}

// Runs one job end to end. Returns { code, text }.
async function runJob(job, opts, ctx, adapter) {
  const { cfg } = ctx
  const now = Date.now()
  const refuse = (code, word, reason, id) => {
    appendLog(ctx.log, { id, event: 'refused', ts: now, action: word, reason, model: job.model, effort: job.effort, from: job.from, harness: job.target, title: job.title }, cfg.logMax)
    return { code, text: line(id, word, reason) }
  }
  if (!KINDS.includes(job.kind)) return refuse(2, 'REJECT', `--kind is research, audit or code, not "${job.kind}".`)
  const quota = readQuota({ env: ctx.env, home: ctx.home, now, staleMinutes: cfg.staleMinutes })
  const d = decide({ job, quota, exhausted: loadExhausted(ctx.quotaState, now), cfg, mode: opts.mode, overCap: opts.overCap, now })
  if (d.action === 'reject') return refuse(2, 'REJECT', d.reason)
  if (d.action === 'defer') return refuse(3, 'DEFER', d.reason)
  if (d.action === 'ask') return refuse(4, 'ASK', d.reason)
  if (!job.spec && !job.prompt) return refuse(2, 'REJECT', 'no task: pass --spec FILE (or --prompt TEXT for a short one).')
  const cwd = process.cwd()
  let specPath = null
  if (job.spec) {
    const s = checkSpec(job.spec, { cwd, env: ctx.env, home: ctx.home, packDir: ctx.dir })
    if (!s.ok) return refuse(2, 'REJECT', s.reason)
    specPath = s.path
  }

  const id = newId()
  const jobDir = join(jobsDirOf(cwd, ctx), id)
  mkdirSync(jobDir, { recursive: true })
  if (specPath) copyFileSync(specPath, join(jobDir, 'spec.md'))
  else writeFileSync(join(jobDir, 'spec.md'), job.prompt)
  return attempt(job, d, { id, jobDir, cwd, n: 1 }, opts, ctx, adapter)
}

// One launch. Each attempt has its own folder (<job>/attempt-<n>/) for the CLI's raw output and
// any adapter files, so a retry never reads the first attempt's out.json or done marker.
async function attempt(job, d, where, opts, ctx, adapter) {
  const { cfg } = ctx
  const { id, jobDir, cwd, n } = where
  const target = job.target
  const exe = findOnPath(EXE[target] ?? target, ctx.env)
  const started = Date.now()
  const shown = `${target} ${d.model}/${d.effort}`
  appendLog(ctx.log, {
    id, event: 'start', ts: started, harness: target, from: job.from, model: d.model, effort: d.effort, pool: d.pool,
    title: job.title ?? '', kind: job.kind, mode: opts.mode, pid: process.pid, parent: ctx.env.DOTAI_DELEGATE_PARENT, jobDir,
  }, cfg.logMax)
  const end = (status, extra = {}) => appendLog(ctx.log, { id, event: 'end', ts: Date.now(), status, secs: Math.round((Date.now() - started) / 1000), ...extra }, cfg.logMax)
  if (!exe) {
    end('FAIL')
    return { code: 1, text: line(id, 'FAIL', `${shown}: ${EXE[target] ?? target} not found on PATH.`) }
  }
  const attemptDir = join(jobDir, `attempt-${n}`)
  const resultFile = join(jobDir, 'result.md')
  try {
    rmSync(attemptDir, { recursive: true, force: true })
    mkdirSync(attemptDir, { recursive: true })
    if (n > 1) rmSync(resultFile, { force: true })
  } catch (e) {
    end('FAIL')
    return { code: 1, text: line(id, 'FAIL', `${shown}: cannot prepare ${attemptDir} (${e.code || e.message}).`) }
  }
  const iso = { agy: agyIsolation, claudecode: claudeIsolation, opencode: openCodeIsolation }[target](ctx.home)
  if (iso.error) {
    end('FAIL')
    return { code: 1, text: line(id, 'FAIL', `${shown}: ${iso.error}.`) }
  }
  const prompt = buildPrompt(jobDir, job.kind)
  const args = buildArgs(target, d, prompt, cfg, jobDir, cwd, job.kind, iso)
  // The child knows who called it and under which launch, so a nested delegation is refused
  // (the child is never the primary, checkRoute) and shows under its parent in the tree.
  const env = { ...isolatedEnv(ctx.env, iso), DOTAI_DELEGATE_CALLER: target, DOTAI_DELEGATE_PARENT: id }
  let r
  try {
    r = await adapter.launch({ exe, cli: EXE[target], target, args, cwd, env, isolation: isolationVars(iso), jobDir, attemptDir, id, title: job.title || `delegate ${id}`, timeoutMs: cfg.timeoutMin * 60000 }, ctx)
  } catch (e) {
    end('FAIL')
    return { code: 1, text: line(id, 'FAIL', `${shown}: ${e.message}`) }
  }
  const secs = Math.round((Date.now() - started) / 1000)
  const via = r.via ? ` via=${r.via}` : ''
  if (r.timedOut) {
    end('TIMEOUT')
    return { code: 1, text: line(id, 'FAIL', `${shown}: timeout after ${secs}s (timeoutMin ${cfg.timeoutMin}).${via}`) }
  }
  // An adapter that knows the run is lost (an Orca terminal closed before its done marker).
  if (r.fail) {
    end('FAIL')
    return { code: 1, text: line(id, 'FAIL', `${shown} ${secs}s: ${r.fail}${via}`) }
  }
  const stderr = String(r.stderr ?? '')
  const lastLine = t => t.trim().split(/\r?\n/).at(-1) ?? ''
  const parsed = target === 'agy'
    ? parseAgyJson(r.stdout)
    : target === 'claudecode' ? parseClaudeJson(r.stdout) : parseOpenCodeJson(r.stdout, r.code, stderr)
  if (target !== 'opencode' && isQuotaError(parsed, stderr, target)) {
    markExhausted(ctx.quotaState, d.pool, cfg.exhaustedMinutes)
    end('QUOTA')
    const said = parsed.status === 'UNPARSED' && stderr.trim() ? lastLine(stderr) : parsed.error
    if (n === 1 && job.alt) {
      const again = decide({ job, quota: readQuota({ env: ctx.env, home: ctx.home, staleMinutes: cfg.staleMinutes }), exhausted: loadExhausted(ctx.quotaState), cfg, mode: opts.mode, overCap: opts.overCap })
      if (again.action === 'launch' && again.pool !== d.pool) return attempt(job, again, { ...where, id: `${id}-2`, n: 2 }, opts, ctx, adapter)
    }
    return { code: 3, text: line(id, 'DEFER', `${d.pool} pool exhausted: ${said.slice(0, 160)}. ${fallbackAdvice(job.from)}`) }
  }
  if (parsed.status !== 'SUCCESS') {
    end('FAIL', { inTok: parsed.inTok, outTok: parsed.outTok })
    const said = parsed.status === 'UNPARSED' && stderr.trim() ? lastLine(stderr) : parsed.error
    const why = said || lastLine(stderr) || r.error || `exit ${r.code}`
    return { code: 1, text: line(id, 'FAIL', `${shown} ${secs}s: ${why.slice(0, 200)}${via}`) }
  }
  if (!existsSync(resultFile) && parsed.response) writeFileSync(resultFile, parsed.response)
  // A run that wrote no result.md and replied nothing has nothing to give back (a read-only run
  // whose reply was lost): reported as a failure, never as OK with result=(none).
  if (!existsSync(resultFile)) {
    end('FAIL', { inTok: parsed.inTok, outTok: parsed.outTok })
    return { code: 1, text: line(id, 'FAIL', `${shown} ${secs}s: no reply and no result.md.${via}`) }
  }
  const model = parsed.model && parsed.model !== d.model ? ` actual-model=${parsed.model}!` : ''
  const tok = parsed.inTok ? ` in=${kTok(parsed.inTok)} out=${kTok(parsed.outTok)}` : ''
  end('OK', { inTok: parsed.inTok, outTok: parsed.outTok, result: resultFile })
  return { code: 0, text: line(id, 'OK', `${shown} ${secs}s${tok}${model}${via} result=${resultFile}`) }
}

function readJobFile(file, flags, env, primary) {
  const j = JSON.parse(readFileSync(file, 'utf8'))
  const base = dirname(resolve(file))
  return {
    ...jobFromFlags({ from: flags.from, ...j, to: j.to ?? flags.to }, env, primary),
    spec: j.spec ? resolve(base, j.spec) : undefined,
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker))
  return out
}

// ---------- commands

function help(adapter) {
  return [
    `delegate-backend (${adapter.variant}): hand research, audits or bulk mechanical work to the other harness (agy or Claude Code), or OpenCode, within quota.`,
    '  run --model M --effort E (--spec FILE | --prompt TEXT) [--title T] [--kind research|audit|code]',
    '      [--alt M2:E2] [--to agy|claudecode|opencode] [--from claudecode|agy] [--mode interactive|autonomous] [--over-cap]',
    adapter.refuseJobs ? null : '  run --jobs JOB.json...   several jobs in parallel, one job file each',
    '  check --model M --effort E [...]   validate the pair, route and quota; no launch',
    '  status [--line] [--watch]   launch tree, running jobs and quota',
    '  workers   how to run several workers in this variant',
    ...(adapter.helpExtra ?? []),
    'Exit: 0 ok, 1 failed, 2 rejected, 3 deferred (quota), 4 ask the user (soft cap).',
  ].filter(Boolean).join('\n')
}

async function cmdStatus(a, ctx) {
  const show = () => {
    const entries = readLog(ctx.log)
    const now = Date.now()
    if (a.flags.line) return statusLine(entries, now)
    const q = readQuota({ env: ctx.env, home: ctx.home, now, staleMinutes: ctx.cfg.staleMinutes })
    return `${quotaLine(q)}\n${renderTree(entries, now, { limit: a.flags.all ? Infinity : 20 })}`
  }
  if (!a.flags.watch) {
    process.stdout.write(show() + '\n')
    return 0
  }
  for (;;) {
    process.stdout.write('\x1b[2J\x1b[H' + show() + '\n\n(refreshing every 2 s; Ctrl+C to stop)\n')
    await new Promise(r => setTimeout(r, 2000))
  }
}

export async function main(argv, adapter, env = process.env) {
  let a
  try {
    a = parseArgs(argv)
  } catch (e) {
    process.stdout.write(`delegate REJECT ${e.message}\n${help(adapter)}\n`)
    return 2
  }
  if (a.flags.help || !a.cmd) {
    process.stdout.write(help(adapter) + '\n')
    return a.flags.help ? 0 : 2
  }
  const ctx = makeCtx(env)
  let mode
  try {
    mode = resolveMode(a.flags.mode, env)
  } catch (e) {
    process.stdout.write(`delegate REJECT ${e.message}\n`)
    return 2
  }
  const opts = { mode, overCap: !!a.flags['over-cap'] }
  if (ctx.off && (a.cmd === 'run' || a.cmd === 'check')) {
    process.stderr.write(`delegate: ${ctx.off}.\n`)
    process.stdout.write(`delegate REJECT ${ctx.off}.\n`)
    return 2
  }
  switch (a.cmd) {
    case 'run': {
      pruneJobs(jobsDirOf(process.cwd(), ctx))
      if (a.jobs.length) {
        if (adapter.refuseJobs) {
          process.stdout.write(`delegate REJECT ${adapter.refuseJobs}\n`)
          return 2
        }
        const results = await pool(a.jobs, ctx.cfg.maxParallel, async f => {
          try {
            return await runJob(readJobFile(f, a.flags, env, ctx.cfg.primary), opts, ctx, adapter)
          } catch (e) {
            return { code: 2, text: line(null, 'REJECT', `job file ${f}: ${e.message}`) }
          }
        })
        process.stdout.write(results.map(r => r.text).join('\n') + '\n')
        return Math.max(...results.map(r => r.code))
      }
      const r = await runJob(jobFromFlags(a.flags, env, ctx.cfg.primary), opts, ctx, adapter)
      process.stdout.write(r.text + '\n')
      return r.code
    }
    case 'check': {
      const job = jobFromFlags(a.flags, env, ctx.cfg.primary)
      const now = Date.now()
      const d = decide({ job, quota: readQuota({ env, home: ctx.home, now, staleMinutes: ctx.cfg.staleMinutes }), exhausted: loadExhausted(ctx.quotaState, now), cfg: ctx.cfg, mode, overCap: opts.overCap, now })
      const codes = { reject: [2, 'REJECT'], defer: [3, 'DEFER'], ask: [4, 'ASK'] }
      if (codes[d.action]) {
        const [code, word] = codes[d.action]
        appendLog(ctx.checks, { event: 'refused', ts: now, action: word, reason: d.reason, model: job.model, effort: job.effort, from: job.from, harness: job.target, title: job.title }, ctx.cfg.logMax)
        process.stdout.write(`delegate ${word} ${d.reason}\n`)
        return code
      }
      appendLog(ctx.checks, { event: 'checked', ts: now, model: d.model, effort: d.effort, pool: d.pool, from: job.from, harness: job.target, title: job.title }, ctx.cfg.logMax)
      const extra = adapter.checkExtra?.(d, job) ?? ''
      process.stdout.write(`delegate CHECK OK pool=${d.pool} model=${d.model} effort=${d.effort}${d.usedAlt ? ' (alternative)' : ''}${extra}\n`)
      return 0
    }
    case 'status':
      return cmdStatus(a, ctx)
    case 'workers':
      process.stdout.write(adapter.workersGuide(ctx) + '\n')
      return 0
    default:
      if (adapter.commands?.[a.cmd]) return adapter.commands[a.cmd](a, ctx)
      process.stdout.write(`delegate REJECT unknown command "${a.cmd}"\n${help(adapter)}\n`)
      return 2
  }
}

// The CLI runs as a child of this process; its stdout (the JSON result, any size) goes to
// out.json in the attempt folder and is parsed from there.
export function headlessLaunch(spec) {
  return runCli(spec.exe, spec.args, { cwd: spec.cwd, env: spec.env, timeoutMs: spec.timeoutMs, stdoutFile: join(spec.attemptDir ?? spec.jobDir, 'out.json') })
}
