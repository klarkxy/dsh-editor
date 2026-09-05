const { execFile } = require('node:child_process')
const { rename } = require('node:fs/promises')
const { join } = require('node:path')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

/** Electron Builder ignores directories named node_modules in extraResources. */
exports.default = async function afterPack(context) {
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  await rename(join(resources, 'dsh', 'vendor-dependencies'), join(resources, 'dsh', 'node_modules'))
  await rename(join(resources, 'profile-template', 'vendor-dependencies'), join(resources, 'profile-template', 'node_modules'))
  if (context.electronPlatformName === 'win32') {
    const executable = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
    const icon = join(context.packager.buildResourcesDir, 'icon.ico')
    const rcedit = require.resolve('electron-winstaller/vendor/rcedit.exe')
    await execFileAsync(rcedit, [executable, '--set-icon', icon], { windowsHide: true })
  }
}
