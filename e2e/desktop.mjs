import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function waitForFileText(path, expected, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await readFile(path, 'utf8').then((text) => text === expected, () => false)) return
    await delay(100)
  }
  throw new Error(`file did not reach expected text within ${timeoutMs}ms: ${path}`)
}

async function closeElectronApplication(app) {
  const pid = app.process().pid
  const graceful = await Promise.race([
    app.close().then(() => true, () => false),
    delay(15_000).then(() => false),
  ])
  if (graceful) return true
  if (process.platform === 'win32' && pid) {
    await new Promise((resolvePromise) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('error', () => resolvePromise())
      killer.once('exit', () => resolvePromise())
    })
  } else if (pid) {
    try { process.kill(pid, 'SIGKILL') } catch { /* The process may have exited during the timeout fallback. */ }
  }
  return false
}

async function readWindowDiagnostic(window, processLogs) {
  if (window.isClosed()) return { closed: true, processLogs }
  return await Promise.race([
    window.evaluate(() => ({
      title: document.title,
      body: document.body.textContent?.slice(0, 500) ?? '',
      url: location.href,
      scripts: [...document.scripts].map((script) => script.src || '[inline]'),
      bootEntries: globalThis.__DSH_BOOT__?.entries?.map((entry) => entry.id),
    })).catch((error) => ({ evaluateError: error instanceof Error ? error.message : String(error), processLogs })),
    delay(5_000).then(() => ({ unresponsive: true, processLogs })),
  ])
}

async function dismissNativeOnboarding(page) {
  const continueNotice = page.getByRole('button', { name: '继续', exact: true })
  let steps = 0
  for (; steps < 5 && await continueNotice.waitFor({ state: 'visible', timeout: 1_000 }).then(() => true, () => false); steps += 1) {
    await continueNotice.click()
    await page.waitForTimeout(250)
  }
  const configureLater = page.getByRole('button', { name: '稍后配置', exact: true })
  const setup = await configureLater.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true, () => false)
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
  DSH_EDITOR_PROJECTS_ROOT: resolve(e2eHomeRoot, 'projects'),
}
delete baseEnv.DEEPSEEK_API_KEY
delete baseEnv.DSH_EDITOR_CUSTOM_API_KEY

await run(resolve(root, 'scripts', 'prepare-desktop-dev.mjs'), [], baseEnv)
await rm(e2eHomeRoot, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const projectsRoot = resolve(e2eHomeRoot, 'projects')
const multiWindowWorkspace = resolve(projectsRoot, 'multi-window-workspace')

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
    console.log(`[desktop-e2e] ${name}: Electron launched`)
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
    console.log(`[desktop-e2e] ${name}: first window ready`)
    const browserErrors = []
    window.on('console', (message) => {
      const text = message.text()
      const acceptedDevelopmentWarning = message.type() === 'warning'
        && text.includes('Electron Security Warning (Insecure Content-Security-Policy)')
      if (!acceptedDevelopmentWarning && (message.type() === 'error' || message.type() === 'warning')) browserErrors.push(`${message.type()}: ${text}`)
    })
    window.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
    window.on('crash', () => browserErrors.push('page crashed'))
    try {
      await delay(5_000)
      console.log(`[desktop-e2e] ${name}: initial page ${JSON.stringify(await readWindowDiagnostic(window, processLogs))}`)
      await window.waitForFunction(() => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell')), undefined, { timeout: 90_000 })
      console.log(`[desktop-e2e] ${name}: shell mounted`)
    } catch (error) {
      const diagnostic = await readWindowDiagnostic(window, processLogs)
      if (!window.isClosed()) await window.screenshot({ path: resolve(output, `${name}-failure.png`) }).catch(() => undefined)
      throw new Error(`desktop shell did not mount: ${JSON.stringify({ ...diagnostic, browserErrors, processLogs })}; ${error instanceof Error ? error.message : String(error)}`)
    }
    const url = new URL(window.url())
    if (url.hostname !== '127.0.0.1' || !url.port) throw new Error(`unexpected desktop URL ${url.href}`)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await window.waitForTimeout(350)
    const nativeOnboarding = await dismissNativeOnboarding(window)
    console.log(`[desktop-e2e] ${name}: onboarding dismissed`)
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
    await inspect({ ...state, nativeOnboarding }, { app, window })
    console.log(`[desktop-e2e] ${name}: assertions passed`)
    if (browserErrors.length) throw new Error(`browser console errors in ${name}: ${JSON.stringify(browserErrors)}`)
    await window.screenshot({ path: resolve(output, `${name}.png`) })
    const origin = url.origin
    const gracefulExit = await closeElectronApplication(app)
    console.log(`[desktop-e2e] ${name}: close completed graceful=${gracefulExit}`)
    app = undefined
    if (!gracefulExit) throw new Error(`Electron did not exit within 15 seconds after closing the ${name} window`)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    const portReleased = await fetch(origin, { signal: AbortSignal.timeout(1_000) }).then(() => false, () => true)
    if (!portReleased) throw new Error(`DSH loopback port still responds after Electron close: ${origin}`)
    return { name, origin, portReleased, state: { ...state, body: undefined, bounds } }
  } finally {
    if (app) await closeElectronApplication(app).catch(() => false)
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

phases.push(await launchPhase('multi-window', { DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key' }, async (state, ctx) => {
  const onboarding = state.body.includes('新建') && state.body.includes('打开作品')
  if (!state.shell || state.officialHome || !state.editorName || !onboarding) {
    throw new Error(`multi-window home assertion failed: ${JSON.stringify({ ...state, body: undefined, onboarding })}`)
  }
  await ctx.window.getByRole('button', { name: '新建', exact: true }).click()
  const nameBox = ctx.window.getByLabel('作品名称')
  await nameBox.waitFor({ state: 'visible', timeout: 10_000 })
  await nameBox.fill('multi-window-workspace')
  await ctx.window.getByRole('button', { name: '创建', exact: true }).click()
  await ctx.window.getByRole('navigation', { name: '稿件目录' }).waitFor({ state: 'visible', timeout: 45_000 })
  await ctx.window.locator('.tree-row', { hasText: '001.md' }).first().click()
  const firstEditor = ctx.window.getByRole('textbox', { name: '正文' })
  await firstEditor.waitFor({ state: 'visible', timeout: 30_000 })
  const secondWindow = ctx.app.waitForEvent('window')
  await ctx.window.keyboard.press('Control+Shift+N')
  const second = await Promise.race([
    secondWindow,
    delay(30_000).then(() => { throw new Error('second window was not created within 30 seconds') }),
  ])
  try {
    await second.waitForFunction(() => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell')), undefined, { timeout: 90_000 })
  } catch (error) {
    throw new Error(`second window shell did not mount: ${JSON.stringify(await readWindowDiagnostic(second, []))}; ${error instanceof Error ? error.message : String(error)}`)
  }
  const firstUrl = new URL(ctx.window.url())
  const secondUrl = new URL(second.url())
  if (firstUrl.origin !== secondUrl.origin || firstUrl.port !== secondUrl.port) {
    throw new Error(`windows did not share DSH origin: ${firstUrl.href} vs ${secondUrl.href}`)
  }
  await second.getByRole('navigation', { name: '稿件目录' }).waitFor({ state: 'visible', timeout: 45_000 })
  await second.locator('.tree-row', { hasText: '001.md' }).first().click()
  const secondEditor = second.getByRole('textbox', { name: '正文' })
  await secondEditor.waitFor({ state: 'visible', timeout: 30_000 })

  const firstText = '# 第一窗口版本\n\n由第一窗口保存。\n'
  const staleText = '# 第二窗口草稿\n\n发生冲突时必须保留。\n'
  await firstEditor.fill(firstText)
  await waitForFileText(resolve(multiWindowWorkspace, '正文', '001.md'), firstText)
  await secondEditor.fill(staleText)
  await second.waitForFunction(() => document.querySelector('.editor-header')?.textContent?.includes('版本冲突'), undefined, { timeout: 30_000 })
  if (await secondEditor.inputValue() !== staleText) throw new Error('stale second-window draft was not preserved')
  if (await readFile(resolve(multiWindowWorkspace, '正文', '001.md'), 'utf8') !== firstText) {
    throw new Error('stale second-window save overwrote the first-window disk version')
  }
  await second.close()
  if (ctx.window.isClosed()) throw new Error('remaining window closed after closing the second window')
  await ctx.window.waitForFunction(() => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell')), undefined, { timeout: 15_000 })
  const remaining = await ctx.window.evaluate(() => ({
    title: document.title,
    shell: Boolean(document.querySelector('.shell')),
    href: location.href,
  }))
  if (!remaining.shell || remaining.title !== 'DSH Editor' || new URL(remaining.href).origin !== firstUrl.origin) {
    throw new Error(`remaining window was not responsive: ${JSON.stringify(remaining)}`)
  }
}))

const report = { ok: true, source: 'current', phases }
await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
