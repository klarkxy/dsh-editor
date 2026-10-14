import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'
import { assertDefaultPluginPage, closePluginsPage, openPluginsPage, openWebSearchSettings, openWritingPresets } from './helpers/plugin-page.mjs'
import { S } from './helpers/selectors.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.pack', 'desktop-e2e')
resolveDshInstallation('0.2.0-rc.2')
const e2eHomeRoot = resolve(root, '.dev', 'desktop-e2e-home')
const template = resolve(root, '.dev', 'desktop-profile-template')
const electronDist = resolve(root, 'apps', 'desktop', 'node_modules', 'electron', 'dist')
const electronExecutable = process.platform === 'darwin'
  ? resolve(electronDist, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  : resolve(electronDist, 'electron.exe')
const main = resolve(root, 'apps', 'desktop', 'dist', 'main.js')
// Selectors passed into page.evaluate/waitForFunction callbacks (S is not
// visible inside the page context).
const DOM = {
  SHELL: S.shell, DIALOG: S.dialog, BRAND: S.brandLockup, CHECKING: S.workspaceChecking,
  HOME: S.homeStage, TREE: S.tree, ALERT: S.alert, SHELL_ERROR: S.shellError,
  SAVE_STATE: S.paperSaveState, NOTICE: S.paperNotice, PAPER_PATH: S.paperPath,
  CONFLICT_COPY: S.paperSaveConflictCopy, SETTINGS_BUTTON: S.nativeSettingsButton,
}

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

async function waitForPath(path, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return
    await delay(100)
  }
  throw new Error(`path did not appear within ${timeoutMs}ms: ${path}`)
}

async function openTreeFile(page, directory, file) {
  // A second window may open with the writing assistant over the manuscript tree.
  const dismissAssistant = page.getByRole('button', { name: '隐藏写作搭档' })
  if (await dismissAssistant.isVisible()) {
    await dismissAssistant.click()
    await dismissAssistant.waitFor({ state: 'hidden', timeout: 10_000 })
  }
  const folder = page.locator(S.treeRow, { hasText: directory }).first()
  // 4.2: display names hide .md/.txt; data-tree-path keeps the full path.
  const fileRow = page.locator(S.treePath(`${directory}/${file}`)).first()
  await folder.waitFor({ state: 'visible', timeout: 20_000 })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (await fileRow.isVisible()) {
      await fileRow.click()
      return
    }
    if (await folder.getAttribute('aria-expanded') !== 'true') await folder.click()
    await delay(200)
  }
  throw new Error(`tree file ${file} did not become visible under ${directory}`)
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

async function assertNewProjectHasNoManuscriptFolder(page, workspace) {
  await page.locator(S.treeEmpty).waitFor({ state: 'visible', timeout: 20_000 })
  for (const extra of ['正文', '大纲', '人物卡', '世界书']) {
    if (existsSync(resolve(workspace, extra))) throw new Error(`new project should not pre-create ${extra}`)
    if (await page.locator(S.tree).getByText(extra, { exact: true }).count()) {
      throw new Error(`new project should not pre-seed ${extra}`)
    }
  }
}

async function createRootFolderFromTree(page, name) {
  const tree = page.locator(S.tree)
  const box = await tree.boundingBox()
  if (!box) throw new Error('tree missing')
  await tree.click({ button: 'right', position: { x: 16, y: Math.max(12, box.height - 18) } })
  await page.getByRole('menu', { name: '文档操作' }).getByRole('menuitem', { name: '新建文件夹' }).click()
  const dialog = page.getByRole('dialog', { name: '新建文件夹' })
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.getByLabel('文件夹名称').fill(name)
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await dialog.waitFor({ state: 'detached', timeout: 15_000 })
  await page.locator(S.treeRow).filter({ hasText: name }).first().waitFor({ state: 'visible', timeout: 20_000 })
}

const baseEnv = {
  ...process.env,
  DSH_TELEMETRY_DISABLED: '1',
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: resolve(root, '.dev', 'desktop-dsh-runtime-0.2.0-rc.2', 'lib', 'bin.js'),
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
      console.log(`[desktop-e2e] ${name}: initial page loaded`)
      await window.waitForFunction(({ SHELL }) => document.title === 'DSH Editor' && Boolean(document.querySelector(SHELL)), DOM, { timeout: 90_000 })
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
    const state = await window.evaluate(({ SHELL, DIALOG, BRAND, SETTINGS_BUTTON }) => ({
      body: document.querySelector(SHELL)?.textContent ?? '',
      title: document.title,
      shell: Boolean(document.querySelector(SHELL)),
      settings: Boolean(document.querySelector(DIALOG)),
      settingsControl: [...document.querySelectorAll(SETTINGS_BUTTON)].some((button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').includes('设置')),
      officialHome: document.querySelector(SHELL)?.textContent?.includes('DeepSeek Harness') ?? false,
      editorName: Boolean(document.querySelector(BRAND)),
      bootEntries: globalThis.__DSH_BOOT__?.entries?.map((entry) => entry.id) ?? [],
      width: window.innerWidth,
      height: window.innerHeight,
    }), DOM)
    try {
      await inspect({ ...state, nativeOnboarding }, { app, window })
    } catch (error) {
      await writeFile(resolve(output, `${name}-failure-dom.txt`), await window.locator(S.body).innerText()).catch(() => {})
      throw new Error(`${error instanceof Error ? error.message : String(error)}; browserErrors: ${JSON.stringify(browserErrors.slice(-20))}; processLogs: ${JSON.stringify(processLogs.slice(-30))}`)
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

  // Global settings and plugin management have separate entry points.
  const window = ctx.window
  await window.locator(S.nativeSettingsTrigger).click()
  const dialog = window.locator(S.settingsDialog)
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.locator(S.settingsNavSection('appearance')).waitFor({ state: 'visible', timeout: 5_000 })
  await dialog.locator(S.settingsNavSection('models')).click()
  await dialog.locator('section.models-page').waitFor({ state: 'visible', timeout: 10_000 })
  // 冷启动时 llm.listConfigurableProviders 要经过刚部署的 profile + 运行时
  // 插件初始化，15s 可能仍在读；先等供应商区块脱离「正在读取」再断言内容。
  try {
    await window.waitForFunction(
      ({ DIALOG }) => {
        const text = document.querySelector(DIALOG)?.textContent ?? ''
        return text.includes('DeepSeek') || !text.includes('正在读取')
      },
      { DIALOG: S.settingsDialog },
      { timeout: 60_000 },
    )
  } catch {
    throw new Error(`settings models section did not finish loading: ${(await dialog.textContent())?.slice(0, 400)}`)
  }
  const modelsText = await dialog.textContent() ?? ''
  if (!modelsText.includes('DeepSeek')) {
    throw new Error(`settings models section did not list the DeepSeek provider: ${modelsText.slice(0, 400)}`)
  }
  await dialog.locator(S.settingsNavSection('writing')).click()
  await dialog.getByRole('radio').first().waitFor({ state: 'visible', timeout: 10_000 })
  const writingRadios = await dialog.getByRole('radio').count()
  if (writingRadios < 2) throw new Error('settings writing section lost the completion radios')
  await window.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
  const pluginsPage = await openPluginsPage(window)
  const bundles = await assertDefaultPluginPage(window, pluginsPage)
  for (const name of ['dsh-manuscript', 'dsh-editor-shell', 'dsh-editor-plugins']) {
    const bundle = bundles.find(item => item.name === name)
    if (!bundle?.enabled || bundle.readOnlyReason !== 'management-required') throw new Error(`native manager lost the required core guard: ${name}`)
  }
  await openWebSearchSettings(pluginsPage)
  const presets = await openWritingPresets(pluginsPage)
  const presetSwitch = presets.locator(S.pluginsPresetToggleNovel)
  await presetSwitch.waitFor({ state: 'visible', timeout: 10_000 })
  if ((await presetSwitch.getAttribute('aria-checked')) !== 'true') throw new Error('小说创作 writing preset should be enabled by default')
  const lockedCore = presets.locator(S.pluginsPresetWriting)
  await lockedCore.locator(S.pluginsCatalogPresetLocked).filter({ hasText: '必需' }).waitFor()
  if (await lockedCore.locator(S.switchAny).count()) throw new Error('core writing preset exposes a toggle')
  await closePluginsPage(window)
}))

phases.push(await launchPhase('multi-window', { DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key' }, async (state, ctx) => {
  const onboarding = state.body.includes('新建') && state.body.includes('打开作品')
  if (!state.shell || state.officialHome || !state.editorName || !onboarding) {
    throw new Error(`multi-window home assertion failed: ${JSON.stringify({ ...state, body: undefined, onboarding })}`)
  }
  await ctx.window.getByRole('button', { name: '新建作品' }).first().click()
  const nameBox = ctx.window.getByLabel('作品名称')
  await nameBox.waitFor({ state: 'visible', timeout: 10_000 })
  await nameBox.fill('multi-window-workspace')
  await ctx.window.getByRole('button', { name: '创建', exact: true }).click()
  try {
    await ctx.window.getByRole('tree', { name: '稿件目录' }).waitFor({ state: 'visible', timeout: 45_000 })
  } catch (error) {
    const body = await ctx.window.evaluate(({ SHELL, CHECKING, HOME, TREE, ALERT, SHELL_ERROR }) => ({
      text: document.body.innerText.slice(0, 1200),
      shellClass: document.querySelector(SHELL)?.className ?? null,
      checking: Boolean(document.querySelector(CHECKING)),
      home: Boolean(document.querySelector(HOME)),
      tree: Boolean(document.querySelector(TREE)),
      errors: [...document.querySelectorAll(ALERT)].map((node) => node.textContent?.slice(0, 200)),
      shellError: document.querySelector(SHELL_ERROR)?.textContent?.slice(0, 400) ?? null,
    }), DOM).catch((error) => ({ evaluateError: error instanceof Error ? error.message : String(error) }))
    await ctx.window.screenshot({ path: resolve(output, 'multi-window-create-failure.png') }).catch(() => undefined)
    throw new Error(`manuscript tree did not appear after 新建: ${JSON.stringify(body)}; ${error instanceof Error ? error.message : String(error)}`)
  }
  // New works start empty. 正文 is an ordinary folder created from the tree, not mkdir.
  await assertNewProjectHasNoManuscriptFolder(ctx.window, multiWindowWorkspace)
  await createRootFolderFromTree(ctx.window, '正文')
  await ctx.window.locator(S.treeRow).filter({ hasText: '正文' }).first().hover()
  await ctx.window.getByRole('button', { name: '在 正文 中新建文件', exact: true }).click()
  const chapterNameBox = ctx.window.getByLabel('文件名称（无扩展名时按 .md 创建）')
  await chapterNameBox.waitFor({ state: 'visible', timeout: 10_000 })
  await chapterNameBox.fill('001')
  await ctx.window.getByRole('button', { name: '创建', exact: true }).click()
  await waitForPath(resolve(multiWindowWorkspace, '正文', '001.md'))
  // The create flow opens the document directly; the tree starts collapsed.
  const firstEditor = ctx.window.locator(S.paperEditor)
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
    await second.waitForFunction(({ SHELL }) => document.title === 'DSH Editor' && Boolean(document.querySelector(SHELL)), DOM, { timeout: 90_000 })
  } catch (error) {
    throw new Error(`second window shell did not mount: ${JSON.stringify(await readWindowDiagnostic(second, []))}; ${error instanceof Error ? error.message : String(error)}`)
  }
  const firstUrl = new URL(ctx.window.url())
  const secondUrl = new URL(second.url())
  if (firstUrl.origin !== secondUrl.origin || firstUrl.port !== secondUrl.port) {
    throw new Error(`windows did not share DSH origin: ${firstUrl.href} vs ${secondUrl.href}`)
  }
  await second.getByRole('tree', { name: '稿件目录' }).waitFor({ state: 'visible', timeout: 45_000 })
  await openTreeFile(second, '正文', '001.md')
  const secondEditor = second.locator(S.paperEditor)
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
  await second.locator(S.paperSaveState, { hasText: '版本冲突' }).waitFor({ timeout: 30_000 })
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
  await ctx.window.waitForFunction(({ SHELL }) => document.title === 'DSH Editor' && Boolean(document.querySelector(SHELL)), DOM, { timeout: 15_000 })
  const remaining = await ctx.window.evaluate(({ SHELL }) => ({
    title: document.title,
    shell: Boolean(document.querySelector(SHELL)),
    href: location.href,
  }), DOM)
  if (!remaining.shell || remaining.title !== 'DSH Editor' || new URL(remaining.href).origin !== firstUrl.origin) {
    throw new Error(`remaining window was not responsive: ${JSON.stringify(remaining)}`)
  }
}))

// Restart the entire Electron/DSH process against the same home, not just a React remount.
phases.push(await launchPhase('multi-window', { DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key' }, async (_state, ctx) => {
  try {
    await ctx.window.getByRole('tree', { name: '稿件目录' }).waitFor({ state: 'visible', timeout: 45_000 })
  } catch (error) {
    const body = await ctx.window.evaluate(({ SHELL, CHECKING, HOME, TREE, SHELL_ERROR }) => ({
      text: document.body.innerText.slice(0, 1200),
      shellClass: document.querySelector(SHELL)?.className ?? null,
      checking: Boolean(document.querySelector(CHECKING)),
      home: Boolean(document.querySelector(HOME)),
      tree: Boolean(document.querySelector(TREE)),
      shellError: document.querySelector(SHELL_ERROR)?.textContent?.slice(0, 400) ?? null,
    }), DOM).catch((evaluateError) => ({ evaluateError: evaluateError instanceof Error ? evaluateError.message : String(evaluateError) }))
    await ctx.window.screenshot({ path: resolve(output, 'multi-window-resume-failure.png') }).catch(() => undefined)
    throw new Error(`manuscript tree did not appear after restart: ${JSON.stringify(body)}; ${error instanceof Error ? error.message : String(error)}`)
  }
  const editor = ctx.window.locator(S.paperEditor)
  if (!await editor.isVisible()) await openTreeFile(ctx.window, '正文', '001.md')
  await editor.waitFor({ state: 'visible', timeout: 30_000 })
  const backups = ctx.window.locator(S.paperDraftBackups)
  await backups.waitFor({ state: 'visible', timeout: 15_000 })
  const disk = await readFile(resolve(multiWindowWorkspace, '正文', '001.md'), 'utf8')
  const before = await editor.evaluate(el => el.__cmView.state.doc.toString())
  if (before !== disk) throw new Error('another window draft was silently applied on restart')
  await backups.getByRole('button').first().click()
  await ctx.window.locator(S.paperSaveState, { hasText: '版本冲突' }).waitFor({ timeout: 15_000 })
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
  await ctx.window.getByRole('tree', { name: '稿件目录' }).waitFor({ state: 'visible', timeout: 45_000 })
  if (!await editor.isVisible()) await openTreeFile(ctx.window, '正文', '001.md')
  await ctx.window.locator(S.paperSaveState, { hasText: '版本冲突' }).waitFor({ timeout: 15_000 })
  // Reload restore schedules the same 250 ms host-draft put as adoptBackup.
  // Clicking 另存冲突副本 before that put lands lets delete run, then the
  // delayed put recreates the conflict draft and remount restores 版本冲突.
  await ctx.window.waitForTimeout(1_000)
  await ctx.window.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
  if (await readFile(resolve(multiWindowWorkspace, '正文', '001.md'), 'utf8') !== disk) throw new Error('reloaded conflict bypassed version protection')
  if (!(await editor.evaluate(el => el.__cmView.state.doc.toString())).includes('第二窗口草稿')) throw new Error('reloaded conflict draft lost its text')
  await ctx.window.screenshot({ path: resolve(output, 'draft-recovery.png'), fullPage: true })
  // Complete the author workflow before closing: preserve the recovered draft
  // as a conflict copy, then leave the original document in a clean state.
  await ctx.window.locator(S.paperSaveConflictCopy).click()
  try {
    await ctx.window.locator(S.paperSaveState, { hasText: '已保存' }).waitFor({ state: 'visible', timeout: 15_000 })
  } catch (error) {
    const names = await readdir(resolve(multiWindowWorkspace, '正文')).catch(() => [])
    const ui = await ctx.window.evaluate(({ SAVE_STATE, NOTICE, PAPER_PATH, CONFLICT_COPY }) => ({
      saveStates: [...document.querySelectorAll(SAVE_STATE)].map((node) => node.textContent ?? ''),
      notice: document.querySelector(NOTICE)?.textContent ?? '',
      path: document.querySelector(PAPER_PATH)?.textContent ?? '',
      conflictCopy: Boolean(document.querySelector(CONFLICT_COPY)),
    }), DOM).catch((evaluateError) => ({ evaluateError: evaluateError instanceof Error ? evaluateError.message : String(evaluateError) }))
    await ctx.window.screenshot({ path: resolve(output, 'conflict-copy-timeout.png'), fullPage: true }).catch(() => undefined)
    throw new Error(`conflict copy did not reach 已保存: ${JSON.stringify({ ui, files: names })}; ${error instanceof Error ? error.message : String(error)}`)
  }
  const copies = (await readdir(resolve(multiWindowWorkspace, '正文'))).filter(name => /^001\.冲突-.*\.md$/.test(name))
  if (copies.length !== 1) throw new Error('conflict copy was not created exactly once')
  const copied = await readFile(resolve(multiWindowWorkspace, '正文', copies[0]), 'utf8')
  if (!copied.includes('第二窗口草稿')) throw new Error('conflict copy lost recovered text')
  if (await readFile(resolve(multiWindowWorkspace, '正文', '001.md'), 'utf8') !== disk) throw new Error('saving conflict copy modified the original')
}))

const report = { ok: true, source: 'current', phases }
await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
