// PreCompact: saves the session summary to Engram before the context is compacted (pack 0041,
// 0042: the summary is written only here, not at every session end, and the model runs no
// ritual). The summary is built from the transcript, without a model: the first prompt (the
// goal), the latest prompts, the files edited and the last assistant message, capped at about
// 500 tokens. Saved with `engram save --type session_summary`, keyed by `--topic
// session-summary/<session id>` so a second compaction of the same session updates it.
// Claude Code sends { session_id, transcript_path, cwd, trigger }; OpenCode's rulesync plugin
// (experimental.session.compacting) may send no transcript, and then nothing is saved
// (TODO(trial)). agy has no PreCompact event.
// The project name is the project root's directory name, lowercased (TODO(trial): match
// Engram's own project detection).
// Secrets never reach the store: every text is redacted (redact) before it is saved, and files
// the secrets list denies (deny-paths.*.txt, hook-lib denyMatcher) are left out of the list.
// A summary that cannot be saved is recorded in <pack home>/hook-errors.log, which the next
// session start reports in one line (hook-lib recordHookError).
// Never fails the hook. Entry point: `node memory-compact.mjs <harness>`.
import { openSync, readSync, closeSync, statSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { cliInvocation, denyMatcher, findOnPath, parsePayload, projectRootOf, readStdin, recordHookError, runCapped } from './hook-lib.mjs'

const MAX_TRANSCRIPT_BYTES = 8 << 20 // the tail of a longer transcript is enough
const MAX_SUMMARY = 2000
const RECENT_PROMPTS = 5
const MAX_FILES = 12
const SAVE_TIMEOUT_MS = 20000
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'edit', 'write'])

const R = '[redacted]'
const entropy = s => {
  const counts = {}
  for (const c of s) counts[c] = (counts[c] ?? 0) + 1
  return Object.values(counts).reduce((h, n) => h - (n / s.length) * Math.log2(n / s.length), 0)
}
// Token shapes first, then assignments, then any long random-looking word: 32 or more letters,
// digits, `+`, `_`, `=` or `-` (no `/` or `.`, so paths and file names stay), with a letter and a
// digit and at least 3.5 bits of entropy per character. Lossy on purpose: a hash or a UUID is
// redacted too.
const SECRET_RULES = [
  [/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g, R],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${R}`],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, R],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, R],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, R],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, R],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, R],
  [/\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s;&|,]+)/gi, `$1=${R}`],
  [/[A-Za-z0-9+_=-]{32,}/g, w => (/[A-Za-z]/.test(w) && /\d/.test(w) && entropy(w) >= 3.5 ? R : w)],
]
export function redact(text) {
  let out = String(text)
  for (const [re, by] of SECRET_RULES) out = out.replace(re, by)
  return out
}

const clip = (s, n) => {
  const t = String(s).replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const texts = content =>
  typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter(c => c?.type === 'text').map(c => String(c.text ?? '')) : []

// Builds the summary from transcript JSONL; '' when the session has no prompt worth saving.
// `isDenied(absPath)` leaves a file out of the edited list. Every text is redacted before it is
// clipped, so a cut never leaves half a secret behind.
export function summarize(jsonl, { root = null, sessionId = '', trigger = '', isDenied = () => false } = {}) {
  const prompts = []
  const files = []
  let last = ''
  for (const raw of String(jsonl).split(/\r?\n/)) {
    if (!raw.trim()) continue
    let e
    try {
      e = JSON.parse(raw)
    } catch {
      continue
    }
    const content = e?.message?.content
    if (e?.type === 'user' && !e.isMeta) {
      for (const t of texts(content)) if (t.trim() && !t.trim().startsWith('<')) prompts.push(redact(t))
    } else if (e?.type === 'assistant') {
      const said = texts(content).filter(t => t.trim())
      if (said.length) last = redact(said[said.length - 1])
      for (const c of Array.isArray(content) ? content : []) {
        const f = c?.type === 'tool_use' && EDIT_TOOLS.has(c.name) ? (c.input?.file_path ?? c.input?.filePath ?? c.input?.notebook_path) : null
        if (!f) continue
        const abs = isAbsolute(String(f)) || !root ? String(f) : resolve(root, String(f))
        if (isDenied(abs)) continue
        const shown = (root ? relative(root, String(f)) : String(f)).replaceAll('\\', '/')
        const i = files.indexOf(shown)
        if (i >= 0) files.splice(i, 1)
        files.push(shown)
      }
    }
  }
  if (!prompts.length) return ''
  const lines = [`Session ${sessionId.slice(0, 8) || '?'} compacted${trigger ? ` (${trigger})` : ''} on ${new Date().toISOString().slice(0, 10)}.`]
  lines.push(`Goal: ${clip(prompts[0], 300)}`)
  const recent = prompts.slice(1).slice(-RECENT_PROMPTS)
  if (recent.length) lines.push('Recent prompts:', ...recent.map(p => `- ${clip(p, 180)}`))
  if (files.length) lines.push(`Files edited: ${files.slice(-MAX_FILES).join(', ')}`)
  if (last) lines.push(`Last state: ${clip(last, 400)}`)
  const out = redact(lines.join('\n'))
  return out.length > MAX_SUMMARY ? `${out.slice(0, MAX_SUMMARY - 1)}…` : out
}

function readTail(file) {
  const size = statSync(file).size
  const len = Math.min(size, MAX_TRANSCRIPT_BYTES)
  const buf = Buffer.alloc(len)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, buf, 0, len, size - len)
  } finally {
    closeSync(fd)
  }
  let text = buf.toString('utf8')
  if (len < size) text = text.slice(text.indexOf('\n') + 1) // drop the partial first line
  return text
}

async function main() {
  const parsed = parsePayload(await readStdin())
  const p = parsed.payload
  try {
    const transcript = String(p.transcript_path ?? '')
    if (!transcript) return
    let jsonl
    try {
      jsonl = readTail(transcript)
    } catch {
      return
    }
    const root = projectRootOf(parsed.cwd) ?? parsed.cwd
    const sessionId = String(p.session_id ?? '')
    const deny = denyMatcher(parsed.cwd)
    const summary = summarize(jsonl, { root, sessionId, trigger: String(p.trigger ?? ''), isDenied: f => deny.match(f).matched })
    if (!summary) return
    const bin = findOnPath('engram')
    if (!bin) return fail('engram is not on PATH')
    const project = basename(root).toLowerCase()
    const args = ['save', `Session summary: ${project} ${new Date().toISOString().slice(0, 10)}`, summary, '--type', 'session_summary', '--project', project]
    if (sessionId) args.push('--topic', `session-summary/${sessionId}`)
    const inv = cliInvocation(bin, args)
    const r = await runCapped(inv.file, inv.args, { cwd: root, timeoutMs: SAVE_TIMEOUT_MS, verbatim: inv.verbatim, maxBytes: 64 * 1024 })
    if (r.code !== 0) fail(`engram save failed (${r.error ?? `exit ${r.code}`})`)
  } catch (e) {
    fail(e.message)
  }
}

// Stderr goes nowhere visible in a PreCompact hook, so the reason is also kept for the next
// session start.
function fail(reason) {
  process.stderr.write(`memory: ${reason}; the session summary was not saved.\n`)
  recordHookError('memory-compact', reason)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
