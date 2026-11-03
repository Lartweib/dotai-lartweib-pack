#!/usr/bin/env node
// vframes — download a video and turn it into frames an agent can actually read.
// Commands: fetch | frames | sheet | transcribe
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_BIN || 'ffprobe'
const YTDLP = process.env.YTDLP_BIN || 'yt-dlp'

// Claude bills an image at roughly (width * height) / 750 tokens.
const TOKENS_PER_PIXEL = 1 / 750

function die(msg) {
  console.error(`error: ${msg}`)
  process.exit(1)
}

function run(bin, args, { capture = false, quiet = false, binary = false } = {}) {
  const res = spawnSync(bin, args, {
    encoding: binary ? 'buffer' : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', quiet ? 'pipe' : 'inherit', 'pipe'],
  })
  if (res.error) die(`could not run ${bin}: ${res.error.message}`)
  return res
}

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) flags[key] = true
      else {
        flags[key] = next
        i++
      }
    } else positional.push(a)
  }
  return { positional, flags }
}

// Accepts 90, 1:30, 01:30.5, 00:01:30
function toSeconds(v) {
  if (typeof v === 'number') return v
  const parts = String(v).split(':').map(Number)
  if (parts.some(Number.isNaN)) die(`bad timestamp: ${v}`)
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

function fmtTime(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}

function probeDuration(file) {
  const res = run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { capture: true })
  return Number.parseFloat(res.stdout.trim()) || 0
}

function probeSize(file) {
  const res = run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { capture: true })
  const [w, h] = res.stdout.trim().split(',').map(Number)
  return { width: w || 0, height: h || 0 }
}

// ---------------------------------------------------------------- fetch

function cmdFetch(argv) {
  const { positional, flags } = parseArgs(argv)
  const url = positional[0]
  if (!url) die('usage: vframes fetch <url> [--out DIR] [--quality 1080] [--cookies firefox|chrome|edge] [--subs es,en] [--audio-only]')

  const outDir = resolve(flags.out || './video')
  mkdirSync(outDir, { recursive: true })
  const quality = flags.quality || '1080'

  // --restrict-filenames keeps names ASCII. Windows hands back console-encoded
  // paths for accented titles, which then fail to probe; sidestep it entirely.
  const args = ['--no-playlist', '--restrict-filenames', '--js-runtimes', 'node', '--paths', outDir, '-o', '%(title).80B [%(id)s].%(ext)s']
  if (flags.cookies && flags.cookies !== true) args.push('--cookies-from-browser', String(flags.cookies))
  if (flags.subs) {
    const langs = flags.subs === true ? 'es.*,en.*' : String(flags.subs)
    args.push('--write-subs', '--write-auto-subs', '--sub-langs', langs, '--convert-subs', 'srt')
  }
  if (flags['audio-only']) {
    args.push('--skip-download')
  } else {
    args.push('-f', `bv*[height<=${quality}]+ba/b[height<=${quality}]/bv*+ba/b`, '--merge-output-format', 'mp4')
  }
  args.push('--no-simulate', '--print', 'after_move:filepath', url)

  const res = run(YTDLP, args, { capture: true })
  if (res.status !== 0) {
    console.error(res.stderr?.trim() || '')
    die('yt-dlp failed. For YouTube 403s retry with --cookies firefox (or chrome/edge).')
  }

  let file = res.stdout.trim().split(/\r?\n/).filter(Boolean).pop()
  // Belt and braces: if the reported path did not survive the round trip,
  // fall back to the newest media file actually sitting in the output dir.
  if (file && !existsSync(file)) {
    const media = readdirSync(outDir)
      .filter((f) => /\.(mp4|mkv|webm|m4a|mp3)$/i.test(f))
      .map((f) => ({ f, t: statSync(join(outDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    file = media.length ? join(outDir, media[0].f) : null
  }
  if (!file) {
    console.log(`downloaded into ${outDir} (subtitles only)`)
    return
  }
  const dur = probeDuration(file)
  const { width, height } = probeSize(file)
  console.log(`video      ${file}`)
  console.log(`duration   ${fmtTime(dur)} (${Math.round(dur)}s)`)
  console.log(`resolution ${width}x${height}`)
  const subs = readdirSync(outDir).filter((f) => f.endsWith('.srt'))
  if (subs.length) console.log(`subtitles  ${subs.map((s) => join(outDir, s)).join(', ')}`)
  else if (flags.subs) console.log(`subtitles  none found; for speech, opt in to: vframes transcribe "${file}"`)
  const anchors = subs.length ? ` --anchors "${join(outDir, subs[0])}"` : ''
  console.log(`\nnext: vframes frames "${file}" --mode scene${anchors}`)
}

// ---------------------------------------------------------------- frames

const MODES = ['scene', 'interval', 'keyframes', 'at']
// a#####/t##### are this script's own scratch names (anchors, renumbering).
const OURS = /^([at]?\d{5}\.jpg|manifest\.tsv|meta\.json|overflow|sheet)$/

// Anchors closer than this to a frame already taken add nothing a reader would
// notice: captions roll every 2-4 s, so 2 s keeps about one extra frame per cue.
const ANCHOR_GAP = 2
// Sliding-window dedup compares each frame with the last N kept, not just the previous one.
const DEDUP_WINDOW = 4
// Same shot: dHash within 3 of 64 bits AND mean brightness gap within 12 of 255
// (flat frames all hash to 0, so brightness keeps a black and a white screen apart).
const HASH_MAX_BITS = 3
const MEAN_MAX_DIFF = 12

const frameName = (i, prefix = '') => `${prefix}${String(i + 1).padStart(5, '0')}.jpg`

// A stale frame mixed into a fresh run is a silently wrong answer, so the
// directory gets emptied — but only once we are sure it is ours to empty.
function prepareOutDir(dir) {
  if (existsSync(dir)) {
    const foreign = readdirSync(dir).filter((f) => !OURS.test(f))
    if (foreign.length) {
      die(
        `${dir} holds files this skill did not create (${foreign.slice(0, 3).join(', ')}${foreign.length > 3 ? ', …' : ''}).\n` +
        `       Refusing to wipe it. Point --out at a new or empty directory.`,
      )
    }
    rmSync(dir, { recursive: true, force: true })
  }
  mkdirSync(dir, { recursive: true })
}

function cmdFrames(argv) {
  const { positional, flags } = parseArgs(argv)
  const video = positional[0]
  if (!video) die('usage: vframes frames <video> [--mode scene|interval|keyframes|at] [...]')
  if (!existsSync(video)) die(`no such file: ${video}`)

  const mode = String(flags.mode || 'scene')
  if (!MODES.includes(mode)) die(`--mode must be one of: ${MODES.join(', ')}`)

  const outDir = resolve(flags.out || './frames')
  prepareOutDir(outDir)

  const width = Number(flags.width || 1280)
  const from = flags.from ? toSeconds(flags.from) : 0
  const to = flags.to ? toSeconds(flags.to) : null
  const duration = probeDuration(video)

  let cues = null
  const anchorsFile = flags.anchors
  if (anchorsFile !== undefined) {
    if (anchorsFile === true) die('--anchors needs a subtitles file (.srt or .vtt)')
    if (!existsSync(anchorsFile)) die(`no such subtitles file: ${anchorsFile}`)
    cues = parseCues(readFileSync(anchorsFile, 'utf8'))
    if (!cues.length) die(`no cues found in ${anchorsFile} (expected .srt or .vtt)`)
  }
  const anchorGap = flags['anchor-gap'] !== undefined ? Number(flags['anchor-gap']) : ANCHOR_GAP
  const dedupWin = flags['dedup-window'] !== undefined ? Number(flags['dedup-window']) : DEDUP_WINDOW
  const dedup = Boolean(flags.dedup) || (flags['dedup-window'] !== undefined && dedupWin > 0)

  const inputOpts = []
  if (from > 0) inputOpts.push('-ss', String(from))
  if (mode === 'keyframes') inputOpts.unshift('-skip_frame', 'nokey')

  const outputOpts = []
  if (to !== null) outputOpts.push('-t', String(Math.max(0, to - from)))

  let entries
  if (mode === 'at') {
    entries = extractAt(video, outDir, width, flags, duration, cues !== null)
  } else {
    const chain = []
    if (mode === 'scene') {
      const threshold = Number(flags.threshold || 0.3)
      // eq(n,0) guarantees the opening frame, which scene detection always skips.
      chain.push(`select='eq(n\\,0)+gt(scene\\,${threshold})'`)
    } else if (mode === 'interval') {
      const fps = flags.fps ? String(flags.fps) : `1/${Number(flags.every || 5)}`
      chain.push(`fps=${fps}`)
    } else if (mode === 'keyframes') {
      chain.push(`select='eq(pict_type\\,I)'`)
    }
    if (dedup) chain.push('mpdecimate=hi=64*24:lo=64*12:frac=0.05')
    chain.push(`scale=${width}:-2:flags=lanczos`)
    chain.push('showinfo')

    const args = [
      '-hide_banner', '-nostdin', '-y',
      ...inputOpts, '-i', video, ...outputOpts,
      '-vf', chain.join(','), '-fps_mode', 'vfr', '-q:v', '2',
      join(outDir, '%05d.jpg'),
    ]
    const res = run(FFMPEG, args, { capture: true })
    if (res.status !== 0) {
      console.error(res.stderr?.trim().split(/\r?\n/).slice(-15).join('\n'))
      die('ffmpeg failed')
    }
    entries = parseShowinfo(res.stderr, from)
  }

  const files = readdirSync(outDir).filter((f) => /^\d+\.jpg$/.test(f)).sort()

  // Pair each file with its timestamp; showinfo emits one line per written frame.
  let rows = files.map((f, i) => ({ file: f, seconds: entries[i] ?? null, source: mode }))

  // Anchors: one exact seek per caption cue that is not already covered by a frame.
  let anchored = 0
  if (cues) {
    const end = to ?? (duration || Infinity)
    const picked = selectAnchors(cues, rows.map((r) => r.seconds).filter((s) => s !== null), { gap: anchorGap, from, to: end })
    picked.forEach((sec, i) => {
      const file = frameName(i, 'a')
      extractOne(video, sec, width, join(outDir, file))
      rows.push({ file, seconds: sec, source: 'anchor' })
    })
    anchored = picked.length
    rows.sort((a, b) => (a.seconds ?? 0) - (b.seconds ?? 0))
    rows = renumber(outDir, rows)
  }
  if (!rows.length) die('no frames extracted — try a lower --threshold or --mode interval')

  // Sliding-window dedup: mpdecimate above only sees neighbours; this catches A-B-A cuts.
  let deduped = 0
  if (dedup && dedupWin > 0 && rows.length > 1) {
    const keep = new Set(dedupWindow(thumbnails(outDir, rows.length), dedupWin))
    rows = rows.filter((row, i) => {
      if (keep.has(i)) return true
      unlinkSync(join(outDir, row.file))
      deduped++
      return false
    })
    rows = renumber(outDir, rows)
  }

  const max = flags.max ? Number(flags.max) : null
  let dropped = 0
  if (max && rows.length > max) {
    const overflow = join(outDir, 'overflow')
    mkdirSync(overflow, { recursive: true })
    const step = rows.length / max
    const keep = new Set(Array.from({ length: max }, (_, i) => Math.floor(i * step)))
    rows = rows.filter((row, i) => {
      if (keep.has(i)) return true
      renameSync(join(outDir, row.file), join(overflow, row.file))
      dropped++
      return false
    })
    rows = renumber(outDir, rows)
  }

  const { width: fw, height: fh } = probeSize(join(outDir, rows[0].file))
  const perFrame = Math.round(fw * fh * TOKENS_PER_PIXEL)

  writeFileSync(
    join(outDir, 'manifest.tsv'),
    ['file\tseconds\ttimestamp\tsource', ...rows.map((r) => `${r.file}\t${r.seconds ?? ''}\t${r.seconds === null ? '' : fmtTime(r.seconds)}\t${r.source}`)].join('\n') + '\n',
  )
  writeFileSync(
    join(outDir, 'meta.json'),
    JSON.stringify({
      video: resolve(video), mode, width, from, to, duration, frames: rows.length,
      anchors: anchored, anchorsFile: cues ? resolve(anchorsFile) : null, anchorGap: cues ? anchorGap : null,
      deduped, dedupWindow: dedup ? dedupWin : null, dropped, tokensPerFrame: perFrame, totalTokens: perFrame * rows.length,
    }, null, 2),
  )

  console.log(`mode       ${mode}${dedup ? ` + dedup (window ${dedupWin})` : ''}${cues ? ' + anchors' : ''}`)
  if (cues) console.log(`anchors    ${anchored} added from ${cues.length} cues (min gap ${anchorGap}s to any other frame)`)
  if (deduped) console.log(`deduped    ${deduped} repeats of a shot kept in the last ${dedupWin} frames (deleted)`)
  console.log(`window     ${fmtTime(from)} → ${fmtTime(to ?? duration)}`)
  console.log(`frames     ${rows.length} @ ${fw}x${fh}`)
  console.log(`est. cost  ~${perFrame} tok/frame → ~${(perFrame * rows.length / 1000).toFixed(0)}k tokens to read all`)
  console.log(`manifest   ${join(outDir, 'manifest.tsv')}`)
  if (dropped) console.log(`DROPPED    ${dropped} frames exceeded --max ${max}; moved to ${join(outDir, 'overflow')} (not deleted)`)
  if (!max && rows.length > 200) console.log(`WARNING    ${rows.length} frames is a lot to read. Build a contact sheet first, or re-run with --max.`)
}

// showinfo writes one "pts_time:X" line per frame that survives the filter chain.
function parseShowinfo(stderr, offset) {
  const out = []
  for (const m of (stderr || '').matchAll(/pts_time:([0-9.]+)/g)) out.push(offset + Number.parseFloat(m[1]))
  return out
}

// Exact timestamps: one seek per frame, so the time is known rather than parsed.
// With --anchors the list may be empty: the cues then supply every timestamp.
function extractAt(video, outDir, width, flags, duration, hasAnchors) {
  const list = flags.at && flags.at !== true ? String(flags.at).split(',') : []
  if (!list.length && !hasAnchors) die('--mode at requires --at 00:01:20,00:02:33 (or --anchors <subs>)')
  const seconds = list.map((t) => toSeconds(t.trim()))
  const past = seconds.filter((s) => s > duration)
  if (past.length) {
    die(
      `these timestamps fall past the end of the video (${fmtTime(duration)}): ${past.map(fmtTime).join(', ')}\n` +
      `       remember "4:00" means 4 minutes — write "4" for 4 seconds.`,
    )
  }
  seconds.forEach((sec, i) => extractOne(video, sec, width, join(outDir, frameName(i))))
  return seconds
}

function extractOne(video, sec, width, file) {
  const args = [
    '-hide_banner', '-nostdin', '-y', '-ss', String(sec), '-i', video,
    '-frames:v', '1', '-vf', `scale=${width}:-2:flags=lanczos`, '-q:v', '2', file,
  ]
  const res = run(FFMPEG, args, { capture: true })
  if (res.status !== 0) die(`ffmpeg failed seeking to ${fmtTime(sec)}`)
}

// An image sequence demuxer stops at the first hole, so after any merge or cull
// the frames are renamed back into a contiguous 00001.jpg… run. Two phases
// (via t#####.jpg) make it collision-free whichever way the indices moved.
function renumber(outDir, rows) {
  if (rows.every((row, i) => row.file === frameName(i))) return rows
  rows.forEach((row, i) => renameSync(join(outDir, row.file), join(outDir, frameName(i, 't'))))
  return rows.map((row, i) => {
    renameSync(join(outDir, frameName(i, 't')), join(outDir, frameName(i)))
    return { ...row, file: frameName(i) }
  })
}

// Cue start times from .srt (00:01:02,500 -->) or .vtt (01:02.500 --> or 00:01:02.500 -->).
export function parseCues(text) {
  const out = new Set()
  for (const m of String(text).matchAll(/^[ \t]*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})[ \t]+-->/gm)) {
    out.add(toSeconds(m[1].replace(',', '.')))
  }
  return [...out].sort((a, b) => a - b)
}

// Cues inside [from, to] that sit at least `gap` seconds from every frame taken and
// from each other. Earlier cues win, so a burst of rolling captions yields one frame.
export function selectAnchors(cues, taken, { gap = ANCHOR_GAP, from = 0, to = Infinity } = {}) {
  const near = [...taken]
  const picked = []
  for (const sec of [...cues].sort((a, b) => a - b)) {
    if (sec < from || sec > to) continue
    if (near.some((t) => Math.abs(t - sec) < gap)) continue
    picked.push(sec)
    near.push(sec)
  }
  return picked
}

// dHash of a 9x8 gray thumbnail: one bit per pixel, set when it is brighter than its right neighbour.
export function dhash(px) {
  let h = 0n
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n)
  }
  return h
}

export function hamming(a, b) {
  let v = a ^ b
  let n = 0
  while (v) {
    n += Number(v & 1n)
    v >>= 1n
  }
  return n
}

const mean = (px) => px.reduce((s, v) => s + v, 0) / px.length

// Indices of the frames to keep: a frame goes when it matches any of the last
// `window` kept frames. Window 1 is plain consecutive dedup.
export function dedupWindow(thumbs, window = DEDUP_WINDOW) {
  const sig = thumbs.map((px) => ({ hash: dhash(px), mean: mean(px) }))
  const kept = []
  sig.forEach((s, i) => {
    const same = kept.slice(-window).some((k) => hamming(sig[k].hash, s.hash) <= HASH_MAX_BITS && Math.abs(sig[k].mean - s.mean) <= MEAN_MAX_DIFF)
    if (!same) kept.push(i)
  })
  return kept
}

// One ffmpeg pass over the whole sequence: 72 bytes (9x8 gray) per frame on stdout.
function thumbnails(outDir, count) {
  const res = run(FFMPEG, [
    '-hide_banner', '-nostdin', '-v', 'error', '-i', join(outDir, '%05d.jpg'),
    '-vf', 'scale=9:8:flags=area,format=gray', '-f', 'rawvideo', 'pipe:1',
  ], { capture: true, binary: true })
  if (res.status !== 0 || res.stdout.length !== count * 72) die('ffmpeg failed hashing frames for --dedup')
  return Array.from({ length: count }, (_, i) => res.stdout.subarray(i * 72, (i + 1) * 72))
}

// ---------------------------------------------------------------- sheet

// A drive-letter colon inside a filtergraph must survive two rounds of parsing,
// so it needs a doubled backslash. Anything less and ffmpeg splits the path.
function escapeFilterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\\\:')
}

function fontPath() {
  if (process.env.VFRAMES_FONT) return process.env.VFRAMES_FONT
  const win = process.env.SystemRoot || 'C:/Windows'
  for (const f of ['consola.ttf', 'arial.ttf', 'segoeui.ttf']) {
    const candidate = join(win, 'Fonts', f)
    if (existsSync(candidate)) return candidate
  }
  return '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
}

function cmdSheet(argv) {
  const { positional, flags } = parseArgs(argv)
  const framesDir = resolve(positional[0] || './frames')
  if (!existsSync(join(framesDir, '00001.jpg'))) die(`no frames found in ${framesDir} — run "vframes frames" first`)

  const cols = Number(flags.cols || 5)
  const rows = Number(flags.rows || 6)
  const tile = Number(flags.tile || 384)
  const out = resolve(flags.out || join(framesDir, 'sheet'))
  mkdirSync(out, { recursive: true })

  const build = (withLabels) => {
    const chain = [`scale=${tile}:-2:flags=lanczos`]
    if (withLabels) {
      chain.push(
        `drawtext=fontfile=${escapeFilterPath(fontPath())}:text='%{eif\\:n+1\\:d}':x=6:y=6:fontsize=26:fontcolor=yellow:box=1:boxcolor=black@0.75:boxborderw=5`,
      )
    }
    chain.push(`tile=${cols}x${rows}:padding=4:margin=4:color=black`)
    return run(FFMPEG, [
      '-hide_banner', '-nostdin', '-y',
      '-i', join(framesDir, '%05d.jpg'),
      '-vf', chain.join(','), '-fps_mode', 'vfr', '-q:v', '3',
      join(out, 'sheet_%02d.jpg'),
    ], { capture: true })
  }

  let res = build(true)
  let labelled = true
  if (res.status !== 0) {
    labelled = false
    res = build(false)
  }
  if (res.status !== 0) {
    console.error(res.stderr?.trim().split(/\r?\n/).slice(-15).join('\n'))
    die('ffmpeg failed building the contact sheet')
  }

  const sheets = readdirSync(out).filter((f) => f.startsWith('sheet_')).sort()
  const { width: sw, height: sh } = probeSize(join(out, sheets[0]))
  console.log(`sheets     ${sheets.length} × ${cols}x${rows} grid at ${sw}x${sh}`)
  console.log(`labels     ${labelled ? 'yes — the number on each tile is its frame index' : 'NO (font unavailable) — tiles run left→right, top→bottom'}`)
  console.log(`est. cost  ~${Math.round(sw * sh * TOKENS_PER_PIXEL)} tok/sheet`)
  sheets.forEach((s) => console.log(`           ${join(out, s)}`))
}

// ---------------------------------------------------------------- transcribe

// Opt-in fallback for videos without subtitles: a local Whisper CLI, never a download.
// All three share openai-whisper's flags (--output_dir, --output_format, --model, --language, --device).
const WHISPERS = ['faster-whisper-xxl', 'whisper-ctranslate2', 'whisper']
// The two CTranslate2 builds also take --compute_type; openai-whisper does not.
const COMPUTE_TYPE_CLIS = ['faster-whisper-xxl', 'whisper-ctranslate2']
const DEFAULT_MODEL = 'large-v3-turbo'

// Only real executables: Node cannot spawn .cmd/.bat without a shell, and the
// Windows builds of all three ship as .exe.
export function findWhisper(env = process.env, platform = process.platform) {
  return findOnPath(WHISPERS, env, platform)
}

function findOnPath(names, env = process.env, platform = process.platform) {
  const pathVar = Object.entries(env).find(([k]) => k.toUpperCase() === 'PATH')?.[1] || ''
  const exts = platform === 'win32' ? ['.exe', '.com'] : ['']
  const dirs = pathVar.split(platform === 'win32' ? ';' : ':').filter(Boolean)
  for (const name of names) {
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = join(dir, name + ext)
        try {
          if (statSync(candidate).isFile()) return { name, path: candidate }
        } catch {}
      }
    }
  }
  return null
}

// CTranslate2's auto compute type (int8_float16) fails with cuBLAS NOT_SUPPORTED on
// RTX 50xx GPUs, and float16 works there. float16 on the CPU is an error, so it is
// the default only for a GPU run: --device cuda, or no --device and an NVIDIA driver
// (nvidia-smi on PATH). --compute-type always wins.
export function whisperArgs({ name, video, dir, flags, nvidia }) {
  const value = (k) => (flags[k] && flags[k] !== true ? String(flags[k]) : undefined)
  const args = [video, '--output_dir', dir, '--output_format', 'vtt', '--model', value('model') ?? DEFAULT_MODEL]
  if (value('language')) args.push('--language', value('language'))
  const device = value('device')
  if (device) args.push('--device', device)
  if (COMPUTE_TYPE_CLIS.includes(name)) {
    const gpu = device === 'cuda' || (!device && nvidia)
    const computeType = value('compute-type') ?? (gpu ? 'float16' : undefined)
    if (computeType) args.push('--compute_type', computeType)
  }
  return args
}

function cmdTranscribe(argv) {
  const { positional, flags } = parseArgs(argv)
  const video = positional[0]
  if (!video) die(`usage: vframes transcribe <video> [--model ${DEFAULT_MODEL}] [--language es] [--device cpu] [--compute-type float32] [--force]`)
  if (!existsSync(video)) die(`no such file: ${video}`)

  const dir = dirname(resolve(video))
  const vtt = join(dir, `${basename(video, extname(video))}.vtt`)
  if (existsSync(vtt) && !flags.force) die(`${vtt} already exists; pass --force to overwrite it`)

  const whisper = findWhisper()
  if (!whisper) {
    die(`no Whisper CLI on PATH (looked for ${WHISPERS.join(', ')}). Install one yourself: faster-whisper-xxl from Purfview/whisper-standalone-win (Windows), or pipx install whisper-ctranslate2, or pipx install openai-whisper.`)
  }

  const nvidia = Boolean(findOnPath(['nvidia-smi']))
  const args = whisperArgs({ name: whisper.name, video: resolve(video), dir, flags, nvidia })
  // stdout is the running transcript: kept out of the agent's context on purpose.
  const res = run(whisper.path, args, { capture: true })
  // whisper-ctranslate2 can log a CUDA error, write nothing and still exit 0,
  // so a missing .vtt is a failure too, reported with the same stderr tail.
  if (res.status !== 0 || !existsSync(vtt)) {
    const tail = res.stderr?.trim().split(/\r?\n/).slice(-15).join('\n')
    if (tail) console.error(tail)
    const retry = COMPUTE_TYPE_CLIS.includes(whisper.name) && flags['compute-type'] !== 'float32' ? '--compute-type float32, then --device cpu' : '--device cpu'
    const hint = flags.device === 'cpu' ? '' : `; if the error mentions CUDA or cuBLAS, retry with ${retry}`
    die(res.status !== 0 ? `${whisper.name} failed${hint}` : `${whisper.name} finished but wrote no ${vtt}${hint}`)
  }

  console.log(`whisper    ${whisper.name} (${whisper.path})`)
  console.log(`subtitles  ${vtt}`)
  console.log(`cues       ${parseCues(readFileSync(vtt, 'utf8')).length}`)
  console.log(`\nnext: vframes frames "${video}" --mode scene --anchors "${vtt}"`)
}

// ---------------------------------------------------------------- main

function main() {
  const [, , cmd, ...rest] = process.argv
  switch (cmd) {
    case 'fetch': cmdFetch(rest); break
    case 'frames': cmdFrames(rest); break
    case 'sheet': cmdSheet(rest); break
    case 'transcribe': cmdTranscribe(rest); break
    default:
      console.log(`vframes — video → readable frames

  fetch      <url>    [--out DIR] [--quality 1080] [--cookies firefox] [--subs es,en] [--audio-only]
  frames     <video>  [--mode scene|interval|keyframes|at] [--threshold 0.3] [--every 5] [--fps 2]
                      [--at 1:20,2:33] [--from 1:00] [--to 2:00] [--width 1280] [--max N] [--out DIR]
                      [--dedup] [--dedup-window 4] [--anchors <subs.srt|.vtt>] [--anchor-gap 2]
  sheet      <dir>    [--cols 5] [--rows 6] [--tile 384] [--out DIR]
  transcribe <video>  [--model large-v3-turbo] [--language es] [--device cpu] [--compute-type float32] [--force]
                      (opt-in; needs a local Whisper CLI)`)
      process.exit(cmd ? 1 : 0)
  }
}

// Run as a script, not when imported by the tests. Realpaths, so a symlinked install still runs.
const isMain = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}
if (process.argv[1] && isMain()) main()
