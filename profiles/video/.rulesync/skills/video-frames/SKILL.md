---
name: video-frames
description: "Readable frames from a video file, YouTube URL or animated GIF. Use to watch or review a video or recording, see a UI in it, or find a moment, when the transcript alone will not answer."
metadata:
  author: Federico Ara
---

# video-frames

You cannot watch video. You *can* read images. This skill closes the gap: it turns a
video into a set of JPEGs plus a manifest mapping each one to its timestamp, so you
read frames with the Read tool and reason about them with real timecodes.

## Before anything: do you actually need frames?

Frames are the expensive path. Ask what the question depends on.

| The question is about | Use |
| --- | --- |
| What was said, explained, argued | Subtitles only — `fetch --audio-only --subs`. Seconds, near-zero tokens. |
| What was shown on screen — UI, gameplay, a demo, editing | Frames. |
| Both | Subtitles first to find the interesting minutes, then frames for just those windows. Add `--anchors` when what is said points at what is shown ("click here", "notice this"). |
| Speech, but the video has no subtitles | `transcribe` (local Whisper, opt-in; see below), then as above. |

Downloading a 30-minute video to read its transcript is waste. Say so and take the
cheap path.

## The two-pass workflow — use this by default

Do **not** extract hundreds of frames and read them all. That burns your context on
frames of a screen that never changed.

**Pass 1 — survey.** Extract with scene detection, build a contact sheet, read the
sheet. One or two images tell you the whole shape of the video and which moments matter.

**Pass 2 — zoom.** Re-extract densely, only inside the windows that matter, at full
width so small UI text is legible. Read those frames.

```bash
S=${DOTAI_PROJECT_TOOLS}/vframes.mjs

node $S fetch "<url>" --out ./video --subs
node $S frames "./video/<file>.mp4" --mode scene --out ./frames   # + --anchors "<subs>.srt" for narrated videos
node $S sheet ./frames                          # → read sheet_00.jpg
node $S frames "./video/<file>.mp4" --mode interval --fps 2 --from 3:40 --to 4:10 --out ./zoom
```

## Modes

| Mode | What it does | When |
| --- | --- | --- |
| `scene` (default) | Emits a frame each time the picture changes by more than `--threshold` (0..1, default 0.3) | Screen recordings, UI demos, app walkthroughs. Catches a menu that opens for two seconds and skips ten seconds of a static screen. |
| `interval` | One frame every `--every N` seconds, or `--fps F` for dense sampling | Continuous motion, or a zoom pass over a known window. |
| `keyframes` | I-frames only; decodes fast | Cheap first look at a long video. Spacing is dictated by the encoder, not by content. |
| `at` | Exactly the timestamps in `--at 1:20,2:33` | You already know where to look — usually from subtitles. |

Lower `--threshold` (0.15) catches subtler changes and yields more frames; raise it
(0.5) for only hard cuts. Add `--dedup` to drop near-identical frames — worth it on
`interval` over screen recordings. It compares each frame with the last
`--dedup-window N` kept ones (default 4), so an A-B-A cut does not resend shot A;
`--dedup-window 1` is consecutive-only. Duplicates are deleted, and the count is printed.

## Anchoring frames to captions

`--anchors <subs.srt|.vtt>` adds one exact frame per caption cue start, on top of any
mode (with `--mode at`, alone or merged with `--at`). Cues closer than `--anchor-gap`
seconds (default 2) to a frame already taken, or to another anchor, are skipped:
captions roll every 2-4 s, so this adds about one frame per line of speech, not per
rolling fragment. Anchors count toward `--max` like any other frame. Use them for
tutorials and talks where the narration says *when* to look; skip them on silent or
music-only footage. `fetch --subs` prints the subtitle path and the anchored next step.

## No subtitles: transcribe (opt-in)

`node $S transcribe "<video>" [--model large-v3-turbo] [--language es] [--device cpu] [--compute-type float32]`
writes `<video>.vtt` next to the video with the first local Whisper CLI on PATH
(`faster-whisper-xxl`, `whisper-ctranslate2`, `whisper`). It never installs or downloads
anything itself; with no CLI it says so in one line and fails. The CLI may fetch its own
model on first run (`large-v3-turbo` is about 1.6 GB; `--model small` is lighter). It
refuses to overwrite an existing `.vtt` without `--force`. Ask before running it on long
videos: it is slow on CPU. On a GPU run (`--device cuda`, or no `--device` with
`nvidia-smi` on PATH) the two CTranslate2 CLIs get `--compute_type float16`, because
their auto type fails on RTX 50xx cards. On a CUDA or cuBLAS error, rerun with
`--compute-type float32`, then `--device cpu`.

Gemini video understanding is a manual alternative, not built in: it reads audio and
frames together, but **the video leaves the machine**. Offer it only for content the
user is fine uploading, and let them run it.

## Controlling cost

Every frame you read costs roughly `width × height / 750` tokens. At the default
1280px width that is ~1200 tokens each, so 100 frames ≈ 120k tokens.

- `--width` — drop to 640 for a survey pass; keep 1280+ when you must read UI labels.
- `--max N` — caps the set by sampling evenly. The rest move to `frames/overflow/`,
  are **not** deleted, and the count is printed. Never present a capped read as complete coverage.
- `--from` / `--to` — the biggest saving available. Narrow the window first.

`frames` prints a token estimate and warns above 200 frames. Respect the warning.

## Reading the output

`frames/` contains `00001.jpg`, `00002.jpg`, … plus:

- `manifest.tsv` — `file`, `seconds`, `timestamp`, `source` (the mode, or `anchor`).
  Read this first; it is tiny. For an anchor frame, the caption at that time says why it is there.
- `meta.json` — mode, window, frame count, anchors, deduped, token estimate.

Always cite findings with the timestamp from the manifest, not the filename. "At
03:42 the sidebar shows…" is useful; "in frame 47" is not.

Contact sheet tiles are numbered, and the number is the frame index — tile 23 is
`00023.jpg`. If the font is unavailable the script says so, and tiles then run
left→right, top→bottom.

## Gotchas

- **YouTube 403s.** The common failure. Retry with `--cookies firefox` (or `chrome`,
  `edge`) to reuse a logged-in session.
- **Re-running `frames` wipes its output directory** so stale frames never mix with
  fresh ones. Give each pass its own `--out` (`./frames`, `./zoom`) rather than
  reusing one. If the directory holds anything the skill did not create, it refuses
  to wipe and stops.
- **`--quality`** caps the download height (default 1080). Going higher makes the
  download slower without making frames more readable — extraction scales down anyway.
- Requires `yt-dlp` and `ffmpeg` on PATH (a Whisper CLI only for `transcribe`). Local
  files skip `fetch` entirely: point `frames` straight at the file.
