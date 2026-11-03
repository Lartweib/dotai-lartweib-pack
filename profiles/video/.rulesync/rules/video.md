---
root: false
targets: ["*"]
description: "Video work: QA with capped scripts, frames through contact sheets, renders kept out of context."
antigravity:
  trigger: always_on
---

# Video

- QA a render with `node ${DOTAI_PROJECT_TOOLS}/ffqa.mjs probe|loudness|freeze|black|silence <file>`: a few lines each. Never paste ffmpeg's log.
- To see a video, use the `video-frames` skill: a contact sheet first, read one image, then zoom into the moments that matter. Never read many frames.
- Animated GIFs go through `video-frames` too: the Read tool shows only their first frame.
- Never read media files (`*.mp4`, `*.mov`, `*.wav`, renders) with the Read tool.
- Rendering: the project's tool (Remotion by default, HyperFrames, Godot `--write-movie <file> --fixed-fps 30`), always under a `timeout`; Remotion with `--concurrency` 6 or less.
- Before any full render, check frames with `npx remotion still` (or `hyperframes snapshot --at`).
- Composition width and height are integers.
- Keep video projects in git.
