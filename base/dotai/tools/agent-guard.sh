#!/bin/sh
# Thin wrapper (PACK-FORMAT: every tool ships .sh and .ps1); the logic lives in the .mjs.
exec node "$(dirname "$0")/agent-guard.mjs" "$@"
