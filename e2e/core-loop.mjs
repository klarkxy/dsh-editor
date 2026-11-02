/**
 * Core author loop smoke test for the DSH Editor shell.
 *
 * Boots DSH under the dedicated `dsh-editor` profile with an isolated
 * DSH_HOME, drives the home → workbench → editor → chat flow with no
 * external model, then tears everything down. The script never calls the
 * paid model turn; chat interactions are limited to UI smoke and the
 * ghost FIM stays on its default `manual` preference so the
 * completion-only path is exercised but does not block on a missing key.
 *
 * Replaces the previous `e2e/workbench.mjs` (which covered features that
 * have been removed from the shell: snapshots, imports, exports, search,
 * archive, worldbook settings, shortcut dialog) and `e2e/shell-web.mjs`
 * (whose `first-run-home` and `configured-home` probes were folded into
 * the new home assertions below).
 */
import { spawn } from 'node:child_process'
import { mkdir, rename, rm, stat, writeFile, readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'
import { S } from './helpers/selectors.mjs'
import { toggleTheme } from './helpers/theme.mjs'

const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const projectsRoot = resolve(devRoot, 'core-loop-projects')
const home = resolve(devRoot, 'core-loop-home')
const output = resolve(root, 'e2e', 'out', 'core-loop')
const targetWorkspace = resolve(projectsRoot, 'core-loop-workspace')

for (const target of [projectsRoot, home, output, targetWorkspace]) {
  if (!target.startsWith(`${devRoot}${sep}`) && !target.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) {
    throw new Error(`unsafe path: ${target}`)
  }
}

resolveDshInstallation('0.2.1-rc.5')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime-0.2.1-rc.5')
const cli = resolve(runtime, 'lib', 'bin.js')

const failures = []
let browser
let dshChild

// Selectors passed into page.evaluate/waitForFunction callbacks (S is not
// visible inside the page context).
const DOM = {
  SHELL: S.shell, HOME_STAGE: S.homeStage, TREE: S.tree, SIDEBAR: S.filesRail,
  EDITOR_AREA: S.editorArea, PAPER_EDITOR: S.paperEditor, PAPER_GHOST: S.paperGhost,
  PAPER_SAVE: S.paperSaveState, PAPER_WORDS: S.paperWordcount, PAPER_PATH: S.paperPath,
  CHAT: S.chatRail, COMPOSER: S.composerInputInner, THEME: S.themeToggle,
  SHELL_THEME: S.shellTheme, OVERVIEW: S.overviewPanel, OVERVIEW_BODY: S.overviewBody,
  OVERVIEW_LOADING: S.overviewLoading,
  MEMORY: S.memoryPanel, MEMORY_LIST: S.memoryList, MEMORY_STATUS: S.memoryStatus,
}

function note(label, detail = '') {
  console.log(`[core-loop] ${label}${detail ? ` — ${detail}` : ''}`)
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(5_000).then(() => false),
  ])
  if (!exited && process.platform === 'win32' && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('error', () => resolve())
      killer.once('exit', () => resolve())
    })
  }
}

async function exists(target) { return stat(target).then(() => true, () => false) }

async function waitFor(check, label, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(120)
  }
  throw new Error(`timed out: ${label}`)
}

async function startDsh(env) {
  const logs = []
  const child = spawn(process.execPath, [cli, '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const ready = new Promise((resolve, reject) => {
    let buffer = ''
    const inspect = (chunk) => {
      const text = String(chunk)
      logs.push(text)
      void writeFile(output + '/host.log', logs.join('')).catch(() => undefined)
      buffer += text
      const match = /https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/.exec(buffer)
      if (match) resolve(new URL(match[0]))
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`DSH exited before readiness (${code}): ${logs.join('').slice(-4_000)}`)))
  })
  const url = await Promise.race([
    ready,
    delay(60_000).then(() => { throw new Error(`DSH readiness timed out: ${logs.join('').slice(-4_000)}`) }),
  ])
  return { child, url }
}

async function dismissNativeOnboarding(page) {
  const continueNotice = page.getByRole('button', { name: '继续', exact: true })
  for (let step = 0; step < 5; step += 1) {
    const visible = await continueNotice.isVisible({ timeout: 1_000 }).catch(() => false)
    if (!visible) break
    await continueNotice.click()
    await page.waitForTimeout(250)
  }
  const configureLater = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await configureLater.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await configureLater.click()
  }
}

async function readState(page) {
  return page.evaluate(({ SHELL, HOME_STAGE, TREE, SIDEBAR, EDITOR_AREA, PAPER_EDITOR, PAPER_GHOST, PAPER_SAVE, PAPER_WORDS, PAPER_PATH, CHAT, COMPOSER, THEME }) => {
    const theme = document.documentElement.getAttribute('data-theme') || ''
    const stored = globalThis.localStorage?.getItem('dsh-editor.theme') || ''
    const title = document.title
    const shell = Boolean(document.querySelector(SHELL))
    const homeStage = Boolean(document.querySelector(HOME_STAGE))
    const tree = Boolean(document.querySelector(TREE))
    const sidebar = Boolean(document.querySelector(SIDEBAR))
    const editorSection = Boolean(document.querySelector(EDITOR_AREA))
    const editorEl = document.querySelector(PAPER_EDITOR)
    const cmView = editorEl && /** @type {any} */ (editorEl).__cmView
    const ghost = Boolean(document.querySelector(PAPER_GHOST))
    const saveState = document.querySelector(PAPER_SAVE)?.textContent || ''
    const wordCount = document.querySelector(PAPER_WORDS)?.textContent || ''
    const headerPath = document.querySelector(PAPER_PATH)?.textContent || ''
    const chat = document.querySelector(CHAT)
    const composer = chat?.querySelector(COMPOSER) || null
    const placeholder = composer?.getAttribute('placeholder') || ''
    const themeToggle = document.querySelector(THEME)?.getAttribute('aria-label') || ''
    const themeToggleText = document.querySelector(THEME)?.textContent?.trim() || ''
    return {
      theme, stored, title, shell, homeStage, tree, sidebar, editorSection,
      editorValue: cmView ? cmView.state.doc.toString() : '',
      ghost, saveState, wordCount, headerPath,
      composerVisible: Boolean(composer),
      composerPlaceholder: placeholder,
      chatVisible: chat ? !chat.hasAttribute('hidden') : false,
      themeToggleLabel: themeToggle,
      themeToggleText,
    }
  }, DOM)
}

await rm(projectsRoot, { recursive: true, force: true })
await rm(home, { recursive: true, force: true })
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await mkdir(resolve(home, 'electron-user-data'), { recursive: true })

const env = {
  ...process.env,
  DSH_TELEMETRY_DISABLED: '1',
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: cli,
  DSH_DESKTOP_PROFILE_TEMPLATE: template,
  DSH_HOME: home,
  DSH_EDITOR_PROJECTS_ROOT: projectsRoot,
  DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
  SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-core-loop',
  DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key',
}
delete env.DSH_EDITOR_CUSTOM_API_KEY
const profileRoot = await deployProfile(home, template, resolve(runtime, 'node_modules'))
const templateComposition = JSON.parse(await readFile(resolve(template, 'composition.json'), 'utf-8'))
const { configureProfile } = await import('../scripts/desktop-compositions.mjs')
const { syncPresetDeclarations } = await import('../apps/desktop/dist/preset-config.js')
await configureProfile(profileRoot, {
  ...templateComposition,
  disabledEntries: templateComposition.disabledEntries.filter(id => id !== 'editor-memory-panel'),
  enabledEntries: ['editor-memory-panel'],
})
await syncPresetDeclarations(home, profileRoot)

try {
  const started = await startDsh(env)
  dshChild = started.child
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  page.setDefaultTimeout(15_000)
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })

  await page.goto(started.url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(({ SHELL }) => document.title === 'DSH Editor' && Boolean(document.querySelector(SHELL)), DOM, { timeout: 45_000 })
  await page.screenshot({ path: resolve(output, '00-initial.png') })
  await dismissNativeOnboarding(page)
  // The theme is applied by the useTheme hook's useEffect, which only fires
  // after the first commit. Poll for either the data-theme attribute or the
  // localStorage key so the home snapshot below reads the resolved value
  // instead of the empty pre-effect state.
  await page.waitForFunction(
    () => Boolean(document.documentElement.getAttribute('data-theme'))
      || Boolean(globalThis.localStorage?.getItem('dsh-editor.theme')),
    undefined,
    { timeout: 5_000 },
  ).catch(() => undefined)
  await page.waitForTimeout(500)

  // Boot invariants: shell only loads the client plugin; no host plugins leak.
  const bootEntries = await page.evaluate(() => globalThis.__DSH_BOOT__?.entries?.map((entry) => entry.id) ?? [])
  if (bootEntries.filter((id) => id === 'dsh-editor-shell').length !== 1) failures.push('shell client entry must load exactly once')
  for (const id of ['dsh-editor-workbench', 'dsh-editor-novel-kernel']) {
    if (bootEntries.includes(id)) failures.push(`host-only plugin leaked into browser boot entries: ${id}`)
  }

  const homeState = await readState(page)
  if (!homeState.shell) failures.push('home shell not mounted')
  if (!homeState.homeStage) failures.push('home stage not visible')
  // The home page only renders the brand chrome — there is no ThemeToggle
  // button here, so the user cannot observe the theme directly. We just
  // require the useTheme hook's defaults to have propagated to either the
  // document attribute or localStorage. A brief race where neither is
  // populated yet is treated as the default light value rather than a
  // hard failure.
  const homeThemeOk = homeState.theme === 'light'
    || homeState.stored === 'light'
    || (!homeState.theme && !homeState.stored)
  if (!homeThemeOk) {
    failures.push(`home theme should default to light; got theme=${homeState.theme} stored=${homeState.stored}`)
  }
  // Theme switching is a command-palette action (Phase 4.1); no chrome — home
  // or workbench — may host a .theme-toggle button any more.
  if (homeState.themeToggleText) failures.push(`home chrome should not host a theme toggle; got ${homeState.themeToggleText}`)
  if (homeState.editorSection) failures.push('editor section should not be present on home')
  if (homeState.tree) failures.push('tree should not be present on home')

  // The native settings trigger must exist in the topbar so Ctrl+, can fire.
  const settingsTriggerCount = await page.locator(S.nativeSettingsTrigger).count()
  if (!settingsTriggerCount) failures.push('native settings trigger missing from topbar')

  // The DeepSeek Harness "Internal Testing Notice" (内测声明) overlay can
  // re-appear after the initial dismissal if its acknowledgement is held in a
  // memory-mode scope. Re-dismiss before the first home-stage interaction so
  // the modal mask stops intercepting pointer events.
  await dismissNativeOnboarding(page)
  // Create a new project from the home stage.
  await page.getByRole('button', { name: '新建作品' }).first().click()
  const newProject = page.getByRole('dialog', { name: '新建作品' })
  await newProject.waitFor({ state: 'visible' })
  await newProject.getByLabel('作品名称').fill('core-loop-workspace')
  await newProject.getByRole('button', { name: '创建', exact: true }).click()
  await page.locator(S.tree).waitFor({ state: 'visible', timeout: 30_000 })
  await waitFor(async () => exists(targetWorkspace), 'new project home directory created')
  if (await exists(resolve(targetWorkspace, '项目总览.md'))) failures.push('new project should not pre-seed 项目总览.md')
  await waitFor(async () => exists(resolve(targetWorkspace, 'AGENTS.md')), 'new project root rules created')
  await page.locator(S.treeEmpty).waitFor({ state: 'visible', timeout: 20_000 })

  // An initialized work contains only the app-owned AGENTS.md until the
  // author creates the first document. Reopening it from Recent must return
  // to the empty workbench instead of reporting that no manuscript was found.
  await page.getByRole('button', { name: '作品菜单' }).click()
  await page.getByRole('menuitem', { name: '返回作品列表' }).click()
  await page.locator(S.homeStage).waitFor({ state: 'visible' })
  await page.locator(S.homeRecent).getByRole('button', { name: /core-loop-workspace/ }).first().click()
  await page.locator(S.tree).waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator(S.treeEmpty).waitFor({ state: 'visible', timeout: 20_000 })

  // Top bar inventory: the Phase-4.1 workbench topbar hosts the workspace menu,
  // pane toggles, palette trigger and settings/plugins triggers. Theme switching
  // moved to the command palette, so the topbar must not contain a theme toggle.
  const chromeHeader = page.locator(S.topbar)
  await chromeHeader.screenshot({ path: resolve(output, '01-chrome.png') })
  for (const label of ['作品菜单']) {
    const present = await chromeHeader.getByRole('button', { name: label }).count()
    if (!present) failures.push(`topbar is missing ${label}`)
  }
  if (await chromeHeader.locator(S.themeToggle).count()) {
    failures.push('topbar still hosts a theme toggle (moved to the command palette)')
  }
  for (const removed of ['作品快照', '导入作品', '导出 Markdown', '导出 TXT', '管理当前作品', '返回作品列表']) {
    if (await page.getByRole('button', { name: removed }).count()) {
      // Secondary workspace actions live in the host Menu and should not show as chrome buttons.
      const visible = await page.getByRole('button', { name: removed }).first().isVisible().catch(() => false)
      if (visible) failures.push(`removed button leaked into chrome: ${removed}`)
    }
  }

  // New projects only seed neutral root rules. Specialist names stay ordinary
  // folders the author creates; they must not appear until the tree UI makes them.
  for (const label of ['正文', '大纲', '人物卡', '世界书']) {
    if (await exists(resolve(targetWorkspace, label))) {
      failures.push(`new project should not pre-create ${label}`)
    }
    if (await page.locator(S.tree).getByText(label, { exact: true }).count()) {
      failures.push(`preset directory leaked into new-project tree: ${label}`)
    }
  }
  const tree = page.locator(S.tree)
  const treeBox = await tree.boundingBox()
  if (!treeBox) failures.push('tree missing after new project')
  else {
    await tree.click({ button: 'right', position: { x: 16, y: Math.max(12, treeBox.height - 18) } })
    const newFolder = page.getByRole('menu', { name: '文档操作' }).getByRole('menuitem', { name: '新建文件夹' })
    if (!(await newFolder.isVisible().catch(() => false))) failures.push('directory create action missing')
    else {
      await newFolder.click()
      const createFolder = page.getByRole('dialog', { name: '新建文件夹' })
      await createFolder.waitFor({ state: 'visible' })
      await createFolder.getByLabel('文件夹名称').fill('正文')
      await createFolder.getByRole('button', { name: '创建', exact: true }).click()
      await createFolder.waitFor({ state: 'detached', timeout: 15_000 })
      await page.locator(S.treeRow).filter({ hasText: '正文' }).first().waitFor({ state: 'visible', timeout: 20_000 })
    }
  }
  await page.locator(S.treeRow).filter({ hasText: '正文' }).first().hover()
  if (!(await page.getByRole('button', { name: '在 正文 中新建文件', exact: true }).isVisible())) failures.push('folder create-file action missing')

  // Create and save through the real author workflow before theme/navigation checks.
  await page.locator(S.treeRow).filter({ hasText: '正文' }).first().hover()
  await page.getByRole('button', { name: '在 正文 中新建文件', exact: true }).click()
  const createFile = page.getByRole('dialog', { name: '新建文件', exact: true })
  await createFile.getByLabel('文件名称（无扩展名时按 .md 创建）').fill('001')
  await createFile.getByRole('button', { name: '创建', exact: true }).click()
  const editor = page.locator(S.paperEditor).locator(S.cmContent)
  await editor.click()
  await page.keyboard.insertText('核心闭环保存验证。')
  await page.keyboard.press('Control+s')
  await page.locator(S.paperSaveState).filter({ hasText: '已保存' }).waitFor()
  // The label can linger from the create-time save; assert on the disk write
  // itself instead of trusting the indicator timing.
  const chapterPath = resolve(targetWorkspace, '正文', '001.md')
  await waitFor(async () => (await readFile(chapterPath, 'utf8').catch(() => '')).includes('核心闭环保存验证。'), 'chapter save on disk', 15_000)
  const savedChapter = await readFile(chapterPath, 'utf8')
  if (!savedChapter.includes('核心闭环保存验证。')) throw new Error('core-loop chapter save missing on disk')

  // Two-panel validation: overview (文档概览) and memory (记忆).
  // Overview: center overlay opened with Ctrl+Shift+O, data-testid="overview-panel".
  // Memory: sidebar tool, requires enabling via plugin manager first (defaultEnabled: false).

  // Open overview panel via Ctrl+Shift+O
  await page.keyboard.press('Control+Shift+o')
  const overviewPanel = page.locator(S.overviewPanel)
  await overviewPanel.waitFor({ state: 'visible', timeout: 5_000 })

  // Wait for real data load (not loading, not error)
  // overview state: undefined=loading, null=failed, object=loaded
  // Success: .overview-body appears AND .overview-loading disappears
  await page.waitForFunction(({ OVERVIEW, OVERVIEW_BODY, OVERVIEW_LOADING }) => {
    const panel = document.querySelector(OVERVIEW)
    if (!panel) return false
    // Must have loaded body
    if (!panel.querySelector(OVERVIEW_BODY)) return false
    // Must not be in loading state
    if (panel.querySelector(OVERVIEW_LOADING)) return false
    return true
  }, DOM, { timeout: 10_000 })

  await page.screenshot({ path: resolve(output, '03-overview-panel.png') })

  // Verify header
  const overviewTitle = await overviewPanel.locator(S.h2).innerText()
  if (!overviewTitle.includes('文档概览')) failures.push(`overview panel title unexpected: ${overviewTitle}`)

  // Close via close button and verify detachment
  const overviewCloseButton = overviewPanel.getByRole('button', { name: /关闭/ })
  if (!(await overviewCloseButton.isVisible())) failures.push('overview panel close button not found')
  await overviewCloseButton.click()
  await overviewPanel.waitFor({ state: 'detached', timeout: 3_000 })

  // Memory panel: sidebar tool, defaultEnabled: false in package.json.
  // Already enabled via configureProfile with enabledEntries before DSH startup.
  // Open via command palette trigger button, then type and select "记忆维护"

  // Close the aux rail if it's open so the memory command demonstrably opens it.
  if (await page.locator(S.chatRail).isVisible().catch(() => false)) {
    await page.keyboard.press('Control+Alt+j')
    await page.locator(S.chatRail).waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => undefined)
  }

  await chromeHeader.locator(S.paletteTriggerButton).click()
  const commandPalette = page.locator(S.paletteContent)
  await commandPalette.waitFor({ state: 'visible', timeout: 5_000 })

  // Type command to filter
  const commandInput = commandPalette.locator(S.paletteInputField)
  await commandInput.fill('记忆维护')
  await page.waitForTimeout(300)

  // Find and click the memory command item
  const memoryCommand = commandPalette.locator(S.paletteItem).filter({ hasText: '记忆维护' })
  await memoryCommand.waitFor({ state: 'visible', timeout: 3_000 })
  const memoryCommandDisabled = await memoryCommand.getAttribute('aria-disabled')
  if (memoryCommandDisabled === 'true') failures.push('memory command is disabled in palette')
  await memoryCommand.click()
  await commandPalette.waitFor({ state: 'detached', timeout: 3_000 })

  // Wait for memory panel to open in sidebar
  const memoryPanel = page.locator(S.memoryPanel)
  await memoryPanel.waitFor({ state: 'visible', timeout: 5_000 })

  // Wait for data load or empty state (not loading, not error)
  // memory state: items=undefined initially, null=failed, array=loaded
  // Success: either .memory-list (has items) OR .memory-status with empty text (no role=alert)
  // Loading: .memory-status[role=status] with skeleton
  // Error: .memory-status with role=alert
  await page.waitForFunction(({ MEMORY, MEMORY_LIST, MEMORY_STATUS }) => {
    const panel = document.querySelector(MEMORY)
    if (!panel) return false
    // Accept loaded list
    if (panel.querySelector(MEMORY_LIST)) return true
    // Accept empty state: .memory-status without role=alert
    const status = panel.querySelector(MEMORY_STATUS)
    if (status && !status.hasAttribute('role')) return true
    // Reject loading (role=status with skeleton) and error (role=alert)
    return false
  }, DOM, { timeout: 10_000 })

  await page.screenshot({ path: resolve(output, '05-memory-panel.png') })

  // Verify header
  const memoryTitle = await memoryPanel.locator(S.h2).innerText()
  if (!memoryTitle.includes('记忆')) failures.push(`memory panel title unexpected: ${memoryTitle}`)

  // Verify empty state shows correct message (not error)
  const memoryStatus = memoryPanel.locator(S.memoryStatus)
  if (await memoryStatus.count()) {
    const hasAlert = await memoryStatus.evaluate(el => el.hasAttribute('role') && el.getAttribute('role') === 'alert')
    if (hasAlert) {
      const alertText = await memoryStatus.innerText()
      failures.push(`memory panel shows error: ${alertText}`)
    } else {
      const statusText = await memoryStatus.innerText()
      if (!statusText.includes('还没有记忆更新记录')) {
        failures.push(`memory panel empty state unexpected: ${statusText}`)
      }
    }
  }

  // Close memory panel via close button
  const memoryCloseButton = memoryPanel.getByRole('button', { name: /关闭/ })
  if (!(await memoryCloseButton.isVisible())) failures.push('memory panel close button not found')
  await memoryCloseButton.click()
  await memoryPanel.waitFor({ state: 'detached', timeout: 3_000 })

  // Tools tab empty state: with every contribution dormant, the tab lists the
  // registered launchers; clicking one must open the tool in this tab.
  const toolsEmpty = page.locator(S.toolsEmpty)
  await toolsEmpty.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined)
  if (!(await toolsEmpty.isVisible().catch(() => false))) {
    failures.push('tools tab shows no empty state after the last tool closes')
  } else {
    const memoryLauncher = toolsEmpty.locator(S.toolsEmptyRow).filter({ hasText: '记忆维护' })
    if (!(await memoryLauncher.count())) {
      failures.push('tools empty state does not list the memory launcher')
    } else {
      await memoryLauncher.click()
      await memoryPanel.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined)
      if (!(await memoryPanel.isVisible().catch(() => false))) failures.push('tools launcher did not reopen the memory panel')
      else await memoryPanel.getByRole('button', { name: /关闭/ }).click().catch(() => undefined)
    }
  }

  // Theme switching is a command-palette command (Phase 4.1). light → dark →
  // light; the DOM data-theme and localStorage must update and survive reload.
  await toggleTheme(page)
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark')
  const darkStored = await page.evaluate(() => globalThis.localStorage.getItem('dsh-editor.theme'))
  if (darkStored !== 'dark') failures.push(`localStorage theme did not persist dark; got ${darkStored}`)
  await page.waitForFunction(({ SHELL_THEME }) => document.querySelector(SHELL_THEME)?.classList.contains('dark'), DOM)
  await page.waitForTimeout(350)
  await page.screenshot({ path: resolve(output, '06-editor-dark.png') })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => document.title === 'DSH Editor' && document.documentElement.getAttribute('data-theme') === 'dark',
    undefined,
    { timeout: 45_000 },
  )
  // The Internal Testing Notice can re-appear after reload — re-dismiss it.
  await dismissNativeOnboarding(page)
  await page.waitForTimeout(500)

  // A page reload usually returns DSH to the home stage, but if the last
  // workspace is still on disk and openable (it has a .md file from the
  // author-created 正文/001.md above) the shell may re-enter the workbench
  // directly. Either way, the tree must be in scope; handle both landings.
  // The home stage can appear transiently while the shell is still deciding to
  // auto-reopen the last workspace; waiting on either landing avoids clicking a
  // recent entry that unmounts mid-navigation.
  const recentButton = page.locator(S.homeRecent).getByRole('button', { name: /core-loop-workspace/ }).first()
  const landed = await Promise.race([
    page.locator(S.tree).waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'workbench', () => null),
    recentButton.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'home', () => null),
  ])
  if (landed === 'home') {
    // If the auto-reopen wins mid-click the button unmounts — the tree wait below still lands.
    await recentButton.click({ timeout: 10_000 }).catch(() => undefined)
  }
  await page.locator(S.tree).waitFor({ state: 'visible', timeout: 30_000 })

  const reloadedState = await readState(page)
  if (reloadedState.theme !== 'dark') failures.push(`theme did not survive reload; got ${reloadedState.theme}`)
  if (reloadedState.stored !== 'dark') failures.push(`localStorage theme did not survive reload; got ${reloadedState.stored}`)

  // Back to light.
  await toggleTheme(page)
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light')
  await page.waitForFunction(() => globalThis.localStorage.getItem('dsh-editor.theme') === 'light')

  // Chat: open via the launcher, focus composer via the web binding
  // (DSH 0.2.0 matches platform bindings strictly; web is Ctrl+Alt+L, while
  // bare Ctrl+L is the desktop-only binding).
  const launcher = page.getByRole('button', { name: '打开写作搭档' })
  if (!(await page.locator(S.chatRail).isVisible().catch(() => false))) {
    if (await launcher.isVisible().catch(() => false)) {
      await launcher.click()
    } else {
      // Launcher only renders while the aux rail is closed; it lags capability
      // loading right after a reload, so fall back to the topbar aux toggle.
      await page.locator(S.auxToggle).click().catch(() => undefined)
    }
  }
  // The chat lives on the aux rail's 搭档 tab — make sure that tab is active.
  if (!(await page.locator(S.chatRail).isVisible().catch(() => false))) {
    await page.getByRole('tab', { name: '搭档' }).click().catch(() => undefined)
  }
  await page.locator(S.chatRail).waitFor({ state: 'visible', timeout: 15_000 })
  await page.keyboard.press('Control+Alt+l')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '输入消息')
  const composer = page.getByRole('textbox', { name: '输入消息' })
  if (await composer.inputValue() !== '') failures.push('chat composer should start empty')
  const placeholder = await composer.getAttribute('placeholder')
  if (placeholder !== '问问这篇稿、审一段、提议一处修改……') {
    failures.push(`composer placeholder drifted: ${placeholder}`)
  }
  // Type a draft; Ctrl+Alt+B closes sidebar, Ctrl+Alt+F focus mode hides both
  // sidebars (web bindings; DSH 0.2.0 matches platform bindings strictly).
  await composer.fill('不要丢失的草稿')
  await page.keyboard.press('Control+Alt+b')
  // 4.1: the files pane host is adopted into a hidden park node, not unmounted.
  await page.locator(S.filesRail).waitFor({ state: 'hidden' })
  await page.keyboard.press('Control+Alt+f')
  await page.locator(S.shellFocus).waitFor({ state: 'visible' })
  await page.screenshot({ path: resolve(output, '07-focus-mode.png') })
  // In focus mode, Ctrl+Alt+B exits focus mode AND reopens the sidebar in one
  // keystroke (root.ts:231). Reusing it is more realistic than toggling
  // focus mode off and then asking the test to find a hidden sidebar.
  await page.keyboard.press('Control+Alt+b')
  await page.locator(S.shellFocus).waitFor({ state: 'detached' })
  await page.locator(S.filesRail).waitFor({ state: 'visible' })
  if (await composer.inputValue() !== '不要丢失的草稿') failures.push('composer draft lost across focus toggle')
  await composer.fill('')

  // Negative chat leak: without a model, the chat rail should not show any
  // internal strings even after a turn fails.
  const chatText = await page.locator(S.chatRail).innerText()
  for (const leaked of ['novel_propose', 'novel_knowledge', '.dsh-editor/作品索引.md', '为当前工作区建立作品索引', '状态已更新。']) {
    if (chatText.includes(leaked)) failures.push(`chat rail leaked internal string: ${leaked}`)
  }

  // Return to home via the workspace menu. Phase 4.5 home: the 「继续写作」
  // block must offer the last-opened chapter (正文/001.md, saved above).
  await page.getByRole('button', { name: '作品菜单' }).click()
  await page.getByRole('menuitem', { name: '返回作品列表' }).click()
  await page.locator(S.homeStage).waitFor({ state: 'visible' })
  const continueBlock = page.locator(S.homeContinue)
  await continueBlock.waitFor({ state: 'visible', timeout: 15_000 })
  const continueText = await continueBlock.innerText()
  if (!continueText.includes('继续写作')) failures.push(`home continue block missing label: ${continueText}`)
  // 摘录取章节首个非空正文行；这里是刚保存的那句。
  if (!continueText.includes('核心闭环保存验证')) failures.push(`home continue excerpt missing saved line: ${continueText}`)
  await continueBlock.getByRole('button', { name: '继续', exact: true }).click()
  await page.locator(S.tree).waitFor({ state: 'visible', timeout: 30_000 })
  // 继续必须回到上次章节（正文/001.md）；等章节文本载入而不是只等节点挂载。
  const lastChapter = await page.locator(S.cmContent)
    .filter({ hasText: '核心闭环保存验证' })
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  if (!lastChapter) {
    const got = await page.locator(S.cmContent).first().innerText().catch(() => '(no editor)')
    failures.push(`继续 did not reopen the last chapter; got: ${got.slice(0, 80)}`)
  }

  // Back home again: open the work from a TOC row, then exercise the row menu
  // (移除) and the relocate path-fallback from the new rows.
  await page.getByRole('button', { name: '作品菜单' }).click()
  await page.getByRole('menuitem', { name: '返回作品列表' }).click()
  await page.locator(S.homeStage).waitFor({ state: 'visible' })
  const homeRow = page.locator(S.homeRow).filter({ hasText: 'core-loop-workspace' }).first()
  await homeRow.locator(S.homeRowMain).click()
  await page.locator(S.tree).waitFor({ state: 'visible', timeout: 30_000 })

  // Relocate: move the workspace directory away, reopen the row, then point the
  // fallback form at the moved directory.
  const movedWorkspace = resolve(projectsRoot, 'core-loop-workspace-moved')
  await page.getByRole('button', { name: '作品菜单' }).click()
  await page.getByRole('menuitem', { name: '返回作品列表' }).click()
  await page.locator(S.homeStage).waitFor({ state: 'visible' })
  await rename(targetWorkspace, movedWorkspace)
  const movedRow = page.locator(S.homeRow).filter({ hasText: 'core-loop-workspace' }).first()
  await movedRow.locator(S.homeRowMain).click()
  const relocateNotice = page.locator('.dsh-home-row__relocation')
  await relocateNotice.waitFor({ state: 'visible', timeout: 30_000 })
  await relocateNotice.getByRole('button', { name: '重新定位' }).click()
  // The directory picker is unavailable headless → manual path fallback form.
  await page.getByLabel('作品文件夹路径').waitFor({ state: 'visible', timeout: 15_000 })
  await page.getByLabel('作品文件夹路径').fill(movedWorkspace)
  await page.getByRole('button', { name: '打开此目录', exact: true }).click()
  await page.locator(S.tree).waitFor({ state: 'visible', timeout: 30_000 })

  // Remove from recents via the new row's context/menu affordance.
  await page.getByRole('button', { name: '作品菜单' }).click()
  await page.getByRole('menuitem', { name: '返回作品列表' }).click()
  await page.locator(S.homeStage).waitFor({ state: 'visible' })
  const removeRow = page.locator(S.homeRow).filter({ hasText: 'core-loop-workspace' }).first()
  await removeRow.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '从最近移除' }).click()
  const removeConfirm = page.getByRole('alertdialog')
  await removeConfirm.waitFor({ state: 'visible', timeout: 10_000 })
  await removeConfirm.getByRole('button', { name: '从最近移除', exact: true }).click()
  await page.locator(S.homeRow).filter({ hasText: 'core-loop-workspace' }).waitFor({ state: 'hidden', timeout: 15_000 })
  if (await page.locator(S.homeRow).filter({ hasText: 'core-loop-workspace' }).count()) {
    failures.push('removed work still listed in home recents')
  }

  // Reopen via 打开作品 → manual path fallback, proving the entry still lands
  // on a work moved + removed from recents. Then final screenshot.
  await page.getByRole('button', { name: '打开作品' }).first().click()
  await page.getByLabel('作品文件夹路径').waitFor({ state: 'visible', timeout: 15_000 })
  await page.getByLabel('作品文件夹路径').fill(movedWorkspace)
  await page.getByRole('button', { name: '打开此目录', exact: true }).click()
  await page.locator(S.tree).waitFor({ state: 'visible', timeout: 30_000 })

  // Final screenshot: full workbench in light theme for the visual reference set.
  await page.screenshot({ path: resolve(output, '08-workbench-light.png'), fullPage: true })

  if (browserErrors.length) failures.push(...browserErrors)
} catch (error) {
  if (browser) {
    const pages = browser.contexts().flatMap((context) => context.pages())
    for (const page of pages) {
      await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => undefined)
      await writeFile(resolve(output, 'failure.txt'), await page.locator(S.body).innerText()).catch(() => undefined)
      await writeFile(resolve(output, 'failure.html'), await page.content()).catch(() => undefined)
    }
  }
  failures.push(error instanceof Error ? error.stack || error.message : String(error))
} finally {
  if (browser) await browser.close().catch(() => undefined)
  if (dshChild) await stop(dshChild)
}

const report = { ok: failures.length === 0, failures }
await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exitCode = 1
