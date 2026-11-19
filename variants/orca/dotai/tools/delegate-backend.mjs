// delegate-backend, orca variant (pack 0022, 0031, 0033, 0034): a single delegation opens a
// visible Orca terminal running `agy -p --output-format json`, waits for it and closes it.
// Several workers go through Orca's own `orchestration` skill, referenced by name, never copied;
// this tool only adds the pack's checks around `worker-start` (check, confirm).
// Without a reachable Orca the delegation runs headless: dotai never depends on Orca (0022).
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// The contract is a base tool at user scope (0034, update 2026-11-03). Staging writes the user
// tools directory into TOOLS (PACK-FORMAT, dotai 0030); from the pack source, as in the tests,
// the placeholder is still there and the base layer's copy is used. A missing core is reported
// (stderr, exit 1) instead of failing with a stack trace.
const TOOLS = '${DOTAI_TOOLS}'
const CORE = TOOLS.startsWith('$')
  ? new URL('../../../../base/dotai/tools/delegate-core.mjs', import.meta.url)
  : pathToFileURL(`${TOOLS}/delegate-core.mjs`)
let core
try {
  core = await import(CORE.href)
} catch (e) {
  process.stderr.write(`delegate-backend (orca): cannot load delegate-core.mjs from ${CORE.href} (${e.code || e.message}); reinstall the base pack.\n`)
  process.exit(1)
}
const { appendLog, findOnPath, headlessLaunch, main, runCli } = core

const TOOL = `${TOOLS}/delegate-backend.mjs`
const WIN = process.platform === 'win32'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const msFrom = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback)
// Tuning knobs (the tests shorten them): how often the wait asks Orca whether the terminal is
// still open, and how long `terminal create` may take.
const probeMs = env => msFrom(env.DOTAI_ORCA_PROBE_MS, 10000)
const createTimeoutMs = env => msFrom(env.DOTAI_ORCA_CREATE_TIMEOUT_MS, 60000)

function parseJson(text) {
  try {
    return JSON.parse(String(text).trim())
  } catch {
    return null
  }
}

const strings = v => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [])

// The handle of `terminal create --json`: `{ ok: true, result: { terminal: { handle: "term_<uuid>",
// tabId, title, ... } } }` (observed, Orca 1.4.247).
const createdHandle = j => (j?.ok === true && typeof j.result?.terminal?.handle === 'string' ? j.result.terminal.handle : null)

// The terminal in `terminal list --json` whose title holds `marker` (the job id). The list is
// `result.terminals[]` of `{ handle, title, preview, ... }` across every workspace (observed, Orca
// 1.4.247). Only the title is matched: `preview` is a terminal's recent output, so another tab
// (the caller's own session, say) can show the marker too. A cmd.exe terminal replaces the
// `--title` with its own once it runs a command, hence the `title` in terminalLine.
const findTerminal = (listed, marker) =>
  listed?.terminals.find(t => typeof t?.title === 'string' && t.title.includes(marker) && typeof t.handle === 'string')?.handle ?? null

// `{ ok: true, result: { runtime: { state: "ready", reachable: true, appVersion, ... } } }`
// (observed, Orca 1.4.247).
async function orcaReachable(orca, spec) {
  const r = await runCli(orca, ['status', '--json'], { cwd: spec.cwd, env: spec.env, timeoutMs: 15000 })
  const j = parseJson(r.stdout)
  return r.code === 0 && j?.ok === true && j.result?.runtime?.reachable === true
}

// The list's `result` (`terminals`, `truncated`, ...), or null when Orca does not answer with that
// shape (then nothing is concluded).
async function listTerminals(orca, spec) {
  const r = await runCli(orca, ['terminal', 'list', '--json'], { cwd: spec.cwd, env: spec.env, timeoutMs: 15000 })
  const j = parseJson(r.stdout)
  return r.code === 0 && j?.ok === true && Array.isArray(j.result?.terminals) ? j.result : null
}

// `{ ok: true, result: { close: { handle, tabId, closeMode: "tab" } } }`; a terminal whose line
// already ran `exit` is gone, and close answers `terminal_handle_stale` (exit 1), which is ignored
// (observed, Orca 1.4.247).
const closeTerminal = (orca, handle, spec) =>
  runCli(orca, ['terminal', 'close', '--terminal', handle, '--tab', '--json'], { cwd: spec.cwd, env: spec.env, timeoutMs: 30000 })

class Unquotable extends Error {}

// The command typed into the Orca terminal's shell: cmd.exe on Windows (0022, third test),
// the login shell elsewhere. It enters the working directory first (an Orca terminal opens in
// the workspace's), and touches the done marker whatever happens, which ends the wait; the JSON
// goes to out.json, since the exit code in cmd is not reliable and the real status is in the
// JSON (0022). In cmd.exe it also sets the tab title again, since cmd replaces the `--title`
// with its own (`C:\windows\SYSTEM32\cmd.exe - <command>`) while a command runs; after `title`,
// Orca lists `<title> [<id>]  - <command>` (observed, Orca 1.4.247). The `exit` at the end closes
// the tab: the terminal leaves `terminal list` by itself (observed, cmd.exe, Orca 1.4.247).
// The terminal has Orca's environment, not the delegate's, so the line also sets the isolated
// install's variables (an isolated OpenCode, delegate-core isolationVars) and clears the others it
// owns, which Orca's environment may hold.
function terminalLine(spec, { out, err, done }, label) {
  const parts = [spec.target ?? 'agy', ...spec.args]
  const env = { ...spec.isolation?.set, DOTAI_DELEGATE_CALLER: spec.env.DOTAI_DELEGATE_CALLER, DOTAI_DELEGATE_PARENT: spec.env.DOTAI_DELEGATE_PARENT }
  const unset = spec.isolation?.unset ?? []
  if (WIN) {
    const q = a => {
      if (/["%\r\n]/.test(a)) throw new Unquotable(`cannot type ${JSON.stringify(a)} into cmd.exe`)
      return `"${a}"`
    }
    const title = `title ${label.replace(/[^\w .,:[\]-]/g, ' ')}`
    const sets = [...unset.map(k => `set "${k}="`), ...Object.entries(env).map(([k, v]) => `set ${q(`${k}=${v}`)}`)]
    const run = `${parts.map((a, i) => (i ? q(a) : a)).join(' ')} > ${q(out)} 2> ${q(err)}`
    return `cd /d ${q(spec.cwd)} 2> ${q(err)} && (${[title, ...sets, run].join(' & ')}) & type nul > ${q(done)} & exit`
  }
  const q = a => `'${String(a).replace(/'/g, `'\\''`)}'`
  const sets = Object.entries(env).map(([k, v]) => `${k}=${q(v)}`)
  const clear = unset.length ? `unset ${unset.join(' ')}; ` : ''
  return `cd ${q(spec.cwd)} 2> ${q(err)} && ${clear}${sets.join(' ')} ${parts.map(q).join(' ')} > ${q(out)} 2> ${q(err)}; : > ${q(done)}; exit`
}

// Each attempt has its own folder (delegate-core), so a retry never sees the first attempt's
// done marker or out.json; stale files are removed anyway. Without a reachable Orca, with a
// working directory cmd.exe cannot take, or when `terminal create` fails, the run goes headless
// and `via` says why (headless:orca-unquotable, headless:orca-create-timeout,
// headless:orca-create-error); a terminal that a failed create still opened is closed first, so
// agy never runs twice. While waiting, Orca is asked every probeMs whether the terminal is still
// open; one missing from two lists in a row before its done marker fails the run.
async function orcaLaunch(spec) {
  const headless = async reason => ({ ...(await headlessLaunch(spec)), via: reason ? `headless:${reason}` : 'headless' })
  const orca = findOnPath('orca', spec.env)
  if (!orca || !(await orcaReachable(orca, spec))) return headless()
  const dir = spec.attemptDir ?? spec.jobDir
  const files = { out: join(dir, 'out.json'), err: join(dir, 'err.txt'), done: join(dir, 'done') }
  for (const f of Object.values(files)) rmSync(f, { force: true })
  const marker = `[${spec.id}]`
  const label = `${spec.title} ${marker}`
  let typed
  try {
    typed = terminalLine(spec, files, label)
  } catch (e) {
    if (e instanceof Unquotable) return headless('orca-unquotable')
    throw e
  }
  const args = ['terminal', 'create', '--title', label, '--command', typed]
  if (WIN) args.push('--shell', 'cmd.exe')
  args.push('--json')
  const created = await runCli(orca, args, { cwd: spec.cwd, env: spec.env, timeoutMs: createTimeoutMs(spec.env) })
  if (created.code !== 0 || created.timedOut) {
    const stray = findTerminal(await listTerminals(orca, spec), marker)
    if (stray) await closeTerminal(orca, stray, spec)
    return headless(created.timedOut ? 'orca-create-timeout' : 'orca-create-error')
  }
  let handle = createdHandle(parseJson(created.stdout)) ?? findTerminal(await listTerminals(orca, spec), marker)
  const every = probeMs(spec.env)
  const deadline = Date.now() + spec.timeoutMs
  let nextProbe = Date.now() + every
  let lost = false
  // The terminal counts as closed when a complete list (not `truncated`) has no entry with its
  // handle, on two probes in a row; a live terminal is always listed (observed, Orca 1.4.247).
  // Other tabs' fields are never read (a `preview` can quote the handle). A failed, unparsed or
  // truncated list concludes nothing.
  const listedHere = listed => listed.terminals.some(t => t?.handle === handle)
  let misses = 0
  try {
    while (!existsSync(files.done) && Date.now() < deadline) {
      await sleep(Math.min(500, every))
      if (!handle || Date.now() < nextProbe || existsSync(files.done)) continue
      nextProbe = Date.now() + every
      const listed = await listTerminals(orca, spec)
      if (!listed || listed.truncated === true) continue
      misses = listedHere(listed) ? 0 : misses + 1
      if (misses >= 2 && !existsSync(files.done)) {
        lost = true
        break
      }
    }
  } finally {
    // Without a handle from create, the terminal is looked up by the job marker once more; if it
    // still cannot be found, the user is asked to close the tab (one line on stderr).
    handle ??= findTerminal(await listTerminals(orca, spec), marker)
    if (handle) await closeTerminal(orca, handle, spec)
    else process.stderr.write(`delegate ${spec.id}: could not find its Orca terminal; close the Orca tab titled with ${marker} yourself.\n`)
  }
  const read = f => (existsSync(f) ? readFileSync(f, 'utf8') : '')
  const via = `orca:${handle ?? 'unknown'}`
  if (lost) return { code: null, stdout: read(files.out), stderr: read(files.err), timedOut: false, fail: 'terminal closed before agy finished', via }
  const timedOut = !existsSync(files.done)
  return { code: timedOut ? null : 0, stdout: read(files.out), stderr: read(files.err), timedOut, via }
}

const words = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
// After worker-start, the real model from the worker's own output, because Orca's
// launch.effective repeats what was asked even when agy ignored it (0022, orchestration test).
// The model is matched as words. agy's banner prints "Gemini 3.8 Flash (Low)" on its own line
// (agy 1.4.12, trial 2026-11-04), but the pack statusline shows "3.8 Flash (Low)", so a leading
// "gemini" is optional. A fresh agy dir or an untrusted folder shows onboarding or a trust prompt
// before the banner, so the worker blocks there and the verdict is UNCONFIRMED.
async function confirm(a, ctx) {
  const { dispatch, model } = a.flags
  if (!dispatch || !model) {
    process.stdout.write('delegate REJECT confirm needs --dispatch ID and --model M\n')
    return 2
  }
  const orca = findOnPath('orca', ctx.env)
  if (!orca) {
    process.stdout.write('delegate UNCONFIRMED orca not found on PATH\n')
    return 1
  }
  const r = await runCli(orca, ['orchestration', 'worker-read', '--dispatch', dispatch, '--json'], { cwd: process.cwd(), env: ctx.env, timeoutMs: 30000 })
  const text = words(strings(parseJson(r.stdout) ?? r.stdout).join(' '))
  const want = words(model)
  let verdict = 'UNCONFIRMED'
  const bare = want.replace(/^gemini /, '')
  if (text && (` ${text} `.includes(` ${want} `) || ` ${text} `.includes(` ${bare} `))) verdict = 'CONFIRMED'
  else if (/\b(gemini|claude|gpt)\b/.test(text)) verdict = 'MISMATCH'
  appendLog(ctx.checks, { event: 'confirm', ts: Date.now(), dispatch, model, verdict, harness: 'agy' }, ctx.cfg.logMax)
  const hint = verdict === 'CONFIRMED' ? '' : ': stop that worker (worker-stop) and report it; do not trust launch.effective'
  process.stdout.write(`delegate ${verdict} dispatch=${dispatch} model=${model}${hint}\n`)
  return verdict === 'CONFIRMED' ? 0 : 1
}

export const adapter = {
  variant: 'orca',
  launch: orcaLaunch,
  refuseJobs: 'several workers go through Orca orchestration in this variant; run `workers` for the steps.',
  checkExtra: (d, job) => (job.target === 'agy' ? ` worker-start: --agent antigravity --model ${d.model}${d.effortFlag ? ` --effort ${d.effortFlag}` : ''}` : ''),
  helpExtra: ["  confirm --dispatch ID --model M   confirm a worker's real model after startup"],
  commands: { confirm },
  workersGuide: () =>
    [
      "Several agy workers (orca): Orca's orchestration runs them; the pack adds its contract.",
      '1. Load the guide: orca skills get orchestration. Orca owns it; never copy it.',
      `2. Before each worker-start: node "${TOOL}" check --model M --effort E --title "worker name"`,
      '   Exit 0 prints the flags to pass (worker-start ... --agent antigravity --model M [--effort E]). Exit 2, 3 or 4: do not start it (fix, defer, or ask the user).',
      '3. In each task spec, require the long result in a result file in its own job folder (.dotai/jobs/<name>/result.md); worker_done carries only a short summary.',
      `4. After startup, confirm the real model: node "${TOOL}" confirm --dispatch <dispatch_id> --model M`,
      '   MISMATCH or UNCONFIRMED: stop that worker and report it.',
      'One worker: use run instead; it opens an Orca terminal running agy -p.',
    ].join('\n'),
}

process.exitCode = await main(process.argv.slice(2), adapter)
