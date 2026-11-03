// PreToolUse guard for shell commands, every harness (pack 0038).
//   1. Commands from past incidents ask the author: `git stash` (except `list` and `show`),
//      `git reset --hard`, and killing processes by name (`taskkill /IM` or `/FI`,
//      `Stop-Process -Name` or from the pipeline, `pkill`, `killall`). Killing by PID passes.
//      Headless runs cannot answer, so there the command is refused; OpenCode cannot ask at all
//      and gets a deny (hook-lib formatPreToolUse).
//   2. A command that names a denied path is denied, with no prompt: interpreters, `cmd /c
//      type`, uploads, archivers, and plain readers and copiers, in every harness. Claude Code's
//      own Read deny was seen to stop only cat, head, rg and Get-Content (measurement 9), so its
//      shell is checked like the others. A file read through `<` is checked whatever the command.
//      A text filter: it stops accidental reads, not a script built to evade it.
// The denied paths come from `deny-paths.*.txt` in ~/.dotai/tools/ and the project's
// .dotai/tools/ (gitignore-style; hook-lib denyMatcher, where a project `!` line is ignored).
// Keep deny-paths.base.txt in step with the secrets of base/.rulesync/permissions.jsonc
// (DESIGN §3).
// Never blocks on its own failure. Entry point: `node shell-guard.mjs <harness>` with the hook
// payload on stdin.
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { compilePatterns, denyMatcher, formatPreToolUse, harnessArg, parsePayload, readStdin, simpleCommands } from './hook-lib.mjs'

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

function expandHome(p, home) {
  let s = p
  s = s.replace(/^~(?=$|[\\/])/, home)
  s = s.replace(/^(\$HOME|\$\{HOME\}|\$env:USERPROFILE|\$env:HOME|%USERPROFILE%)(?=$|[\\/])/i, home)
  if (process.platform === 'win32') s = s.replace(/^\/\/?([a-z])\//i, '$1:/')
  return s
}

function deniedPiece(tokens, { cwd, root, home, match }) {
  for (const t of tokens) {
    for (const raw of new Set([...pieces(t.v), ...pieces(t.u)])) {
      const p = expandHome(raw, home)
      const abs = isAbsolute(p) ? p : resolve(cwd, p)
      const hit = match(abs, root)
      if (hit.matched) return { piece: raw, pattern: hit.pattern }
    }
  }
  return null
}

// harness: 'claudecode' | 'opencode' | 'antigravity' (every harness gets the same checks; the
// argument stays for the output format). Returns null or { decision, reason }.
export function decide(command, { harness = 'claudecode', cwd = process.cwd(), root = null, home = homedir(), denyPatterns = [] } = {}) {
  const cmds = simpleCommands(command)
  if (!cmds.length) return null
  const match = compilePatterns(denyPatterns, { home })
  for (const cmd of cmds) {
    const tokens = [...(CHECKED.has(cmd.name) ? cmd.args : []), ...(cmd.redirs ?? [])]
    const hit = deniedPiece(tokens, { cwd, root, home, match })
    if (hit) {
      return {
        decision: 'deny',
        reason: `shell guard: this command reads a denied path (${hit.piece} matches ${hit.pattern}). Agents do not read secrets: do not retry with another reader or tool; if the user needs it, they run it themselves.`,
      }
    }
  }
  for (const cmd of cmds) {
    const reason = askReason(cmd)
    if (reason) return { decision: 'ask', reason }
  }
  return null
}

async function main() {
  const parsed = parsePayload(await readStdin())
  const harness = harnessArg() ?? parsed.harness
  let decision = null
  try {
    const cwd = parsed.cwd
    const { lines, root } = denyMatcher(cwd)
    decision = decide(parsed.command, { harness, cwd, root, denyPatterns: lines })
  } catch (e) {
    process.stderr.write(`shell guard: skipped (${e.message})\n`)
  }
  const out = formatPreToolUse(harness, decision?.decision ?? null, decision?.reason ?? '')
  if (out) process.stdout.write(out)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
