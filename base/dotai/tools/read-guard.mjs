// PreToolUse guard for file reads, every harness.
//   1. Secrets (pack 0038): a path the deny list names (`deny-paths.*.txt`, the shell guard's
//      list; hook-lib denyMatcher) is denied whatever its size or range, so agy's view_file and
//      OpenCode's read get the same block as Claude Code's Read deny rules.
//   2. Artifacts (0039) are guarded by size, not denied.
// A full read of a file over the threshold whose path matches an artifact pattern is denied,
// with advice to read a range, search it with rg or use the tool's own command. Ranges
// (offset/limit, PDF pages, agy line ranges), small files and other paths pass.
// Patterns: `read-size.*.txt` in ~/.dotai/tools/ (base and variant) and the project's
// .dotai/tools/ (profiles), merged (dotai 0030), gitignore-style (hook-lib compilePatterns).
// Threshold: readSize.maxKb in .dotai/config.yaml, default 64 KB (about 16k tokens; Claude
// Code's Read refuses files over 25k tokens anyway).
// Never blocks on its own failure. Entry point: `node read-guard.mjs <harness>`.
import { statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  compilePatterns,
  denyMatcher,
  formatPreToolUse,
  isObject,
  harnessArg,
  loadSection,
  numberSettings,
  parsePayload,
  projectRootOf,
  projectToolsDir,
  readPatternFiles,
  readStdin,
  userToolsDir,
} from './hook-lib.mjs'

export const DEFAULTS = { maxKb: 64 }

const given = v => v !== undefined && v !== null && v !== ''

// Claude Code Read: { file_path, offset, limit, pages }. OpenCode read: { filePath, offset,
// limit }. agy view_file: { AbsolutePath, StartLine, EndLine } (TODO(trial): agy's read tool
// name and fields, from its hooks docs only).
export function readRequest(payload) {
  const p = isObject(payload) ? payload : {}
  const a = isObject(p.toolCall) ? (isObject(p.toolCall.args) ? p.toolCall.args : {}) : isObject(p.tool_input) ? p.tool_input : {}
  const path = String(a.file_path ?? a.filePath ?? a.AbsolutePath ?? a.path ?? a.Path ?? '')
  const partial = [a.offset, a.limit, a.pages, a.StartLine, a.EndLine, a.Offset, a.Limit].some(given)
  return { path, partial }
}

// `denied`: match(absPath) -> { matched, pattern } for the secrets list, or null.
export function decide(request, { cwd = process.cwd(), root = null, patterns = [], maxKb = DEFAULTS.maxKb, denied = null } = {}) {
  if (!request.path) return null
  const abs = isAbsolute(request.path) ? request.path : resolve(cwd, request.path)
  const secret = denied?.(abs)
  if (secret?.matched) {
    return {
      decision: 'deny',
      reason: `read guard: ${request.path} is a denied path (matches ${secret.pattern}). Agents do not read secrets: do not retry with another reader or tool; if the user needs it, they run it themselves.`,
    }
  }
  if (request.partial) return null
  let size
  try {
    const st = statSync(abs)
    if (!st.isFile()) return null
    size = st.size
  } catch {
    return null // a missing file is the tool's error to report
  }
  if (size <= maxKb * 1024) return null
  const hit = compilePatterns(patterns)(abs, root)
  if (!hit.matched) return null
  const kb = Math.round(size / 1024)
  return {
    decision: 'deny',
    reason:
      `read guard: ${request.path} is ${kb} KB (over ${maxKb} KB) and matches the artifact pattern ${hit.pattern}. ` +
      "Read a range (offset and limit), search it with rg, or ask the tool that made it (npm ls, git log, the build's own report).",
  }
}

async function main() {
  const raw = await readStdin()
  const parsed = parsePayload(raw)
  const harness = harnessArg() ?? parsed.harness
  let decision = null
  let warnings = []
  try {
    const cwd = parsed.cwd
    const settings = numberSettings(loadSection(cwd, 'readSize'), DEFAULTS, 'readSize')
    warnings = settings.warnings
    const { lines } = readPatternFiles('read-size', [userToolsDir(), projectToolsDir(cwd)])
    const deny = denyMatcher(cwd)
    decision = decide(readRequest(parsed.payload), { cwd, root: projectRootOf(cwd), patterns: lines, maxKb: settings.values.maxKb, denied: deny.match })
  } catch (e) {
    process.stderr.write(`read guard: skipped (${e.message})\n`)
  }
  for (const w of warnings) process.stderr.write(`read guard: ${w}\n`)
  const reason = decision && warnings.length ? `${decision.reason} (${warnings.join(' ')})` : (decision?.reason ?? '')
  const out = formatPreToolUse(harness, decision?.decision ?? null, reason)
  if (out) process.stdout.write(out)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
