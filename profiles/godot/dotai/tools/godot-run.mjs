// Runs a command with a deadline, like coreutils `timeout`, in every shell (pack decision 0045).
// cmd and PowerShell have no `timeout` that runs a command (theirs waits), so the godot guard
// suggests this tool there and accepts it as a deadline everywhere.
//   node godot-run.mjs [-k KILL_AFTER] SECONDS COMMAND [ARGS...]
// At the deadline the whole process tree is stopped: Windows `taskkill /T /F`; POSIX SIGTERM to
// the process group, then SIGKILL after KILL_AFTER seconds (default 5). Exit codes follow
// `timeout`: 124 on timeout, 125 on bad usage, 127 when the command is missing, else the
// command's own. Self-contained (no hook-lib): it is a runner the agent calls, not a hook.
import { spawn, spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { constants } from 'node:os'
import { extname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const USAGE = 'usage: godot-run [-k KILL_AFTER_SECONDS] SECONDS COMMAND [ARGS...]'
const UNIT = { s: 1, m: 60, h: 3600, d: 86400 }

const seconds = v => {
  const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(String(v ?? ''))
  return m ? Number(m[1]) * UNIT[m[2] || 's'] : NaN
}

// Returns { timeoutSec, killAfterSec, command, args }, or null on bad usage.
export function parseArgs(argv) {
  let i = 0
  let killAfterSec = 5
  if (argv[i] === '-k' || argv[i] === '--kill-after') {
    killAfterSec = seconds(argv[i + 1])
    i += 2
  } else if (/^--kill-after=/.test(argv[i] ?? '')) {
    killAfterSec = seconds(argv[i].slice('--kill-after='.length))
    i++
  }
  const timeoutSec = seconds(argv[i])
  const command = argv[i + 1]
  if (!Number.isFinite(killAfterSec) || !Number.isFinite(timeoutSec) || !command) return null
  return { timeoutSec, killAfterSec, command, args: argv.slice(i + 2) }
}

// Windows: finds the file the command names, as the shell would (current directory, then PATH,
// trying each PATHEXT extension when the name has none). Returns the path, or null.
export function resolveWindowsCommand(command, env = process.env, cwd = process.cwd()) {
  const key = name => Object.keys(env).find(k => k.toLowerCase() === name)
  const exts = (env[key('pathext')] || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map(e => e.toLowerCase())
  const names = exts.includes(extname(command).toLowerCase()) ? [command] : exts.map(e => command + e)
  const dirs = /[\\/]/.test(command) || isAbsolute(command) ? [''] : [cwd, ...(env[key('path')] || '').split(';').filter(Boolean)]
  for (const dir of dirs) {
    for (const name of names) {
      const f = dir ? join(dir, name) : resolve(cwd, name)
      try {
        if (statSync(f).isFile()) return f
      } catch {}
    }
  }
  return null
}

const fail = (code, text) => {
  process.stderr.write(`godot-run: ${text}\n`)
  process.exit(code)
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts) {
    process.stderr.write(`${USAGE}\n`)
    process.exit(125)
  }
  const posix = process.platform !== 'win32'
  let file = opts.command
  if (!posix) {
    // Node spawns only real executables on Windows; a .cmd or .bat would need cmd.exe, whose
    // quoting cannot pass every argument through unchanged (% and ! expand even in quotes), so
    // it is refused instead of run with arguments it may have rewritten.
    file = resolveWindowsCommand(opts.command)
    if (!file) fail(127, `cannot run ${opts.command} (not found)`)
    const ext = extname(file).toLowerCase()
    if (ext !== '.exe' && ext !== '.com') {
      fail(125, `${opts.command} resolves to ${file}, a ${ext || 'non-executable'} script, which cannot be run with safe arguments; pass the real .exe instead (for example Godot_v4.x-stable_win64_console.exe).`)
    }
  }
  let child
  try {
    // POSIX: its own process group, so one signal reaches everything it starts.
    child = spawn(file, opts.args, { stdio: 'inherit', detached: posix })
  } catch (e) {
    fail(127, `cannot run ${opts.command} (${e.code || e.message})`)
  }
  let timedOut = false
  const signalGroup = sig => {
    try {
      process.kill(-child.pid, sig)
    } catch {}
  }
  const stopTree = () => {
    if (posix) {
      signalGroup('SIGTERM')
      setTimeout(() => signalGroup('SIGKILL'), opts.killAfterSec * 1000).unref()
    } else {
      spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true })
    }
  }
  // A zero deadline disables the timeout, as in coreutils.
  const timer =
    opts.timeoutSec > 0
      ? setTimeout(() => {
          timedOut = true
          process.stderr.write(`godot-run: timed out after ${opts.timeoutSec} s; stopping the process tree.\n`)
          stopTree()
        }, opts.timeoutSec * 1000)
      : null
  // A detached group does not get the terminal's Ctrl-C; pass it on.
  if (posix) for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => signalGroup(sig))
  child.on('error', e => {
    clearTimeout(timer)
    process.stderr.write(`godot-run: cannot run ${opts.command} (${e.code || e.message})\n`)
    process.exit(e.code === 'ENOENT' ? 127 : 126)
  })
  child.on('exit', (code, signal) => {
    clearTimeout(timer)
    if (timedOut) {
      // Exiting drops the pending SIGKILL timer, so descendants that ignored SIGTERM would
      // outlive the deadline; kill the group now.
      if (posix) signalGroup('SIGKILL')
      process.exit(124)
    }
    process.exit(code ?? 128 + (constants.signals[signal] ?? 0))
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
