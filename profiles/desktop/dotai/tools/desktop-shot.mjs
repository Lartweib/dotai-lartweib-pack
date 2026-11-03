// Real-window check of an Electron app through Playwright's Electron support.
//   node desktop-shot.mjs [--main .] [--out shots] [--wait 1000]
// Launches the app, waits for the first window, captures it and prints one JSON line:
// { ok, title, errors, path }. Errors are console errors and page errors, at most 5.
// Uses the project's own pinned Playwright (see the desktop-verify skill).
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_ERRORS = 5

export function parseArgs(argv) {
  const o = { main: '.', out: 'shots', wait: 1000 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--main') o.main = argv[++i]
    else if (argv[i] === '--out') o.out = argv[++i]
    else if (argv[i] === '--wait') o.wait = Number(argv[++i]) || 0
  }
  return o
}

const cap = e => (e.length > MAX_ERRORS ? [...e.slice(0, MAX_ERRORS), `… ${e.length - MAX_ERRORS} more`] : e)

export async function shoot(o, electron) {
  mkdirSync(o.out, { recursive: true })
  const path = join(o.out, 'window.png')
  const errors = []
  let app = null
  try {
    app = await electron.launch({ args: [o.main] })
    const win = await app.firstWindow()
    win.on('console', m => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 200)}`))
    win.on('pageerror', e => errors.push(`page: ${String(e.message || e).slice(0, 200)}`))
    await win.waitForLoadState('domcontentloaded')
    if (o.wait) await win.waitForTimeout(o.wait)
    await win.screenshot({ path })
    return { ok: true, title: await win.title(), errors: cap(errors), path: resolve(path) }
  } catch (e) {
    return { ok: false, title: '', errors: cap([String(e.message || e).split('\n')[0], ...errors]), path: null }
  } finally {
    if (app) await app.close().catch(() => {})
  }
}

function projectElectron(cwd) {
  const req = createRequire(join(resolve(cwd), 'package.json'))
  for (const id of ['playwright', '@playwright/test', 'playwright-core']) {
    try {
      return req(id)._electron
    } catch {}
  }
  return null
}

async function main() {
  const o = parseArgs(process.argv.slice(2))
  const electron = projectElectron(process.cwd())
  if (!electron) {
    console.log(JSON.stringify({ ok: false, title: '', errors: ['playwright is not installed in this project: add @playwright/test at the pinned version (desktop-verify skill)'], path: null }))
    return
  }
  console.log(JSON.stringify(await shoot(o, electron)))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
