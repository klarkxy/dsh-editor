import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tests = readdirSync(join(root, 'packages/dsh-fusion/test'))
  .filter(name => name.endsWith('.node.mjs'))
  .sort()
  .map(name => join(root, 'packages/dsh-fusion/test', name))
if (tests.length === 0) throw new Error('Fusion has no Node suites.')

for (const [label, args] of [
  ['Fusion Node suites', ['--experimental-strip-types', '--test', ...tests]],
  ['Fusion native typecheck', [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', join(root, 'packages/dsh-fusion/tsconfig.json')]],
]) {
  console.log(`Running ${label}`)
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
