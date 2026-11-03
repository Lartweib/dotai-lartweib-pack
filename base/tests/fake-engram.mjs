// A fake `engram` CLI for the tests, put first on PATH so the hooks never reach the real store.
// Each call appends its arguments to calls.jsonl next to it; `search` prints FAKE_ENGRAM_OUT;
// FAKE_ENGRAM_EXIT sets the exit code. Not a test file (no .test suffix).
import { appendFileSync, chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)

// Creates a directory (with a space in its name) holding the fake; returns { dir, env, calls }.
export function fakeEngram({ out = '', exit = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fake engram '))
  if (process.platform === 'win32') {
    writeFileSync(join(dir, 'engram.cmd'), `@"${process.execPath}" "${SELF}" %*\r\n`)
  } else {
    writeFileSync(join(dir, 'engram'), `#!/bin/sh\nexec "${process.execPath}" "${SELF}" "$@"\n`)
    chmodSync(join(dir, 'engram'), 0o755)
  }
  const env = { PATH: dir, Path: dir, FAKE_ENGRAM_LOG: join(dir, 'calls.jsonl'), FAKE_ENGRAM_OUT: out, FAKE_ENGRAM_EXIT: String(exit) }
  const calls = () => {
    const f = join(dir, 'calls.jsonl')
    return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
  }
  return { dir, env, calls }
}

if (process.argv[1] === SELF) {
  const args = process.argv.slice(2)
  if (process.env.FAKE_ENGRAM_LOG) appendFileSync(process.env.FAKE_ENGRAM_LOG, `${JSON.stringify(args)}\n`)
  if (args[0] === 'search' && process.env.FAKE_ENGRAM_OUT) process.stdout.write(process.env.FAKE_ENGRAM_OUT)
  if (args[0] === 'save') process.stdout.write('saved\n')
  process.exit(Number(process.env.FAKE_ENGRAM_EXIT || 0))
}

export const fakeDir = dirname(SELF)
