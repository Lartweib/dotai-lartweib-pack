// Fake agy, claude, opencode and orca for the tests. Behavior comes from FAKE_AGY / FAKE_CLAUDE /
// FAKE_OPENCODE / FAKE_ORCA; every call is appended to FAKE_LOG. Never calls a real CLI.
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const [name, ...argv] = process.argv.slice(2)
const env = process.env
const log = extra => {
  if (env.FAKE_LOG) appendFileSync(env.FAKE_LOG, JSON.stringify({ name, argv, cwd: process.cwd(), ...extra }) + '\n')
}
const arg = flag => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const jobDir = text => /job folder: (.+)$/.exec(text ?? '')?.[1]?.trim()
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function agy() {
  const prompt = arg('-p')
  const model = arg('--model') ?? ''
  const mode = env.FAKE_AGY ?? 'ok'
  log({ caller: env.DOTAI_DELEGATE_CALLER, parent: env.DOTAI_DELEGATE_PARENT })
  const dir = jobDir(prompt)
  const quota = mode === 'quota' || (mode === 'quota-gemini' && model.startsWith('gemini'))
  if (quota) {
    process.stdout.write(JSON.stringify({ status: 'ERROR', error: 'RESOURCE_EXHAUSTED: out of quota until 12:00', usage: {} }))
    return
  }
  if (mode === 'quota-stderr') {
    process.stdout.write('panic: no json here')
    process.stderr.write('Error: RESOURCE_EXHAUSTED (429)\n')
    process.exit(1)
  }
  if (mode === 'huge') {
    process.stdout.write(JSON.stringify({ status: 'SUCCESS', response: 'x'.repeat(5 * 1024 * 1024), usage: { input_tokens: 1, output_tokens: 1 } }))
    return
  }
  if (mode === 'empty') {
    process.stdout.write(JSON.stringify({ status: 'SUCCESS', response: '', usage: {} }))
    return
  }
  if (mode === 'error') {
    process.stdout.write(JSON.stringify({ status: 'ERROR', error: 'boom', usage: {} }))
    return
  }
  if (mode === 'sleep') await sleep(Number(env.FAKE_AGY_SLEEP_MS) || 8000)
  if (dir) {
    mkdirSync(dir, { recursive: true })
    const body = mode === 'env' ? `caller=${env.DOTAI_DELEGATE_CALLER} parent=${env.DOTAI_DELEGATE_PARENT}` : 'fake result: Definición'
    writeFileSync(join(dir, 'result.md'), body)
  }
  process.stdout.write(
    JSON.stringify({
      status: 'SUCCESS',
      response: 'done',
      duration_seconds: 1.5,
      num_turns: 2,
      usage: { input_tokens: 16457, output_tokens: 1200, reasoning_tokens: 30, cached_tokens: 9000 },
    }),
  )
}

async function opencode() {
  log({ caller: env.DOTAI_DELEGATE_CALLER, xdgConfig: env.XDG_CONFIG_HOME, testHome: env.OPENCODE_TEST_HOME, config: env.OPENCODE_CONFIG, disableClaude: env.OPENCODE_DISABLE_CLAUDE_CODE })
  const message = argv[argv.length - 1]
  const dir = jobDir(message)
  // Without --auto (research, audit) OpenCode cannot write: only the reply comes back.
  if (dir && argv.includes('--auto')) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'result.md'), 'opencode result')
  }
  if (env.FAKE_OPENCODE === 'error') {
    process.stderr.write('model not found\n')
    process.exit(1)
  }
  // The `run --format json` event stream: {type, timestamp, sessionID, part}, one per line.
  const ev = (type, part) => process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID: 'ses_fake', part }) + '\n')
  const tokens = { input: 1200, output: 80, reasoning: 0, cache: { read: 0, write: 0 } }
  ev('step_start', { type: 'step-start' })
  if (env.FAKE_OPENCODE !== 'silent') ev('text', { type: 'text', text: 'Let me read spec.md.' })
  ev('tool_use', { type: 'tool', tool: 'read', state: { status: 'completed' } })
  ev('step_finish', { type: 'step-finish', reason: 'tool-calls', tokens })
  ev('step_start', { type: 'step-start' })
  if (env.FAKE_OPENCODE !== 'silent') ev('text', { type: 'text', text: 'opencode reply: Definición' })
  ev('step_finish', { type: 'step-finish', reason: 'stop', tokens })
}

// `claude -p PROMPT --output-format json`: one result object. The shapes are the ASSUMED fixtures
// in base/tests/fixtures/claude-p-assumed (pack 0050, trial pending).
async function claude() {
  log({ caller: env.DOTAI_DELEGATE_CALLER, parent: env.DOTAI_DELEGATE_PARENT, claudeConfig: env.CLAUDE_CONFIG_DIR })
  const fixture = f => readFileSync(join(HERE, '..', '..', '..', 'base', 'tests', 'fixtures', 'claude-p-assumed', f), 'utf8')
  const mode = env.FAKE_CLAUDE ?? 'ok'
  if (mode === 'quota' || mode === 'error') {
    process.stdout.write(fixture(`${mode}.json`))
    process.exit(1)
  }
  const dir = jobDir(argv[argv.indexOf('-p') + 1])
  if (dir && arg('--permission-mode') === 'acceptEdits') {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'result.md'), 'claude result')
  }
  process.stdout.write(fixture('success.json'))
}

async function orcaTerm() {
  const line = argv[0]
  const child =
    process.platform === 'win32'
      ? spawn(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { windowsVerbatimArguments: true, stdio: 'ignore', windowsHide: true })
      : spawn('sh', ['-c', line], { stdio: 'ignore' })
  await new Promise(r => child.on('close', r))
}

async function orca() {
  const cmd = argv.slice(0, 2).join(' ')
  log({})
  if (argv[0] === 'status') {
    if (env.FAKE_ORCA === 'down') {
      process.stdout.write(JSON.stringify({ ok: false, error: { message: 'runtime not reachable' } }))
      process.exit(1)
    }
    process.stdout.write(JSON.stringify({ ok: true, result: { runtime: { state: 'ready', reachable: true } } }))
    return
  }
  // Handles are numbered by the create calls in the log: term_fake1, term_fake2...
  const created = () => (env.FAKE_LOG ? readFileSync(env.FAKE_LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])
    .filter(c => c.name === 'orca' && c.argv[0] === 'terminal' && c.argv[1] === 'create')
    .map((c, i) => ({ handle: `term_fake${i + 1}`, title: c.argv[c.argv.indexOf('--title') + 1] }))
  if (cmd === 'terminal create') {
    const mine = created().at(-1)
    if (env.FAKE_ORCA === 'create-hang') {
      await sleep(30000)
      return
    }
    if (env.FAKE_ORCA === 'create-fail') {
      process.stdout.write(JSON.stringify({ ok: false, error: { message: 'fake orca: create failed after creating' } }))
      process.exit(1)
    }
    if (env.FAKE_ORCA !== 'vanish') {
      // A detached helper runs the line, so this call returns at once as Orca's does. On Windows the
      // helper runs cmd.exe attached to itself: a console app under a detached cmd loses redirected stdout.
      const child = spawn(process.execPath, [process.argv[1], 'orca-term', arg('--command')], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
    }
    if (/^no-handle/.test(env.FAKE_ORCA ?? '')) process.stdout.write(JSON.stringify({ ok: true, result: { created: true } }))
    else process.stdout.write(JSON.stringify({ ok: true, result: { terminal: { handle: mine.handle, title: arg('--title') } } }))
    return
  }
  if (cmd === 'terminal list') {
    // Orca 1.4.247 shape: result.terminals[], each with handle and title (orca/tests/fixtures).
    const closed = (env.FAKE_LOG ? readFileSync(env.FAKE_LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])
      .filter(c => c.name === 'orca' && c.argv[1] === 'close')
      .map(c => c.argv[c.argv.indexOf('--terminal') + 1])
    const mode = env.FAKE_ORCA ?? ''
    if (mode === 'list-error') {
      process.stdout.write(JSON.stringify({ ok: false, error: { message: 'fake orca: list failed' } }))
      process.exit(1)
    }
    // This call is already in the log: n is 1 on the first list.
    const n = readFileSync(env.FAKE_LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(c => c.name === 'orca' && c.argv[1] === 'list').length
    const gone = mode === 'vanish' || mode === 'no-handle-never' || (mode === 'flicker' && n % 2 === 1) || (mode === 'no-handle-late' && n === 1)
    let live = gone ? [] : created().filter(t => !closed.includes(t.handle))
    process.stdout.write(JSON.stringify({ ok: true, result: { terminals: live } }))
    return
  }
  if (cmd === 'terminal close') {
    process.stdout.write(JSON.stringify({ ok: true, result: { closed: true } }))
    return
  }
  if (cmd === 'orchestration worker-read') {
    process.stdout.write(JSON.stringify({ ok: true, result: { output: env.FAKE_ORCA_BANNER ?? '' } }))
    return
  }
  process.stdout.write(JSON.stringify({ ok: false, error: { message: `fake orca: ${cmd} not faked` } }))
  process.exit(1)
}

await { agy, claude, opencode, orca, 'orca-term': orcaTerm }[name]()
