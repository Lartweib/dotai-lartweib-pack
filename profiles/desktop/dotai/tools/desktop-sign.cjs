// Optional Windows code-signing hook for electron-builder (win.signtoolOptions.sign).
// A template, not a tool: copy it into the project (build/sign.cjs) so CI does not
// depend on .dotai/, which is never committed. See the desktop-release skill.
//
// Without DESKTOP_SIGN_COMMAND the build stays unsigned and says so, unless
// DESKTOP_SIGN_REQUIRED=1 (set it in the release job), which fails the build instead.
// With it, the command runs once per file; {file} is replaced by the quoted path, e.g.
// Certum SimplySign (SimplySign Desktop connected, certificate in the Windows store):
//   DESKTOP_SIGN_COMMAND='signtool sign /sha1 <thumbprint> /fd sha256 /tr http://time.certum.pl /td sha256 {file}'
const { spawnSync } = require('node:child_process')

function buildCommand(template, file) {
  return template.split('{file}').join(`"${String(file).replace(/"/g, '\\"')}"`)
}

module.exports = async function sign(configuration) {
  const template = (process.env.DESKTOP_SIGN_COMMAND || '').trim()
  const file = configuration.path
  if (!template) {
    if (process.env.DESKTOP_SIGN_REQUIRED === '1') {
      throw new Error(`sign: DESKTOP_SIGN_REQUIRED=1 but DESKTOP_SIGN_COMMAND is not set; refusing to leave ${file} unsigned`)
    }
    console.log(`sign: DESKTOP_SIGN_COMMAND is not set; ${file} stays unsigned`)
    return 'skipped'
  }
  const r = spawnSync(buildCommand(template, file), { shell: true, stdio: 'inherit', windowsHide: true, timeout: 300000 })
  if (r.error || r.status !== 0) {
    throw new Error(`sign: signing ${file} failed (${r.error ? r.error.message : `exit ${r.status}`})`)
  }
  return 'signed'
}

module.exports.buildCommand = buildCommand
