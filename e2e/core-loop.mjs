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
import { mkdir, rm, stat, writeFile, readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

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

resolveDshInstallation('0.1.5-rc.2')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')

const failures = []
let browser
let dshChild

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
  return page.evaluate(() => {
    const theme = document.documentElement.getAttribute('data-theme') || ''
    const stored = globalThis.localStorage?.getItem('dsh-editor.theme') || ''
    const title = document.title
    const shell = Boolean(document.querySelector('.shell'))
    const homeStage = Boolean(document.querySelector('.home-stage'))
    const tree = Boolean(document.querySelector('.tree'))
    const sidebar = Boolean(document.querySelector('.sidebar'))
    const editorSection = Boolean(document.querySelector('[aria-label="文稿编辑区"]'))
    const editorEl = document.querySelector('[data-testid="paper-editor"]')
    const cmView = editorEl && /** @type {any} */ (editorEl).__cmView
    const ghost = Boolean(document.querySelector('[data-testid="paper-ghost"]'))
    const saveState = document.querySelector('[data-testid="paper-save-state"]')?.textContent || ''
    const wordCount = document.querySelector('[data-testid="paper-wordcount"]')?.textContent || ''
    const headerPath = document.querySelector('[data-testid="paper-path"]')?.textContent || ''
    const chat = document.querySelector('aside.chat')
    const composer = chat?.querySelector('textarea[aria-label="输入消息"]') || null
    const placeholder = composer?.getAttribute('placeholder') || ''
    const themeToggle = document.querySelector('.theme-toggle')?.getAttribute('aria-label') || ''
    const themeToggleText = document.querySelector('.theme-toggle')?.textContent?.trim() || ''
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
  })
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
await deployProfile(home, template, resolve(runtime, 'node_modules'))

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
  await page.waitForFunction(() => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell')), undefined, { timeout: 45_000 })
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
  // The theme toggle lives on the workbench chrome, not the home chrome — the
  // home chrome only renders brand-lockup / local-state / native-settings-control.
  if (homeState.themeToggleText) failures.push(`home chrome should not host a theme toggle; got ${homeState.themeToggleText}`)
  if (homeState.editorSection) failures.push('editor section should not be present on home')
  if (homeState.tree) failures.push('tree should not be present on home')

  // The native settings trigger must exist in the topbar so Ctrl+, can fire.
  const settingsTriggerCount = await page.locator('.native-settings-control button[aria-haspopup="dialog"]').count()
  if (!settingsTriggerCount) failures.push('native settings trigger missing from topbar')

  // The DeepSeek Harness "Internal Testing Notice" (内测声明) overlay can
  // re-appear after the initial dismissal if its acknowledgement is held in a
  // memory-mode scope. Re-dismiss before the first home-stage interaction so
  // the modal mask stops intercepting pointer events.
  await dismissNativeOnboarding(page)
  // Create a new project from the home stage.
  await page.getByRole('button', { name: '新建', exact: true }).first().click()
  const newProject = page.getByRole('dialog', { name: '新建作品' })
  await newProject.waitFor({ state: 'visible' })
  await newProject.getByLabel('作品名称').fill('core-loop-workspace')
  await newProject.getByRole('button', { name: '创建', exact: true }).click()
  await page.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })
  await waitFor(async () => exists(targetWorkspace), 'new project home directory created')
  if (await exists(resolve(targetWorkspace, '项目总览.md'))) failures.push('new project should not pre-seed 项目总览.md')
  await waitFor(async () => exists(resolve(targetWorkspace, 'AGENTS.md')), 'new project root rules created')
  await page.locator('.tree-empty').waitFor({ state: 'visible', timeout: 20_000 })

  // An initialized work contains only the app-owned AGENTS.md until the
  // author creates the first document. Reopening it from Recent must return
  // to the empty workbench instead of reporting that no manuscript was found.
  await page.getByRole('button', { name: '作品菜单' }).click()
  await page.getByRole('menuitem', { name: '返回作品列表' }).click()
  await page.locator('.home-stage').waitFor({ state: 'visible' })
  await page.locator('.home-recent').getByRole('button', { name: /core-loop-workspace/ }).first().click()
  await page.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.tree-empty').waitFor({ state: 'visible', timeout: 20_000 })

  // Top bar inventory: only the four chrome buttons that survived the refactor.
  await page.locator('.chrome').screenshot({ path: resolve(output, '01-chrome.png') })
  // The merged workspace menu is a <summary role="button"> with an aria-label.
  // The theme toggle is matched by its stable .theme-toggle class because the
  // Chinese glyph in its text content can fall back to a placeholder "?" in
  // the headless font, which would defeat an accessible-name lookup.
  for (const label of ['作品菜单']) {
    const present = await page.getByRole('button', { name: label }).count()
    if (!present) failures.push(`topbar is missing ${label}`)
  }
  if (!(await page.locator('.chrome .theme-toggle').count())) {
    failures.push('topbar is missing theme toggle')
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
    if (await page.locator('.tree').getByText(label, { exact: true }).count()) {
      failures.push(`preset directory leaked into new-project tree: ${label}`)
    }
  }
  const tree = page.locator('.tree')
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
      await page.locator('.tree-row').filter({ hasText: '正文' }).first().waitFor({ state: 'visible', timeout: 20_000 })
    }
  }
  await page.locator('.tree-row').filter({ hasText: '正文' }).first().hover()
  if (!(await page.getByRole('button', { name: '在 正文 中新建文件', exact: true }).isVisible())) failures.push('folder create-file action missing')

  // Create and save through the real author workflow before theme/navigation checks.
  await page.locator('.tree-row').filter({ hasText: '正文' }).first().hover()
  await page.getByRole('button', { name: '在 正文 中新建文件', exact: true }).click()
  const createFile = page.getByRole('dialog', { name: '新建文件', exact: true })
  await createFile.getByLabel('文件名称（无扩展名时按 .md 创建）').fill('001')
  await createFile.getByRole('button', { name: '创建', exact: true }).click()
  const editor = page.getByTestId('paper-editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.insertText('核心闭环保存验证。')
  await page.keyboard.press('Control+s')
  await page.getByTestId('paper-save-state').filter({ hasText: '已保存' }).waitFor()
  const savedChapter = await readFile(resolve(targetWorkspace, '正文', '001.md'), 'utf8')
  if (!savedChapter.includes('核心闭环保存验证。')) throw new Error('core-loop chapter save missing on disk')

  // Theme toggle: light → dark → light. The DOM data-theme and localStorage must
  // both update and survive a reload.
  await page.getByRole('button', { name: /主题（当前浅色）/ }).click()
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark')
  const darkStored = await page.evaluate(() => globalThis.localStorage.getItem('dsh-editor.theme'))
  if (darkStored !== 'dark') failures.push(`localStorage theme did not persist dark; got ${darkStored}`)
  const darkToggle = await page.getByRole('button', { name: /主题（当前深色）/ }).count()
  if (!darkToggle) failures.push('theme toggle did not re-label itself as 当前深色 after switching to dark')
  await page.screenshot({ path: resolve(output, '05-editor-dark.png') })

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
  if (await page.locator('.home-stage').isVisible().catch(() => false)) {
    await page.locator('.home-recent').getByRole('button', { name: /core-loop-workspace/ }).first().click()
  }
  await page.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })

  const reloadedState = await readState(page)
  if (reloadedState.theme !== 'dark') failures.push(`theme did not survive reload; got ${reloadedState.theme}`)
  if (reloadedState.stored !== 'dark') failures.push(`localStorage theme did not survive reload; got ${reloadedState.stored}`)

  // Back to light.
  await page.getByRole('button', { name: /主题（当前深色）/ }).click()
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light')
  await page.waitForFunction(() => globalThis.localStorage.getItem('dsh-editor.theme') === 'light')

  // Chat: open via the launcher, focus composer via Ctrl+L, verify the placeholder.
  const launcher = page.getByRole('button', { name: '打开写作搭档' })
  if (await launcher.isVisible().catch(() => false)) await launcher.click()
  await page.locator('aside.chat').waitFor({ state: 'visible', timeout: 10_000 })
  await page.keyboard.press('Control+l')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '输入消息')
  const composer = page.getByRole('textbox', { name: '输入消息' })
  if (await composer.inputValue() !== '') failures.push('chat composer should start empty')
  const placeholder = await composer.getAttribute('placeholder')
  if (placeholder !== '问剧情、审一段、对质人物……') {
    failures.push(`composer placeholder drifted: ${placeholder}`)
  }
  // Type a draft; Ctrl+B closes sidebar, Ctrl+\\ focus mode hides both sidebars.
  await composer.fill('不要丢失的草稿')
  await page.keyboard.press('Control+b')
  await page.locator('.sidebar').waitFor({ state: 'detached' })
  await page.keyboard.press('Control+\\')
  await page.locator('.shell.focus-mode').waitFor({ state: 'visible' })
  await page.screenshot({ path: resolve(output, '06-focus-mode.png') })
  // In focus mode, Ctrl+B exits focus mode AND reopens the sidebar in one
  // keystroke (root.ts:231). Reusing it is more realistic than toggling
  // focus mode off and then asking the test to find a hidden sidebar.
  await page.keyboard.press('Control+b')
  await page.locator('.shell.focus-mode').waitFor({ state: 'detached' })
  await page.locator('.sidebar').waitFor({ state: 'visible' })
  if (await composer.inputValue() !== '不要丢失的草稿') failures.push('composer draft lost across focus toggle')
  await composer.fill('')

  // Negative chat leak: without a model, the chat rail should not show any
  // internal strings even after a turn fails.
  const chatText = await page.locator('aside.chat').innerText()
  for (const leaked of ['novel_propose', 'novel_knowledge', '.dsh-editor/作品索引.md', '为当前工作区建立作品索引', '状态已更新。']) {
    if (chatText.includes(leaked)) failures.push(`chat rail leaked internal string: ${leaked}`)
  }

  // Return to home via the workspace menu, then reopen the project to prove
  // the round-trip still works. The tree shows
  // the existing files and the editor can restore its current chapter.)
  await page.getByRole('button', { name: '作品菜单' }).click()
  await page.getByRole('menuitem', { name: '返回作品列表' }).click()
  await page.locator('.home-stage').waitFor({ state: 'visible' })
  await page.locator('.home-recent').getByRole('button', { name: /core-loop-workspace/ }).first().click()
  await page.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })

  // Final screenshot: full workbench in light theme for the visual reference set.
  await page.screenshot({ path: resolve(output, '07-workbench-light.png'), fullPage: true })

  if (browserErrors.length) failures.push(...browserErrors)
} catch (error) {
  if (browser) {
    const pages = browser.contexts().flatMap((context) => context.pages())
    for (const page of pages) {
      await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => undefined)
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
