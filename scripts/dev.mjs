/** Build/watch the private profile and launch the Electron product window. */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshInstallation } from './dsh-cli.mjs'
import { workspacePackageDir, desktopComposition } from './desktop-compositions.mjs'
import { firstCompilePattern, isLeftoverDevCommand } from './dev-process.mjs'
import { clientPackages, compositionInstallNames, loadPluginManifests } from './plugin-manifest.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pnpmCli = process.env.npm_execpath
const devHome = resolve(root, '.dev', 'desktop-home')
const template = resolve(root, '.dev', 'desktop-profile-template')
const devDshRuntime = resolve(root, '.dev', 'desktop-dsh-runtime-0.1.7-alpha.1')
const prepareDesktopDev = resolve(root, 'scripts', 'prepare-desktop-dev.mjs')
const electronCli = resolve(root, 'apps', 'desktop', 'node_modules', 'electron', 'cli.js')
const tsdownCli = resolve(root, 'node_modules', 'tsdown', 'dist', 'run.mjs')
const electronUserData = resolve(devHome, 'electron-user-data')
const win = process.platform === 'win32'
const FIRST_COMPILE_MS = 90_000

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
  dsh = resolveDshInstallation('0.1.7-alpha.1')
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
  DSH_DESKTOP_USER_DATA_DIR: process.env.DSH_DESKTOP_USER_DATA_DIR || electronUserData,
}
// Some terminals (VS Code and other Electron-based tools) export
// ELECTRON_RUN_AS_NODE=1; inherited, it turns the Electron binary into plain
// Node and the desktop main fails to boot.
delete env.ELECTRON_RUN_AS_NODE

function spawnNode(script, args, cwd = root, stdio = 'inherit') {
  return spawn(process.execPath, [script, ...args], {
    cwd,
    stdio,
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

function runTaskkill(pid) {
  return new Promise((resolvePromise) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    const done = () => resolvePromise()
    killer.once('exit', done)
    killer.once('error', done)
    setTimeout(done, 8_000)
  })
}

function killTree(child) {
  if (!child?.pid) return Promise.resolve()
  return runTaskkill(child.pid)
}

function listCandidateProcesses() {
  return new Promise((resolvePromise) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe' OR Name = 'electron.exe'\" | Where-Object { $_.CommandLine } | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress",
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.on('error', () => resolvePromise([]))
    child.on('exit', () => {
      try {
        const parsed = JSON.parse(out || '[]')
        const rows = Array.isArray(parsed) ? parsed : [parsed]
        resolvePromise(rows.map((row) => ({
          pid: Number(row.ProcessId),
          command: String(row.CommandLine ?? ''),
        })).filter((row) => Number.isInteger(row.pid) && row.pid > 0))
      } catch {
        resolvePromise([])
      }
    })
  })
}

async function killLeftoverDevProcesses() {
  const rows = await listCandidateProcesses()
  const pids = [...new Set(rows
    .filter((row) => row.pid !== process.pid && isLeftoverDevCommand(row.command, root))
    .map((row) => row.pid))]
  if (!pids.length) return
  console.log(`dev: stopping leftover watcher/electron/dsh processes (${pids.length})`)
  await Promise.all(pids.map(runTaskkill))
}

function waitForFirstCompile(child, packageName, wrapClient) {
  const pattern = firstCompilePattern(packageName, wrapClient)
  return new Promise((resolvePromise, reject) => {
    let settled = false
    let buffered = ''
    const inspect = (chunk) => {
      const text = String(chunk)
      process.stdout.write(text)
      buffered += text
      if (buffered.length > 8_000) buffered = buffered.slice(-4_000)
      if (!settled && pattern.test(buffered)) {
        settled = true
        resolvePromise()
      }
    }
    child.stdout?.on('data', inspect)
    child.stderr?.on('data', inspect)
    child.once('error', (error) => {
      if (!settled) reject(error)
    })
    child.once('exit', (code) => {
      if (!settled && !stopping) reject(new Error(`${packageName} watcher exited ${code ?? 1} before the first compile`))
    })
  })
}

for (const path of [prepareDesktopDev, electronCli, tsdownCli]) {
  if (!existsSync(path)) {
    console.error(`dev: required desktop input is missing: ${path}`)
    process.exit(1)
  }
}

function packageHasBuildOutput(name) {
  const dir = workspacePackageDir(name)
  return existsSync(resolve(dir, 'lib/index.js')) || existsSync(resolve(dir, 'lib/client.js'))
}

function newestMtime(dir) {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs)
  }
  return newest
}

const composition = await desktopComposition()
const pluginNames = compositionInstallNames(composition)
const desktopMain = resolve(root, 'apps', 'desktop', 'dist', 'main.js')
const forceBuild = process.env.DSH_DEV_FORCE_BUILD === '1'
const pluginsReady = pluginNames.every(packageHasBuildOutput)
const desktopReady = existsSync(desktopMain)
  && newestMtime(resolve(root, 'apps', 'desktop', 'src')) <= statSync(desktopMain).mtimeMs

console.log(`dev: DSH ${dsh.version}, isolated home ${devHome}`)
await killLeftoverDevProcesses()
if (forceBuild || !pluginsReady || !desktopReady) {
  console.log('dev: building the desktop profile plugins')
  await runNode(pnpmCli, ['-r', 'build'])
} else {
  console.log('dev: reusing existing package builds (set DSH_DEV_FORCE_BUILD=1 to rebuild)')
}

await runNode(prepareDesktopDev, [])

if (process.env.DSH_DESKTOP_PREPARE_ONLY === '1') {
  console.log(`dev: prepared desktop profile template ${template}`)
  process.exit(0)
}

let stopping = false
const children = []
let electron

async function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  await Promise.all(children.map(killTree))
  await killLeftoverDevProcesses()
  process.exit(code)
}

function bindChild(child, role) {
  children.push(child)
  child.on('error', (error) => {
    console.error(error)
    void shutdown(1)
  })
  child.on('exit', (code) => {
    if (stopping) return
    if (role === 'electron') {
      void shutdown(code ?? 0)
      return
    }
    console.error(`dev: watcher exited ${code ?? 1}; stopping the desktop process`)
    void shutdown(code || 1)
  })
}

process.on('SIGINT', () => { void shutdown(0) })
process.on('SIGTERM', () => { void shutdown(0) })

console.log('dev: starting plugin watchers')
const wrapClients = new Set(clientPackages(loadPluginManifests(root)))
const watchers = compositionInstallNames(composition).map((name) => {
  const wrapClient = wrapClients.has(name)
  const child = spawnNode(tsdownCli, [
    '--watch', '--no-clean',
    ...(wrapClient ? ['--on-success', `node ../../scripts/wrap-client.mjs ${name}`] : []),
  ], workspacePackageDir(name), ['ignore', 'pipe', 'pipe'])
  bindChild(child, 'watcher')
  return { name, child, wrapClient }
})

try {
  await Promise.race([
    Promise.all(watchers.map((row) => waitForFirstCompile(row.child, row.name, row.wrapClient))),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`plugin watchers did not finish the first compile within ${FIRST_COMPILE_MS}ms`)), FIRST_COMPILE_MS)),
  ])
} catch (error) {
  console.error(`dev: ${error instanceof Error ? error.message : String(error)}`)
  await shutdown(1)
}

console.log('dev: starting Electron')
electron = spawnNode(electronCli, [resolve(root, 'apps', 'desktop', 'dist', 'main.js')])
bindChild(electron, 'electron')
console.log('dev: Electron launched; keep this terminal open. The window may take a few seconds.')
