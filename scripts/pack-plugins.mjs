import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PUBLIC_PLUGIN_PACKAGES } from './desktop-compositions.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pnpm = process.env.npm_execpath
if (!pnpm || !existsSync(pnpm)) throw new Error('run through pnpm pack:plugins')
function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.status !== 0) throw new Error(`plugin packaging failed: ${script} (exit ${result.status})`)
}
run(resolve(root, 'scripts/prepare-pack.mjs'))
for (const name of PUBLIC_PLUGIN_PACKAGES) run(pnpm, ['--filter', name, 'pack', '--pack-destination', '.pack'])
run(resolve(root, 'scripts/verify-artifacts.mjs'))
