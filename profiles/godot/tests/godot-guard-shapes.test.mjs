// Run: node --test profiles/godot/tests/
// Detection shapes, shell-aware suggestions, the launch reservation and probe failures.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { analyze, decide, fileReservations, parseVmStat } from '../dotai/tools/godot-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOLS = join(HERE, '..', 'dotai', 'tools')
const probeOf = s => ({ load: async () => s })
const cfg = { reserveMb: 4096, footprintMb: 1536 }
const roomy = { freeMb: 20000, cpuPct: 20, procs: [] }

test('launches are found after shell keywords and grouping', () => {
  for (const c of [
    'for i in 1 2; do godot --headless; done',
    'if true; then godot --headless; fi',
    'if false; then :; else godot --headless; fi',
    'if false; then :; elif true; then godot --headless; fi',
    '! godot --headless',
    '{ godot --headless; }',
    '(godot --headless)',
    'time godot --headless',
    'time -p godot --headless',
  ]) {
    assert.equal(analyze(c).length, 1, c)
  }
})

test('launches are found behind more wrappers', () => {
  for (const c of [
    'env -u FOO godot --headless',
    'env -C /tmp godot --headless',
    'env -S "godot --headless"',
    'env --unset FOO --chdir /tmp godot --headless',
    'godot.cmd --headless',
    'godot.bat --headless',
    'godot.com --headless',
    'g\\odot --headless',
    'echo "$(godot --headless)"',
    'echo "`godot --headless`"',
    'start godot --headless',
    'start "" /b godot --headless',
    'start "Godot" /wait C:/Godot/godot.exe --headless',
    'Start-Process godot -ArgumentList "--headless"',
    "Start-Process -FilePath 'C:\\Godot\\godot.exe' -ArgumentList '--headless','--path','.' -Wait",
    'saps godot',
    'cmd /c godot --headless',
    'cmd.exe /s /c "godot --headless"',
    'echo . | xargs -n 1 godot --headless --path',
    'sudo -u me godot --headless',
    'setsid -w godot --headless',
    'stdbuf -oL godot --headless',
    'stdbuf -o L godot --headless',
    'nice -n 5 godot --headless',
    'nohup godot --headless',
    'exec -a game godot --headless',
    '$env:GODOT --headless',
    '& $env:GODOT_BIN --headless',
    'cd game; & "C:\\Godot\\godot.exe" --headless',
  ]) {
    assert.equal(analyze(c).length, 1, c)
  }
})

test('cmd syntax (agy on Windows runs through cmd /c) splits like a shell', () => {
  for (const c of [
    'cd game && godot --headless --path .',
    'godot --headless --path . > out.txt 2>&1',
    'godot --headless --path . | findstr ERROR',
    'if exist project.godot godot --headless --path .',
  ]) {
    assert.equal(analyze(c).length, 1, c)
  }
  assert.deepEqual(analyze('godot --headless --path . >log.txt')[0].args, ['--headless', '--path', '.'])
})

test('lookups and unknown shapes are not guessed as launches', () => {
  for (const c of [
    'command -v godot',
    'which godot',
    'type godot',
    "echo '$(godot --headless)'",
    'echo "godot $(date)"',
    'myrunner godot --headless',
    'Get-Process godot*',
  ]) {
    assert.equal(analyze(c).length, 0, c)
  }
})

test('timeout and godot-run count as a deadline in every form', () => {
  for (const c of [
    'timeout --kill-after 5 60 godot --headless',
    'timeout --kill-after=5 60 godot --headless',
    'timeout --signal KILL 60 godot --headless',
    'timeout -s KILL -k 5 60 godot --headless',
    'timeout --foreground 60 godot --headless',
    'godot-run 300 godot --headless',
    'node .dotai/tools/godot-run.mjs 300 godot --headless',
    'node "C:/my projects/game/.dotai/tools/godot-run.mjs" -k 5 300 godot --headless',
    '& .dotai/tools/godot-run.ps1 300 godot --headless',
    'sh .dotai/tools/godot-run.sh 300 godot --headless',
  ]) {
    const l = analyze(c)
    assert.equal(l.length, 1, c)
    assert.equal(l[0].hasTimeout, true, c)
  }
  assert.equal(analyze('Start-Process godot -ArgumentList "--headless"')[0].hasTimeout, false)
})

test('--path without a headless or batch flag opens a window: it asks', () => {
  for (const c of ['godot --path .', 'godot --path game', 'Start-Process godot -ArgumentList "--path","."']) {
    assert.equal(analyze(c)[0].editor, true, c)
  }
  for (const c of [
    'godot --path . --headless',
    'godot --path . -s res://t.gd',
    'godot --path . --script res://t.gd',
    'godot --path . --export-release Web out/index.html',
    'godot --path . --export-pack Win out.pck',
    'godot --path . --check-only',
    'godot --path . --doctool docs',
  ]) {
    assert.equal(analyze(c)[0].editor, false, c)
  }
})

test('the suggested wrap fits the shell that runs the command', async () => {
  const posix = await decide('godot --headless --path .', { probe: probeOf(roomy), config: cfg, shell: 'posix' })
  assert.match(posix.reason, /timeout 300 godot --headless --path \./)
  for (const shell of ['powershell', 'windows']) {
    const d = await decide('godot --headless --path .', { probe: probeOf(roomy), config: cfg, shell })
    assert.equal(d.decision, 'deny')
    assert.doesNotMatch(d.reason, /timeout 300/, shell)
    assert.match(d.reason, /node "?[^ "]*godot-run\.mjs"? 300 godot --headless --path \./, shell)
  }
})

test('a probe that cannot read memory means unknown, and unknown allows', async () => {
  for (const freeMb of [0, -5, NaN, Infinity, undefined]) {
    const d = await decide('timeout 300 godot --headless', { probe: probeOf({ freeMb, cpuPct: 10, procs: [] }), config: cfg })
    assert.equal(d, null, String(freeMb))
  }
})

test('vm_stat counts free, inactive and speculative pages', () => {
  const out = [
    'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
    'Pages free:                               12345.',
    'Pages active:                            100000.',
    'Pages inactive:                           50000.',
    'Pages speculative:                         2000.',
  ].join('\n')
  assert.equal(parseVmStat(out), ((12345 + 50000 + 2000) * 16384) / 1048576)
  assert.ok(Number.isNaN(parseVmStat('garbage')))
})

test('back-to-back launches see the first one reserved', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'godot-res-'))
  try {
    const reservations = fileReservations(dir)
    const tight = { freeMb: 7000, cpuPct: 10, procs: [] } // room for exactly one 1536 MB launch
    const opts = { probe: probeOf(tight), config: cfg, reservations }
    assert.equal(await decide('timeout 300 godot --headless', opts), null)
    assert.equal(readdirSync(dir).length, 1)
    const second = await decide('timeout 300 godot --headless', opts)
    assert.equal(second?.decision, 'deny')
    assert.match(second.reason, /1 launch\(es\) starting/)
    // Reservations expire: after the TTL the first launch is measured, not reserved.
    const later = await decide('timeout 300 godot --headless', { ...opts, now: Date.now() + 60000 })
    assert.equal(later, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function runGuard(payload, cwd) {
  return spawnSync('node', [join(TOOLS, 'godot-guard.mjs')], { input: JSON.stringify(payload), cwd, encoding: 'utf8', timeout: 30000 })
}

test('the Claude Code PowerShell tool is guarded with a PowerShell-ready suggestion', () => {
  const r = runGuard({ tool_name: 'PowerShell', tool_input: { command: 'Start-Process godot -ArgumentList "--headless"' } })
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout).hookSpecificOutput
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /godot-run\.mjs"? 300 godot --headless/)
})

test('a non-numeric config value warns and falls back to the default', () => {
  const dir = mkdtempSync(join(tmpdir(), 'godot-cfg-'))
  try {
    mkdirSync(join(dir, '.git'))
    mkdirSync(join(dir, '.dotai'))
    writeFileSync(join(dir, '.dotai', 'config.yaml'), 'godot:\n  reserveMb: 4096MB\n')
    const r = runGuard({ tool_name: 'Bash', tool_input: { command: 'godot --headless' }, cwd: dir }, dir)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stderr, /godot\.reserveMb.*4096MB/)
    assert.equal(r.stderr.trim().split('\n').length, 1)
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /godot\.reserveMb/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the Claude Code hook matches both shell tools', () => {
  const text = readFileSync(join(HERE, '..', '.rulesync', 'hooks.jsonc'), 'utf8')
  const block = text.slice(text.indexOf('"claudecode"'), text.indexOf('"opencode"'))
  assert.match(block, /"matcher": "Bash\|PowerShell"/)
})
