import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { localArtifactsForPlatform } from '../scripts/release-artifacts.mjs'
import { treeDigest } from '../apps/desktop/dist/runtime-tree.js'

if (process.platform !== 'darwin') throw new Error('macOS packaged smoke must run on macOS')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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
try {
  // Test the distributable ZIP, not the development Electron executable.
  execFileSync('/usr/bin/ditto', ['-x', '-k', join(root, '.pack', 'desktop', zipName), unpacked])
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
  application = await electron.launch({ executablePath: join(bundle, 'MacOS', 'DSH Editor'), env, timeout: 120_000 })
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
  const diagnostic = page ? await page.locator('body').innerText().catch(() => 'unavailable') : 'no window'
  await writeFile(join(output, 'failure.txt'), `${String(error)}\n${diagnostic}`)
  if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => undefined)
  throw error
} finally {
  if (application) await application.close()
  await rm(sandbox, { recursive: true, force: true, maxRetries: 3 })
}
