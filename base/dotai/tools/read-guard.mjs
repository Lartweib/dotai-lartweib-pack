// PreToolUse guard for file reads, every harness.
//   1. Secrets (pack 0038): a path the deny list names (`deny-paths.*.txt`, the shell guard's
//      list; hook-lib denyMatcher) is denied whatever its size or range, so agy's file tools and
//      OpenCode's read get the same block as Claude Code's Read deny rules.
//      agy also gets its other tools that return file content here, since agy relies on these
//      hooks for `.env` (its own deny list takes absolute paths only; base/.rulesync/permissions.jsonc):
//      - outline and code-item views: the path, like a read.
//      - content searches (grep_search, codebase_search, ...): denied when the target is a denied
//        file, an include names one, or the scope directory holds one the includes do not leave
//        out, because a search over a directory returns the matching lines of every file in it.
//        A scope too large to check is denied too. A narrower scope or an include (`*.ts`) passes.
//      - run_workflow (a script agy runs; seen doing a content search with os.walk, agy 1.5.12,
//        trial 2026-11-19): denied when the script names a denied path, or walks a tree while the
//        workspace holds a denied file. A text filter like the shell guard: it stops an accidental
//        read, not a script built to evade it.
//      Listing tools (list_dir, find_by_name, file_search) return names only and stay unguarded.
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
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  compilePatterns,
  denyMatcher,
  expandHome,
  firstDeniedUnder,
  formatPreToolUse,
  includeNamesDenied,
  isObject,
  harnessArg,
  loadSection,
  numberSettings,
  parsePayload,
  projectRootOf,
  projectToolsDir,
  readPatternFiles,
  readStdin,
  SEARCH_MAX_ENTRIES,
  userToolsDir,
} from './hook-lib.mjs'

export const DEFAULTS = { maxKb: 64 }

const given = v => v !== undefined && v !== null && v !== ''

// Claude Code Read: { file_path, offset, limit, pages }. OpenCode read: { path, offset, limit }
// in 2.0.30 (trial 2026-11-04), { filePath, ... } before. agy read_file: { Path, StartLine, EndLine } (agy 1.4.12, seen in real hook payloads;
// the hooks docs said view_file with AbsolutePath, which is kept as a fallback). agy's
// view_file_outline { AbsolutePath } and view_code_item { File, NodePaths } return part of a file,
// so they count as ranges (names from the agy 1.5.12 binary; the model was not offered them in the
// trial of 2026-11-19, which saw read_file, write_file, edit_file, run_command and run_workflow).
const PART_TOOLS = new Set(['view_file_outline', 'view_code_item'])

export function readRequest(payload) {
  const p = isObject(payload) ? payload : {}
  const a = isObject(p.toolCall) ? (isObject(p.toolCall.args) ? p.toolCall.args : {}) : isObject(p.tool_input) ? p.tool_input : {}
  const path = String(a.file_path ?? a.filePath ?? a.AbsolutePath ?? a.path ?? a.Path ?? a.File ?? '')
  const partial = [a.offset, a.limit, a.pages, a.StartLine, a.EndLine, a.Offset, a.Limit].some(given) || PART_TOOLS.has(p.toolCall?.name)
  return { path, partial }
}

// agy tools that return content from many files: { kind: 'search' | 'script', scopes, includes,
// script }, or null for any other tool or harness. grep_search { SearchPath, Query, Includes,
// MatchPerLine } (SearchPathUri in its proto) and codebase_search { Query, TargetDirectories }
// come from the agy 1.5.12 binary, so other likely spellings are read too; no scope means the
// workspace. run_workflow { Description, Script, WaitMsBeforeAsync } is a real payload (agy
// 1.5.12, trial 2026-11-19).
const SEARCH_TOOLS = new Set(['grep_search', 'codebase_search', 'code_search', 'search_files'])
const asList = v => (Array.isArray(v) ? v : [v]).filter(given).map(String)

export function searchRequest(payload) {
  const p = isObject(payload) ? payload : {}
  if (!isObject(p.toolCall)) return null
  const name = String(p.toolCall.name ?? '')
  const a = isObject(p.toolCall.args) ? p.toolCall.args : {}
  if (name === 'run_workflow') return { kind: 'script', scopes: [], includes: [], script: String(a.Script ?? a.script ?? '') }
  if (!SEARCH_TOOLS.has(name)) return null
  const scopes = [...asList(a.SearchPath ?? a.SearchPathUri ?? a.SearchDirectory ?? a.DirectoryPath ?? a.Path ?? a.path), ...asList(a.TargetDirectories ?? a.Directories)]
  return { kind: 'search', scopes, includes: asList(a.Includes ?? a.includes ?? a.Include), script: '' }
}

const NO_RETRY = 'Agents do not read secrets: do not retry with another reader or tool; if the user needs it, they run it themselves.'

function toPath(s, cwd, home) {
  if (/^file:\/\//i.test(s)) {
    try {
      return fileURLToPath(s)
    } catch {
      return null
    }
  }
  const p = expandHome(s, home)
  return isAbsolute(p) ? p : resolve(cwd, p)
}

// Python, Node, PowerShell and shell idioms that enumerate a directory tree.
const WALKS =
  /\bos\.(walk|scandir|listdir)\b|\bglob\.i?glob\b|\.(rglob|glob|iterdir)\s*\(|\b(readdir|opendir)(Sync)?\b|\bget-childitem\b|\b(gci|dir|ls)\s+-r|\bscandir\b|\bwalkdir\b|\bfind\s+\.|\bwalk\s*\(/i

// Quoted strings and bare words of a script that could be paths.
function pathCandidates(script) {
  const out = new Set()
  for (const m of script.matchAll(/(["'`])([^"'`\n]*)\1/g)) out.add(m[2])
  for (const w of script.split(/[\s()[\]{},;=+<>|&"'`]+/)) out.add(w)
  return [...out].filter(c => c && c.length < 512 && /[./\\~]/.test(c))
}

// request: from searchRequest. workspaces: agy's workspacePaths, the scope of a script and of a
// search that names none. Returns null or { decision: 'deny', reason }.
export function decideSearch(request, { cwd = process.cwd(), workspaces = [], home = homedir(), denied = null, maxEntries = SEARCH_MAX_ENTRIES } = {}) {
  if (!request || !denied) return null
  const roots = workspaces.length ? workspaces.map(String) : [cwd]
  const tooLarge = where => ({
    decision: 'deny',
    reason: `read guard: ${where} is too large to check for denied paths (over ${maxEntries} entries). Narrow it to a subdirectory, or name the files to read.`,
  })
  if (request.kind === 'script') {
    for (const c of pathCandidates(request.script)) {
      const abs = toPath(c, cwd, home)
      const hit = abs && denied(abs)
      if (hit?.matched) return { decision: 'deny', reason: `read guard: this script names a denied path (${c} matches ${hit.pattern}). ${NO_RETRY}` }
    }
    if (!WALKS.test(request.script)) return null
    for (const root of roots) {
      const found = firstDeniedUnder(toPath(root, cwd, home), { denied, maxEntries })
      if (found === 'too-large') return tooLarge(root)
      if (found) {
        return {
          decision: 'deny',
          reason: `read guard: this script walks a directory tree, and the workspace holds the denied path ${found}. Read the files it needs by name, or use a search tool with a scope or include that leaves it out. ${NO_RETRY}`,
        }
      }
    }
    return null
  }
  const inc = request.includes.length ? compilePatterns(request.includes) : null
  const keep = (abs, scope) => !inc || inc(abs, scope).matched
  for (const s of request.scopes.length ? request.scopes : roots) {
    const scope = toPath(s, cwd, home)
    if (!scope) continue
    for (const i of request.includes) {
      const hit = includeNamesDenied(i, scope, denied)
      if (hit) return { decision: 'deny', reason: `read guard: this search includes a denied path (${i} matches ${hit.pattern}). ${NO_RETRY}` }
    }
    const found = firstDeniedUnder(scope, { denied, keep, maxEntries })
    if (found === 'too-large') return tooLarge(s)
    if (found) {
      return {
        decision: 'deny',
        reason:
          `read guard: this search would return lines of the denied path ${found}, which is inside ${s}. ` +
          `Search a narrower directory, or add an include that leaves it out (such as *.ts). ${NO_RETRY}`,
      }
    }
  }
  return null
}

// `denied`: match(absPath) -> { matched, pattern } for the secrets list, or null. A home
// reference left unexpanded (`~/.ssh/x`, `%USERPROFILE%\.ssh\x`) is resolved against `home`.
export function decide(request, { cwd = process.cwd(), root = null, home = homedir(), patterns = [], maxKb = DEFAULTS.maxKb, denied = null } = {}) {
  if (!request.path) return null
  const path = expandHome(request.path, home)
  const abs = isAbsolute(path) ? path : resolve(cwd, path)
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
    const search = searchRequest(parsed.payload)
    const workspaces = Array.isArray(parsed.payload?.workspacePaths) ? parsed.payload.workspacePaths.filter(given) : []
    decision = search
      ? decideSearch(search, { cwd, workspaces, denied: deny.match })
      : decide(readRequest(parsed.payload), { cwd, root: projectRootOf(cwd), patterns: lines, maxKb: settings.values.maxKb, denied: deny.match })
  } catch (e) {
    process.stderr.write(`read guard: skipped (${e.message})\n`)
  }
  for (const w of warnings) process.stderr.write(`read guard: ${w}\n`)
  const reason = decision && warnings.length ? `${decision.reason} (${warnings.join(' ')})` : (decision?.reason ?? '')
  const out = formatPreToolUse(harness, decision?.decision ?? null, reason)
  if (out) process.stdout.write(out)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
