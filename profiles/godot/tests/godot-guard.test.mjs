// Run: node --test profiles/godot/tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { analyze, capReason, decide, fileReservations, parseGetProcess, parsePs } from '../dotai/tools/godot-guard.mjs'

const TOOLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'dotai', 'tools')
const roomy = { freeMb: 20000, cpuPct: 20, procs: [] }
const probeOf = s => ({ load: async () => s })
const cfg = { reserveMb: 4096, footprintMb: 1536 }

test('mentions of godot are not launches', () => {
  for (const c of [
    'rg godot src',
    'tasklist | findstr /i godot',
    'echo "godot --editor"',
    'ls ~/godot/bin',
    'git log --grep godot',
    'cat project.godot',
  ]) {
    assert.equal(analyze(c).length, 0, c)
  }
})

test('launches are found behind wrappers, paths, variables and shells', () => {
  for (const c of [
    'godot --headless --path . --quit',
    'C:/Godot/Godot_v4.7-stable_win64.exe --headless --path .',
    'Godot_v4.7-stable_win64_console.exe --headless --path .',
    '"C:/Program Files/Godot/Godot_v4.7-stable_win64_console.exe" --headless',
    '$GODOT --headless --script res://t.gd',
    '${GODOT_BIN} --headless',
    'cd game && godot4 --headless --path .',
    'FOO=1 godot --headless',
    'bash -c "godot --headless --path ."',
    'cmd //c godot.exe --headless',
    '& "C:\\Godot\\godot.exe" --headless',
  ]) {
    assert.equal(analyze(c).length, 1, c)
  }
})

test('timeout is detected only when it wraps the launch', () => {
  assert.equal(analyze('timeout 300 godot --headless')[0].hasTimeout, true)
  assert.equal(analyze('timeout -k 5 120 godot --headless')[0].hasTimeout, true)
  assert.equal(analyze('timeout --signal=KILL 60 godot --headless')[0].hasTimeout, true)
  assert.equal(analyze('timeout 300 ls && godot --headless')[0].hasTimeout, false)
  assert.equal(analyze('godot --headless')[0].hasTimeout, false)
})

test('editor launches are flagged', () => {
  for (const c of ['godot -e', 'godot --editor --path .', 'godot', 'godot -p', 'godot --path . project.godot']) {
    assert.equal(analyze(c)[0].editor, true, c)
  }
  for (const c of ['godot --headless --path .', 'godot --headless --export-release "Windows" out.exe', 'godot --path . --write-movie a.avi']) {
    assert.equal(analyze(c)[0].editor, false, c)
  }
})

test('editor asks, even with a timeout', async () => {
  const d = await decide('timeout 60 godot -e --path .', { probe: probeOf(roomy), config: cfg })
  assert.equal(d.decision, 'ask')
  assert.match(d.reason, /editor/)
})

test('a launch without timeout is denied and the reason shows the wrapped command', async () => {
  const d = await decide('cd game && FOO=1 godot --headless --path .', { probe: probeOf(roomy), config: cfg })
  assert.equal(d.decision, 'deny')
  assert.match(d.reason, /FOO=1 timeout 300 godot --headless --path \./)
})

test('a wrapped launch on a roomy machine passes', async () => {
  assert.equal(await decide('timeout 300 godot --headless --path .', { probe: probeOf(roomy), config: cfg }), null)
})

test('non-launch commands never probe', async () => {
  let probed = false
  const probe = { load: async () => ((probed = true), roomy) }
  assert.equal(await decide('git status', { probe, config: cfg }), null)
  assert.equal(probed, false)
})

test('the cap uses the footprint of running Godot processes, not a count', () => {
  // 8 running, plenty of memory: no fixed count blocks it
  const many = { freeMb: 30000, cpuPct: 50, procs: Array.from({ length: 8 }, () => ({ name: 'godot.exe', rssMb: 900 })) }
  assert.equal(capReason(many, cfg), null)
  // one heavy process leaves too little room for another of its size
  const heavy = { freeMb: 7000, cpuPct: 30, procs: [{ name: 'Godot_v4.7-stable_win64.exe', rssMb: 3500 }] }
  assert.match(capReason(heavy, cfg), /3500 MB/)
  // no process running: the default footprint applies
  assert.match(capReason({ freeMb: 5000, cpuPct: 10, procs: [] }, cfg), /1536 MB/)
  assert.equal(capReason({ freeMb: 6000, cpuPct: 10, procs: [] }, cfg), null)
})

test('the console launcher does not count as a worker', () => {
  const s = {
    freeMb: 30000,
    cpuPct: 99,
    procs: [{ name: 'Godot_v4.7-stable_win64_console.exe', rssMb: 8 }],
  }
  assert.equal(capReason(s, cfg), null)
  s.procs.push({ name: 'Godot_v4.7-stable_win64.exe', rssMb: 700 })
  assert.match(capReason(s, cfg), /CPU/)
})

test('the reserve margin is the one tunable', () => {
  const s = { freeMb: 9000, cpuPct: 10, procs: [{ name: 'godot', rssMb: 2000 }] }
  assert.equal(capReason(s, { ...cfg, reserveMb: 4096 }), null)
  assert.match(capReason(s, { ...cfg, reserveMb: 8000 }), /reserve 8000 MB/)
})

test('an unreadable machine state fails open', async () => {
  const probe = { load: async () => { throw new Error('no tasklist') } }
  assert.equal(await decide('timeout 300 godot --headless', { probe, config: cfg }), null)
})

test('process lists parse on Windows and POSIX', () => {
  const win = ['Godot_v4.7-stable_win64 1572864000', 'Godot_v4.7-stable_win64_console 8388608', 'godotsteam_helper 1000'].join('\r\n')
  assert.deepEqual(parseGetProcess(win).map(p => Math.round(p.rssMb)), [1500, 8])
  assert.deepEqual(parseGetProcess(''), [])
  const ps = '  204800 /usr/local/bin/godot\n  1024 /usr/bin/bash\n  102400 Godot\n'
  assert.deepEqual(parsePs(ps).map(p => p.rssMb), [200, 100])
})

function runTool(argv, input, env = {}) {
  return spawnSync(argv[0], argv.slice(1), { input, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30000 })
}

test('the hook entry point and both wrappers print the same decision', () => {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'godot -e --path .' } })
  const runs = [
    ['node', join(TOOLS, 'godot-guard.mjs')],
    ['sh', join(TOOLS, 'godot-guard.sh')],
  ]
  if (process.platform === 'win32') {
    runs.push(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(TOOLS, 'godot-guard.ps1')])
  }
  for (const argv of runs) {
    const r = runTool(argv, payload)
    assert.equal(r.status, 0, `${argv[0]}: ${r.stderr}`)
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'ask', argv[0])
  }
})

test('a zero timeout is no deadline, as in coreutils', async () => {
  for (const c of ['timeout 0 godot --headless -s t.gd', 'timeout 0s godot --headless', 'timeout -k 5 0 godot --headless', 'node godot-run.mjs 0 godot --headless']) {
    assert.equal(analyze(c)[0].hasTimeout, false, c)
    const d = await decide(c, { probe: probeOf(roomy), config: cfg })
    assert.equal(d?.decision, 'deny', c)
  }
  assert.equal(analyze('timeout 0.5 godot --headless')[0].hasTimeout, true)
  assert.equal(analyze('node godot-run.mjs 10 godot --headless')[0].hasTimeout, true)
})

test('planted or broken reservation files expire instead of blocking launches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'godot-res-'))
  try {
    const now = 1_000_000_000
    const plant = (name, body) => writeFileSync(join(dir, name), body)
    plant('future.json', JSON.stringify({ at: now + 3_600_000, footprintMb: 999999 }))
    plant('nan.json', JSON.stringify({ at: 'soon', footprintMb: 999999 }))
    plant('missing.json', JSON.stringify({ footprintMb: 999999 }))
    plant('null.json', 'null')
    plant('garbage.json', '{not json')
    plant('badsize.json', JSON.stringify({ at: now - 10, footprintMb: 'lots' }))
    plant('old.json', JSON.stringify({ at: now - 60_000, footprintMb: 100 }))
    plant('huge.json', JSON.stringify({ at: now - 10, footprintMb: 1e12 }))
    plant('ok.json', JSON.stringify({ at: now - 10, footprintMb: 500 }))
    const active = fileReservations(dir).active(now)
    assert.deepEqual(active.map(r => r.footprintMb).sort((a, b) => a - b), [500, 65536])
    assert.deepEqual(readdirSync(dir).sort(), ['huge.json', 'ok.json'])
    // The survivors leave a roomy machine able to launch once they expire.
    assert.equal(capReason({ freeMb: 20000, cpuPct: 10, procs: [] }, cfg, fileReservations(dir).active(now + 30_000)), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
