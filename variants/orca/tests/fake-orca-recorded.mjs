// A fake orca that answers with the JSON recorded from Orca 1.4.247 (fixtures/orca-1.4.247,
// sanitized), so the backend's parsing is tested against real shapes. Behavior observed in the
// trial and mirrored here: `terminal list` spans every workspace and holds another tab; cmd.exe
// replaces the tab title while a command runs (kept only after a `title` in the line); a
// terminal whose line ran `exit` leaves the list; `close` on it answers `terminal_handle_stale`.
// FAKE_ORCA words: create-hang, vanish, truncated, foreign-mentions (the other tab's preview
// quotes this job's marker and handle). Every call is appended to FAKE_LOG like fake-cli's.
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FAKE_CLI } from '../../standalone/tests/fakes.mjs'

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'orca-1.4.247')
const fixture = n => JSON.parse(readFileSync(join(FIX, `${n}.json`), 'utf8'))
const argv = process.argv.slice(2)
const env = process.env
const mode = new Set((env.FAKE_ORCA ?? '').split(/\s+/).filter(Boolean))
const arg = (a, flag) => (a.includes(flag) ? a[a.indexOf(flag) + 1] : undefined)
const out = (j, code = 0) => {
  process.stdout.write(JSON.stringify(j))
  process.exitCode = code
}
const calls = () => (existsSync(env.FAKE_LOG) ? readFileSync(env.FAKE_LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])
appendFileSync(env.FAKE_LOG, JSON.stringify({ name: 'orca', argv, cwd: process.cwd() }) + '\n')

const closed = () => calls().filter(c => c.argv[1] === 'close').map(c => arg(c.argv, '--terminal'))
const terminals = () =>
  calls()
    .filter(c => c.argv[1] === 'create')
    .map((c, i) => {
      const line = arg(c.argv, '--command')
      const done = /type nul > "([^"]+)"|: > '([^']+)'/.exec(line)
      const titled = /\(title ([^&]*?) &/.exec(line)
      const cmd = c.argv.includes('cmd.exe')
      return {
        handle: `term_recorded${i + 1}`,
        marker: /\[[^\]]+\]/.exec(arg(c.argv, '--title'))?.[0],
        title: !cmd ? arg(c.argv, '--title') : titled ? `${titled[1]}  - agy` : 'C:\\windows\\SYSTEM32\\cmd.exe - agy',
        exited: Boolean(done && existsSync(done[1] ?? done[2])),
      }
    })
const live = () => terminals().filter(t => !t.exited && !closed().includes(t.handle))

const cmd = argv.slice(0, 2).join(' ')
if (argv[0] === 'status') out(fixture('status'))
else if (cmd === 'terminal create') {
  if (mode.has('create-hang')) await new Promise(r => setTimeout(r, 30000))
  else {
    if (!mode.has('vanish')) spawn(process.execPath, [FAKE_CLI, 'orca-term', arg(argv, '--command')], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    const j = fixture('create')
    Object.assign(j.result.terminal, { handle: terminals().at(-1).handle, title: arg(argv, '--title') })
    out(j)
  }
} else if (cmd === 'terminal list') {
  const j = fixture('list-running')
  const [foreign, template] = j.result.terminals
  const last = terminals().at(-1)
  if (mode.has('foreign-mentions') && last) foreign.preview = `delegate ${last.marker} ... via=orca:${last.handle}`
  const mine = mode.has('vanish') || mode.has('truncated') ? [] : live().map(t => ({ ...template, handle: t.handle, title: t.title }))
  j.result.terminals = [foreign, ...mine]
  j.result.totalCount = mode.has('truncated') ? 1 + live().length : j.result.terminals.length
  j.result.truncated = mode.has('truncated')
  out(j)
} else if (cmd === 'terminal close') {
  const h = arg(argv, '--terminal')
  const t = terminals().find(x => x.handle === h)
  // This call is already in the log, so closed() includes h once.
  const isLive = t && !t.exited && closed().filter(x => x === h).length === 1
  if (isLive) {
    const j = fixture('close-tab')
    j.result.close.handle = h
    out(j)
  } else out(fixture('close-stale'), 1)
} else out({ ok: false, error: { code: 'not_faked', message: `fake orca: ${cmd} not faked` } }, 1)
