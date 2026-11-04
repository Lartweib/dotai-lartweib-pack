// Repeatable page capture with a compact result (principle P7).
//   node ui-shot.mjs <url> [--viewports 1440x900,390x844] [--out shots] [--name shot]
//                         [--full] [--wait 500]
// Prints one JSON line per viewport: { ok, title, errors, path, engine[, fallback] }. Errors
// are console errors, page errors and responses >= 400, at most 5 plus a count. Read the
// image only when the layout must be judged. Uses the project's own Playwright (no global
// install); when it is missing or fails to launch, agent-browser from PATH (console and page
// errors only, no HTTP status), with `fallback` saying why.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_ERRORS = 5
const AB_TIMEOUT_MS = 60000

export function parseArgs(argv) {
  const o = { url: null, viewports: [{ width: 1440, height: 900 }], out: 'shots', name: 'shot', full: false, wait: 500 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--full') o.full = true
    else if (a === '--viewports') {
      o.viewports = String(argv[++i]).split(',').map(v => {
        const m = /^(\d+)x(\d+)$/.exec(v.trim())
        if (!m) throw new Error(`bad viewport "${v}", expected WIDTHxHEIGHT`)
        return { width: Number(m[1]), height: Number(m[2]) }
      })
    } else if (a === '--out') o.out = argv[++i]
    else if (a === '--name') o.name = argv[++i]
    else if (a === '--wait') o.wait = Number(argv[++i]) || 0
    else if (!o.url) o.url = a
  }
  if (!o.url) throw new Error('usage: ui-shot <url> [--viewports WxH,...] [--out dir] [--name n] [--full] [--wait ms]')
  return o
}

const capErrors = errs => (errs.length > MAX_ERRORS ? [...errs.slice(0, MAX_ERRORS), `… ${errs.length - MAX_ERRORS} more`] : errs)
const shotPath = (o, vp) => join(o.out, `${o.name}-${vp.width}x${vp.height}.png`)

export async function capture(o, chromium) {
  mkdirSync(o.out, { recursive: true })
  const browser = await chromium.launch()
  const results = []
  try {
    for (const vp of o.viewports) {
      const page = await browser.newPage({ viewport: vp })
      const errors = []
      page.on('console', m => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 200)}`))
      page.on('pageerror', e => errors.push(`page: ${String(e.message || e).slice(0, 200)}`))
      page.on('response', r => r.status() >= 400 && errors.push(`${r.status()} ${r.url().slice(0, 200)}`))
      const path = shotPath(o, vp)
      try {
        await page.goto(o.url, { waitUntil: 'networkidle', timeout: 30000 })
        if (o.wait) await page.waitForTimeout(o.wait)
        await page.screenshot({ path, fullPage: o.full })
        results.push({ ok: true, title: await page.title(), errors: capErrors(errors), path: resolve(path) })
      } catch (e) {
        results.push({ ok: false, title: '', errors: capErrors([String(e.message || e).split('\n')[0], ...errors]), path: null })
      }
      await page.close()
    }
  } finally {
    await browser.close()
  }
  return results
}

// Same result shape through agent-browser's CLI. run(args) resolves to its --json reply,
// { success, data, error }. One session per run, so the user's own sessions are untouched;
// `close` leaves `~/.agent-browser/<session>.target` behind (0.41.2), so it is removed too.
export async function captureWithAgentBrowser(o, run, { home = homedir() } = {}) {
  mkdirSync(o.out, { recursive: true })
  const session = ['--json', '--session', `ui-shot-${process.pid}`]
  const call = (...args) => run([...session, ...args])
  const results = []
  let pageSeen = 0
  try {
    // agent-browser follows the OS color scheme; Playwright defaults to light. Pin light so
    // both engines render the same page.
    await call('set', 'media', 'light')
    for (const vp of o.viewports) {
      await call('set', 'viewport', String(vp.width), String(vp.height))
      const opened = await call('open', o.url)
      if (!opened?.success) {
        results.push({ ok: false, title: '', errors: capErrors([String(opened?.error || 'agent-browser open failed').split('\n')[0]]), path: null })
        continue
      }
      if (o.wait) await call('wait', String(o.wait))
      const path = resolve(shotPath(o, vp))
      const shot = await call('screenshot', ...(o.full ? ['--full'] : []), path)
      const errors = []
      for (const m of (await call('console'))?.data?.messages ?? []) if (m?.type === 'error') errors.push(`console: ${String(m.text).slice(0, 200)}`)
      // The logs belong to the session, not the page. `console --clear` works; `errors --clear`
      // does not on 0.27, so page errors seen in an earlier viewport are skipped by count (a
      // shorter list means the session was reset).
      const page = (await call('errors'))?.data?.errors ?? []
      if (page.length < pageSeen) pageSeen = 0
      // Playwright's message has no "Error: " prefix; drop it so both engines read the same.
      for (const e of page.slice(pageSeen)) errors.push(`page: ${String(e?.text).split('\n')[0].replace(/^Error: /, '').slice(0, 200)}`)
      pageSeen = page.length
      await call('console', '--clear')
      if (!shot?.success) {
        results.push({ ok: false, title: opened.data?.title ?? '', errors: capErrors([String(shot?.error || 'agent-browser screenshot failed').split('\n')[0], ...errors]), path: null })
        continue
      }
      results.push({ ok: true, title: opened.data?.title ?? '', errors: capErrors(errors), path })
    }
  } finally {
    await call('close')
    rmSync(join(home, '.agent-browser', `ui-shot-${process.pid}.target`), { force: true })
  }
  return results
}

// A program on PATH (with PATHEXT on Windows), or null. Kept here rather than taken from the
// base hook lib: this is a CLI, not a hook, and must work without the lib.
export function findOnPath(name, env = process.env, platform = process.platform) {
  const dirs = String(env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean)
  const exts = platform === 'win32' ? String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : ['']
  for (const dir of dirs) for (const ext of exts) if (existsSync(join(dir, name + ext.toLowerCase()))) return join(dir, name + ext.toLowerCase())
  return null
}

// agent-browser on PATH, or null. npm installs a .cmd shim on Windows; cmd.exe would read `%`
// and `&` in a URL, so the package's own script next to the shim runs through node instead,
// and a shim without it is not used.
export function agentBrowserCommand(which = name => findOnPath(name), platform = process.platform) {
  const found = which('agent-browser')
  if (!found) return null
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(found)) {
    const js = join(dirname(found), 'node_modules', 'agent-browser', 'bin', 'agent-browser.js')
    return existsSync(js) ? { file: process.execPath, prefix: [js] } : null
  }
  return { file: found, prefix: [] }
}

function agentBrowserRunner(cmd) {
  return async args => {
    const r = spawnSync(cmd.file, [...cmd.prefix, ...args], { encoding: 'utf8', timeout: AB_TIMEOUT_MS, windowsHide: true })
    const line = String(r.stdout ?? '').trim().split('\n').filter(l => l.trim().startsWith('{')).pop()
    try {
      return JSON.parse(line)
    } catch {
      return { success: false, data: null, error: r.error ? String(r.error.message) : String(r.stderr || `agent-browser exited ${r.status}`).trim() }
    }
  }
}

function projectChromium(cwd) {
  const req = createRequire(join(resolve(cwd), 'package.json'))
  for (const id of ['playwright', '@playwright/test', 'playwright-core']) {
    try {
      return req(id).chromium
    } catch {}
  }
  return null
}

const INSTALL_HINT = 'install playwright as a devDependency for repeatable captures (npm i -D playwright && npx playwright install chromium), or agent-browser 0.38 or later on PATH (npm i -g agent-browser@0.41.1)'

// Playwright first; agent-browser when Playwright is missing or cannot run (launch or
// browser setup throws). A page that fails to load is a result, not a reason to switch:
// capture() reports it as ok:false. Every line carries `engine`, and `fallback` when switched.
export async function shoot(o, { chromium, agentBrowser }) {
  let reason = 'playwright not installed in this project'
  if (chromium) {
    try {
      return (await capture(o, chromium)).map(r => ({ ...r, engine: 'playwright' }))
    } catch (e) {
      reason = `playwright failed: ${String(e?.message || e).split('\n')[0].slice(0, 200)}`
    }
  }
  if (agentBrowser) return (await captureWithAgentBrowser(o, agentBrowser)).map(r => ({ ...r, engine: 'agent-browser', fallback: reason }))
  return [{ ok: false, title: '', errors: [`${reason}; agent-browser not on PATH: ${INSTALL_HINT}`], path: null, engine: null }]
}

async function main() {
  let o
  try {
    o = parseArgs(process.argv.slice(2))
  } catch (e) {
    process.stderr.write(`ui-shot: ${e.message}\n`)
    process.exit(2)
  }
  const ab = agentBrowserCommand()
  const results = await shoot(o, { chromium: projectChromium(process.cwd()), agentBrowser: ab && agentBrowserRunner(ab) })
  for (const r of results) console.log(JSON.stringify(r))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
