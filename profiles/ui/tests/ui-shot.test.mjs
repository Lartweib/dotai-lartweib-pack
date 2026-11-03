import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { agentBrowserCommand, capture, captureWithAgentBrowser, findOnPath, parseArgs, shoot } from '../dotai/tools/ui-shot.mjs'

const OUT = join(tmpdir(), 'ui-shot-test-out')
const TOOLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'dotai', 'tools')

test('arguments: url, viewports, output folder and name', () => {
  const a = parseArgs(['http://localhost:4321/', '--viewports', '1440x900,390x844', '--out', 'shots', '--name', 'home', '--full'])
  assert.equal(a.url, 'http://localhost:4321/')
  assert.deepEqual(a.viewports, [{ width: 1440, height: 900 }, { width: 390, height: 844 }])
  assert.equal(a.full, true)
  assert.equal(a.name, 'home')
  assert.deepEqual(parseArgs(['http://x']).viewports, [{ width: 1440, height: 900 }])
  assert.throws(() => parseArgs([]), /usage/)
  assert.throws(() => parseArgs(['http://x', '--viewports', 'big']), /viewport/)
})

function fakeChromium({ title = 'Home', fail = null, consoleErrors = 0, launchFails = null } = {}) {
  return {
    async launch() {
      if (launchFails) throw new Error(launchFails)
      return {
        async newPage({ viewport }) {
          const handlers = {}
          return {
            on: (ev, fn) => (handlers[ev] = fn),
            async goto() {
              if (fail) throw new Error(fail)
              for (let i = 0; i < consoleErrors; i++) handlers.console?.({ type: () => 'error', text: () => `boom ${i}` })
              handlers.response?.({ status: () => 404, url: () => 'http://x/missing.png' })
            },
            waitForTimeout: async () => {},
            title: async () => title,
            screenshot: async ({ path }) => path,
            close: async () => {},
            viewport,
          }
        },
        close: async () => {},
      }
    },
  }
}

test('one summary per viewport: ok, title, capped errors, path', async () => {
  const out = await capture(parseArgs(['http://x', '--viewports', '1440x900,390x844', '--out', OUT]), fakeChromium({ consoleErrors: 9 }))
  assert.equal(out.length, 2)
  assert.equal(out[0].ok, true)
  assert.equal(out[0].title, 'Home')
  assert.equal(out[0].errors.length, 6)
  assert.match(out[0].errors[5], /more/)
  const [few] = await capture(parseArgs(['http://x', '--out', OUT]), fakeChromium())
  assert.deepEqual(few.errors, ['404 http://x/missing.png'])
  assert.match(out[1].path.replace(/\\/g, '/'), /ui-shot-test-out\/shot-390x844\.png$/)
})

test('a failed navigation is ok:false, never a throw', async () => {
  const [r] = await capture(parseArgs(['http://x', '--out', OUT]), fakeChromium({ fail: 'net::ERR_CONNECTION_REFUSED' }))
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /ERR_CONNECTION_REFUSED/)
})

// agent-browser --json replies, as measured on 0.27.0 (2026-11-02).
function fakeAgentBrowser({ openFails = false, consoleErrors = 1 } = {}) {
  const calls = []
  const run = async args => {
    calls.push(args)
    const i = args.indexOf('--session')
    const rest = args.slice(i + 2)
    switch (rest[0]) {
      case 'open':
        return openFails ? { success: false, data: null, error: 'Navigation failed: net::ERR_CONNECTION_REFUSED' } : { success: true, data: { title: 'Home', url: rest[1] }, error: null }
      case 'console':
        return { success: true, data: { messages: [{ type: 'log', text: 'hi' }, ...Array.from({ length: consoleErrors }, (_, n) => ({ type: 'error', text: `boom ${n}` }))] }, error: null }
      case 'errors':
        return { success: true, data: { errors: [{ text: 'Error: kaput\n    at file:///p.html:1:95' }] }, error: null }
      case 'screenshot':
        return { success: true, data: { path: rest[rest.length - 1] }, error: null }
      default:
        return { success: true, data: {}, error: null }
    }
  }
  return { calls, run }
}

test('the agent-browser fallback: one isolated session, viewport, open, screenshot, then close', async () => {
  const ab = fakeAgentBrowser({ consoleErrors: 9 })
  const out = await captureWithAgentBrowser(parseArgs(['http://x/', '--viewports', '1440x900,390x844', '--out', OUT, '--full', '--wait', '200']), ab.run)
  assert.equal(out.length, 2)
  assert.equal(out[0].ok, true)
  assert.equal(out[0].title, 'Home')
  assert.equal(out[0].errors.length, 6)
  assert.match(out[0].errors[0], /^console: boom 0/)
  assert.match(out[1].path.replace(/\\/g, '/'), /ui-shot-test-out\/shot-390x844\.png$/)
  const session = ab.calls[0][ab.calls[0].indexOf('--session') + 1]
  assert.ok(ab.calls.every(c => c.includes('--json') && c[c.indexOf('--session') + 1] === session), 'every call uses --json and one session')
  const verbs = ab.calls.map(c => c.slice(c.indexOf('--session') + 2).join(' '))
  assert.equal(verbs[0], 'set viewport 1440 900')
  assert.equal(verbs[1], 'open http://x/')
  assert.equal(verbs[2], 'wait 200')
  assert.match(verbs[3], /^screenshot --full .*shot-1440x900\.png$/)
  assert.equal(verbs[verbs.length - 1], 'close')
  const [few] = await captureWithAgentBrowser(parseArgs(['http://x/', '--out', OUT]), fakeAgentBrowser().run)
  assert.deepEqual(few.errors, ['console: boom 0', 'page: Error: kaput'])
})

test('agent-browser: page errors that pile up in the session are reported once (0.27 ignores errors --clear)', async () => {
  let pageErrors = 0
  const run = async args => {
    const rest = args.slice(args.indexOf('--session') + 2)
    if (rest[0] === 'open') pageErrors++
    if (rest[0] === 'open') return { success: true, data: { title: 'T' }, error: null }
    if (rest[0] === 'errors') return { success: true, data: { errors: Array.from({ length: pageErrors }, (_, i) => ({ text: `Error: e${i}` })) }, error: null }
    if (rest[0] === 'console') return { success: true, data: { messages: [] }, error: null }
    return { success: true, data: {}, error: null }
  }
  const out = await captureWithAgentBrowser(parseArgs(['http://x/', '--viewports', '1440x900,390x844', '--out', OUT]), run)
  assert.deepEqual(out.map(r => r.errors), [['page: Error: e0'], ['page: Error: e1']])
})

test('agent-browser: a failed navigation is ok:false and the session is still closed', async () => {
  const ab = fakeAgentBrowser({ openFails: true })
  const [r] = await captureWithAgentBrowser(parseArgs(['http://x/', '--out', OUT]), ab.run)
  assert.equal(r.ok, false)
  assert.equal(r.path, null)
  assert.match(r.errors[0], /ERR_CONNECTION_REFUSED/)
  assert.deepEqual(ab.calls.at(-1).slice(-1), ['close'])
})

// The engine choice: Playwright first, agent-browser when Playwright is missing or cannot run.
test('engine: Playwright when it works, tagged playwright with no fallback', async () => {
  const ab = fakeAgentBrowser()
  const out = await shoot(parseArgs(['http://x', '--out', OUT]), { chromium: fakeChromium(), agentBrowser: ab.run })
  assert.equal(out[0].ok, true)
  assert.equal(out[0].engine, 'playwright')
  assert.equal('fallback' in out[0], false)
  assert.equal(ab.calls.length, 0, 'agent-browser is not touched')
})

test('engine: Playwright missing falls back to agent-browser and says so', async () => {
  const out = await shoot(parseArgs(['http://x/', '--out', OUT]), { chromium: null, agentBrowser: fakeAgentBrowser().run })
  assert.equal(out[0].ok, true)
  assert.equal(out[0].engine, 'agent-browser')
  assert.match(out[0].fallback, /playwright/i)
  assert.match(out[0].fallback, /not installed/)
})

test('engine: a Playwright launch error falls back to agent-browser with the reason', async () => {
  const launchFails = "browserType.launch: Executable doesn't exist at C:\\ms-playwright\\chromium\nrun npx playwright install"
  const out = await shoot(parseArgs(['http://x/', '--out', OUT]), { chromium: fakeChromium({ launchFails }), agentBrowser: fakeAgentBrowser().run })
  assert.equal(out[0].ok, true)
  assert.equal(out[0].engine, 'agent-browser')
  assert.match(out[0].fallback, /Executable doesn't exist/)
  assert.equal(out[0].fallback.includes('\n'), false, 'one line')
})

test('engine: a page error stays with Playwright (no fallback)', async () => {
  const ab = fakeAgentBrowser()
  const [r] = await shoot(parseArgs(['http://x', '--out', OUT]), { chromium: fakeChromium({ fail: 'net::ERR_CONNECTION_REFUSED' }), agentBrowser: ab.run })
  assert.equal(r.ok, false)
  assert.equal(r.engine, 'playwright')
  assert.equal(ab.calls.length, 0)
})

test('engine: both unavailable is one actionable line', async () => {
  const none = await shoot(parseArgs(['http://x', '--out', OUT]), { chromium: null, agentBrowser: null })
  assert.equal(none.length, 1)
  assert.equal(none[0].ok, false)
  assert.equal(none[0].engine, null)
  assert.match(none[0].errors[0], /devDependency/)
  assert.match(none[0].errors[0], /agent-browser.*0\.38/)
  const broken = await shoot(parseArgs(['http://x', '--out', OUT]), { chromium: fakeChromium({ launchFails: 'launch failed' }), agentBrowser: null })
  assert.equal(broken.length, 1)
  assert.match(broken[0].errors[0], /launch failed/)
  assert.match(broken[0].errors[0], /agent-browser/)
})

// PATH with node, sh and the system only (plus `extra`): the real agent-browser stays out.
function isolatedEnv(extra) {
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH') delete env[k]
  const sep = process.platform === 'win32' ? ';' : ':'
  const dirs = [extra, dirname(process.execPath), dirname(findOnPath('sh') ?? '/bin/sh')]
  if (process.platform === 'win32') dirs.push(join(process.env.SystemRoot || 'C:\\Windows', 'System32'), join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0'))
  else dirs.push('/usr/bin', '/bin')
  env.PATH = dirs.filter(Boolean).join(sep)
  return env
}

function wrapperRuns() {
  const runs = [['node', join(TOOLS, 'ui-shot.mjs')], ['sh', join(TOOLS, 'ui-shot.sh')]]
  if (process.platform === 'win32') runs.push(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(TOOLS, 'ui-shot.ps1')])
  return runs
}

test('without Playwright or agent-browser it says how to install either, in the same shape', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-shot-'))
  const empty = mkdtempSync(join(tmpdir(), 'ui-shot-path-'))
  try {
    for (const argv of wrapperRuns()) {
      const r = spawnSync(argv[0] === 'node' ? process.execPath : argv[0], [...argv.slice(1), 'http://localhost:1/'], { cwd: dir, encoding: 'utf8', timeout: 30000, env: isolatedEnv(empty) })
      assert.equal(r.status, 0, `${argv[0]}: ${r.stderr}`)
      const j = JSON.parse(r.stdout.trim())
      assert.equal(j.ok, false)
      assert.match(j.errors[0], /playwright/i)
      assert.match(j.errors[0], /agent-browser/)
      assert.equal(j.engine, null)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(empty, { recursive: true, force: true })
  }
})

test('without Playwright, a fake agent-browser on PATH takes the capture (npm layout: shim + bin js)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-shot-ab-'))
  const bin = mkdtempSync(join(tmpdir(), 'ui-shot-bin-'))
  try {
    const js = join(bin, 'node_modules', 'agent-browser', 'bin', 'agent-browser.js')
    mkdirSync(dirname(js), { recursive: true })
    const log = join(bin, 'calls.log')
    writeFileSync(js, `const fs = require('fs')
const a = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n')
const rest = a.slice(a.indexOf('--session') + 2)
const reply = d => console.log(JSON.stringify({ success: true, data: d, error: null }))
if (rest[0] === 'open') reply({ title: 'Fake Home', url: rest[1] })
else if (rest[0] === 'screenshot') { fs.writeFileSync(rest[rest.length - 1], 'png'); reply({ path: rest[rest.length - 1] }) }
else if (rest[0] === 'console') reply({ messages: [] })
else if (rest[0] === 'errors') reply({ errors: [] })
else reply({})
`)
    writeFileSync(join(bin, 'agent-browser.cmd'), '@ECHO off\r\nnode "%~dp0node_modules\\agent-browser\\bin\\agent-browser.js" %*\r\n')
    writeFileSync(join(bin, 'agent-browser'), '#!/bin/sh\nexec node "$(dirname "$0")/node_modules/agent-browser/bin/agent-browser.js" "$@"\n')
    chmodSync(join(bin, 'agent-browser'), 0o755)
    for (const argv of wrapperRuns()) {
      writeFileSync(log, '')
      const r = spawnSync(argv[0] === 'node' ? process.execPath : argv[0], [...argv.slice(1), 'http://localhost:4321/?q=a%20b&x=1', '--out', 'shots'], { cwd: dir, encoding: 'utf8', timeout: 30000, env: isolatedEnv(bin) })
      assert.equal(r.status, 0, `${argv[0]}: ${r.stderr}`)
      const j = JSON.parse(r.stdout.trim())
      assert.equal(j.ok, true, r.stdout)
      assert.equal(j.title, 'Fake Home')
      assert.equal(j.engine, 'agent-browser')
      assert.match(j.fallback, /playwright/i)
      assert.match(j.path.replace(/\\/g, '/'), /shots\/shot-1440x900\.png$/)
      const calls = readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l))
      assert.ok(calls.some(c => c.includes('http://localhost:4321/?q=a%20b&x=1')), 'the URL reaches agent-browser intact')
      assert.deepEqual(calls.at(-1).slice(-1), ['close'])
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  }
})

test('the agent-browser command prefers the npm package script next to a .cmd shim (no cmd.exe)', () => {
  const bin = mkdtempSync(join(tmpdir(), 'ui-shot-shim-'))
  try {
    const shim = join(bin, 'agent-browser.cmd')
    writeFileSync(shim, '')
    assert.equal(agentBrowserCommand(() => null), null)
    // A bare .cmd shim would need cmd.exe, which reads % and & in the URL: not used.
    assert.equal(agentBrowserCommand(() => shim, 'win32'), null)
    const js = join(bin, 'node_modules', 'agent-browser', 'bin', 'agent-browser.js')
    mkdirSync(dirname(js), { recursive: true })
    writeFileSync(js, '')
    const viaNode = agentBrowserCommand(() => shim, 'win32')
    assert.equal(viaNode.file, process.execPath)
    assert.deepEqual(viaNode.prefix, [js])
    assert.equal(agentBrowserCommand(() => '/usr/bin/agent-browser', 'linux').file, '/usr/bin/agent-browser')
  } finally {
    rmSync(bin, { recursive: true, force: true })
  }
})
