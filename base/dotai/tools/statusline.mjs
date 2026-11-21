// Statusline for Claude Code and agy (pack 0017, update 2026-11-21): one line for the harness
// that runs it, with its own quota only,
//   Claude │ 5h ███░░░░░  41% ↻ 2h 13m │ 7d ██░░░░░░  22% ↻ 3d 4h   │ Opus · ctx 34%
//   Gemini │ 5h █░░░░░░░   8% ↻ 4h 2m  │ 7d ░░░░░░░░   5% ↻ 6d 1h   │ 3.8 Flash (Medium)
// A window the harness does not report (Claude Code sends no five_hour on some plans) or has no
// data for is left out. Bars and percentages are green, yellow from 50%, red from 80%; NO_COLOR
// drops the color only.
// Each harness gives quota only to its own statusline command, on stdin: Claude Code
// `rate_limits.five_hour|seven_day` (used_percentage, resets_at), agy `quota` with the pools
// `gemini-5h`, `gemini-weekly`, `3p-5h`, `3p-weekly` (used_percentage or remaining_fraction,
// reset_in_seconds or reset_time). So each run writes its harness's snapshot, which the delegate reads for both pools:
//   ~/.claude/rate_limits.json                    (fields kept from the old statusline; under
//                                                 CLAUDE_CONFIG_DIR when set)
//   ~/.gemini/antigravity-cli/rate_limits.json    (read by delegate, RUNTIME; now also with each
//                                                  pool's reset as an absolute time, 0017)
// A snapshot older than STALE_SEC keeps its values, dimmed, and shows its age (unknown counts as
// available, 0022).
// A payload without its quota block (`rate_limits` before Claude Code's first answer, `quota` in
// agy) writes nothing, so the last good snapshot survives; the line shows it with the payload's
// model and context. A snapshot is replaced atomically or not at all.
// A second line, `delegate: N running · last OK 2m ago`, comes from the launch log that the
// delegate backend and the agent guard write (<pack home>/launches.jsonl, delegate-core.mjs);
// without that log, or with an empty one, the line is omitted, and the delegate code is loaded only
// when the log exists.
// No subprocesses, one or two small files: it runs on every refresh.
// Entry point: `node statusline.mjs <claudecode|antigravity>`, stdin from the harness.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { harnessArg, isObject, packHome, readStdin } from './hook-lib.mjs'

export const STALE_SEC = 15 * 60 // TODO(trial): tune against agy's refresh rate
const LABEL_WIDTH = 9

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const pctOf = v => (num(v) === null ? null : Math.max(0, Math.min(100, Math.round(Number(v)))))
// Epoch seconds; a value in milliseconds is converted.
const epoch = v => {
  const n = num(v)
  return n === null ? null : n > 1e12 ? Math.round(n / 1000) : Math.round(n)
}

export function formatDuration(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '?'
  if (sec <= 0) return 'now'
  const s = Math.floor(sec)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const modelName = m => {
  const raw = isObject(m) ? (m.display_name ?? m.id ?? '') : (m ?? '')
  return String(raw).replace(/^Gemini\s*/i, '').trim()
}

// Normalized shape: { ts, model, ctx, five: { pct, reset }, week: { pct, reset } } for Claude;
// { ts, model, ctx, gemini: { five, week }, p3: { five, week } } for agy.
export function fromClaude(d, now) {
  const rl = isObject(d?.rate_limits) ? d.rate_limits : {}
  const win = w => ({ pct: pctOf(w?.used_percentage), reset: epoch(w?.resets_at) })
  return { ts: now, model: modelName(d?.model), ctx: pctOf(d?.context_window?.used_percentage), five: win(rl.five_hour), week: win(rl.seven_day) }
}

function agyBucket(b, now) {
  if (!isObject(b)) return { pct: null, reset: null }
  let pct = pctOf(b.used_percentage)
  if (pct === null && num(b.remaining_fraction) !== null) pct = pctOf((1 - Number(b.remaining_fraction)) * 100)
  let reset = null
  if (num(b.reset_in_seconds) !== null) reset = now + Math.round(Number(b.reset_in_seconds))
  else if (b.reset_time) {
    const t = Date.parse(b.reset_time)
    if (Number.isFinite(t)) reset = Math.round(t / 1000)
  } else reset = epoch(b.resets_at)
  return { pct, reset }
}

export function fromAgy(d, now) {
  const q = isObject(d?.quota) ? d.quota : {}
  return {
    ts: now,
    model: modelName(d?.model),
    ctx: pctOf(d?.context_window?.used_percentage),
    gemini: { five: agyBucket(q['gemini-5h'], now), week: agyBucket(q['gemini-weekly'], now) },
    p3: { five: agyBucket(q['3p-5h'], now), week: agyBucket(q['3p-weekly'], now) },
  }
}

const claudeSnapshot = c => ({
  ts: c.ts,
  model: c.model || null,
  five_hour_pct: c.five.pct,
  five_hour_resets: c.five.reset,
  seven_day_pct: c.week.pct,
  seven_day_resets: c.week.reset,
  context_pct: c.ctx,
})
const claudeFromSnapshot = j =>
  isObject(j) && num(j.ts) !== null
    ? {
        ts: Number(j.ts),
        model: String(j.model ?? ''),
        ctx: pctOf(j.context_pct),
        five: { pct: pctOf(j.five_hour_pct), reset: epoch(j.five_hour_resets) },
        week: { pct: pctOf(j.seven_day_pct), reset: epoch(j.seven_day_resets) },
      }
    : null

const agySnapshot = a => ({
  ts: a.ts,
  model: a.model || null,
  context_pct: a.ctx,
  gemini_5h_pct: a.gemini.five.pct,
  gemini_7d_pct: a.gemini.week.pct,
  p3_5h_pct: a.p3.five.pct,
  p3_7d_pct: a.p3.week.pct,
  gemini_5h_resets: a.gemini.five.reset,
  gemini_7d_resets: a.gemini.week.reset,
  p3_5h_resets: a.p3.five.reset,
  p3_7d_resets: a.p3.week.reset,
})
const agyFromSnapshot = j =>
  isObject(j) && num(j.ts) !== null
    ? {
        ts: Number(j.ts),
        model: String(j.model ?? ''),
        ctx: pctOf(j.context_pct),
        gemini: { five: { pct: pctOf(j.gemini_5h_pct), reset: epoch(j.gemini_5h_resets) }, week: { pct: pctOf(j.gemini_7d_pct), reset: epoch(j.gemini_7d_resets) } },
        p3: { five: { pct: pctOf(j.p3_5h_pct), reset: epoch(j.p3_5h_resets) }, week: { pct: pctOf(j.p3_7d_pct), reset: epoch(j.p3_7d_resets) } },
      }
    : null

const colorOn = () => !process.env.NO_COLOR
const sgr = (code, text) => (colorOn() && text ? `\x1b[${code}m${text}\x1b[0m` : text)
const level = pct => (pct >= 80 ? 31 : pct >= 50 ? 33 : 32) // red, yellow, green
const BAR = 8
const RESET_WIDTH = 7 // `23h 59m`, the longest reset, so the line does not shift as it counts down

// One line for the harness running it: its label, each window it reports (a window it does not
// report, or with no data, is left out), then the model and context. A stale snapshot keeps its
// values, dimmed, and shows its age.
export function render({ label, snap, now }) {
  const stale = !!snap && now - snap.ts > STALE_SEC
  const paint = (pct, text) => (stale ? sgr(2, text) : sgr(level(pct), text))
  const windows = [
    ['5h', snap?.five],
    ['7d', snap?.week],
  ]
    .filter(([, w]) => w && w.pct !== null)
    .map(([name, w]) => {
      const filled = Math.round((w.pct / 100) * BAR)
      const bar = paint(w.pct, '█'.repeat(filled)) + sgr(stale ? 2 : 90, '░'.repeat(BAR - filled))
      const reset = w.reset === null ? '' : `↻ ${formatDuration(w.reset - now).padEnd(RESET_WIDTH)}`
      return `${name} ${bar} ${paint(w.pct, `${w.pct}%`.padStart(4))} ${stale ? sgr(2, reset) : reset}`.trimEnd()
    })
  const info = stale ? [`${formatDuration(now - snap.ts)} ago`] : [snap?.model || null, snap?.ctx == null ? null : `ctx ${snap.ctx}%`].filter(Boolean)
  const sep = ` ${sgr(90, '│')} `
  return [sgr(1, label), ...windows, sgr(90, info.join(' · '))].filter(Boolean).join(sep)
}

const readJson = f => {
  try {
    return JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''))
  } catch {
    return null
  }
}
// Atomic or nothing: a reader holding the file on Windows makes the rename fail, and then this
// refresh is skipped (the next one writes it) rather than writing the file in place, which a
// concurrent reader could see half-written.
function writeJson(f, data) {
  const tmp = `${f}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(tmp, JSON.stringify(data))
    renameSync(tmp, f)
  } catch {
    try {
      rmSync(tmp, { force: true })
    } catch {}
  }
}

// The last good snapshot with the live model and context, for a payload that carries no quota.
const withLive = (prev, cur) => (prev ? { ...prev, model: cur.model || prev.model, ctx: cur.ctx ?? prev.ctx } : cur)

// The delegate line, or null. The pack home is the one delegate-core.mjs uses.
export async function delegateLine(env = process.env, home = homedir(), now = Date.now()) {
  const log = join(packHome(env, home), 'launches.jsonl')
  const has = f => existsSync(f) && statSync(f).size > 0
  try {
    if (!has(log) && !has(`${log}.1`)) return null
    const { readLog, statusLine } = await import('./delegate-core.mjs')
    const entries = readLog(log)
    return entries.length ? statusLine(entries, now) : null
  } catch {
    return null
  }
}

async function main() {
  const raw = await readStdin()
  if (!raw.trim()) return
  let d
  try {
    d = JSON.parse(raw)
  } catch {
    return
  }
  if (!isObject(d)) return
  const now = Math.floor(Date.now() / 1000)
  const home = homedir()
  // Claude Code's config directory, the rule agent-guard uses: an isolated session
  // (CLAUDE_CONFIG_DIR) keeps its own snapshot and never overwrites the default one.
  const ccFile = join(process.env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'rate_limits.json')
  const agyFile = join(home, '.gemini', 'antigravity-cli', 'rate_limits.json')
  const harness = harnessArg() ?? (isObject(d.quota) ? 'antigravity' : 'claudecode')
  // Each run still writes its harness's snapshot: the delegate reads both pools from them (0050).
  let line
  if (harness === 'antigravity') {
    let agy = fromAgy(d, now)
    if (isObject(d.quota)) writeJson(agyFile, agySnapshot(agy))
    else agy = withLive(agyFromSnapshot(readJson(agyFile)), agy)
    line = render({ label: 'Gemini', snap: { ts: agy.ts, model: agy.model, ctx: agy.ctx, five: agy.gemini.five, week: agy.gemini.week }, now })
  } else {
    let cc = fromClaude(d, now)
    // An empty object (`rate_limits: {}`) carries no quota either: the snapshot is kept.
    if (isObject(d.rate_limits) && Object.keys(d.rate_limits).length) writeJson(ccFile, claudeSnapshot(cc))
    else cc = withLive(claudeFromSnapshot(readJson(ccFile)), cc)
    line = render({ label: 'Claude', snap: cc, now })
  }
  const extra = await delegateLine(process.env, home)
  process.stdout.write(`${line}\n${extra ? `${extra}\n` : ''}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
