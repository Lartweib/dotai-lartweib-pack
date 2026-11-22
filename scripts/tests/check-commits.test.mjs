// Run: node --test scripts/tests/
// The pull request commit check (.github/workflows/commits.yml).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { problemWith, TYPES } from '../../.github/scripts/check-commits.mjs'

test('conventional subjects pass, with scope, breaking mark and the squash PR number', () => {
  for (const type of TYPES) assert.equal(problemWith(`${type}: do a thing`), undefined, type)
  for (const s of ['fix(delegate): route first (#6)', 'feat(statusline)!: one line', 'chore(deps): bump node']) assert.equal(problemWith(s), undefined, s)
})

test('subjects GitHub writes pass', () => {
  for (const s of ['Revert "fix: something"', 'Merge pull request #12 from a/b', 'Merge branch main into x']) assert.equal(problemWith(s), undefined, s)
})

test('everything else is rejected', () => {
  for (const s of ['fixup! fix: x', 'wip: stuff', 'Fix: capitalised', 'fix:x', 'fix: ', 'feat(): empty scope', 'update readme', '']) {
    assert.match(problemWith(s) ?? '', /not a conventional commit/, JSON.stringify(s))
  }
})
