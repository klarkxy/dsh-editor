import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.pack', 'desktop-e2e')
resolveDshInstallation('0.1.1-rc.2')
const e2eHomeRoot = resolve(root, '.dev', 'desktop-e2e-home')
const template = resolve(root, '.dev', 'desktop-profile-template')
const electronDist = resolve(root, 'apps', 'desktop', 'node_modules', 'electron', 'dist')
const electronExecutable = process.platform === 'darwin'
  ? resolve(electronDist, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  : resolve(electronDist, 'electron.exe')
const main = resolve(root, 'apps', 'desktop', 'dist', 'main.js')

function run(script, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, env, stdio: 'inherit', windowsHide: true })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`desktop preparation exited ${code}`)))
  })
}

// pnpm 在全新环境(如 CI runner)会跑 electron 的 postinstall,但其 install.js
// 依赖的 extract-zip@2 解 Electron 这种大 zip 会静默挂死(promise 不 settle,
// dist 里只留下部分文件)。这里改用 @electron/get 下载 + 系统解压器兜底。
if (!existsSync(electronExecutable)) {
  console.log(`[desktop-e2e] Electron dist missing, downloading: ${electronExecutable}`)
  const electronPackageDir = await realpath(resolve(root, 'apps', 'desktop', 'node_modules', 'electron'))
  const electronRequire = createRequire(resolve(electronPackageDir, 'install.js'))
  const { downloadArtifact } = electronRequire('@electron/get')
  const { version } = electronRequire('./package.json')
  const zipPath = await downloadArtifact({ version, artifactName: 'electron' })
  await rm(electronDist, { recursive: true, force: true })
  await mkdir(electronDist, { recursive: true })
  if (process.platform === 'win32') {
    const escaped = (value) => value.replaceAll("'", "''")
    await new Promise((resolvePromise, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${escaped(zipPath)}' -DestinationPath '${escaped(electronDist)}' -Force`], { stdio: 'inherit', windowsHide: true })
      child.on('error', reject)
      child.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`Expand-Archive exited ${code}`)))
    })
  } else {
    await new Promise((resolvePromise, reject) => {
      const child = spawn('unzip', ['-q', zipPath, '-d', electronDist], { stdio: 'inherit' })
      child.on('error', reject)
      child.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`unzip exited ${code}`)))
    })
  }
  if (!existsSync(electronExecutable)) {
    throw new Error(`Electron dist still missing after manual download: ${electronExecutable}`)
  }
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
// VS Code 集成终端会给子进程注入 ELECTRON_RUN_AS_NODE=1,Electron 会把
// main.js 当普通 Node 跑并秒退(Playwright 只报 "Process failed to launch!")。
delete baseEnv.ELECTRON_RUN_AS_NODE

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
    try {
      await inspect({ ...state, nativeOnboarding }, { app, window })
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; processLogs: ${JSON.stringify(processLogs.slice(-30))}`)
    }
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
  if (!state.shell || state.officialHome || !state.editorName || !onboarding || !state.settingsControl) {
    throw new Error(`first-run home assertion failed: ${JSON.stringify({ ...state, body: undefined, onboarding })}`)
  }
}))

phases.push(await launchPhase('configured-home', { DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key' }, async (state, ctx) => {
  const onboarding = state.body.includes('新建') && state.body.includes('打开作品')
  const settingsEntry = state.settingsControl
  const technicalChrome = ['DeepSeek Harness', 'DSH_HOME', 'permission preset', '权限模式', '会话列表'].some((label) => state.body.includes(label))
  const clientBoundaryReady = state.bootEntries.filter((entry) => entry === 'dsh-editor-shell').length === 1
    && state.bootEntries.every((entry) => entry !== 'dsh-editor-workbench' && entry !== 'dsh-editor-novel-kernel')
  if (!state.shell || !state.editorName || state.officialHome || !onboarding || !settingsEntry || technicalChrome || !clientBoundaryReady) {
    throw new Error(`configured home assertion failed: ${JSON.stringify({ ...state, body: undefined, onboarding, settingsEntry, technicalChrome, clientBoundaryReady })}`)
  }

  // The editor owns the settings dialog now: open it from the topbar trigger,
  // walk the three tabs, and close it again.
  const window = ctx.window
  await window.locator('.native-settings-control button[aria-haspopup="dialog"]').click()
  const dialog = window.locator('.shell .settings-dialog')
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.getByRole('button', { name: '通用设置', exact: true }).waitFor({ state: 'visible', timeout: 5_000 })
  await dialog.getByRole('button', { name: '模型', exact: true }).click()
  await window.waitForTimeout(600)
  const modelsText = await dialog.textContent()
  if (!modelsText?.includes('DeepSeek')) throw new Error('settings models tab did not list the DeepSeek provider')
  await dialog.getByRole('button', { name: '写作', exact: true }).click()
  await window.waitForTimeout(400)
  const writingRadios = await dialog.getByRole('radio').count()
  if (writingRadios < 2) throw new Error('settings writing tab lost the completion radios')
  await window.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached', timeout: 10_000 })
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
  // New works start with an empty manuscript: create the first chapter through the cover affordance.
  await ctx.window.getByRole('button', { name: '新建文件', exact: true }).first().click()
  const chapterNameBox = ctx.window.getByLabel('文件名称（无扩展名时按 .md 创建）')
  await chapterNameBox.waitFor({ state: 'visible', timeout: 10_000 })
  await chapterNameBox.fill('001')
  await ctx.window.getByRole('button', { name: '创建', exact: true }).click()
  // The create flow opens the document directly; the tree starts collapsed.
  const firstEditor = ctx.window.locator('[data-testid="paper-editor"]')
  await firstEditor.waitFor({ state: 'visible', timeout: 30_000 })
  const secondWindow = ctx.app.waitForEvent('window')
  // Drive the shortcut through Electron's own input pipeline: synthetic CDP key
  // events do not reliably trigger before-input-event in this environment.
  await ctx.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: ['control', 'shift'] })
  })
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
  await second.locator('.tree-row', { hasText: '正文' }).first().click()
  await second.locator('.tree-row', { hasText: '001.md' }).first().click()
  const secondEditor = second.locator('[data-testid="paper-editor"]')
  await secondEditor.waitFor({ state: 'visible', timeout: 30_000 })

  const firstText = '# 第一窗口版本\n\n由第一窗口保存。\n'
  const staleText = '# 第二窗口草稿\n\n发生冲突时必须保留。\n'
  // The paper is a CodeMirror view, not a textarea: write through the
  // `__cmView` test handle so the change goes through the normal dispatch
  // → updateListener → React autosave pipeline.
  const setEditorText = (editor, text) => editor.evaluate((el, next) => {
    const view = /** @type {any} */ (el).__cmView
    if (!view) throw new Error('paper editor: __cmView missing')
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
  }, text)
  const getEditorText = (editor) => editor.evaluate((el) => {
    const view = /** @type {any} */ (el).__cmView
    return view ? view.state.doc.toString() : ''
  })
  await setEditorText(firstEditor, firstText)
  await waitForFileText(resolve(multiWindowWorkspace, '正文', '001.md'), firstText)
  await setEditorText(secondEditor, staleText)
  await second.locator('[data-testid="paper-save-state"]', { hasText: '版本冲突' }).waitFor({ timeout: 30_000 })
  if (await getEditorText(secondEditor) !== staleText) throw new Error('stale second-window draft was not preserved')
  if (await readFile(resolve(multiWindowWorkspace, '正文', '001.md'), 'utf8') !== firstText) {
    throw new Error('stale second-window save overwrote the first-window disk version')
  }
  const ownerIds = await Promise.all([ctx.window, second].map((page) => page.evaluate(() => sessionStorage.getItem('dsh-editor:draft-owner'))))
  if (!ownerIds[0] || !ownerIds[1] || ownerIds[0] === ownerIds[1]) throw new Error('windows share a draft owner')
  // A later save in A must not erase B's durable conflict draft.
  const latestText = firstText + '第一窗口继续保存。\n'
  await setEditorText(firstEditor, latestText)
  await waitForFileText(resolve(multiWindowWorkspace, '正文', '001.md'), latestText)
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

// Restart the entire Electron/DSH process against the same home, not just a React remount.
phases.push(await launchPhase('multi-window', { DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key' }, async (_state, ctx) => {
  await ctx.window.getByRole('navigation', { name: '稿件目录' }).waitFor({ state: 'visible', timeout: 45_000 })
  const editor = ctx.window.locator('[data-testid="paper-editor"]')
  if (!await editor.isVisible()) {
    const chapter = ctx.window.locator('.tree-row', { hasText: '001.md' }).first()
    if (!await chapter.isVisible()) await ctx.window.locator('.tree-row', { hasText: '正文' }).first().click()
    await chapter.click()
  }
  await editor.waitFor({ state: 'visible', timeout: 30_000 })
  const backups = ctx.window.locator('[data-testid="paper-draft-backups"]')
  await backups.waitFor({ state: 'visible', timeout: 15_000 })
  const disk = await readFile(resolve(multiWindowWorkspace, '正文', '001.md'), 'utf8')
  const before = await editor.evaluate(el => el.__cmView.state.doc.toString())
  if (before !== disk) throw new Error('another window draft was silently applied on restart')
  await backups.getByRole('button').first().click()
  await ctx.window.locator('[data-testid="paper-save-state"]', { hasText: '版本冲突' }).waitFor({ timeout: 15_000 })
  const recovered = await editor.evaluate(el => el.__cmView.state.doc.toString())
  if (!recovered.includes('第二窗口草稿')) throw new Error('restart did not recover the second-window draft')
  if (await readFile(resolve(multiWindowWorkspace, '正文', '001.md'), 'utf8') !== disk) throw new Error('draft recovery overwrote the newer disk version')
  // Allow the normal 250 ms draft debounce to persist the adopted conflict.
  await ctx.window.waitForTimeout(1_000)
  // Electron may resolve beforeunload before CDP's handler runs. Handle that
  // specific dialog race locally so Playwright's auto-handler cannot crash the runner.
  ctx.window.on('dialog', dialog => {
    void dialog.accept().catch(error => {
      if (!String(error).includes('No dialog is showing')) throw error
    })
  })
  // The test explicitly chooses to leave after the conflict draft is durable.
  await ctx.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.once('will-prevent-unload', event => event.preventDefault())
  })
  await ctx.window.reload()
  await ctx.window.getByRole('navigation', { name: '稿件目录' }).waitFor({ state: 'visible', timeout: 45_000 })
  if (!await editor.isVisible()) {
    const chapter = ctx.window.locator('.tree-row', { hasText: '001.md' }).first()
    if (!await chapter.isVisible()) await ctx.window.locator('.tree-row', { hasText: '正文' }).first().click()
    await chapter.click()
  }
  await ctx.window.locator('[data-testid="paper-save-state"]', { hasText: '版本冲突' }).waitFor({ timeout: 15_000 })
  await ctx.window.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
  if (await readFile(resolve(multiWindowWorkspace, '正文', '001.md'), 'utf8') !== disk) throw new Error('reloaded conflict bypassed version protection')
  if (!(await editor.evaluate(el => el.__cmView.state.doc.toString())).includes('第二窗口草稿')) throw new Error('reloaded conflict draft lost its text')
  await ctx.window.screenshot({ path: resolve(output, 'draft-recovery.png'), fullPage: true })
  // Complete the author workflow before closing: preserve the recovered draft
  // as a conflict copy, then leave the original document in a clean state.
  await ctx.window.locator('[data-testid="paper-save-conflict-copy"]').click()
  await ctx.window.locator('[data-testid="paper-save-state"]', { hasText: '已保存' }).waitFor({ timeout: 15_000 })
  const copies = (await readdir(resolve(multiWindowWorkspace, '正文'))).filter(name => /^001\.冲突-.*\.md$/.test(name))
  if (copies.length !== 1) throw new Error('conflict copy was not created exactly once')
  const copied = await readFile(resolve(multiWindowWorkspace, '正文', copies[0]), 'utf8')
  if (!copied.includes('第二窗口草稿')) throw new Error('conflict copy lost recovered text')
  if (await readFile(resolve(multiWindowWorkspace, '正文', '001.md'), 'utf8') !== disk) throw new Error('saving conflict copy modified the original')
}))

const report = { ok: true, source: 'current', phases }
await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
