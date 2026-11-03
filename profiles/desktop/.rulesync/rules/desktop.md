---
root: false
targets: ["*"]
description: "Electron app rules: commands, IPC security, compact verification output."
antigravity:
  trigger: always_on
---

# Desktop (Electron)

- Commands come from `package.json`: test, build, then pack with electron-builder. Unit tests and the build run in CI; a real-window check runs locally (the `desktop-verify` skill).
- IPC security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The preload exposes a minimal, named API through `contextBridge`; the main process validates every IPC argument and never evaluates strings from the renderer.
- Verification output: one line per step (`build ok`, `tests 120 passed`, `window ok`), the failure lines only when a step fails.
- Never read `node_modules`, `dist`, `release` or `*.asar` whole.
- Release and signing: the `desktop-release` skill.
