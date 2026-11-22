---
status: accepted
date: 2026-11-19
tags: [release, versioning, ci, distribution]
---

# 0048 · Versioning and release

## Context

Users fetch the pack with `dotai pack add https://github.com/<owner>/dotai-lartweib-pack --ref <ref>` ([dotai 0044](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0044-git-pack-distribution.md)). A ref is a tag, a branch or a full commit; a branch is accepted with the warning `ref-branch`, and the installed commit stays fixed until `dotai pack update`. A git pack's identity is the repository (`github.com/<owner>/<repo>`, lowercased), not the manifest `name`, which is only a label. The fetch refuses links, submodules, `.git` paths and a tree over 10,000 files or 64 MiB, then runs `dotai validate`. The repository is private for now, and there is no GitHub Actions quota for it (author, 2026-11-19).

## Decision

- **Tags are the release.** A release is a SemVer tag `vX.Y.Z` on `main`; it is what users pin with `--ref`. `dotai.yaml` `version` is bumped in the same commit the tag points to, and the tag must equal `v<version>`.
- **0.x until the engine items land.** The first public release is `v1.0.0`, once the engine items the pack waits for are released (external skills and plugins, a tagged engine). Until then releases are `0.x`, and a minor bump may break.
- **Release notes from the commits.** Commits follow Conventional Commits; the GitHub release is created with `gh release create vX.Y.Z --generate-notes`.
- **One local check script.** `node scripts/check.mjs` runs the tests, `dotai validate --json` for each variant (with `$DOTAI` or `dotai` on `PATH`; skipped, saying so, when there is none), the tree check of dotai 0044 over `git ls-tree -r -l` of `HEAD`, a privacy guard over the tracked files (home paths, email addresses other than noreply forms, and extra terms from `DOTAI_PRIVACY_TERMS` plus the local user name), and the tag check when `HEAD` has a `v*` tag. It is run before every tag.
- **CI calls the same script.** `.github/workflows/ci.yml` (push and pull request to `main`, Ubuntu and Windows, Node 22) builds dotai from source at a pinned engine commit, `ENGINE_REF`, since the engine has no release yet, and runs the script. `release.yml` runs on a `v*` tag: the same checks, a check that the tag is on `main`, then the release. Every job has `if: ${{ !github.event.repository.private }}`, so nothing runs or bills while the repository is private; making it public turns them on.

## Considered options

- **A (chosen):** tags plus one local script that CI also calls.
- **B:** branches as the only ref. Rejected: a branch moves, and dotai warns on it.
- **C:** CI only. Rejected for now: no Actions quota while private, and the checks would differ from what the author runs.

The sources do not record other alternatives.

## Consequences

- Good: what CI checks is what the author ran locally; the tree check fails before a user's `pack add` would.
- Accepted cost: `ENGINE_REF` is bumped by hand, and `validate` only sees what that engine commit knows.
- Pending: the privacy guard's current hits, and a history scrub, before the repository goes public; switch the engine build to a release binary once dotai tags one.

## Update 2026-11-22: release-please

The release no longer waits on someone remembering to bump and tag. `.github/workflows/release.yml` runs on every push to `main`: the checks (`ci.yml`), then [release-please](https://github.com/googleapis/release-please) (`release-please-config.json`, `.release-please-manifest.json`). It keeps one release pull request open with the next version, the `version` line of `dotai.yaml` (marked `x-release-please-version`) and `CHANGELOG.md`; merging it creates the tag `vX.Y.Z` and the GitHub release, whose notes are the changelog entry.

- **Bumps.** `fix`, `perf`, `revert` and `docs` bump the patch (`docs` is a release type here, since rule and skill text is the pack's behaviour); `feat` and a breaking `!` bump the minor while on `0.x` (`bump-minor-pre-major`). `chore`, `ci`, `build`, `test`, `refactor` and `style` release nothing.
- **Required checks on the release pull request.** A pull request opened with the workflow token triggers no workflow, so the release job dispatches `ci.yml` and `commits.yml` (`workflow_dispatch`, the title as input) on the release branch; their check runs land on its head commit.
- **Replaced.** The tag-triggered workflow and its tag-on-main check: release-please tags the merge commit on `main`, from the version it wrote. `ci.yml` no longer runs on its own on `main` pushes; the release workflow calls it.

## Evidence

- [dotai 0044](https://github.com/Lartweib/dotai/blob/main/docs/decisions/0044-git-pack-distribution.md), [PACK-FORMAT](https://github.com/Lartweib/dotai/blob/main/docs/PACK-FORMAT.md), and the engine's own `ci.yml` and `release.yml` (action pinning by commit, the tag-on-main check).
- `scripts/check.mjs` and `scripts/tests/check.test.mjs`.
