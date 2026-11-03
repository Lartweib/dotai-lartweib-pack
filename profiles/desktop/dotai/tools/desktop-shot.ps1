# Thin wrapper (PACK-FORMAT: every tool ships .sh and .ps1); the logic lives in the .mjs.
# node inherits this process's stdin, so the hook payload reaches it unchanged.
& node (Join-Path $PSScriptRoot 'desktop-shot.mjs') @args
exit $LASTEXITCODE
