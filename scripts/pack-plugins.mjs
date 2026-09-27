import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { externalPluginPins } from './external-plugins.mjs'
import { PUBLIC_PLUGIN_PACKAGES, workspacePackageDir } from './desktop-compositions.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pnpm = process.env.npm_execpath
if (!pnpm || !existsSync(pnpm)) throw new Error('run through pnpm pack:plugins')
function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.status !== 0) throw new Error(`plugin packaging failed: ${script} (exit ${result.status})`)
}
run(resolve(root, 'scripts/prepare-pack.mjs'))
const external = externalPluginPins(root)
for (const name of PUBLIC_PLUGIN_PACKAGES) {
  if (name in external) {
    // Repack installed, already-built npm artifacts; never execute their lifecycle scripts.
    run(pnpm, ['--dir', workspacePackageDir(name), 'exec', 'npm', 'pack', '--ignore-scripts', '--pack-destination', resolve(root, '.pack')])
  } else run(pnpm, ['--filter', name, 'pack', '--pack-destination', '.pack'])
}
run(resolve(root, 'scripts/verify-artifacts.mjs'))
