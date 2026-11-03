// vframes started as the author's existing tool; these tests cover its entry point and
// wrappers (usage error, no download), the pure helpers behind subtitle anchors,
// sliding-window dedup and Whisper detection, and a real ffmpeg clip when installed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { dedupWindow, dhash, findWhisper, hamming, parseCues, selectAnchors, whisperArgs } from '../dotai/tools/vframes.mjs'

const TOOLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'dotai', 'tools')
const VFRAMES = join(TOOLS, 'vframes.mjs')
const hasFfmpeg = !spawnSync('ffmpeg', ['-version']).error

const vframes = (args, opts = {}) => spawnSync(process.execPath, [VFRAMES, ...args], { encoding: 'utf8', timeout: 120000, ...opts })

// A temp dir with a space in it: Windows paths with spaces are the common case.
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'vframes test '))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// PATH limited to one directory, whatever case the platform spells it in.
function envWithPath(dir) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'))
  env.PATH = dir
  return env
}

const manifest = (dir) => readFileSync(join(dir, 'manifest.tsv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'))

test('vframes and its wrappers print usage for a missing argument', () => {
  const runs = [['node', VFRAMES], ['sh', join(TOOLS, 'vframes.sh')]]
  if (process.platform === 'win32') runs.push(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(TOOLS, 'vframes.ps1')])
  for (const argv of runs) {
    const r = spawnSync(argv[0], [...argv.slice(1), 'fetch'], { encoding: 'utf8', timeout: 30000 })
    assert.equal(r.status, 1, argv[0])
    assert.match(r.stderr, /usage: vframes fetch/, argv[0])
  }
})

// ---------------------------------------------------------------- anchors

test('parseCues reads SRT and VTT cue starts, sorted and unique', () => {
  const srt = '1\r\n00:00:01,500 --> 00:00:03,000\r\nhello\r\n\r\n2\r\n00:01:02,250 --> 00:01:04,000\r\nworld\r\n\r\n3\r\n00:00:01,500 --> 00:00:02,000\r\nrepeat\r\n'
  assert.deepEqual(parseCues(srt), [1.5, 62.25])
  const vtt = 'WEBVTT\nKind: captions\n\nNOTE 00:00:09.000 --> is not a cue\n\n00:05.000 --> 00:07.000 align:start position:0%\nshort form\n\n01:00:00.000 --> 01:00:01.000\nlong form\n'
  assert.deepEqual(parseCues(vtt), [5, 3600])
  assert.deepEqual(parseCues('no cues here'), [])
})

test('selectAnchors keeps cues inside the window and at least the gap from every frame', () => {
  const cues = [0.5, 1, 3, 3.5, 6, 9, 20]
  // Existing frames at 0 and 5; default gap 2 s; window 0..10.
  assert.deepEqual(selectAnchors(cues, [0, 5], { from: 0, to: 10 }), [3, 9])
  // A smaller gap lets more through, and anchors also space out from each other.
  assert.deepEqual(selectAnchors(cues, [0, 5], { gap: 0.5, from: 0, to: 10 }), [0.5, 1, 3, 3.5, 6, 9])
  // Window bounds apply; with no frames at all, only the gap between anchors matters.
  assert.deepEqual(selectAnchors(cues, [], { from: 2, to: 7 }), [3, 6])
})

// ---------------------------------------------------------------- dedup

const ramp = (dir) => Uint8Array.from({ length: 72 }, (_, i) => (dir > 0 ? (i % 9) * 20 : (8 - (i % 9)) * 20))
const flat = (v) => new Uint8Array(72).fill(v)

test('dhash compares horizontal neighbours on a 9x8 thumbnail', () => {
  assert.equal(dhash(ramp(-1)), (1n << 64n) - 1n) // every pixel brighter than its right neighbour
  assert.equal(dhash(ramp(1)), 0n)
  assert.equal(hamming(dhash(ramp(-1)), dhash(ramp(1))), 64)
  assert.equal(hamming(5n, 5n), 0)
})

test('dedupWindow drops a shot already kept within the window (A-B-A)', () => {
  const A = ramp(1)
  const B = ramp(-1)
  const C = flat(200)
  assert.deepEqual(dedupWindow([A, B, A], 4), [0, 1])
  // Window 1 is the old consecutive-only behaviour.
  assert.deepEqual(dedupWindow([A, B, A], 1), [0, 1, 2])
  // A-B-C-A with window 2: A fell out of the window, so it is kept again.
  assert.deepEqual(dedupWindow([A, B, C, A], 2), [0, 1, 2, 3])
  assert.deepEqual(dedupWindow([A, B, C, A], 3), [0, 1, 2])
  // Flat frames all hash to 0; brightness keeps a black and a white screen apart.
  assert.deepEqual(dedupWindow([flat(10), flat(240), flat(12)], 4), [0, 1])
})

// ---------------------------------------------------------------- transcribe

test('findWhisper prefers faster-whisper-xxl, then whisper-ctranslate2, then whisper', (t) => {
  const dir = scratch(t)
  const ext = process.platform === 'win32' ? '.exe' : ''
  const env = envWithPath(dir)
  assert.equal(findWhisper(env), null)
  writeFileSync(join(dir, `whisper${ext}`), '')
  assert.equal(findWhisper(env).name, 'whisper')
  writeFileSync(join(dir, `whisper-ctranslate2${ext}`), '')
  assert.equal(findWhisper(env).name, 'whisper-ctranslate2')
  writeFileSync(join(dir, `faster-whisper-xxl${ext}`), '')
  const found = findWhisper(env)
  assert.equal(found.name, 'faster-whisper-xxl')
  assert.equal(found.path, join(dir, `faster-whisper-xxl${ext}`))
})

test('transcribe without a Whisper CLI prints one line with install hints and fails', (t) => {
  const dir = scratch(t)
  const video = join(dir, 'my clip.mp4')
  writeFileSync(video, '')
  const r = vframes(['transcribe', video], { env: envWithPath(join(dir, 'empty')) })
  assert.equal(r.status, 1)
  const lines = r.stderr.trim().split(/\r?\n/)
  assert.equal(lines.length, 1, r.stderr)
  assert.match(lines[0], /no Whisper CLI on PATH/)
  assert.match(lines[0], /faster-whisper-xxl/)
  assert.ok(!existsSync(join(dir, 'my clip.vtt')))
})

// The fake Whisper is node itself under a Whisper name, and the "video" is a script
// that writes the .vtt where a real Whisper CLI would: <output_dir>/<stem>.vtt.
function fakeWhisper(dir, name = 'whisper') {
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  if (process.platform === 'win32') {
    const fake = join(bin, `${name}.exe`)
    try { linkSync(process.execPath, fake) } catch { copyFileSync(process.execPath, fake) }
  } else {
    symlinkSync(process.execPath, join(bin, name))
  }
  return bin
}

test('transcribe runs the Whisper CLI it finds and writes a .vtt next to the video', (t) => {
  const dir = scratch(t)
  const bin = fakeWhisper(dir)
  const video = join(dir, 'my clip.mp4')
  writeFileSync(video, [
    "const a = process.argv, at = (k) => a[a.indexOf(k) + 1]",
    "if (at('--output_format') !== 'vtt') process.exit(3)",
    "require('fs').writeFileSync(require('path').join(at('--output_dir'), 'my clip.vtt'), 'WEBVTT\\n\\n00:00.500 --> 00:01.000\\nhi\\n\\n00:03.000 --> 00:04.000\\nthere\\n')",
  ].join('\n'))
  const env = envWithPath(bin)
  const r = vframes(['transcribe', video], { env })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(existsSync(join(dir, 'my clip.vtt')))
  assert.match(r.stdout, /whisper/)
  assert.match(r.stdout, /cues\s+2/)
  assert.match(r.stdout, /--anchors/)
  // An existing transcript is never overwritten silently.
  const again = vframes(['transcribe', video], { env })
  assert.equal(again.status, 1)
  assert.match(again.stderr, /already exists.*--force/)
  assert.equal(vframes(['transcribe', video, '--force'], { env }).status, 0)
})

// whisper-ctranslate2 0.5.8 on an unsupported GPU (RTX 50xx with ctranslate2 4.x) logs
// a cuBLAS traceback, writes nothing and still exits 0. The cause must reach the
// agent, and --device must be passed through so it can retry on the CPU.
test('transcribe surfaces a silent Whisper failure and passes --device through', (t) => {
  const dir = scratch(t)
  const bin = fakeWhisper(dir)
  const video = join(dir, 'my clip.mp4')
  writeFileSync(video, [
    "const a = process.argv, at = (k) => a[a.indexOf(k) + 1]",
    "if (at('--device') !== 'cpu') { console.error('RuntimeError: cuBLAS failed with status CUBLAS_STATUS_NOT_SUPPORTED'); process.exit(0) }",
    "require('fs').writeFileSync(require('path').join(at('--output_dir'), 'my clip.vtt'), 'WEBVTT\\n\\n00:00.500 --> 00:01.000\\nhi\\n')",
  ].join('\n'))
  const env = envWithPath(bin)
  const r = vframes(['transcribe', video], { env })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /CUBLAS_STATUS_NOT_SUPPORTED/)
  assert.match(r.stderr, /--device cpu/)
  const cpu = vframes(['transcribe', video, '--device', 'cpu'], { env })
  assert.equal(cpu.status, 0, cpu.stderr)
  assert.match(cpu.stdout, /cues\s+1/)
})

// ctranslate2's auto compute type (int8_float16) fails with cuBLAS NOT_SUPPORTED on
// RTX 50xx; float16 works there. float16 on the CPU is an error, so it is the default
// only for a GPU run: --device cuda, or no --device and nvidia-smi on PATH.
test('whisperArgs defaults to large-v3-turbo and float16 on an NVIDIA GPU for ctranslate2 CLIs', () => {
  const base = { video: 'v.mp4', dir: 'd' }
  const at = (args, k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined)
  for (const name of ['whisper-ctranslate2', 'faster-whisper-xxl']) {
    const gpu = whisperArgs({ ...base, name, flags: {}, nvidia: true })
    assert.deepEqual(gpu.slice(0, 5), ['v.mp4', '--output_dir', 'd', '--output_format', 'vtt'])
    assert.equal(at(gpu, '--model'), 'large-v3-turbo')
    assert.equal(at(gpu, '--compute_type'), 'float16')
    assert.equal(at(gpu, '--device'), undefined)
    assert.equal(at(whisperArgs({ ...base, name, flags: {}, nvidia: false }), '--compute_type'), undefined)
    assert.equal(at(whisperArgs({ ...base, name, flags: { device: 'cpu' }, nvidia: true }), '--compute_type'), undefined)
    assert.equal(at(whisperArgs({ ...base, name, flags: { device: 'cuda' }, nvidia: false }), '--compute_type'), 'float16')
    const forced = whisperArgs({ ...base, name, flags: { 'compute-type': 'float32', device: 'cpu', model: 'small' }, nvidia: false })
    assert.equal(at(forced, '--compute_type'), 'float32')
    assert.equal(at(forced, '--model'), 'small')
  }
  // openai-whisper has no --compute_type flag.
  const openai = whisperArgs({ ...base, name: 'whisper', flags: { 'compute-type': 'float32', device: 'cuda' }, nvidia: true })
  assert.ok(!openai.includes('--compute_type'))
  assert.equal(at(openai, '--model'), 'large-v3-turbo')
})

test('transcribe passes float16 when nvidia-smi is on PATH and hints float32 then cpu on a CUDA error', (t) => {
  const dir = scratch(t)
  const bin = fakeWhisper(dir, 'whisper-ctranslate2')
  writeFileSync(join(bin, process.platform === 'win32' ? 'nvidia-smi.exe' : 'nvidia-smi'), '')
  const video = join(dir, 'my clip.mp4')
  const argsLog = join(dir, 'args.json')
  writeFileSync(video, [
    "const a = process.argv, at = (k) => a[a.indexOf(k) + 1]",
    `require('fs').writeFileSync(${JSON.stringify(argsLog)}, JSON.stringify(a.slice(2)))`,
    "if (at('--compute_type') !== 'float32') { console.error('RuntimeError: cuBLAS failed with status CUBLAS_STATUS_NOT_SUPPORTED'); process.exit(0) }",
    "require('fs').writeFileSync(require('path').join(at('--output_dir'), 'my clip.vtt'), 'WEBVTT\\n\\n00:00.500 --> 00:01.000\\nhi\\n')",
  ].join('\n'))
  const env = envWithPath(bin)
  const r = vframes(['transcribe', video], { env })
  assert.equal(r.status, 1)
  const sent = JSON.parse(readFileSync(argsLog, 'utf8'))
  assert.equal(sent[sent.indexOf('--compute_type') + 1], 'float16')
  assert.equal(sent[sent.indexOf('--model') + 1], 'large-v3-turbo')
  assert.match(r.stderr, /--compute-type float32, then --device cpu/)
  const f32 = vframes(['transcribe', video, '--compute-type', 'float32'], { env })
  assert.equal(f32.status, 0, f32.stderr)
  assert.match(f32.stdout, /cues\s+1/)
})

// ---------------------------------------------------------------- real clip

// A-B-A: smptebars, rgbtestsrc, smptebars again; 2 s each, cuts at 2 and 4.
function abaClip(dir) {
  const clip = join(dir, 'a b a.mp4')
  const mk = spawnSync('ffmpeg', [
    '-v', 'error',
    '-f', 'lavfi', '-i', 'smptebars=s=320x240:d=2',
    '-f', 'lavfi', '-i', 'rgbtestsrc=s=320x240:d=2',
    '-f', 'lavfi', '-i', 'smptebars=s=320x240:d=2',
    '-filter_complex', '[0][1][2]concat=n=3:v=1', '-pix_fmt', 'yuv420p', '-y', clip,
  ])
  assert.equal(mk.status, 0, String(mk.stderr))
  return clip
}

test('frames: sliding-window dedup drops the returning shot (skipped without ffmpeg)', (t) => {
  if (!hasFfmpeg) return t.skip('ffmpeg not installed')
  const dir = scratch(t)
  const clip = abaClip(dir)
  const win1 = join(dir, 'win1')
  let r = vframes(['frames', clip, '--mode', 'scene', '--dedup', '--dedup-window', '1', '--width', '320', '--out', win1])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(manifest(win1).length, 3)
  const out = join(dir, 'win4')
  r = vframes(['frames', clip, '--mode', 'scene', '--dedup', '--width', '320', '--out', out])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(manifest(out).map((row) => row[1]), ['0', '2'])
  assert.deepEqual(readdirSync(out).filter((f) => f.endsWith('.jpg')).sort(), ['00001.jpg', '00002.jpg'])
  assert.match(r.stdout, /deduped\s+1/)
  assert.equal(JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8')).deduped, 1)
})

test('frames: subtitle anchors add frames at cue starts, gap-filtered and capped (skipped without ffmpeg)', (t) => {
  if (!hasFfmpeg) return t.skip('ffmpeg not installed')
  const dir = scratch(t)
  const clip = abaClip(dir)
  const subs = join(dir, 'a b a.en.srt')
  writeFileSync(subs, '1\n00:00:01,000 --> 00:00:01,500\none\n\n2\n00:00:03,000 --> 00:00:03,100\ntwo\n\n3\n00:00:03,200 --> 00:00:03,500\nthree\n\n4\n00:00:10,000 --> 00:00:11,000\npast the end\n')

  // Scene frames at 0, 2, 4; with a 0.5 s gap, anchors at 1 and 3 survive.
  const out = join(dir, 'anchored')
  let r = vframes(['frames', clip, '--mode', 'scene', '--anchors', subs, '--anchor-gap', '0.5', '--width', '320', '--out', out])
  assert.equal(r.status, 0, r.stderr)
  const rows = manifest(out)
  assert.deepEqual(rows.map((row) => row[0]), ['00001.jpg', '00002.jpg', '00003.jpg', '00004.jpg', '00005.jpg'])
  assert.deepEqual(rows.map((row) => Number(row[1])), [0, 1, 2, 3, 4])
  assert.deepEqual(rows.map((row) => row[3]), ['scene', 'anchor', 'scene', 'anchor', 'scene'])
  assert.match(r.stdout, /anchors\s+2 added/)
  assert.equal(JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8')).anchors, 2)

  // --max caps the combined set; the rest go to overflow, not deleted.
  const capped = join(dir, 'capped')
  r = vframes(['frames', clip, '--mode', 'scene', '--anchors', subs, '--anchor-gap', '0.5', '--max', '3', '--width', '320', '--out', capped])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(manifest(capped).length, 3)
  assert.equal(readdirSync(join(capped, 'overflow')).length, 2)

  // --mode at accepts anchors alone; the default 2 s gap keeps 1 and drops 3.2 (3 is taken).
  const at = join(dir, 'at')
  r = vframes(['frames', clip, '--mode', 'at', '--anchors', subs, '--width', '320', '--out', at])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(manifest(at).map((row) => Number(row[1])), [1, 3])

  r = vframes(['frames', clip, '--anchors', join(dir, 'missing.srt'), '--out', join(dir, 'x')])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /no such subtitles file/)
})
