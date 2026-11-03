import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOOLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'dotai', 'tools')
const TOOL = join(TOOLS, 'orchestra-lanes.mjs')
const WIN = process.platform === 'win32'

const git = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const lanes = (cwd, args, env = process.env) => spawnSync('node', [TOOL, ...args], { cwd, encoding: 'utf8', timeout: 30000, env })

// A PATH with node and git only, so no real dotai is found.
function barePath() {
  const r = spawnSync(WIN ? 'where' : 'which', ['git'], { encoding: 'utf8' })
  const gitDir = dirname(r.stdout.split(/\r?\n/)[0].trim())
  return [dirname(process.execPath), gitDir].join(delimiter)
}

// A fake dotai that records its arguments and working directory, then exits with FAKE_DOTAI_EXIT.
function fakeDotai(dir) {
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'fake-dotai.mjs'), [
    "import { writeFileSync } from 'node:fs'",
    'writeFileSync(process.env.FAKE_DOTAI_OUT, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }))',
    "if (process.env.FAKE_DOTAI_EXIT !== '0') process.stderr.write('harness-running: Claude Code is running\\n')",
    "process.exit(Number(process.env.FAKE_DOTAI_EXIT || '0'))",
  ].join('\n'))
  if (WIN) writeFileSync(join(bin, 'dotai.cmd'), '@node "%~dp0fake-dotai.mjs" %*\r\n')
  else {
    writeFileSync(join(bin, 'dotai'), `#!/bin/sh\nexec node "$(dirname "$0")/fake-dotai.mjs" "$@"\n`)
    chmodSync(join(bin, 'dotai'), 0o755)
  }
  return bin
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'orchestra-lanes-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 't@example.com')
  git(dir, 'config', 'user.name', 'T')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

function withProfiles(dir, profiles) {
  mkdirSync(join(dir, '.dotai'))
  writeFileSync(join(dir, '.dotai', 'state.json'), JSON.stringify({ schema: 'x', profiles }))
}

const wt = (dir, id) => join(dir, '.claude', 'worktrees', id)

test('new <area>/<id> makes .claude/worktrees/<id> on branch <area>/<id>, and ids are disjoint', () => {
  const dir = repo()
  try {
    const r = lanes(dir, ['new', 'combat/dash'])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /lane dash: .*\.claude[\\/]worktrees[\\/]dash \(branch combat\/dash from main\)/)
    assert.equal(git(wt(dir, 'dash'), 'branch', '--show-current'), 'combat/dash')
    assert.match(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8'), /^\.claude\/worktrees\/$/m)
    for (const again of ['combat/dash', 'ui/dash']) {
      const x = lanes(dir, ['new', again])
      assert.notEqual(x.status, 0, again)
      assert.match(x.stderr, /already used/)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('new refuses an area or id that is not a safe ref component', () => {
  const dir = repo()
  try {
    for (const bad of ['dash', 'Combat/dash', 'combat/Dash', 'a/b/c', '../x', 'combat/..', 'combat/x.lock', '-a/b', 'a/-b', 'a b/c', 'combat/']) {
      const r = lanes(dir, ['new', bad])
      assert.notEqual(r.status, 0, bad)
      assert.match(r.stderr, /<area>\/<id>/, bad)
    }
    assert.equal(existsSync(join(dir, '.claude')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('new prints the apply command with the profiles recorded in the main checkout', () => {
  const dir = repo()
  const bare = repo()
  try {
    withProfiles(dir, ['web', 'autonomous-orchestra'])
    const r = lanes(dir, ['new', 'combat/dash'], { ...process.env, PATH: barePath() })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /^apply: cd ".*dash" && dotai apply --profile web,autonomous-orchestra$/m)
    const none = lanes(bare, ['new', 'ui/menu'])
    assert.equal(none.status, 0, none.stderr)
    assert.match(none.stdout, /^apply: no profiles recorded in .*state\.json; nothing to apply$/m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('new --apply runs dotai apply in the new worktree when dotai is on PATH', () => {
  const dir = repo()
  try {
    withProfiles(dir, ['web'])
    const bin = fakeDotai(dir)
    const out = join(dir, 'dotai-call.json')
    const env = { ...process.env, PATH: [bin, barePath()].join(delimiter), FAKE_DOTAI_OUT: out, FAKE_DOTAI_EXIT: '0' }
    const r = lanes(dir, ['new', 'combat/dash', '--apply'], env)
    assert.equal(r.status, 0, r.stderr)
    const call = JSON.parse(readFileSync(out, 'utf8'))
    assert.deepEqual(call.args, ['apply', '--profile', 'web'])
    assert.equal(git(call.cwd, 'branch', '--show-current'), 'combat/dash')
    assert.match(r.stdout, /^applied: dotai apply --profile web \(in .*dash\)$/m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('new --apply says it did not apply when dotai is missing or fails', () => {
  const dir = repo()
  try {
    withProfiles(dir, ['web'])
    let r = lanes(dir, ['new', 'combat/dash', '--apply'], { ...process.env, PATH: barePath() })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /^not applied: dotai is not on PATH; run: cd ".*dash" && dotai apply --profile web$/m)
    const bin = fakeDotai(dir)
    const env = { ...process.env, PATH: [bin, barePath()].join(delimiter), FAKE_DOTAI_OUT: join(dir, 'c.json'), FAKE_DOTAI_EXIT: '3' }
    r = lanes(dir, ['new', 'combat/jump', '--apply'], env)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /lane jump: /)
    assert.match(r.stderr, /dotai apply failed \(exit 3\): harness-running: Claude Code is running; run: cd ".*jump" && dotai apply --profile web/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('list shows every worktree under .claude/worktrees/, whatever its branch, one line each', () => {
  const dir = repo()
  try {
    lanes(dir, ['new', 'combat/one'])
    git(dir, 'worktree', 'add', '-q', '-b', 'feature-x', wt(dir, 'raw'), 'main')
    git(dir, 'worktree', 'add', '-q', '--detach', wt(dir, 'detached'), 'main')
    git(dir, 'worktree', 'add', '-q', '-b', 'outside', join(dir, '.claude', 'elsewhere'), 'main')
    writeFileSync(join(wt(dir, 'raw'), 'b.txt'), 'b\n')
    writeFileSync(join(wt(dir, 'one'), 'c.txt'), 'c\n')
    git(wt(dir, 'one'), 'add', '.')
    git(wt(dir, 'one'), 'commit', '-q', '-m', 'c')
    const r = lanes(wt(dir, 'one'), ['list'])
    assert.equal(r.status, 0, r.stderr)
    const lines = r.stdout.trim().split('\n')
    assert.equal(lines.length, 3, r.stdout)
    assert.match(lines[0], /^detached\s+\(detached\)\s+\+0\/-0\s+dirty:0\s+last: /)
    assert.match(lines[1], /^one\s+combat\/one\s+\+1\/-0\s+dirty:0\s+last: /)
    assert.match(lines[2], /^raw\s+feature-x\s+\+0\/-0\s+dirty:1\s+last: /)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rm refuses a dirty or unmerged lane and removes a merged one with its branch', () => {
  const dir = repo()
  try {
    lanes(dir, ['new', 'combat/fix'])
    const lane = wt(dir, 'fix')
    writeFileSync(join(lane, 'c.txt'), 'c\n')
    let r = lanes(dir, ['rm', 'fix'])
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /uncommitted/)
    git(lane, 'add', '.')
    git(lane, 'commit', '-q', '-m', 'fix')
    r = lanes(dir, ['rm', 'fix'])
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /not merged into main/)
    git(dir, 'merge', '-q', '--ff-only', 'combat/fix')
    r = lanes(dir, ['rm', 'fix'])
    assert.equal(r.status, 0, r.stderr)
    assert.equal(git(dir, 'branch', '--list', 'combat/fix'), '')
    assert.equal(existsSync(lane), false)
    git(dir, 'worktree', 'add', '-q', '--detach', wt(dir, 'loose'), 'main')
    r = lanes(dir, ['rm', 'loose'])
    assert.equal(r.status, 0, r.stderr)
    assert.equal(existsSync(wt(dir, 'loose')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('both wrappers run the same tool', () => {
  const dir = repo()
  try {
    const runs = [['sh', join(TOOLS, 'orchestra-lanes.sh')]]
    if (WIN) runs.push(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(TOOLS, 'orchestra-lanes.ps1')])
    for (const argv of runs) {
      const r = spawnSync(argv[0], [...argv.slice(1), 'list'], { cwd: dir, encoding: 'utf8', timeout: 30000 })
      assert.equal(r.status, 0, `${argv[0]}: ${r.stderr}`)
      assert.match(r.stdout, /no lanes/)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
