// Run: node --test profiles/godot/tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOOLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'dotai', 'tools')
const RUN = join(TOOLS, 'godot-run.mjs')
const node = process.execPath
const run = (args, timeout = 30000) => spawnSync(node, [RUN, ...args], { encoding: 'utf8', timeout })

test('the exit code of the command passes through', () => {
  assert.equal(run(['20', node, '-e', 'process.exit(3)']).status, 3)
  assert.equal(run(['-k', '2', '20', node, '-e', 'console.log("ok")']).stdout.trim(), 'ok')
})

test('a command past its deadline is killed and exits 124', () => {
  const t0 = Date.now()
  const r = run(['1', node, '-e', 'setInterval(() => {}, 1000)'])
  assert.equal(r.status, 124, r.stderr)
  assert.ok(Date.now() - t0 < 15000)
  assert.match(r.stderr, /godot-run: timed out after 1 s/)
})

test('the whole process tree dies on timeout', async () => {
  const script =
    'const c = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });' +
    'console.log(c.pid); setInterval(() => {}, 1000)'
  const r = run(['1', node, '-e', script])
  assert.equal(r.status, 124)
  const pid = Number(r.stdout.trim())
  assert.ok(pid > 0, r.stdout)
  let alive = true
  for (let i = 0; i < 30 && alive; i++) {
    try {
      process.kill(pid, 0)
      await new Promise(res => setTimeout(res, 100))
    } catch {
      alive = false
    }
  }
  assert.equal(alive, false, `grandchild ${pid} survived`)
})

test('bad usage exits 125 and a missing command 127', () => {
  const none = run([])
  assert.equal(none.status, 125)
  assert.match(none.stderr, /usage: godot-run/)
  assert.equal(run(['abc', 'godot']).status, 125)
  assert.equal(run(['5', 'dotai-no-such-program-xyz']).status, 127)
})

test('both wrappers run it', () => {
  const runs = [['sh', join(TOOLS, 'godot-run.sh')]]
  if (process.platform === 'win32') runs.push(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(TOOLS, 'godot-run.ps1')])
  for (const argv of runs) {
    const r = spawnSync(argv[0], [...argv.slice(1), '20', node, '-e', 'process.exit(4)'], { encoding: 'utf8', timeout: 30000 })
    assert.equal(r.status, 4, `${argv[0]}: ${r.stderr}`)
  }
})

test('a zero deadline runs the command without a timeout', () => {
  const r = run(['0', node, '-e', 'setTimeout(() => process.exit(5), 1500)'])
  assert.equal(r.status, 5, r.stderr)
})

test('descendants that ignore SIGTERM are killed once the leader exits on timeout', async () => {
  const script =
    'const c = require("child_process").spawn(process.execPath, ["-e", "process.on(\'SIGTERM\', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });' +
    'console.log(c.pid); setInterval(() => {}, 1000)'
  const r = run(['-k', '20', '1', node, '-e', script])
  assert.equal(r.status, 124)
  const pid = Number(r.stdout.trim())
  assert.ok(pid > 0, r.stdout)
  let alive = true
  for (let i = 0; i < 30 && alive; i++) {
    try {
      process.kill(pid, 0)
      await new Promise(res => setTimeout(res, 100))
    } catch {
      alive = false
    }
  }
  if (alive) process.kill(pid, 'SIGKILL')
  assert.equal(alive, false, `grandchild ${pid} survived`)
})

test('on Windows a .cmd shim is refused with a pointer to the real .exe', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'godot-run-shim-'))
  try {
    writeFileSync(join(dir, 'fakegodot.cmd'), '@echo off\r\nexit /b 0\r\n')
    const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') ?? 'PATH'
    const env = { ...process.env, [pathKey]: `${dir}${delimiter}${process.env[pathKey]}` }
    for (const cmd of ['fakegodot', 'fakegodot.cmd', join(dir, 'fakegodot.cmd')]) {
      const r = spawnSync(node, [RUN, '5', cmd], { encoding: 'utf8', timeout: 30000, env })
      assert.equal(r.status, 125, `${cmd}: ${r.stderr}`)
      assert.match(r.stderr, /\.cmd.*\.exe/, cmd)
      assert.equal(r.stderr.trim().split(/\r?\n/).length, 1, cmd)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
