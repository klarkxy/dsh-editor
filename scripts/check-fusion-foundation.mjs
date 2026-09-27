/** Public Fusion Node suites moved with the package to dsh-plugins.
 * Editor retains its host integration contract suite against the published package. */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pnpm = process.env.npm_execpath
if (!pnpm || !existsSync(pnpm)) throw new Error('Run through pnpm test:fusion')
const result = spawnSync(process.execPath, [pnpm, 'exec', 'vitest', 'run', '--maxWorkers=2', 'packages/dsh-editor-workbench/src/fusion-host.spec.ts'], { cwd: root, stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
