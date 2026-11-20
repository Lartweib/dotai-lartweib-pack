import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs, shoot } from '../dotai/tools/desktop-shot.mjs'

const TOOLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'dotai', 'tools')
const require = createRequire(import.meta.url)
const sign = require('../dotai/tools/desktop-sign.cjs')
const OUT = join(tmpdir(), 'desktop-shot-test-out')

function fakeElectron({ fail = null } = {}) {
  return {
    async launch({ args }) {
      if (fail) throw new Error(fail)
      const handlers = {}
      const win = {
        on: (ev, fn) => (handlers[ev] = fn),
        waitForLoadState: async () => handlers.console?.({ type: () => 'error', text: () => 'preload failed' }),
        waitForTimeout: async () => {},
        title: async () => `App ${args[0]}`,
        screenshot: async ({ path }) => path,
      }
      return { firstWindow: async () => win, close: async () => {} }
    },
  }
}

test('a real window gives one compact summary', async () => {
  const r = await shoot(parseArgs(['--out', OUT]), fakeElectron())
  assert.equal(r.ok, true)
  assert.equal(r.title, 'App .')
  assert.deepEqual(r.errors, ['console: preload failed'])
  assert.match(r.path.replace(/\\/g, '/'), /desktop-shot-test-out\/window\.png$/)
})

test('a launch failure is ok:false with the first line of the error', async () => {
  const r = await shoot(parseArgs(['--out', OUT]), fakeElectron({ fail: 'Process failed to launch!\nstack' }))
  assert.deepEqual([r.ok, r.errors], [false, ['Process failed to launch!']])
})

test('without Playwright in the project it says how to install the pinned version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-shot-'))
  try {
    const runs = [['node', join(TOOLS, 'desktop-shot.mjs')], ['sh', join(TOOLS, 'desktop-shot.sh')]]
    if (process.platform === 'win32') runs.push(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(TOOLS, 'desktop-shot.ps1')])
    for (const argv of runs) {
      const r = spawnSync(argv[0], argv.slice(1), { cwd: dir, encoding: 'utf8', timeout: 30000 })
      assert.equal(r.status, 0, `${argv[0]}: ${r.stderr}`)
      assert.match(JSON.parse(r.stdout.trim()).errors[0], /playwright/i)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('signing is skipped without a configured signer', async () => {
  const before = process.env.DESKTOP_SIGN_COMMAND
  delete process.env.DESKTOP_SIGN_COMMAND
  try {
    assert.equal(await sign({ path: 'x.exe' }), 'skipped')
  } finally {
    if (before !== undefined) process.env.DESKTOP_SIGN_COMMAND = before
  }
})

test('a release that requires signing fails without a configured signer', async () => {
  const before = { cmd: process.env.DESKTOP_SIGN_COMMAND, req: process.env.DESKTOP_SIGN_REQUIRED }
  delete process.env.DESKTOP_SIGN_COMMAND
  process.env.DESKTOP_SIGN_REQUIRED = '1'
  try {
    await assert.rejects(sign({ path: 'x.exe' }), /DESKTOP_SIGN_REQUIRED/)
  } finally {
    if (before.cmd !== undefined) process.env.DESKTOP_SIGN_COMMAND = before.cmd
    if (before.req === undefined) delete process.env.DESKTOP_SIGN_REQUIRED
    else process.env.DESKTOP_SIGN_REQUIRED = before.req
  }
})

test('the configured signer runs once per file, and a failure stops the build', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-sign-'))
  const before = process.env.DESKTOP_SIGN_COMMAND
  try {
    const exe = join(dir, 'My App.exe')
    writeFileSync(exe, 'MZ')
    process.env.DESKTOP_SIGN_COMMAND = 'node -e "require(\'fs\').writeFileSync(process.argv[1] + \'.signed\', \'\')" {file}'
    assert.equal(await sign({ path: exe }), 'signed')
    assert.ok(existsSync(`${exe}.signed`))
    process.env.DESKTOP_SIGN_COMMAND = 'node -e "process.exit(4)" {file}'
    await assert.rejects(sign({ path: exe }), /exit 4/)
  } finally {
    if (before === undefined) delete process.env.DESKTOP_SIGN_COMMAND
    else process.env.DESKTOP_SIGN_COMMAND = before
    rmSync(dir, { recursive: true, force: true })
  }
})
