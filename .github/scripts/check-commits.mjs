// Conventional commit check for pull requests (no dependencies: Node and git). The repository
// allows squash, merge and rebase merges, so both what lands on `main` are checked: the pull
// request title (the squash commit's subject) and each commit (a rebase lands them as they are).
// Usage: node .github/scripts/check-commits.mjs <base> <head> [pr-title]
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// The conventional set; there is no release tooling that reads other types (pack 0048).
export const TYPES = ['feat', 'fix', 'perf', 'revert', 'docs', 'chore', 'ci', 'build', 'test', 'refactor', 'style']

const CONVENTIONAL = new RegExp(`^(${TYPES.join('|')})(\\([^()\\s][^()]*\\))?!?: \\S`)
const GITHUB_MADE = /^(Revert ".+"|Merge (pull request #\d+ |branch |remote-tracking branch ).+)$/

export function problemWith(subject) {
  if (CONVENTIONAL.test(subject) || GITHUB_MADE.test(subject)) return undefined
  return `not a conventional commit: expected "<type>(<scope>)<!>: <subject>", with type one of ${TYPES.join(', ')}`
}

function main(base, head, title) {
  if (!base || !head) {
    console.error('usage: check-commits.mjs <base> <head> [pr-title]')
    return 2
  }
  const log = execFileSync('git', ['log', '--format=%H%x09%s', `${base}..${head}`], { encoding: 'utf8' })
  const items = log
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [sha = '', ...subject] = line.split('\t')
      return { what: sha.slice(0, 8), subject: subject.join('\t') }
    })
  if (title !== undefined) items.push({ what: 'PR title', subject: title })
  let bad = 0
  for (const { what, subject } of items) {
    const problem = problemWith(subject)
    if (problem) {
      bad++
      console.log(`::error title=Commit message::${what} "${subject}" is ${problem}`)
    }
  }
  console.log(`commits ${items.length - bad}/${items.length} ok`)
  return bad ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv[2], process.argv[3], process.argv[4])
}
