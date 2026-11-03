// Worktree lanes for long autonomous work (autonomous-orchestra profile). One lane per independent
// item, with a disjoint id; compact status for the integrator (principle P7: bounded output).
//   node orchestra-lanes.mjs new <area>/<id> [--base <ref>] [--apply]
//        create .claude/worktrees/<id> on branch <area>/<id>, then print (or, with --apply and
//        dotai on PATH, run) the dotai apply of the main checkout's profiles in it (pack 0040)
//   node orchestra-lanes.mjs list [--base <ref>]   one line per worktree under .claude/worktrees/
//   node orchestra-lanes.mjs rm <id> [--base <ref>] remove a clean lane already merged into base
// .claude/worktrees/ is added to .git/info/exclude (never .gitignore).
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { basename, delimiter, dirname, join } from 'node:path'

// One lowercase ref component: safe for git (no dots, slashes, leading dash) and for a shell.
const PART = /^[a-z0-9][a-z0-9-]{0,39}$/
const MAX_LINES = 30
const LANES_DIR = ['.claude', 'worktrees']

function git(cwd, args, ok = false) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (r.status !== 0 && !ok) fail(`git ${args.join(' ')}: ${(r.stderr || '').trim()}`)
  return r.status === 0 ? r.stdout.trim() : null
}

function fail(msg) {
  process.stderr.write(`orchestra-lanes: ${msg}\n`)
  process.exit(1)
}

function mainRoot(cwd) {
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  return { root: dirname(common), common }
}

function defaultBase(root) {
  if (git(root, ['rev-parse', '--verify', '--quiet', 'refs/heads/main'], true) !== null) return 'main'
  return git(root, ['symbolic-ref', '--short', 'HEAD'])
}

function ensureExcluded(common) {
  const f = join(common, 'info', 'exclude')
  const text = existsSync(f) ? readFileSync(f, 'utf8') : ''
  if (!/^\.claude\/worktrees\/$/m.test(text)) appendFileSync(f, `${text && !text.endsWith('\n') ? '\n' : ''}.claude/worktrees/\n`)
}

function parseFlags(argv) {
  const pos = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') flags.apply = true
    else if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i]
    else pos.push(argv[i])
  }
  return { pos, flags }
}

const norm = p => {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? s.toLowerCase() : s
}

// Every worktree directly under .claude/worktrees/, whatever its branch (null when detached).
function lanesOf(root) {
  const parent = norm(join(root, ...LANES_DIR))
  const lanes = []
  let cur = null
  for (const line of git(root, ['worktree', 'list', '--porcelain']).split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      const path = line.slice(9)
      cur = norm(dirname(path)) === parent ? { id: basename(path), path, branch: null } : null
      if (cur) lanes.push(cur)
    }
    const m = /^branch refs\/heads\/(.+)$/.exec(line)
    if (m && cur) cur.branch = m[1]
  }
  return lanes.sort((a, b) => a.id.localeCompare(b.id))
}

function profilesOf(root) {
  const marker = join(root, '.dotai', 'state.json')
  let profiles = []
  try {
    profiles = JSON.parse(readFileSync(marker, 'utf8')).profiles || []
  } catch {}
  return { marker, profiles: profiles.filter(p => PART.test(p)) }
}

function onPath(name) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const f = join(dir, name + ext.toLowerCase())
      if (existsSync(f)) return f
    }
  }
  return null
}

function applyProfiles(root, dir, apply) {
  const { marker, profiles } = profilesOf(root)
  if (!profiles.length) return process.stdout.write(`apply: no profiles recorded in ${marker}; nothing to apply\n`)
  const args = ['apply', '--profile', profiles.join(',')]
  const cmd = `dotai ${args.join(' ')}`
  const manual = `cd "${dir}" && ${cmd}`
  if (!apply) return process.stdout.write(`apply: ${manual}\n`)
  const bin = onPath('dotai')
  if (!bin) return process.stdout.write(`not applied: dotai is not on PATH; run: ${manual}\n`)
  // A .cmd or .bat shim needs a shell; every argument is fixed or a checked profile name.
  const r = /\.(cmd|bat)$/i.test(bin)
    ? spawnSync(`"${bin}" ${args.join(' ')}`, { cwd: dir, encoding: 'utf8', shell: true, windowsHide: true })
    : spawnSync(bin, args, { cwd: dir, encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) {
    const last = (r.stderr || r.stdout || String(r.error || '')).trim().split(/\r?\n/).pop()
    fail(`lane created, but dotai apply failed (exit ${r.status}): ${last}; run: ${manual}`)
  }
  process.stdout.write(`applied: ${cmd} (in ${dir})\n`)
}

function cmdNew(root, common, spec, base, apply) {
  const [area, id, extra] = (spec || '').split('/')
  if (extra !== undefined || !PART.test(area || '') || !PART.test(id || '')) {
    fail('usage: new <area>/<id>, each lowercase letters, digits and dashes (max 40), e.g. combat/dash')
  }
  const branch = `${area}/${id}`
  const dir = join(root, ...LANES_DIR, id)
  if (existsSync(dir) || lanesOf(root).some(l => l.id === id)) fail(`lane id "${id}" is already used; lane ids must be disjoint`)
  if (git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], true) !== null) fail(`branch ${branch} already exists`)
  ensureExcluded(common)
  git(root, ['worktree', 'add', '-q', '-b', branch, dir, base])
  process.stdout.write(`lane ${id}: ${dir} (branch ${branch} from ${base})\n`)
  applyProfiles(root, dir, apply)
}

function cmdList(root, base) {
  const lanes = lanesOf(root)
  if (!lanes.length) return process.stdout.write('no lanes\n')
  const lines = lanes.map(l => {
    const counts = git(l.path, ['rev-list', '--left-right', '--count', `${base}...HEAD`], true) || '0\t0'
    const [behind, ahead] = counts.split(/\s+/)
    const dirty = (git(l.path, ['status', '--porcelain'], true) || '').split(/\r?\n/).filter(Boolean).length
    const age = git(l.path, ['log', '-1', '--format=%cr'], true) || '?'
    return `${l.id}  ${l.branch || '(detached)'}  +${ahead}/-${behind}  dirty:${dirty}  last: ${age}`
  })
  const shown = lines.slice(0, MAX_LINES)
  if (lines.length > MAX_LINES) shown.push(`… ${lines.length - MAX_LINES} more lanes`)
  process.stdout.write(shown.join('\n') + '\n')
}

function cmdRm(root, id, base) {
  const lane = lanesOf(root).find(l => l.id === id)
  if (!lane) fail(`no lane "${id}" under .claude/worktrees/`)
  const dirty = (git(lane.path, ['status', '--porcelain'], true) || '').trim()
  if (dirty) fail(`lane "${id}" has uncommitted changes; commit or discard them first`)
  const head = lane.branch || git(lane.path, ['rev-parse', 'HEAD'])
  if (git(root, ['merge-base', '--is-ancestor', head, base], true) === null) {
    const byHand = `git worktree remove ${lane.path}${lane.branch ? ` && git branch -D ${lane.branch}` : ''}`
    fail(`${head} is not merged into ${base}; integrate it first, or remove it by hand: ${byHand}`)
  }
  git(root, ['worktree', 'remove', lane.path])
  if (lane.branch) git(root, ['branch', '-q', '-d', lane.branch])
  process.stdout.write(`lane ${id} removed\n`)
}

const [sub, ...rest] = process.argv.slice(2)
const { pos, flags } = parseFlags(rest)
const { root, common } = mainRoot(process.cwd())
const base = flags.base || defaultBase(root)
if (sub === 'new') cmdNew(root, common, pos[0], base, flags.apply === true)
else if (sub === 'list') cmdList(root, base)
else if (sub === 'rm') cmdRm(root, pos[0], base)
else fail('usage: orchestra-lanes new <area>/<id> [--apply] | list | rm <id>  [--base <ref>]')
