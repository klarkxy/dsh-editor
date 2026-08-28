/**
 * Local DSH plugin loop: build, link into an isolated profile, watch, boot the web UI.
 *
 *   pnpm run dev:web
 *   pnpm run dev:web -- --port 9000
 *   DSH_HOME=/custom/home DSH_PROFILE=web pnpm run dev:web
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshInstallation } from './dsh-cli.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profile = process.env.DSH_PROFILE || 'web'
const forwarded = process.argv.slice(2)
const extra = forwarded[0] === '--' ? forwarded.slice(1) : forwarded
const win = process.platform === 'win32'
const pnpmCli = process.env.npm_execpath
const devHome = resolve(process.env.DSH_HOME || resolve(root, '.dev/dsh-home'))
const env = {
  ...process.env,
  DSH_HOME: devHome,
  DSH_TELEMETRY_DISABLED: process.env.DSH_TELEMETRY_DISABLED || '1',
}

if (!pnpmCli || !existsSync(pnpmCli)) {
  console.error('dev: start this command through pnpm: pnpm run dev')
  process.exit(1)
}

let dshInstallation
try {
  // Development follows the locally installed DSH so contributors can debug
  // upgrades. Delivery verification remains pinned by resolveDshInstallation().
  dshInstallation = resolveDshInstallation(null)
} catch (error) {
  console.error(`dev: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

function spawnNode(script, args, cwd = root) {
  return spawn(process.execPath, [script, ...args], {
    cwd,
    stdio: 'inherit',
    windowsHide: false,
    env,
  })
}

function runNode(script, args, cwd = root) {
  return new Promise((resolvePromise, reject) => {
    const child = spawnNode(script, args, cwd)
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${script} ${args.join(' ')} exited ${code}`))
    })
  })
}

function hasOption(name) {
  return extra.some((arg) => arg === name || arg.startsWith(`${name}=`))
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

const appArgs = []
if (!hasOption('--host')) appArgs.push('--host', '127.0.0.1')
if (!hasOption('--port')) appArgs.push('--port', '8788')
appArgs.push(...extra)

console.log(`dev: DSH ${dshInstallation.version} (${dshInstallation.source})`)
console.log(`dev: isolated home ${devHome}`)
console.log(`dev: build plugins, then link into DSH profile "${profile}"`)
await runNode(pnpmCli, ['-r', 'build'])

const profileDir = resolve(devHome, 'profiles', profile)
// Initialize through the official manager, then let the current pnpm process
// add space-bearing Windows paths without a .cmd/shell quoting round-trip.
// The final manager pass reconciles the installed packages into profile bundles.
await runNode(dshInstallation.cliPath, ['plugin', '--profile', profile, 'install'])
await runNode(pnpmCli, ['add', `link:${manuscript}`, `link:${grill}`], profileDir)
await runNode(dshInstallation.cliPath, ['plugin', '--profile', profile, 'install'])

console.log('dev: watching. Refresh the browser after editor/client rebuilds; restart this command after host/tool changes if HMR misses them.')

const kids = []
kids.push(
  spawnNode(pnpmCli, ['--filter', 'dsh-grill', 'exec', 'tsdown', '--watch', '--no-clean']),
)
kids.push(
  spawnNode(pnpmCli, [
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
const dsh = spawnNode(dshInstallation.cliPath, ['--profile', profile, ...appArgs])
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
  child.on('exit', (code) => {
    if (!stopping && child !== dsh) {
      console.error(`dev: watcher exited ${code ?? 1}; stopping DSH to avoid serving stale output`)
      shutdown(code || 1)
    }
  })
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
