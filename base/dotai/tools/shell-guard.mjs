// PreToolUse guard for shell commands, every harness (pack 0038).
//   1. Commands from past incidents ask the author: `git stash` (except `list` and `show`),
//      `git reset --hard`, and killing processes by name (`taskkill /IM` or `/FI`,
//      `Stop-Process -Name` or from the pipeline, `pkill`, `killall`). Killing by PID passes.
//      Headless runs cannot answer, so there the command is refused; OpenCode cannot ask, and agy
//      runs the command on ask when an allow rule or skip-permissions applies (agy 1.4.12, trial
//      2026-11-04) while the hook cannot tell which mode is active, so both get a deny (hook-lib
//      formatPreToolUse).
//   2. A command that names a denied path is denied, with no prompt: interpreters, `cmd /c
//      type`, uploads, archivers, and plain readers and copiers, in every harness. Claude Code's
//      own Read deny was seen to stop only cat, head, rg and Get-Content (measurement 9), so its
//      shell is checked like the others. A file read through `<` is checked whatever the command.
//      A wildcard argument is expanded against the disk (`cat sub/*`, `Select-String -Path
//      sub\*`), so a pattern that reaches a denied file is denied too.
//      A static .NET call (`[IO.File]::ReadAllText('.env')`, `[System.IO.File]::Copy(...)`) is
//      checked by its arguments whatever the type or method, so `[IO.File]::Exists('.env')` is
//      denied too. A text filter: it stops accidental reads, not a script built to evade it.
//   3. A recursive content search whose scope holds a denied file is denied, since it returns
//      the matching lines of every file there (agy 1.5.12 ran `rg -uu "X" .` over a tree holding
//      `sub/.env`, trial 2026-11-19): rg (hidden files count only with --hidden, -. or -uu),
//      grep -r, findstr /s, and a recursive listing (Get-ChildItem -Recurse, find, dir /s) in a
//      line that also runs a reader. Include globs that leave the file out (`rg -g '*.ts'`,
//      `grep --include=*.ts`, `-Filter *.ts`, `find -name`) pass; an include that names a denied
//      file is denied. git grep reads tracked files only and is left out.
// The denied paths come from `deny-paths.*.txt` in ~/.dotai/tools/ and the project's
// .dotai/tools/ (gitignore-style; hook-lib denyMatcher, where a project `!` line is ignored).
// Keep deny-paths.base.txt in step with the secrets of base/.rulesync/permissions.jsonc
// (DESIGN §3).
//   4. In a delegated job (DOTAI_DELEGATE_CALLER in the hook's environment, pack 0050), a command
//      that runs the delegate tools or names that variable is denied (see delegatedTry).
// Never blocks on its own failure. Entry point: `node shell-guard.mjs <harness>` with the hook
// payload on stdin.
import { homedir } from 'node:os'
import { readdirSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  commandName,
  compilePatterns,
  denyMatcher,
  expandHome,
  firstDeniedUnder,
  formatPreToolUse,
  harnessArg,
  includeNamesDenied,
  parsePayload,
  readStdin,
  SEARCH_MAX_ENTRIES,
  simpleCommands,
} from './hook-lib.mjs'

const ASK = {
  stash: 'shell guard: `git stash` can hide or overwrite work (past incident). Prefer a WIP commit (`git commit -am wip`) or a new branch; approve only if you asked for the stash.',
  reset: 'shell guard: `git reset --hard` drops uncommitted changes (past incident). Prefer a WIP commit or a new branch first; approve only if you asked for it.',
  kill: 'shell guard: killing by name also kills unrelated processes, such as an editor or a dev server the user has open (past incident). Kill by PID instead (`taskkill /PID <n>`, `Stop-Process -Id <n>`, `kill <pid>`); approve only if you asked for it.',
}

// Programs that read a file named on their command line: interpreters, cmd's `type`, uploads,
// archivers and encoders, then plain readers, searchers and copiers (PowerShell aliases included).
const CHECKED = new Set([
  'python', 'python3', 'py', 'node', 'deno', 'bun', 'ruby', 'perl', 'php', 'lua', 'powershell', 'pwsh', 'type',
  'curl', 'wget', 'scp', 'rsync', 'tar', 'zip', '7z', 'openssl', 'gpg', 'certutil', 'base64', 'xxd', 'od',
  'cat', 'head', 'tail', 'less', 'more', 'bat', 'rg', 'grep', 'sed', 'awk', 'nl', 'tac', 'strings', 'cp', 'copy',
  'xcopy', 'robocopy', 'get-content', 'gc', 'copy-item', 'cpi', 'select-string', 'sls', 'findstr',
])

const lower = t => String(t?.u ?? '').toLowerCase()

function gitSubcommand(args) {
  let j = 0
  while (j < args.length) {
    const a = args[j].u
    if (['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(a)) j += 2
    else if (a.startsWith('-')) j++
    else break
  }
  return { sub: args[j]?.u ?? '', rest: args.slice(j + 1).map(t => t.u) }
}

function askReason(cmd) {
  const { name, args } = cmd
  if (name === 'git') {
    const { sub, rest } = gitSubcommand(args)
    if (sub === 'stash' && !['list', 'show'].includes(rest[0] ?? '')) return ASK.stash
    if (sub === 'reset' && rest.includes('--hard')) return ASK.reset
    return null
  }
  if (name === 'taskkill') return args.some(t => /^(\/\/?|-)(im|fi)$/i.test(t.u)) ? ASK.kill : null
  if (name === 'stop-process' || name === 'spps') {
    if (args.some(t => /^-(id|pid)$/i.test(t.u))) return null
    if (args.some(t => /^-(name|processname|inputobject)$/i.test(t.u))) return ASK.kill
    const positional = args.filter(t => !t.u.startsWith('-'))
    if (positional.length && positional.every(t => /^\d+(,\d+)*$/.test(t.u))) return null
    return ASK.kill // names, or processes from the pipeline (Get-Process <name> | Stop-Process)
  }
  if (name === 'kill' && args.some(t => /^-(name|processname)$/i.test(t.u))) return ASK.kill // PowerShell alias
  if (name === 'pkill' || name === 'killall') return ASK.kill
  return null
}

// The path-like pieces of an argument: quoted substrings whole (a path with spaces inside
// `python -c "open('a b/.env')"`), then the text split at characters a path does not hold.
function pieces(text) {
  const out = []
  for (const m of String(text).matchAll(/'([^']+)'|"([^"]+)"/g)) out.push(m[1] ?? m[2])
  out.push(...String(text).split(/[\s'"(),;=<>|&`{}[\]@]+/))
  return out.filter(p => p && !p.includes('://') && !/^-/.test(p) && !/^\d+$/.test(p))
}

function deniedPiece(tokens, { cwd, root, home, match }) {
  for (const t of tokens) {
    for (const raw of new Set([...pieces(t.v), ...pieces(t.u)])) {
      const p = expandHome(raw, home)
      const abs = isAbsolute(p) ? p : resolve(cwd, p)
      const hit = match(abs, root)
      if (hit.matched) return { piece: raw, pattern: hit.pattern }
      // A wildcard the shell or the reader expands (`cat sub/*`, `Select-String -Path sub\*`).
      if (/[*?]/.test(raw)) {
        for (const file of expandWildcard(abs)) {
          const h = match(file, root)
          if (h.matched) return { piece: `${raw} (${file})`, pattern: h.pattern }
        }
      }
    }
  }
  return null
}

// The existing paths a wildcard path names, component by component (`*` and `?` within one
// component; `**` counts as `*`), capped at 2000 entries read.
function expandWildcard(abs, cap = 2000) {
  const parts = abs.split(/[\\/]+/)
  const first = parts.findIndex(c => /[*?]/.test(c))
  if (first <= 0) return []
  let current = [parts.slice(0, first).join('/') || '/']
  let read = 0
  for (const part of parts.slice(first)) {
    if (!part) continue
    const wild = /[*?]/.test(part)
    const re = wild ? new RegExp(`^${part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '.*').replace(/\?/g, '.')}$`, process.platform === 'win32' ? 'i' : '') : null
    const next = []
    for (const dir of current) {
      if (!wild) {
        next.push(join(dir, part))
        continue
      }
      let names = []
      try {
        names = readdirSync(dir)
      } catch {
        continue
      }
      read += names.length
      if (read > cap) return next
      for (const n of names) if (re.test(n)) next.push(join(dir, n))
    }
    current = next
  }
  return current
}

// The argument text of every static .NET call (`[Type]::Method(...)`) in the raw command, as
// words for deniedPiece. The tokenizer splits at the parentheses, so the raw text is scanned
// here; quotes are honored when finding the closing parenthesis.
function staticCallArgs(command) {
  const out = []
  const s = String(command ?? '')
  for (const m of s.matchAll(/\[[\w.]+\]::\w+\s*\(/g)) {
    let depth = 1
    let quote = null
    let j = m.index + m[0].length
    for (; j < s.length && depth; j++) {
      const c = s[j]
      if (quote) {
        if (c === quote) quote = null
      } else if (c === "'" || c === '"') quote = c
      else if (c === '(') depth++
      else if (c === ')') depth--
    }
    const text = s.slice(m.index + m[0].length, depth ? j : j - 1)
    out.push({ v: text, u: text })
  }
  return out
}

// ------------------------------------------------------------------ recursive content searches

const EXCLUDE_OPTS = new Set(['--exclude', '--exclude-dir'])
const isExclude = u => u.startsWith('!') || /^--exclude(-dir)?=/.test(u) || /^--(glob|iglob)=!/.test(u) || /^-g!/.test(u)

// Options that take a separate value (a `--name=value` word is one token anyway).
const RG_VALUE = new Set(['-e', '--regexp', '-f', '--file', '-g', '--glob', '--iglob', '-t', '--type', '-T', '--type-not', '-A', '-B', '-C', '--after-context', '--before-context', '--context', '-m', '--max-count', '-j', '--threads', '-M', '--max-columns', '-d', '--max-depth', '-E', '--encoding', '--pre', '--pre-glob', '--type-add', '--ignore-file', '-r', '--replace', '--sort', '--sortr', '--color', '--colors', '--context-separator', '--field-match-separator', '--field-context-separator', '--path-separator', '--engine', '--max-filesize', '--dfa-size-limit', '--regex-size-limit'])
const GREP_VALUE = new Set(['-e', '--regexp', '-f', '--file', '-m', '--max-count', '-A', '-B', '-C', '--after-context', '--before-context', '--context', '-d', '--directories', '-D', '--devices', '--include', '--exclude', '--exclude-dir', '--exclude-from', '--label', '--color', '--colour', '--binary-files'])
const PS_VALUE = new Set(['-path', '-literalpath', '-filter', '-include', '-exclude', '-depth', '-attributes'])
const LISTERS = new Set(['get-childitem', 'gci', 'ls', 'dir', 'find'])
const READERS = new Set(['select-string', 'sls', 'get-content', 'gc', 'cat', 'type', 'findstr', 'more', 'grep', 'rg', 'head', 'tail', 'less', 'bat', 'strings', 'xxd', 'od', 'base64'])

// { options: [{ name, value }], positionals } of a command's words; `--` ends the options.
function splitArgs(args, valued, { caseless = false } = {}) {
  const options = []
  const positionals = []
  for (let i = 0; i < args.length; i++) {
    const w = args[i].u
    if (w === '--') {
      positionals.push(...args.slice(i + 1).map(t => t.u))
      break
    }
    if (/^-/.test(w) && w !== '-') {
      const eq = w.indexOf('=')
      const name = caseless ? (eq > 0 ? w.slice(0, eq) : w).toLowerCase() : eq > 0 ? w.slice(0, eq) : w
      if (eq > 0) options.push({ name, value: w.slice(eq + 1) })
      else if (valued.has(name)) options.push({ name, value: args[++i]?.u ?? '' })
      else options.push({ name, value: null })
    } else positionals.push(w)
  }
  return { options, positionals }
}

const values = (options, names) => options.filter(o => names.includes(o.name) && o.value !== null).map(o => o.value)
const shortFlags = options => options.filter(o => /^-[^-]/.test(o.name) && o.value === null).map(o => o.name.slice(1)).join('')

// The searches a command line runs over directory trees: { scopes, includes, excludes,
// skipHidden }. rg (recursive, skips hidden files unless --hidden, -. or -uu), grep -r,
// findstr /s, and a recursive listing (Get-ChildItem -Recurse, find, dir /s) piped or passed to
// a reader. git grep is left out: it reads tracked files only, and a secrets file is not tracked.
function contentSearches(cmds) {
  const out = []
  const hasReader = cmds.some(c => READERS.has(c.name)) || cmds.some(c => c.name === 'find' && c.args.some(t => READERS.has(commandName(t))))
  for (const cmd of cmds) {
    if (cmd.name === 'rg') {
      const { options, positionals } = splitArgs(cmd.args, RG_VALUE)
      const flags = shortFlags(options)
      const names = options.map(o => o.name)
      const hidden = names.includes('--hidden') || names.includes('--unrestricted') || flags.includes('.') || (flags.match(/u/g) ?? []).length >= 2
      const patterned = names.some(n => ['-e', '--regexp', '-f', '--file'].includes(n))
      const globs = values(options, ['-g', '--glob', '--iglob'])
      out.push({
        scopes: (patterned ? positionals : positionals.slice(1)).filter(Boolean),
        includes: globs.filter(g => !g.startsWith('!')),
        excludes: globs.filter(g => g.startsWith('!')).map(g => g.slice(1)),
        skipHidden: !hidden,
      })
    } else if (cmd.name === 'grep' || cmd.name === 'egrep' || cmd.name === 'fgrep') {
      const { options, positionals } = splitArgs(cmd.args, GREP_VALUE)
      const names = options.map(o => o.name)
      const recursive = /[rR]/.test(shortFlags(options)) || names.includes('--recursive') || names.includes('--dereference-recursive') || values(options, ['-d', '--directories']).includes('recurse')
      if (!recursive) continue
      const patterned = names.some(n => ['-e', '--regexp', '-f', '--file'].includes(n))
      out.push({
        scopes: (patterned ? positionals : positionals.slice(1)).filter(Boolean),
        includes: values(options, ['--include']),
        excludes: values(options, ['--exclude']),
        skipHidden: false,
      })
    } else if (cmd.name === 'findstr') {
      const words = cmd.args.map(t => t.u)
      const opts = words.filter(w => /^\//.test(w))
      if (!opts.some(o => /^\/[a-z]*s[a-z]*$/i.test(o))) continue
      const files = words.filter(w => !/^\//.test(w)).slice(opts.some(o => /^\/c:/i.test(o)) ? 0 : 1)
      for (const f of files.length ? files : ['*']) {
        const sep = Math.max(f.lastIndexOf('/'), f.lastIndexOf('\\'))
        out.push({ scopes: [sep >= 0 ? f.slice(0, sep) || '/' : '.'], includes: [sep >= 0 ? f.slice(sep + 1) : f], excludes: [], skipHidden: false })
      }
    } else if (LISTERS.has(cmd.name) && hasReader) {
      if (cmd.name === 'find') {
        const words = cmd.args.map(t => t.u)
        const end = words.findIndex(w => /^[-(!]/.test(w))
        const names = []
        words.forEach((w, i) => /^-i?name$/.test(w) && words[i + 1] && names.push(words[i + 1]))
        out.push({ scopes: (end < 0 ? words : words.slice(0, end)).filter(Boolean), includes: names, excludes: [], skipHidden: false })
        continue
      }
      const { options, positionals } = splitArgs(cmd.args, PS_VALUE, { caseless: true })
      const names = options.map(o => o.name)
      const recursive = names.some(n => /^-r(e(c(u(r(s(e)?)?)?)?)?)?$/.test(n) || n === '-depth') || cmd.args.some(t => /^\/s$/i.test(t.u))
      if (!recursive) continue
      const split = v => v.split(',').map(s => s.trim()).filter(Boolean)
      out.push({
        scopes: [...values(options, ['-path', '-literalpath']), ...positionals.filter(p => !/^\//.test(p))],
        includes: [...values(options, ['-filter']), ...values(options, ['-include']).flatMap(split)],
        excludes: values(options, ['-exclude']).flatMap(split),
        skipHidden: false,
      })
    }
  }
  return out
}

const hiddenUnder = (abs, scope) => relative(scope, abs).split(/[\\/]/).some(p => p.startsWith('.') && p !== '.' && p !== '..')

function deniedSearch(cmds, { cwd, root, home, match }) {
  const denied = abs => match(abs, root)
  for (const s of contentSearches(cmds)) {
    const inc = s.includes.length ? compilePatterns(s.includes) : null
    const exc = s.excludes.length ? compilePatterns(s.excludes) : null
    const keep = (abs, scope) => !(s.skipHidden && hiddenUnder(abs, scope)) && (!inc || inc(abs, scope).matched) && !(exc && exc(abs, scope).matched)
    for (const raw of s.scopes.length ? s.scopes : ['.']) {
      const p = expandHome(raw, home)
      const scope = isAbsolute(p) ? p : resolve(cwd, p)
      for (const i of s.includes) {
        const hit = includeNamesDenied(i, scope, denied)
        if (hit) return { decision: 'deny', reason: `shell guard: this search includes a denied path (${i} matches ${hit.pattern}). ${NO_RETRY}` }
      }
      const found = firstDeniedUnder(scope, { denied, keep })
      if (found === 'too-large') {
        return { decision: 'deny', reason: `shell guard: ${raw} is too large to check for denied paths (over ${SEARCH_MAX_ENTRIES} entries). Search a narrower directory, or name the files.` }
      }
      if (found) {
        return {
          decision: 'deny',
          reason:
            `shell guard: this recursive search would return lines of the denied path ${found}, which is inside ${raw}. ` +
            `Search a narrower directory, or add an include glob that leaves it out (rg -g '*.ts', grep --include='*.ts'). ${NO_RETRY}`,
        }
      }
    }
  }
  return null
}

// 4. A delegated job (pack 0050): delegate-core sets DOTAI_DELEGATE_CALLER on every launched
// harness, and this hook inherits that harness's environment, so with the variable present (even
// empty) a command that runs the delegate tools, or names the variable at all (to set, empty or
// unset it: `X=`, `env -u`, `unset`, `set X=`, `Remove-Item Env:`, `$env:`), is denied. That keeps
// delegation one-way even when the model edits its own command line. Matched on the raw text, in
// any case, like the rest of this guard a filter rather than a sandbox.
const DELEGATION = /delegate-(backend|core)|DOTAI_DELEGATE_CALLER/i
function delegatedTry(command, env) {
  if (env?.DOTAI_DELEGATE_CALLER === undefined || !DELEGATION.test(String(command ?? ''))) return null
  return { decision: 'deny', reason: 'shell guard: a delegated job cannot start delegations (pack 0050). Do the task yourself, or report back to the primary.' }
}

const NO_RETRY = 'Agents do not read secrets: do not retry with another reader or tool; if the user needs it, they run it themselves.'

// harness: 'claudecode' | 'opencode' | 'antigravity' (every harness gets the same checks; the
// argument stays for the output format). Returns null or { decision, reason }.
export function decide(command, { harness = 'claudecode', cwd = process.cwd(), root = null, home = homedir(), denyPatterns = [], env = {} } = {}) {
  const delegated = delegatedTry(command, env)
  if (delegated) return delegated
  const cmds = simpleCommands(command)
  if (!cmds.length) return null
  const match = compilePatterns(denyPatterns, { home })
  const deny = hit => ({
    decision: 'deny',
    reason: `shell guard: this command reads a denied path (${hit.piece} matches ${hit.pattern}). Agents do not read secrets: do not retry with another reader or tool; if the user needs it, they run it themselves.`,
  })
  const dotnet = deniedPiece(staticCallArgs(command), { cwd, root, home, match })
  if (dotnet) return deny(dotnet)
  for (const cmd of cmds) {
    // An exclude glob (`rg -g '!*.pem'`, `--exclude=*.key`) names a denied file only to skip it.
    const args = CHECKED.has(cmd.name) ? cmd.args.filter((t, i) => !isExclude(t.u) && !EXCLUDE_OPTS.has(cmd.args[i - 1]?.u)) : []
    const hit = deniedPiece([...args, ...(cmd.redirs ?? [])], { cwd, root, home, match })
    if (hit) return deny(hit)
  }
  const searched = deniedSearch(cmds, { cwd, root, home, match })
  if (searched) return searched
  for (const cmd of cmds) {
    const reason = askReason(cmd)
    if (reason) return { decision: 'ask', reason }
  }
  return null
}

async function main() {
  const parsed = parsePayload(await readStdin())
  const harness = harnessArg() ?? parsed.harness
  // The delegated check needs no deny list, so a failing one never skips it.
  let decision = delegatedTry(parsed.command, process.env)
  if (!decision) try {
    const cwd = parsed.cwd
    const { lines, root } = denyMatcher(cwd)
    decision = decide(parsed.command, { harness, cwd, root, denyPatterns: lines, env: process.env })
  } catch (e) {
    process.stderr.write(`shell guard: skipped (${e.message})\n`)
  }
  const out = formatPreToolUse(harness, decision?.decision ?? null, decision?.reason ?? '')
  if (out) process.stdout.write(out)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
