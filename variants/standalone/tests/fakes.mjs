// Test helpers: a sandbox under a path with spaces and fake agy/opencode/orca CLIs on PATH.
// PATH holds only the fakes, node's own directory and the OS directories, so a missing fake can
// never fall through to a real CLI (no quota is ever spent by the tests).
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const FAKE_CLI = join(HERE, 'fake-cli.mjs')
const WIN = process.platform === 'win32'

export function sandbox(fakes = ['agy', 'opencode']) {
  const root = mkdtempSync(join(tmpdir(), 'dotai delegate '))
  const bin = join(root, 'fake bin')
  const home = join(root, 'home dir')
  const project = join(root, 'my project')
  for (const d of [bin, home, project, join(project, '.git')]) mkdirSync(d, { recursive: true })
  for (const name of fakes) writeFake(bin, name)
  const sys = WIN ? [join(process.env.SystemRoot || 'C:\\Windows', 'System32'), process.env.SystemRoot || 'C:\\Windows'] : ['/usr/bin', '/bin']
  const fakeLog = join(root, 'fake-calls.jsonl')
  const env = {
    PATH: [bin, dirname(process.execPath), ...sys].join(delimiter),
    SystemRoot: process.env.SystemRoot ?? '',
    ComSpec: process.env.ComSpec ?? '',
    PATHEXT: process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
    TEMP: process.env.TEMP ?? tmpdir(),
    TMP: process.env.TMP ?? tmpdir(),
    HOME: home,
    USERPROFILE: home,
    DOTAI_DELEGATE_HOME: join(home, 'pack home'),
    DOTAI_AGY_RATE_LIMITS: join(home, 'rate_limits.json'),
    FAKE_LOG: fakeLog,
  }
  return {
    root,
    bin,
    home,
    project,
    env,
    fakeLog,
    calls: () => (existsSync(fakeLog) ? readFileSync(fakeLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) : []),
    rateLimits: obj => writeFileSync(env.DOTAI_AGY_RATE_LIMITS, JSON.stringify(obj)),
    config: text => {
      mkdirSync(env.DOTAI_DELEGATE_HOME, { recursive: true })
      writeFileSync(join(env.DOTAI_DELEGATE_HOME, 'delegate.yaml'), text)
    },
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
  }
}

export function writeFake(bin, name) {
  if (WIN) {
    writeFileSync(join(bin, `${name}.cmd`), `@node "${FAKE_CLI}" ${name} %*\r\n`)
  } else {
    const f = join(bin, name)
    writeFileSync(f, `#!/bin/sh\nexec node '${FAKE_CLI}' ${name} "$@"\n`)
    chmodSync(f, 0o755)
  }
}

export function runTool(script, args, sb, extraEnv = {}, input = '', cwd = sb.project) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: { ...sb.env, ...extraEnv },
    encoding: 'utf8',
    input,
    timeout: 60000,
  })
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}

export function spec(sb, name = 'task spec.md', text = '# Task\nSummarize the repo.\n') {
  const f = join(sb.project, name)
  writeFileSync(f, text)
  return f
}
