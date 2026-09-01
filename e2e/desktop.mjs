import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.pack', 'desktop-e2e')
resolveDshInstallation('0.1.1-rc.2')
const e2eHomeRoot = resolve(root, '.dev', 'desktop-e2e-home')
const template = resolve(root, '.dev', 'desktop-profile-template')
const electronExecutable = resolve(root, 'apps', 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
const main = resolve(root, 'apps', 'desktop', 'dist', 'main.js')

function run(script, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, env, stdio: 'inherit', windowsHide: true })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`desktop preparation exited ${code}`)))
  })
}

async function dismissNativeOnboarding(page) {
  const continueNotice = page.getByRole('button', { name: '继续', exact: true })
  let steps = 0
  for (; steps < 5 && await continueNotice.isVisible({ timeout: 1_000 }).catch(() => false); steps += 1) {
    await continueNotice.click()
    await page.waitForTimeout(250)
  }
  const configureLater = page.getByRole('button', { name: '稍后配置', exact: true })
  const setup = await configureLater.isVisible({ timeout: 2_000 }).catch(() => false)
  if (setup) {
    await configureLater.click()
    await page.waitForTimeout(250)
  }
  return { notice: steps > 0, steps, setup }
}

const baseEnv = {
  ...process.env,
  DSH_TELEMETRY_DISABLED: '1',
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: resolve(root, '.dev', 'desktop-dsh-runtime', 'lib', 'bin.js'),
  DSH_DESKTOP_PROFILE_TEMPLATE: template,
}
delete baseEnv.DEEPSEEK_API_KEY
delete baseEnv.DSH_EDITOR_CUSTOM_API_KEY

await run(resolve(root, 'scripts', 'prepare-desktop-dev.mjs'), [], baseEnv)
await rm(e2eHomeRoot, { recursive: true, force: true })
await mkdir(output, { recursive: true })

async function launchPhase(name, extraEnv, inspect) {
  const phaseHome = resolve(e2eHomeRoot, name)
  const electronUserData = resolve(phaseHome, 'electron-user-data')
  await mkdir(electronUserData, { recursive: true })
  let app
  try {
    app = await electron.launch({
      executablePath: electronExecutable,
      args: [main],
      env: { ...baseEnv, DSH_HOME: phaseHome, DSH_DESKTOP_USER_DATA_DIR: electronUserData, ...extraEnv },
    })
    const processLogs = []
    app.process().stdout?.on('data', (chunk) => processLogs.push(`stdout: ${String(chunk)}`))
    app.process().stderr?.on('data', (chunk) => processLogs.push(`stderr: ${String(chunk)}`))
    let firstWindowTimer
    const window = await Promise.race([
      app.firstWindow(),
      new Promise((_, reject) => {
        firstWindowTimer = setTimeout(() => reject(new Error(`desktop window was not created within 90 seconds: ${JSON.stringify(processLogs)}`)), 90_000)
      }),
    ]).finally(() => clearTimeout(firstWindowTimer))
    const browserErrors = []
    window.on('console', (message) => {
      const text = message.text()
      const acceptedDevelopmentWarning = message.type() === 'warning'
        && text.includes('Electron Security Warning (Insecure Content-Security-Policy)')
      if (!acceptedDevelopmentWarning && (message.type() === 'error' || message.type() === 'warning')) browserErrors.push(`${message.type()}: ${text}`)
    })
    window.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
    try {
      await window.waitForFunction(() => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell')), undefined, { timeout: 90_000 })
    } catch (error) {
      const diagnostic = window.isClosed() ? { closed: true, processLogs } : await window.evaluate(() => ({
        title: document.title,
        body: document.body.textContent,
        url: location.href,
        scripts: [...document.scripts].map((script) => script.src || '[inline]'),
        bootEntries: globalThis.__DSH_BOOT__?.entries?.map((entry) => entry.id),
      }))
      if (!window.isClosed()) await window.screenshot({ path: resolve(output, `${name}-failure.png`) }).catch(() => undefined)
      throw new Error(`desktop shell did not mount: ${JSON.stringify({ ...diagnostic, browserErrors, processLogs })}; ${error instanceof Error ? error.message : String(error)}`)
    }
    const url = new URL(window.url())
    if (url.hostname !== '127.0.0.1' || !url.port) throw new Error(`unexpected desktop URL ${url.href}`)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await window.waitForTimeout(350)
    const nativeOnboarding = await dismissNativeOnboarding(window)
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds())
    const state = await window.evaluate(() => ({
      body: document.body.textContent ?? '',
      title: document.title,
      shell: Boolean(document.querySelector('.shell')),
      settings: Boolean(document.querySelector('[role="dialog"]')),
      settingsControl: [...document.querySelectorAll('.native-settings-control button')].some((button) => button.textContent?.includes('设置')),
      officialHome: document.body.textContent?.includes('DeepSeek Harness') ?? false,
      editorName: Boolean(document.querySelector('.brand-lockup')),
      bootEntries: globalThis.__DSH_BOOT__?.entries?.map((entry) => entry.id) ?? [],
      width: window.innerWidth,
      height: window.innerHeight,
    }))
    await inspect({ ...state, nativeOnboarding })
    if (browserErrors.length) throw new Error(`browser console errors in ${name}: ${JSON.stringify(browserErrors)}`)
    await window.screenshot({ path: resolve(output, `${name}.png`) })
    const origin = url.origin
    await app.close()
    app = undefined
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    const portReleased = await fetch(origin, { signal: AbortSignal.timeout(1_000) }).then(() => false, () => true)
    if (!portReleased) throw new Error(`DSH loopback port still responds after Electron close: ${origin}`)
    return { name, origin, portReleased, state: { ...state, body: undefined, bounds } }
  } finally {
    if (app) await app.close().catch(() => undefined)
  }
}

const phases = []
phases.push(await launchPhase('first-run-home', {}, async (state) => {
  const onboarding = state.body.includes('新建') && state.body.includes('打开作品')
  if (!state.shell || state.officialHome || !state.editorName || !onboarding || !state.settingsControl || !state.nativeOnboarding.notice) {
    throw new Error(`first-run home assertion failed: ${JSON.stringify({ ...state, body: undefined, onboarding })}`)
  }
}))

phases.push(await launchPhase('configured-home', { DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key' }, async (state) => {
  const onboarding = state.body.includes('新建') && state.body.includes('打开作品')
  const settingsEntry = state.settingsControl
  const technicalChrome = ['DeepSeek Harness', 'DSH_HOME', 'permission preset', '权限模式', '会话列表'].some((label) => state.body.includes(label))
  const clientBoundaryReady = state.bootEntries.filter((entry) => entry === 'dsh-editor-shell').length === 1
    && state.bootEntries.every((entry) => entry !== 'dsh-editor-workbench' && entry !== 'dsh-editor-novel-kernel')
  if (!state.shell || !state.editorName || state.officialHome || !onboarding || !settingsEntry || technicalChrome || !clientBoundaryReady) {
    throw new Error(`configured home assertion failed: ${JSON.stringify({ ...state, body: undefined, onboarding, settingsEntry, technicalChrome, clientBoundaryReady })}`)
  }
}))

const report = { ok: true, source: 'current', phases }
await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
