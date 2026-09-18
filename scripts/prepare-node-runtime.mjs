import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Keep npm available without shipping links back into the build host. */
export async function prepareNodeRuntime(destination, nodeExecutable = process.execPath, platform = process.platform) {
  const nodeDir = dirname(nodeExecutable)
  const windows = platform === 'win32'
  const npmRoot = windows
    ? join(nodeDir, 'node_modules', 'npm')
    : dirname(dirname(await realpath(join(nodeDir, 'npm'))))
  const npm = JSON.parse(await readFile(join(npmRoot, 'package.json'), 'utf8'))
  if (npm.name !== 'npm') throw new Error(`Unexpected bundled npm package: ${npmRoot}`)
  await mkdir(destination, { recursive: true })
  await cp(nodeExecutable, join(destination, windows ? 'node.exe' : 'node'), { dereference: true })
  await cp(npmRoot, join(destination, 'node_modules', 'npm'), { recursive: true, dereference: true })
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
