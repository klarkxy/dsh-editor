import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
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
    const window = await app.firstWindow()
    const browserErrors = []
    window.on('console', (message) => {
      const text = message.text()
      const acceptedDevelopmentWarning = message.type() === 'warning'
        && text.includes('Electron Security Warning (Insecure Content-Security-Policy)')
      if (!acceptedDevelopmentWarning && (message.type() === 'error' || message.type() === 'warning')) browserErrors.push(`${message.type()}: ${text}`)
    })
    window.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
    try {
      await window.waitForFunction(() => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell, .settings-shell')), undefined, { timeout: 90_000 })
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
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds())
    const state = await window.evaluate(() => ({
      body: document.body.textContent ?? '',
      title: document.title,
      shell: Boolean(document.querySelector('.shell')),
      settings: Boolean(document.querySelector('.settings-shell .settings-view')),
      settingsBack: Boolean(document.querySelector('[aria-label="返回写作区"]')),
      settingsControl: Boolean(document.querySelector('[aria-label="设置"]')),
      officialHome: document.body.textContent?.includes('DeepSeek Harness') ?? false,
      editorName: Boolean(document.querySelector('.brand-lockup, .settings-brand')),
      width: window.innerWidth,
      height: window.innerHeight,
    }))
    await inspect(state)
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
phases.push(await launchPhase('first-run-settings', {}, async (state) => {
  const hasOnlyApprovedInterfaces = state.body.includes('DeepSeek') && state.body.includes('自定义接口') && !state.body.includes('OpenAI')
  const forcedSetup = state.settings && !state.settingsBack && state.body.includes('接口') && state.body.includes('连接')
  if (!forcedSetup || !hasOnlyApprovedInterfaces || state.shell || state.officialHome || !state.editorName) {
    throw new Error(`first-run settings assertion failed: ${JSON.stringify({ ...state, body: undefined, forcedSetup, hasOnlyApprovedInterfaces })}`)
  }
}))

phases.push(await launchPhase('configured-home', { DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key' }, async (state) => {
  const onboarding = state.body.includes('新建') && state.body.includes('打开作品')
  const settingsEntry = state.settingsControl
  const technicalChrome = ['DeepSeek Harness', 'DSH_HOME', 'permission preset', '权限模式', '会话列表'].some((label) => state.body.includes(label))
  if (!state.shell || state.settings || !state.editorName || state.officialHome || !onboarding || !settingsEntry || technicalChrome) {
    throw new Error(`configured home assertion failed: ${JSON.stringify({ ...state, body: undefined, onboarding, settingsEntry, technicalChrome })}`)
  }
}))

const report = { ok: true, source: 'current', phases }
await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
