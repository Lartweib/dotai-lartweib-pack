---
root: false
targets: ["*"]
description: "Godot 4 project rules: headless runs, timeouts, closing gate, files never read whole."
antigravity:
  trigger: always_on
---

# Godot

- Run Godot headless (`--headless`). The editor needs the user's approval. Captures (`--write-movie out.avi --fixed-fps 30`) need a window, so the user's approval too; headless capture crashes.
- Wrap every Godot launch in `timeout <seconds>` (in cmd or PowerShell: `node .dotai/tools/godot-run.mjs <seconds> godot ...`). A guard refuses a bare launch, and one that would leave too little free memory: then wait for the running ones. Never kill Godot by name; use the PID.
- Tests: the project's runner from `AGENTS.md`. Read its summary, not the full log.
- Closing gate before calling a change done: `timeout 60 godot --headless --path . --check-only --script res://<file>.gd` for each changed script, then the project's suite. Judge by `SCRIPT ERROR` lines, not the exit code. A script that references an autoload gets a false "Identifier not found": verify it with the suite. A fresh copy needs `--import` first.
- Never read whole `.tscn` or `.tres` files: `rg` for the node or resource, then read a range. Never read `.godot/`, `*.import` or `*.uid`; they are generated.
- After adding assets: `timeout 300 godot --headless --path . --import`.
- GDScript style: the `godot-gdscript` skill.
