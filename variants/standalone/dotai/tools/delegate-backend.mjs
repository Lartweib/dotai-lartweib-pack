// delegate-backend, standalone variant (pack 0028, 0032, 0034): runs agy (or OpenCode) headless,
// and several jobs in parallel with one job file each. The contract lives in the base tool
// delegate-core.mjs.
import { pathToFileURL } from 'node:url'

// The contract is a base tool at user scope (0034, update 2026-11-03). Staging writes the user
// tools directory into TOOLS (PACK-FORMAT, dotai 0030); from the pack source, as in the tests,
// the placeholder is still there and the base layer's copy is used. A missing core is reported
// (stderr, exit 1) instead of failing with a stack trace.
const TOOLS = '${DOTAI_TOOLS}'
const CORE = TOOLS.startsWith('$')
  ? new URL('../../../../base/dotai/tools/delegate-core.mjs', import.meta.url)
  : pathToFileURL(`${TOOLS}/delegate-core.mjs`)
let core
try {
  core = await import(CORE.href)
} catch (e) {
  process.stderr.write(`delegate-backend (standalone): cannot load delegate-core.mjs from ${CORE.href} (${e.code || e.message}); reinstall the base pack.\n`)
  process.exit(1)
}
const { headlessLaunch, main } = core

const TOOL = `${TOOLS}/delegate-backend.mjs`

export const adapter = {
  variant: 'standalone',
  launch: spec => headlessLaunch(spec),
  workersGuide: () =>
    [
      'Several agy workers (standalone):',
      '1. Write one JSON job file per worker: {"spec": "task.md", "model": "...", "effort": "...", "title": "...", "alt": "model:effort", "kind": "research|audit|code"}. A relative spec is read from the job file\'s folder.',
      `2. Run them in parallel: node "${TOOL}" run --jobs a.json b.json ... (at most maxParallel at once; one result line each, in order).`,
      `3. Watch them in a side terminal: node "${TOOL}" status --watch.`,
      'Workers that depend on each other: run them in sequence. Questions from a worker mid-run are not supported; put every decision in the spec.',
    ].join('\n'),
}

process.exitCode = await main(process.argv.slice(2), adapter)
