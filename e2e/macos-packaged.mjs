import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { localArtifactsForPlatform } from '../scripts/release-artifacts.mjs'
import { treeDigest } from '../apps/desktop/dist/runtime-tree.js'

if (process.platform !== 'darwin') throw new Error('macOS packaged smoke must run on macOS')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifactOutput = resolve(root, process.argv[2] ?? '.pack/desktop')
const output = join(root, '.pack', 'macos-e2e')
await mkdir(output, { recursive: true })
const version = JSON.parse(await readFile(join(root, 'apps', 'desktop', 'package.json'), 'utf8')).version
const zipName = localArtifactsForPlatform('darwin', version, process.arch).find((name) => name.endsWith('.zip'))
if (!zipName) throw new Error('missing macOS ZIP artifact name')
const sandbox = await mkdtemp(join(tmpdir(), 'dsh-mac-first-launch-'))
const unpacked = join(sandbox, 'unpacked')
const home = join(sandbox, 'home')
const dshHome = join(home, '.dsh-editor')
await mkdir(home, { recursive: true })
let application
let page
let launchStarted = 0
let processLog = ''
const events = []
const record = (event) => { events.push(`${new Date().toISOString()} ${event}`); if (events.length > 100) events.shift() }
const safeUrl = (value) => {
  try { const url = new URL(value); return url.protocol === 'data:' ? 'data:' : `${url.origin}${url.pathname}` } catch { return 'unknown' }
}

async function collectNativeCrash(pid) {
  if (!pid) return 'Native crash report: no process id'
  const directories = [...new Set([home, process.env.HOME].filter(Boolean).map((base) => join(base, 'Library', 'Logs', 'DiagnosticReports'))), '/Library/Logs/DiagnosticReports']
  // ReportCrash may write asynchronously after SIGSEGV. This delay only collects
  // diagnostics from an already failed run; it never retries or passes the smoke.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    for (const directory of directories) {
      const names = await readdir(directory).catch(() => [])
      for (const name of names.filter((item) => item.startsWith('DSH Editor') && /\.(ips|crash)$/.test(item))) {
        const path = join(directory, name)
        const info = await stat(path).catch(() => null)
        if (!info || info.mtimeMs < launchStarted - 1000 || info.size > 2_000_000) continue
        const contents = await readFile(path, 'utf8').catch(() => '')
        if (!new RegExp(`"pid"\\s*:\\s*${pid}\\b|Process:\\s+DSH Editor \\[${pid}\\]`).test(contents)) continue
        // Only this freshly launched app's PID is eligible, not other runner apps.
        const bounded = contents.slice(0, 200_000)
        await writeFile(join(output, `native-${name}`), bounded)
        try {
          const report = JSON.parse(contents.slice(contents.indexOf('\n') + 1))
          const thread = report.threads?.[report.faultingThread]
          const images = report.usedImages?.map(({ name, base, uuid }) => ({ name, base, uuid }))
          return `Native crash: ${JSON.stringify({ exception: report.exception, termination: report.termination, faultingThread: report.faultingThread, thread, images })}`
        } catch { return `Native crash: ${bounded.slice(0, 24_000)}` }
      }
    }
    await delay(750)
  }
  return 'Native crash report: not produced within the bounded collection window'
}

try {
  // Test the distributable ZIP, not the development Electron executable.
  execFileSync('/usr/bin/ditto', ['-x', '-k', join(artifactOutput, zipName), unpacked])
  const bundle = join(unpacked, 'DSH Editor.app', 'Contents')
  const resources = join(bundle, 'Resources')
  const manifest = JSON.parse(await readFile(join(resources, 'runtime-manifest.json'), 'utf8'))
  for (const [directory, key] of [['node', 'node'], ['dsh', 'dsh'], ['profile-template', 'profile']]) {
    const digest = await treeDigest(join(resources, directory))
    for (const field of ['sha256', 'files', 'bytes']) {
      if (digest[field] !== manifest[key][field]) throw new Error(`ZIP ${key} ${field} mismatch`)
    }
  }
  const env = {
    ...process.env,
    HOME: home,
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    DSH_HOME: dshHome,
    DSH_DESKTOP_USER_DATA_DIR: join(home, 'electron-user-data'),
    DSH_EDITOR_PROJECTS_ROOT: join(home, 'projects'),
    DSH_TELEMETRY_DISABLED: '1',
    DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key',
  }
  for (const key of ['PORTABLE_EXECUTABLE_FILE', 'PORTABLE_EXECUTABLE_DIR', 'DSH_CLI_PATH', 'DSH_DESKTOP_NODE_PATH', 'DSH_DESKTOP_CLI_PATH', 'DSH_DESKTOP_PROFILE_TEMPLATE', 'DSH_EDITOR_CUSTOM_API_KEY', 'NODE_PATH', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE']) delete env[key]
  launchStarted = Date.now()
  application = await electron.launch({ executablePath: join(bundle, 'MacOS', 'DSH Editor'), env, timeout: 120_000 })
  const child = application.process()
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk) => { processLog = (processLog + chunk.toString()).slice(-65_536) })
  child.on('exit', (code, signal) => record(`process exit code=${code} signal=${signal}`))
  application.on('close', () => record('Playwright application closed'))
  const observe = (window) => {
    record(`page opened ${safeUrl(window.url())}`)
    window.on('close', () => record('page closed'))
    window.on('crash', () => record('page crashed'))
    window.on('pageerror', (error) => record(`page error ${error.message.slice(0, 500)}`))
    window.on('framenavigated', (frame) => { if (frame === window.mainFrame()) record(`navigation ${safeUrl(frame.url())}`) })
  }
  for (const window of application.windows()) observe(window)
  application.on('window', observe)
  await application.evaluate(({ app, webContents }) => {
    const observeContents = (contents) => contents.on('render-process-gone', (_event, details) => console.error('[packaged-smoke] renderer exit', JSON.stringify(details)))
    for (const contents of webContents.getAllWebContents()) observeContents(contents)
    app.on('web-contents-created', (_event, contents) => observeContents(contents))
    app.on('child-process-gone', (_event, details) => console.error('[packaged-smoke] child exit', JSON.stringify(details)))
    app.on('window-all-closed', () => console.error('[packaged-smoke] all windows closed'))
    app.on('will-quit', () => console.error('[packaged-smoke] app will quit'))
  })
  page = await application.firstWindow({ timeout: 120_000 })
  await page.waitForSelector('.shell', { timeout: 180_000 })
  const url = new URL(page.url())
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) throw new Error(`Unexpected packaged URL: ${url.href}`)
  const packaged = await application.evaluate(({ app }) => app.isPackaged)
  if (!packaged) throw new Error('smoke launched development Electron rather than the package')
  if (existsSync(join(dshHome, 'runtime', 'dsh-editor-runtime'))) throw new Error('macOS installed launch unexpectedly materialized its runtime')
  await page.screenshot({ path: join(output, 'window.png') })
  await writeFile(join(output, 'report.json'), JSON.stringify({ ok: true, artifact: zipName, packaged, shell: true, runtimeCopied: false }, null, 2))
  console.log('macOS packaged ZIP first-launch smoke passed')
} catch (error) {
  const diagnostic = page ? await page.locator('body').innerText({ timeout: 2_000 }).catch(() => 'unavailable') : 'no window'
  const child = application?.process()
  const processState = child ? { exitCode: child.exitCode, signalCode: child.signalCode } : null
  const livePages = application?.windows().map((window) => ({ closed: window.isClosed(), url: safeUrl(window.url()) })) ?? []
  const native = child?.signalCode ? await collectNativeCrash(child.pid).catch((failure) => `Native crash collection failed: ${String(failure)}`) : ''
  const details = `${String(error)}\n${diagnostic}\nProcess: ${JSON.stringify(processState)}\nPages: ${JSON.stringify(livePages)}\n${events.join('\n')}\n${processLog}\n${native}`
  await writeFile(join(output, 'failure.txt'), details)
  console.error(details)
  if (page) await page.screenshot({ path: join(output, 'failure.png'), timeout: 2_000 }).catch(() => undefined)
  throw error
} finally {
  if (application) await application.close()
  await rm(sandbox, { recursive: true, force: true, maxRetries: 3 })
}
