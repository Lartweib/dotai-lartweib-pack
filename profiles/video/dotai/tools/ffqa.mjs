// Video QA with capped output (principle P7): a few lines per check, never ffmpeg's log.
//   node ffqa.mjs probe <file>      duration, streams, bitrate on one line
//   node ffqa.mjs loudness <file>   integrated loudness, range, true peak (ebur128)
//   node ffqa.mjs freeze <file>     frozen-picture intervals (freezedetect, >= 2 s)
//   node ffqa.mjs black <file>      black intervals (blackdetect, >= 0.5 s)
//   node ffqa.mjs silence <file>    silent intervals (silencedetect, -50 dB, >= 1 s)
// At most 10 intervals are listed; the count says how many there were.
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_BIN || 'ffprobe'
const MAX = 10

const fps = r => {
  const [a, b] = String(r || '0/1').split('/').map(Number)
  const v = b ? a / b : a
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

export function probeSummary(j) {
  const parts = [`${Number(j.format?.duration || 0)}s`]
  for (const s of j.streams || []) {
    if (s.codec_type === 'video') parts.push(`video ${s.codec_name} ${s.width}x${s.height} ${fps(s.r_frame_rate)}fps`)
    else if (s.codec_type === 'audio') parts.push(`audio ${s.codec_name} ${s.sample_rate}Hz ${s.channels}ch`)
  }
  const br = Number(j.format?.bit_rate)
  if (br) parts.push(`${(br / 1e6).toFixed(1)} Mb/s`)
  return parts.join('  ')
}

export function loudnessSummary(stderr) {
  const tail = String(stderr).slice(String(stderr).lastIndexOf('Summary:'))
  const num = re => re.exec(tail)?.[1] ?? '?'
  return `integrated ${num(/I:\s+(-?[\d.]+) LUFS/)} LUFS, range ${num(/LRA:\s+(-?[\d.]+) LU/)} LU, true peak ${num(/Peak:\s+(-?[\d.inf]+) dBFS/)} dBFS`
}

const KEYS = {
  freeze: [/freeze_start:\s*([\d.]+)/, /freeze_end:\s*([\d.]+)/],
  black: [/black_start:\s*([\d.]+)/, /black_end:\s*([\d.]+)/],
  silence: [/silence_start:\s*(-?[\d.]+)/, /silence_end:\s*([\d.]+)/],
}

export function intervals(kind, stderr, max = MAX) {
  const [startRe, endRe] = KEYS[kind]
  const found = []
  let open = null
  for (const line of String(stderr).split(/\r?\n/)) {
    const s = startRe.exec(line)
    if (s) open = Number(s[1])
    const e = endRe.exec(line)
    if (e) {
      const start = open ?? 0
      found.push([Math.max(0, start), Number(e[1])])
      open = null
    }
  }
  if (open !== null) found.push([open, null])
  if (!found.length) return `${kind}: none`
  const lines = found.slice(0, max).map(([a, b]) => (b === null ? `  ${a.toFixed(2)}-end` : `  ${a.toFixed(2)}-${b.toFixed(2)} (${(b - a).toFixed(2)}s)`))
  if (found.length > max) lines.push(`  … ${found.length - max} more`)
  return `${kind}: ${found.length} interval${found.length === 1 ? '' : 's'}\n${lines.join('\n')}`
}

const FILTERS = {
  freeze: ['-map', '0:v:0', '-vf', 'freezedetect=n=-60dB:d=2'],
  black: ['-map', '0:v:0', '-vf', 'blackdetect=d=0.5:pix_th=0.10'],
  silence: ['-map', '0:a:0', '-af', 'silencedetect=n=-50dB:d=1'],
  loudness: ['-map', '0:a:0', '-af', 'ebur128=peak=true'],
}

function ffmpegStderr(file, filter) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', file, ...filter, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  if (r.error) fail(`could not run ${FFMPEG}: ${r.error.message}`)
  return r.stderr
}

function fail(msg) {
  process.stderr.write(`ffqa: ${msg}\n`)
  process.exit(1)
}

function main() {
  const [cmd, file] = process.argv.slice(2)
  if (!cmd || !file) fail('usage: ffqa probe|loudness|freeze|black|silence <file>')
  if (cmd === 'probe') {
    const r = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels', '-of', 'json', file], { encoding: 'utf8', windowsHide: true })
    if (r.error || r.status !== 0) fail(`ffprobe failed: ${(r.stderr || r.error?.message || '').trim().split('\n')[0]}`)
    console.log(probeSummary(JSON.parse(r.stdout)))
  } else if (cmd === 'loudness') {
    console.log(loudnessSummary(ffmpegStderr(file, FILTERS.loudness)))
  } else if (KEYS[cmd]) {
    console.log(intervals(cmd, ffmpegStderr(file, FILTERS[cmd])))
  } else fail(`unknown check "${cmd}"`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
