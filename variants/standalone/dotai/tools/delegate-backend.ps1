# Thin wrapper (PACK-FORMAT: every tool ships .sh and .ps1); the logic lives in the .mjs.
& node (Join-Path $PSScriptRoot 'delegate-backend.mjs') @args
exit $LASTEXITCODE
