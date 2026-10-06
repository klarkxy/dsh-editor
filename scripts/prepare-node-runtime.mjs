import { createRequire } from 'node:module'
import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const PINNED_PNPM = { name: 'pnpm', version: '11.7.0' }

/** Keep npm and the separately pinned pnpm 11 without shipping links back into the build host. */
export async function prepareNodeRuntime(destination, nodeExecutable = process.execPath, platform = process.platform) {
  const nodeDir = dirname(nodeExecutable)
  const windows = platform === 'win32'
  const npmRoot = windows
    ? join(nodeDir, 'node_modules', 'npm')
    : dirname(dirname(await realpath(join(nodeDir, 'npm'))))
  const npm = JSON.parse(await readFile(join(npmRoot, 'package.json'), 'utf8'))
  if (npm.name !== 'npm') throw new Error(`Unexpected bundled npm package: ${npmRoot}`)
  const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
  let pnpmManifestPath
  try {
    pnpmManifestPath = require.resolve('desktop-pnpm/package.json')
  } catch (error) {
    // pnpm@11.7.0 exports "." as "./package.json"; the /package.json subpath is not exported.
    const resolved = require.resolve('desktop-pnpm')
    if (!resolved.endsWith('package.json')) throw error
    pnpmManifestPath = resolved
  }
  const pnpmRoot = dirname(pnpmManifestPath)
  const pnpm = JSON.parse(await readFile(pnpmManifestPath, 'utf8'))
  if (pnpm.name !== PINNED_PNPM.name || pnpm.version !== PINNED_PNPM.version) {
    throw new Error(`Expected desktop-pnpm to resolve ${PINNED_PNPM.name}@${PINNED_PNPM.version}, found ${pnpm.name}@${pnpm.version} at ${pnpmRoot}`)
  }
  await mkdir(destination, { recursive: true })
  await cp(nodeExecutable, join(destination, windows ? 'node.exe' : 'node'), { dereference: true })
  await cp(npmRoot, join(destination, 'node_modules', 'npm'), { recursive: true, dereference: true })
  // electron-builder omits `.gitkeep`; drop those empty directory markers before the digest so packaged Node matches the builder inventory.
  await cp(pnpmRoot, join(destination, 'node_modules', 'pnpm'), {
    recursive: true,
    dereference: true,
    filter: (source) => basename(source) !== '.gitkeep',
  })
  for (const name of ['npm', 'npx']) {
    if (windows) {
      await cp(join(nodeDir, `${name}.cmd`), join(destination, `${name}.cmd`), { dereference: true })
    } else {
      // A real shell file relocates with the bundle and always uses its own Node.
      const launcher = `#!/bin/sh\nbasedir=$(CDPATH= cd "$(dirname "$0")" && pwd) || exit 1\nexec "$basedir/node" "$basedir/node_modules/npm/bin/${name}-cli.js" "$@"\n`
      await writeFile(join(destination, name), launcher, { mode: 0o755 })
    }
  }
}
