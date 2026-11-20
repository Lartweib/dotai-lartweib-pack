# video profile

Making and analyzing video (pack 0040, 0044). Not staged.

## Contents

| Path | What |
|---|---|
| `.rulesync/rules/video.md` | QA with capped scripts, frames through contact sheets, no media reads |
| `.rulesync/skills/video-frames/` | Frames an agent can read (survey, then zoom). The maintainer's own skill, vendored with the script path pointing at the tools directory, plus caption anchors, sliding-window dedup and the `transcribe` fallback |
| `dotai/tools/vframes.mjs` (+ `.sh`, `.ps1`) | The skill's script, extended: `frames --anchors` (frames at caption cues, idea from `HUANGCHIHHUNGLeo/claude-real-video` `--text-anchors`), `--dedup-window` (dHash over the last N kept frames), `transcribe` (local Whisper CLI, opt-in, capped by `--timeout`, which kills the CLI and its children) |
| `dotai/tools/ffqa.mjs` (+ `.sh`, `.ps1`) | `probe`, `loudness` (ebur128), `freeze`, `black`, `silence`: a few lines each, at most 10 intervals |
| `dotai/tools/read-size.video.txt` | Media and render paths |
| `tests/` | `node --test "profiles/video/tests/*.test.mjs"` (a real ffmpeg clip when ffmpeg is installed) |

## Credits

`vframes.mjs` is original code; no upstream code is copied. Caption-anchored frames and the sliding-window dedup are inspired by [`HUANGCHIHHUNGLeo/claude-real-video`](https://github.com/HUANGCHIHHUNGLeo/claude-real-video) (MIT), and the opt-in local Whisper transcription by [`bradautomates/claude-video`](https://github.com/bradautomates/claude-video) (MIT).

## External items (try; not shipped)

| Item | Source | License | Status |
|---|---|---|---|
| Remotion (default) | [`remotion-dev/remotion`](https://github.com/remotion-dev/remotion) v4.0.540 (2026-11-02); 13 official agent skills, `npx skills add remotion-dev/skills` ([`remotion-dev/skills`](https://github.com/remotion-dev/skills)); docs as `llms.txt` | [Remotion License](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) (source-available, not OSI). Free for individuals, for-profit companies with up to 3 employees, non-profits and evaluation. Any other company needs a company license: from $25 per seat per month, or $0.01 per render with a $100 monthly minimum ([pricing](https://www.remotion.pro/license)). The pack does not ship Remotion; each user checks their own case | Default. Install the skills per project |
| HyperFrames (fallback) | [`heygen-com/hyperframes`](https://github.com/heygen-com/hyperframes) v0.9.6 (pre-1.0); CLI (`snapshot --at`, `lint`, `check`, `tts`, `transcribe`) plus 8 skills, `npx skills add heygen-com/hyperframes` | Apache-2.0 | Better for short web or app promos, or when an OSI license is required. Open Windows issues: #4845 (Smart App Control blocks a DLL), #4058 (`spawn EBUSY` kills renders), #4060 (~16 GB of disk per minute of 1080p). TODO(trial): render one 10-second clip natively on Windows, outside Docker (Node 22+, FFmpeg); install its skills only after that passes |
| Gemini video understanding | manual, documented in `video-frames` (the video leaves the machine); no code | API terms | TODO(trial): long videos, audio plus frames |
| faster-whisper-xxl | `Purfview/whisper-standalone-win` | not stated | First choice of `vframes transcribe` (then `whisper-ctranslate2`, `whisper`); installed by the user, never by the pack |

Not adopted: Motion Canvas, Revideo, Theatre.js and Editly (stalled); Manim (math animation).

## Onboarding clashes

One game project has a project copy `.claude/skills/video-frames` (the older text, without anchors, the dedup window or `transcribe`). `dotai-analyze` must remove it when the profile is applied.
