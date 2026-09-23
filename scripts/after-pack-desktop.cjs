const { execFile } = require('node:child_process')
const { existsSync } = require('node:fs')
const { rename } = require('node:fs/promises')
const { join } = require('node:path')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

async function restoreDependencies(source, target) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, target)
      return
    } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error?.code)
        || existsSync(target) || attempt >= 59) throw error
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
}

/** Electron Builder ignores directories named node_modules in extraResources. */
exports.default = async function afterPack(context) {
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  await restoreDependencies(join(resources, 'dsh', 'vendor-dependencies'), join(resources, 'dsh', 'node_modules'))
  await restoreDependencies(join(resources, 'profile-template', 'vendor-dependencies'), join(resources, 'profile-template', 'node_modules'))
  const nodeVendor = join(resources, 'node', 'vendor-dependencies')
  if (existsSync(nodeVendor)) {
    await restoreDependencies(nodeVendor, join(resources, 'node', 'node_modules'))
  }
  if (context.electronPlatformName === 'win32') {
    const executable = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
    const icon = join(context.packager.buildResourcesDir, 'icon.ico')
    const rcedit = require.resolve('electron-winstaller/vendor/rcedit.exe')
    const productName = context.packager.appInfo.productName
    const version = context.packager.appInfo.version
    await execFileAsync(rcedit, [
      executable,
      '--set-icon', icon,
      '--set-version-string', 'FileDescription', productName,
      '--set-version-string', 'ProductName', productName,
      '--set-version-string', 'InternalName', productName,
      '--set-file-version', version,
      '--set-product-version', version,
    ], { windowsHide: true })
  }
}
