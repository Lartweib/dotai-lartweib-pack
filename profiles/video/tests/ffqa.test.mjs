import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { intervals, loudnessSummary, probeSummary } from '../dotai/tools/ffqa.mjs'

const TOOLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'dotai', 'tools')

test('probe prints one line', () => {
  const j = {
    format: { duration: '12.5', bit_rate: '4100000' },
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '30000/1001' },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
    ],
  }
  assert.equal(probeSummary(j), '12.5s  video h264 1920x1080 29.97fps  audio aac 48000Hz 2ch  4.1 Mb/s')
})

test('loudness reads the ebur128 summary', () => {
  const err = '[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -16.2 LUFS\n    Threshold: -26.5 LUFS\n\n  Loudness range:\n    LRA:         6.1 LU\n\n  True peak:\n    Peak:       -1.3 dBFS\n'
  assert.equal(loudnessSummary(err), 'integrated -16.2 LUFS, range 6.1 LU, true peak -1.3 dBFS')
})

test('detector intervals are capped and counted', () => {
  const lines = []
  for (let i = 0; i < 15; i++) lines.push(`[silencedetect @ 0x1] silence_start: ${i * 10}`, `[silencedetect @ 0x1] silence_end: ${i * 10 + 2} | silence_duration: 2`)
  const out = intervals('silence', lines.join('\n'), 10)
  assert.equal(out.split('\n').length, 12)
  assert.match(out, /^silence: 15 intervals/)
  assert.match(out, /5 more/)
  assert.equal(intervals('freeze', '', 10), 'freeze: none')
  const black = '[blackdetect @ 0x1] black_start:0 black_end:2.04 black_duration:2.04'
  assert.equal(intervals('black', black, 10), 'black: 1 interval\n  0.00-2.04 (2.04s)')
})

test('a real clip is measured end to end (skipped without ffmpeg)', t => {
  if (spawnSync('ffmpeg', ['-version']).error) return t.skip('ffmpeg not installed')
  const dir = mkdtempSync(join(tmpdir(), 'ffqa-'))
  try {
    const clip = join(dir, 'c.mp4')
    const mk = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=160x120:d=3', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '3', '-shortest', '-y', clip])
    assert.equal(mk.status, 0, String(mk.stderr))
    const run = (...a) => spawnSync('node', [join(TOOLS, 'ffqa.mjs'), ...a], { encoding: 'utf8', timeout: 60000 })
    assert.match(run('probe', clip).stdout, /^3(\.\d+)?s\s+video h264 160x120/)
    assert.match(run('black', clip).stdout, /^black: 1 interval/)
    assert.match(run('silence', clip).stdout, /^silence: 1 interval/)
    const sh = spawnSync('sh', [join(TOOLS, 'ffqa.sh'), 'probe', clip], { encoding: 'utf8', timeout: 60000 })
    assert.match(sh.stdout, /160x120/)
    if (process.platform === 'win32') {
      const ps = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(TOOLS, 'ffqa.ps1'), 'probe', clip], { encoding: 'utf8', timeout: 60000 })
      assert.match(ps.stdout, /160x120/)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
