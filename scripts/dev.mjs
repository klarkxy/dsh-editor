/** Build/watch the private profile and launch the Electron product window. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshInstallation } from './dsh-cli.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pnpmCli = process.env.npm_execpath
const devHome = resolve(root, '.dev', 'desktop-home')
const template = resolve(root, '.dev', 'desktop-profile-template')
const devDshRuntime = resolve(root, '.dev', 'desktop-dsh-runtime')
const prepareDesktopDev = resolve(root, 'scripts', 'prepare-desktop-dev.mjs')
const electronCli = resolve(root, 'apps', 'desktop', 'node_modules', 'electron', 'cli.js')
const win = process.platform === 'win32'

if (!pnpmCli || !existsSync(pnpmCli)) {
  console.error('dev: start this command through pnpm: pnpm run dev')
  process.exit(1)
}
if (process.versions.node !== '24.16.0' || process.arch !== 'x64' || !win) {
  console.error(`dev: Windows x64 with Node 24.16.0 is required; found ${process.platform} ${process.arch} Node ${process.versions.node}`)
  process.exit(1)
}

let dsh
try {
  dsh = resolveDshInstallation('0.1.1-rc.2')
} catch (error) {
  console.error(`dev: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

const env = {
  ...process.env,
  DSH_HOME: devHome,
  DSH_TELEMETRY_DISABLED: process.env.DSH_TELEMETRY_DISABLED || '1',
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: resolve(devDshRuntime, 'lib', 'bin.js'),
  DSH_DESKTOP_PROFILE_TEMPLATE: template,
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
    child.on('exit', (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`${script} ${args.join(' ')} exited ${code}`)))
  })
}

function killTree(child) {
  if (!child?.pid || child.exitCode != null) return
  spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  })
}

for (const path of [prepareDesktopDev, electronCli]) {
  if (!existsSync(path)) {
    console.error(`dev: required desktop input is missing: ${path}`)
    process.exit(1)
  }
}

console.log(`dev: DSH ${dsh.version}, isolated home ${devHome}`)
console.log('dev: building the desktop profile plugins')
await runNode(pnpmCli, ['-r', 'build'])

await runNode(prepareDesktopDev, [])

if (process.env.DSH_DESKTOP_PREPARE_ONLY === '1') {
  console.log(`dev: prepared desktop profile template ${template}`)
  process.exit(0)
}

const children = [
  spawnNode(pnpmCli, [
    '--filter', 'dsh-manuscript', 'exec', 'tsdown', '--watch', '--no-clean',
    '--on-success', 'node ../../scripts/wrap-client.mjs dsh-manuscript',
  ]),
  spawnNode(pnpmCli, ['--filter', 'dsh-editor-workbench', 'exec', 'tsdown', '--watch', '--no-clean']),
  spawnNode(pnpmCli, ['--filter', 'dsh-editor-novel-kernel', 'exec', 'tsdown', '--watch', '--no-clean']),
  spawnNode(pnpmCli, [
    '--filter', 'dsh-editor-shell', 'exec', 'tsdown', '--watch', '--no-clean',
    '--on-success', 'node ../../scripts/wrap-client.mjs dsh-editor-shell',
  ]),
]
const electron = spawnNode(electronCli, [resolve(root, 'apps', 'desktop', 'dist', 'main.js')])
children.push(electron)

let stopping = false
function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) killTree(child)
  process.exit(code)
}

electron.on('exit', (code) => shutdown(code ?? 0))
for (const child of children) {
  child.on('error', (error) => {
    console.error(error)
    shutdown(1)
  })
  child.on('exit', (code) => {
    if (!stopping && child !== electron) {
      console.error(`dev: watcher exited ${code ?? 1}; stopping the desktop process`)
      shutdown(code || 1)
    }
  })
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
