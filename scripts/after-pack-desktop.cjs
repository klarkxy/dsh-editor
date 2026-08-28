const { rename } = require('node:fs/promises')
const { join } = require('node:path')

/** Electron Builder ignores directories named node_modules in extraResources. */
exports.default = async function afterPack(context) {
  const resources = join(context.appOutDir, 'resources')
  await rename(join(resources, 'dsh', 'vendor-dependencies'), join(resources, 'dsh', 'node_modules'))
  await rename(join(resources, 'profile-template', 'vendor-dependencies'), join(resources, 'profile-template', 'node_modules'))
}
