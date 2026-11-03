// PreToolUse guard for subagent launches in Claude Code (pack 0030, roster 0037).
//   1. Every launch names its model (`model` in the Agent tool input); a launch without one is
//      denied with the selection criterion.
//   2. The launched agent's definition declares its effort: Claude Code cannot set effort per
//      launch, and an agent without one inherits the session's silently. Built-ins
//      (general-purpose, Explore, Plan...) have no definition here and are denied, so the
//      orchestrator launches the pack's agents.
//      Plugin agents are looked up in the installed plugins. One that declares no effort is
//      denied too (0030 option A), unless the user names it in `agents.defaultEffort` in
//      .dotai/config.yaml (`<agent>: <low|medium|high|xhigh|max>`): an explicit, written
//      acceptance that it runs at that effort, so the inheritance is no longer silent. The value
//      is recorded, not enforced; Claude Code offers no way to enforce it.
//   3. Opus only for allowlisted `<agent> <model>` lines of `model-allow.*.txt`, merged from
//      ~/.dotai/tools/ and the project's .dotai/tools/ (dotai 0030). The base allows `judge`.
// An allowed launch is appended to the delegate launch log (<pack home>/launches.jsonl, capped at
// logMax like the backend's, delegate-core.mjs) as a `start` entry with harness claudecode, so
// `delegate-backend status` and the statusline show one tree (0030, 0032).
// OpenCode and agy are not hooked: OpenCode takes the model from the agent definition, and agy
// launches go through `delegate`, which validates the pair itself (0030). Neither subagent tool's
// name nor payload is verified in HARNESS-NOTES yet (0030, update 2026-11-03), so no matcher is
// guessed for them.
// Never blocks on its own failure. Entry point: `node agent-guard.mjs claudecode`.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  EFFORTS,
  findConfig,
  formatPreToolUse,
  frontmatter,
  packHome,
  parsePayload,
  projectRootOf,
  projectToolsDir,
  readPatternFiles,
  readStdin,
  readSubsection,
  userToolsDir,
} from './hook-lib.mjs'

export { EFFORTS }
const ROSTER = 'explorer (search, read), researcher (external docs), worker (implement, test), reviewer (review), judge (blind judgment)'
// The Opus roles come from the allowlist actually loaded, so the advice never names a role that
// the model-allow files do not allow.
const opusRoles = allow => [...allow].filter(e => e.endsWith(' opus')).map(e => e.slice(0, -' opus'.length))
const criterion = allow => {
  const roles = opusRoles(allow)
  return (
    'Pick it by the cost policy: haiku for search and reading (explorer, researcher), sonnet for implementation and review (worker, reviewer), ' +
    (roles.length ? `opus only for the allowlisted roles (${roles.join(', ')}).` : 'and no opus: no role is allowlisted for it.')
  )
}

export function modelFamily(model) {
  const m = String(model ?? '').toLowerCase()
  for (const f of ['opus', 'sonnet', 'haiku']) if (m.includes(f)) return f
  return m
}

// `<agent> <model>` per line; anything else is ignored.
export function parseAllow(lines) {
  const out = new Set()
  for (const line of lines) {
    const parts = String(line).trim().split(/\s+/)
    if (parts.length === 2 && !parts[0].startsWith('#')) out.add(`${parts[0]} ${modelFamily(parts[1])}`)
  }
  return out
}

function agentFiles(dir, depth = 0) {
  if (depth > 3) return []
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const e of entries) {
    if (e.isDirectory()) out.push(...agentFiles(join(dir, e.name), depth + 1))
    else if (e.name.endsWith('.md')) out.push(join(dir, e.name))
  }
  return out
}

function findIn(dir, name) {
  const direct = join(dir, `${name}.md`)
  const files = existsSync(direct) ? [direct, ...agentFiles(dir).filter(f => f !== direct)] : agentFiles(dir)
  for (const file of files) {
    let fm
    try {
      fm = frontmatter(readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    const stem = file.replace(/^.*[\\/]/, '').replace(/\.md$/, '')
    if (fm.name === name || (fm.name === undefined && stem === name)) return { file, fm }
  }
  return null
}

function pluginDirs(configDir, plugin) {
  try {
    const j = JSON.parse(readFileSync(join(configDir, 'plugins', 'installed_plugins.json'), 'utf8'))
    const dirs = []
    for (const [key, installs] of Object.entries(j?.plugins ?? {})) {
      if (key.split('@')[0] !== plugin || !Array.isArray(installs)) continue
      for (const i of installs) if (typeof i?.installPath === 'string') dirs.push(i.installPath)
    }
    return dirs
  } catch {
    return []
  }
}

// The definition Claude Code would launch: project agents win over user agents (HARNESS-NOTES);
// `plugin:agent` names look in that plugin's installs. Returns { file, fm } or null.
export function findAgent(name, { root = null, configDir = join(homedir(), '.claude') } = {}) {
  if (!name) return null
  const colon = name.indexOf(':')
  if (colon > 0) {
    const plugin = name.slice(0, colon)
    const agent = name.slice(colon + 1)
    for (const dir of pluginDirs(configDir, plugin)) {
      const hit = findIn(join(dir, 'agents'), agent)
      if (hit) return hit
    }
    return null
  }
  if (root) {
    const hit = findIn(join(root, '.claude', 'agents'), name)
    if (hit) return hit
  }
  return findIn(join(configDir, 'agents'), name)
}

const bare = name => String(name).split(':').pop()
const level = v => {
  const l = String(v ?? '').toLowerCase()
  return EFFORTS.includes(l) ? l : null
}

// The effort a launch runs at: the definition's own (`effort`, or `claudecode.effort` in a rulesync
// source), else the user's written acceptance in agents.defaultEffort. Returns { def, effort,
// declared } with effort null when neither names a level.
export function resolveEffort(name, { root = null, configDir, defaultEffort = {} } = {}) {
  const def = findAgent(name, { root, configDir })
  const declared = def ? level(def.fm.effort ?? def.fm.claudecode?.effort) : null
  const accepted = level(defaultEffort[name] ?? defaultEffort[bare(name)])
  return { def, declared, effort: declared ?? accepted }
}

// input: the Agent tool input. Returns null or { decision: 'deny', reason }.
export function decide(input, { root = null, configDir, allow = new Set(), defaultEffort = {} } = {}) {
  const name = String(input?.subagent_type ?? '') || 'general-purpose'
  const model = String(input?.model ?? '').trim()
  if (!model) {
    return { decision: 'deny', reason: `agent guard: every launch names its model. ${criterion(allow)} Retry with model set.` }
  }
  const { def, effort } = resolveEffort(name, { root, configDir, defaultEffort })
  if (!effort) {
    const what = def ? `the definition of ${name} declares no effort` : `${name} has no agent definition with a declared effort (built-in agents inherit the session effort)`
    return {
      decision: 'deny',
      reason:
        `agent guard: ${what}, so it would run at the session's effort. Launch a pack agent instead: ${ROSTER}. ` +
        `To accept this agent anyway, name it under agents.defaultEffort in .dotai/config.yaml.`,
    }
  }
  const family = modelFamily(model)
  if (family === 'opus' && !allow.has(`${name} opus`) && !allow.has(`${bare(name)} opus`)) {
    const list = opusRoles(allow).map(r => `${r} opus`).join(', ') || 'none'
    return {
      decision: 'deny',
      reason: `agent guard: Opus is allowlisted only for: ${list} (model-allow.*.txt). ${criterion(allow)}`,
    }
  }
  return null
}

function loadDefaultEffort(cwd) {
  const out = {}
  const files = [join(homedir(), '.dotai', 'config.yaml'), findConfig(cwd)]
  for (const f of files) {
    if (!f) continue
    try {
      Object.assign(out, readSubsection(readFileSync(f, 'utf8'), 'agents', 'defaultEffort'))
    } catch {}
  }
  return out
}

// The `start` entry of an allowed launch, in the backend's log format (standalone README).
export function launchEntry(input, { root = null, configDir, defaultEffort = {} } = {}, now = Date.now()) {
  const name = String(input?.subagent_type ?? '') || 'general-purpose'
  const { effort } = resolveEffort(name, { root, configDir, defaultEffort })
  return {
    id: `cc-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    event: 'start',
    ts: now,
    harness: 'claudecode',
    from: 'claudecode',
    agent: name,
    model: String(input?.model ?? '').trim(),
    effort: effort ?? '',
    title: String(input?.description ?? '').slice(0, 120) || name,
    kind: 'subagent',
  }
}

// Best effort: a log that cannot be written never blocks a launch.
async function logLaunch(entry) {
  try {
    const { appendLog, loadConfig } = await import('./delegate-core.mjs')
    const dir = packHome()
    appendLog(join(dir, 'launches.jsonl'), entry, loadConfig(dir).values.logMax)
  } catch (e) {
    process.stderr.write(`agent guard: launch not logged (${e.message})\n`)
  }
}

async function main() {
  const parsed = parsePayload(await readStdin())
  if (!/^(Agent|Task)$/.test(parsed.tool)) return
  let decision = null
  try {
    const cwd = parsed.cwd
    const allow = parseAllow(readPatternFiles('model-allow', [userToolsDir(), projectToolsDir(cwd)]).lines)
    const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
    const root = process.env.CLAUDE_PROJECT_DIR || projectRootOf(cwd)
    const defaultEffort = loadDefaultEffort(cwd)
    decision = decide(parsed.payload.tool_input, { root, configDir, allow, defaultEffort })
    if (!decision) await logLaunch(launchEntry(parsed.payload.tool_input, { root, configDir, defaultEffort }))
  } catch (e) {
    process.stderr.write(`agent guard: skipped (${e.message})\n`)
  }
  const out = formatPreToolUse('claudecode', decision?.decision ?? null, decision?.reason ?? '')
  if (out) process.stdout.write(out)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
