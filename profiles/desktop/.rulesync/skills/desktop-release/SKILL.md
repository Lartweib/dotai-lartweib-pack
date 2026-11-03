---
name: desktop-release
description: "Release an Electron app: NSIS installer with electron-builder, published to GitHub Releases, optional code-signing hook. Use when packaging or publishing."
metadata:
  author: Federico Ara
---

# desktop-release

## Flow

1. Bump `version` in `package.json`; conventional commit; tag `v<version>`.
2. `electron-builder --win nsis --publish never` locally first; check the installer starts and the app opens (the `desktop-verify` skill).
3. Publish from CI on the tag: `electron-builder --win nsis --publish always`, with `GH_TOKEN` from the CI secrets. Never put the token in a file or the chat.
4. The release is created as a draft. Check the assets (`*.exe`, `*.blockmap`, `latest.yml`), then publish it by hand.

## Config (`electron-builder.yml`, or the `build` key of `package.json`)

The same keys go in either place; keep the one the project already uses.

```yaml
win:
  target: nsis
  signtoolOptions:
    sign: ./build/sign.cjs   # optional, see below
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
publish:
  provider: github
  releaseType: draft
```

Pin `electron-builder` to an exact version. v27 moves to ESM and Node 22.12+: read its migration notes before upgrading.

## Code signing (optional)

Unsigned builds work; SmartScreen warns until the app builds reputation. Signing does not remove the warning on day one either: reputation grows per publisher and per file, EV included (since 2024).

- Copy `${DOTAI_PROJECT_TOOLS}/desktop-sign.cjs` to `build/sign.cjs` and commit it. Without `DESKTOP_SIGN_COMMAND` it logs and leaves the build unsigned; with it, it runs the signer once per file (`{file}` is the quoted path). Set `DESKTOP_SIGN_REQUIRED=1` in the release job so a missing signer fails the build instead of shipping unsigned.
- **Recommended (open-source app, individual in the EU): Certum Open Source Code Signing in the Cloud** (SimplySign, ~€49/year, no card). Issued to the person ("Open Source Developer, <name>"), so the name is public in the signature. The key stays in Certum's cloud; signing goes through the hook during the build, so the app exe, uninstaller and installer are signed and `latest.yml` hashes the signed installer.
  - Setup: buy and activate it (identity documents, the repository link), install SimplySign Desktop and the mobile app (one-time codes), find the certificate thumbprint in the Windows store, then `DESKTOP_SIGN_COMMAND='signtool sign /sha1 <thumbprint> /fd sha256 /tr http://time.certum.pl /td sha256 {file}'`.
  - Gotchas: a SimplySign session needs a one-time code, so the simplest is to run the release build on the author's machine; signing on CI needs a third-party tool that holds the TOTP seed as a secret (that seed is the signing access). Limit of 5000 signatures a month. Certificates last at most 459 days (CA/B rule, 2026): renew every year.
- **Fallback (free): SignPath Foundation.** OSI license, no proprietary parts, already released, a code signing policy on the site, MFA, a named approver per release, and builds on GitHub-hosted runners. The publisher shown is "SignPath Foundation". It signs uploaded GitHub artifacts in a CI step (`signpath/github-action-submit-signing-request`), not in the hook: leave `DESKTOP_SIGN_COMMAND` unset in that job. It cannot sign inside an NSIS installer, so the flow is two passes: `--dir`, sign `win-unpacked`, `--prepackaged` NSIS, sign the installer, then regenerate `latest.yml` (its sha512 changes) before publishing. TODO(trial).
- Not for this author: Azure Artifact Signing (individuals only in the USA and Canada); EV or standard OV certificates (€200+ a year for the same reputation curve).

## Auto-update

`electron-updater` reads `latest.yml` from the GitHub release. Test an update from the previous version before publishing.
