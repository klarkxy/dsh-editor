/**
 * Local DSH plugin loop: build, link into a profile, watch, boot the web UI.
 *
 *   pnpm run dev
 *   pnpm run dev -- --port 8788
 *   DSH_PROFILE=web pnpm run dev
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profile = process.env.DSH_PROFILE || 'web'
const extra = process.argv.slice(2)
const win = process.platform === 'win32'

function bin(name) {
  return win ? `${name}.cmd` : name
}

function spawnInherit(command, args, cwd = root) {
  return spawn(command, args, {
    cwd,
    stdio: 'inherit',
    windowsHide: false,
    env: process.env,
  })
}

function run(command, args, cwd = root) {
  return new Promise((resolvePromise, reject) => {
    const child = spawnInherit(command, args, cwd)
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`))
    })
  })
}

function killTree(child) {
  if (!child?.pid || child.exitCode != null) return
  if (win) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

const manuscript = resolve(root, 'packages/dsh-manuscript')
const grill = resolve(root, 'packages/dsh-grill')
if (!existsSync(resolve(manuscript, 'package.json')) || !existsSync(resolve(grill, 'package.json'))) {
  console.error('dev: expected packages/dsh-manuscript and packages/dsh-grill')
  process.exit(1)
}

console.log(`dev: build plugins, then link into DSH profile "${profile}"`)
await run(bin('pnpm'), ['-r', 'build'])

await run(bin('dsh'), ['plugin', '--profile', profile, 'add', `link:${manuscript}`])
await run(bin('dsh'), ['plugin', '--profile', profile, 'add', `link:${grill}`])

console.log('dev: watching. Refresh the browser after editor/client rebuilds; restart this command after host/tool changes if HMR misses them.')

const kids = []
kids.push(
  spawnInherit(bin('pnpm'), ['--filter', 'dsh-grill', 'exec', 'tsdown', '--watch', '--no-clean']),
)
kids.push(
  spawnInherit(bin('pnpm'), [
    '--filter',
    'dsh-manuscript',
    'exec',
    'tsdown',
    '--watch',
    '--no-clean',
    '--on-success',
    'node ../../scripts/wrap-client.mjs dsh-manuscript',
  ]),
)
const dsh = spawnInherit(bin('dsh'), ['--profile', profile, ...extra])
kids.push(dsh)

let stopping = false
function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of kids) killTree(child)
  process.exit(code)
}

dsh.on('exit', (code) => shutdown(code ?? 0))
for (const child of kids) {
  child.on('error', (error) => {
    console.error(error)
    shutdown(1)
  })
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
