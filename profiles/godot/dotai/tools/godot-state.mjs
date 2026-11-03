// SessionStart: optional derived project state, capped (DESIGN 4.2, principle P7).
// Off unless .dotai/config.yaml sets godot.stateCommand, so a project without a state
// script pays nothing. The command's own output is the state; this script only runs it
// from the project root with a timeout and caps what reaches the context.
//   godot:
//     stateCommand: python tools/state.py --brief
//     stateMaxLines: 30      # optional
//     stateMaxChars: 1600    # optional (~400 tokens)
//     stateTimeoutSec: 10    # optional; clamped to MAX_STATE_SEC, under the hook's own timeout
// Trust: the command runs through the shell. It comes only from .dotai/config.yaml, which is
// local (never committed), written by onboarding or the user, and read only inside the project.
// Output: plain text for Claude Code and OpenCode; injectSteps JSON for agy (hook-lib).
import { dirname } from 'node:path'
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
  process.stderr.write(`godot state: cannot load hook-lib.mjs from ${LIB.href} (${e.code || e.message}); no project state until the base pack is reinstalled.\n`)
  process.exit(1)
}
const { capOutput, findConfig, formatSessionStart, loadSection, numberSettings, parsePayload, readStdin, runCapped } = lib

export const STATE_DEFAULTS = { stateMaxLines: 30, stateMaxChars: 1600, stateTimeoutSec: 10 }
// Under the hook's 15 s timeout (.rulesync/hooks.jsonc), with room for node to start.
export const MAX_STATE_SEC = 12

export function stateTimeoutMs(cfg) {
  const sec = typeof cfg.stateTimeoutSec === 'number' && cfg.stateTimeoutSec > 0 ? cfg.stateTimeoutSec : STATE_DEFAULTS.stateTimeoutSec
  return Math.min(sec, MAX_STATE_SEC) * 1000
}

export async function stateFor(cwd) {
  const { values: cfg, warnings } = numberSettings(loadSection(cwd, 'godot'), STATE_DEFAULTS, 'godot')
  const cmd = typeof cfg.stateCommand === 'string' ? cfg.stateCommand.trim() : ''
  if (!cmd) return ''
  const root = dirname(dirname(findConfig(cwd)))
  const timeoutMs = stateTimeoutMs(cfg)
  const r = await runCapped(cmd, [], { cwd: root, shell: true, timeoutMs })
  const notes = warnings.length ? `\n${warnings.join('\n')}` : ''
  if (r.error || r.code !== 0) {
    const why = r.error ? (r.timedOut ? `timed out after ${timeoutMs / 1000} s (godot.stateTimeoutSec)` : r.error) : `exit ${r.code}`
    return `Project state: \`${cmd}\` failed (${why}); run it by hand if the task needs project state.${notes}`
  }
  return `Project state (godot.stateCommand, capped):\n${capOutput(r.stdout, cfg.stateMaxLines, cfg.stateMaxChars)}${notes}`
}

async function main() {
  const parsed = parsePayload(await readStdin())
  let out = ''
  try {
    out = await stateFor(parsed.cwd)
  } catch {
    out = ''
  }
  const text = formatSessionStart(parsed.harness, out)
  if (text) process.stdout.write(text)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
