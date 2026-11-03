// SessionStart for every harness.
//   1. Onboarding (pack 0040): in a project without the engine's applied-profiles marker
//      (.dotai/state.json, PACK-FORMAT) and without the pack's done marker
//      (.dotai/packs/dotai-lartweib-pack/onboarded.json, written by dotai-analyze), the agent is
//      told to suggest dotai-analyze once. Only for a new session (Claude Code `source: startup`,
//      or a harness that sends no source). The hook writes nothing in the project: a marker of
//      its own would create .dotai/ in a project that never asked for dotai.
//   2. Memory (0041, 0042): the author's preferences from Engram, through its CLI, read-only and
//      capped at about 300 tokens. Also after a compaction, which drops them from the context;
//      not on resume, which keeps them. Pinned items are not injected yet: the pinned CLI
//      (v1.20.0) has no command that lists them (TODO(trial)).
//   3. Memory failures: the newest entry of <pack home>/hook-errors.log (a summary PreCompact
//      could not save, or a preference search that failed here) becomes one line, then the log
//      is cleared (hook-lib takeHookError). A missing engram is not recorded here: it only means
//      memory is not installed.
// Claude Code and OpenCode get plain text; agy only reads injectSteps JSON (hook-lib
// formatSessionStart). Never fails the session. Entry point: `node session-start.mjs <harness>`.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  PACK,
  capOutput,
  cliInvocation,
  findOnPath,
  formatSessionStart,
  harnessArg,
  parsePayload,
  projectRootOf,
  readStdin,
  recordHookError,
  runCapped,
  samePath,
  takeHookError,
} from './hook-lib.mjs'

export { PACK }
export const DONE_MARKER = join('.dotai', 'packs', PACK, 'onboarded.json')
const ENGINE_MARKER = join('.dotai', 'state.json')
const PREFS_MAX_LINES = 15
const PREFS_MAX_CHARS = 1200 // about 300 tokens (0041)
const PREFS_TIMEOUT_MS = 8000

const HINT =
  'dotai: this project has no applied profiles (.dotai/state.json is missing). Suggest once that the user runs the dotai-analyze skill to choose profiles and clean up clashing config; do not run it unasked.'

export function onboardingHint(cwd, { env = process.env, home = homedir() } = {}) {
  const root = projectRootOf(cwd, env, home)
  if (!root || samePath(root, home)) return ''
  if (existsSync(join(root, DONE_MARKER)) || existsSync(join(root, ENGINE_MARKER))) return ''
  return HINT
}

// `engram search` needs a query; "preference" with the type filter asks for the author's typed
// preferences (TODO(trial): check what the FTS query returns on the real store).
export async function preferences(cwd, env = process.env) {
  const bin = findOnPath('engram', env)
  if (!bin) return ''
  const inv = cliInvocation(bin, ['search', 'preference', '--type', 'preference', '--scope', 'personal', '--limit', '10'])
  const r = await runCapped(inv.file, inv.args, { cwd, timeoutMs: PREFS_TIMEOUT_MS, verbatim: inv.verbatim, maxBytes: 64 * 1024 })
  if (r.code !== 0) {
    recordHookError('session-start', `engram search failed (${r.error ?? `exit ${r.code}`})`, env)
    return ''
  }
  const text = r.stdout
    .split(/\r?\n/)
    .filter(l => !/^(Update available|To update:|\s+go install|\s+or: https)/.test(l))
    .join('\n')
    .trim()
  if (!text || /^no (memories|results|observations)/i.test(text)) return ''
  return `Author preferences (Engram):\n${capOutput(text, PREFS_MAX_LINES, PREFS_MAX_CHARS)}`
}

// One line for the newest recorded memory failure, or ''. Taking it clears the log.
export function memoryNotice(env = process.env) {
  const e = takeHookError(env)
  if (!e) return ''
  return e.tool === 'session-start' ? `memory: preferences not loaded last session (${e.reason})` : `memory: last summary not saved (${e.reason})`
}

async function main() {
  const parsed = parsePayload(await readStdin())
  const harness = harnessArg() ?? parsed.harness
  const source = String(parsed.payload.source ?? '')
  const parts = []
  try {
    parts.push(memoryNotice())
    if (!source || source === 'startup') parts.push(onboardingHint(parsed.cwd))
    if (source !== 'resume') parts.push(await preferences(parsed.cwd))
  } catch (e) {
    process.stderr.write(`session start: ${e.message}\n`)
  }
  const out = formatSessionStart(harness, parts.filter(Boolean).join('\n\n'))
  if (out) process.stdout.write(out)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
