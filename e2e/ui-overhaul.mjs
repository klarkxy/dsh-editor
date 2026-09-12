/**
 * Focused M0/M1 harness for the UI overhaul.
 *
 * Isolated fixtures: `.dev/ui-overhaul-*` and `e2e/out/ui-overhaul`.
 * Records a before video from the copied baseline profile, then an after
 * video plus checks against the current build. Never touches user works
 * or real credentials.
 */
import { spawn } from 'node:child_process'
import { cp, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const output = resolve(root, 'e2e', 'out', 'ui-overhaul')
const beforeHome = resolve(devRoot, 'ui-overhaul-before-home')
const beforeWorkspace = resolve(devRoot, 'ui-overhaul-before-workspace')
const afterHome = resolve(devRoot, 'ui-overhaul-home')
const afterWorkspace = resolve(devRoot, 'ui-overhaul-workspace')
const beforeTemplate = resolve(devRoot, 'ui-overhaul-before-profile-template')
const baselineTemplate = resolve(devRoot, 'ui-overhaul-01a08f87', 'baseline', 'desktop-profile-template')
const currentTemplate = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')

for (const target of [beforeHome, beforeWorkspace, afterHome, afterWorkspace, beforeTemplate, output]) {
  if (!target.startsWith(`${devRoot}${sep}`) && !target.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) {
    throw new Error(`unsafe path: ${target}`)
  }
}

resolveDshInstallation('0.1.5-rc.2')

const failures = []
const notes = []
const screenshots = []
let shotIndex = 0

function note(label, detail = '') {
  notes.push({ label, detail, at: new Date().toISOString() })
  console.log(`[ui-overhaul] ${label}${detail ? ` — ${detail}` : ''}`)
}
function fail(message) {
  failures.push(message)
  console.error(`[ui-overhaul] ${message}`)
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function pressTrustedEnterWithFlags(page, locator, flags) {
  const handle = await locator.elementHandle()
  if (!handle) throw new Error('IME target is missing')
  await page.evaluate(({ element, isComposing, keyCode }) => {
    const mutate = (event) => {
      if (!event.isTrusted || event.key !== 'Enter') return
      Object.defineProperty(event, 'isComposing', { configurable: true, get: () => isComposing })
      Object.defineProperty(event, 'keyCode', { configurable: true, get: () => keyCode })
      Object.defineProperty(event, 'which', { configurable: true, get: () => keyCode })
    }
    const record = (event) => {
      if (event.key !== 'Enter') return
      window.removeEventListener('keydown', record)
      window.__dshEnterProbe = {
        defaultPrevented: event.defaultPrevented,
        isComposing: Boolean(event.isComposing),
        keyCode: event.keyCode,
        trusted: event.isTrusted,
      }
    }
    window.__dshEnterProbe = null
    element.addEventListener('keydown', mutate, { capture: true, once: true })
    window.addEventListener('keydown', record)
  }, { element: handle, isComposing: flags.isComposing, keyCode: flags.keyCode })
  await locator.press('Enter')
  return page.evaluate(() => window.__dshEnterProbe)
}

async function observeDialogExit(page, selector) {
  return page.evaluate((sel) => new Promise((resolve) => {
    const start = performance.now()
    const states = []
    const record = () => {
      const node = document.querySelector(sel)
      if (!node) return { present: false, state: 'detached' }
      return { present: true, state: node.getAttribute('data-state') || 'missing' }
    }
    const first = record()
    if (!first.present) {
      resolve({ sawClosed: false, detached: true, duration: 0, states: ['already-detached'] })
      return
    }
    states.push(first.state)
    const finish = (detached) => {
      observer.disconnect()
      resolve({
        sawClosed: states.includes('closed'),
        detached,
        duration: performance.now() - start,
        states,
      })
    }
    const observer = new MutationObserver(() => {
      const next = record()
      if (!next.present) { finish(true); return }
      if (states[states.length - 1] !== next.state) states.push(next.state)
    })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state'] })
    globalThis.setTimeout(() => finish(!record().present), 2_000)
  }), selector)
}

function workspaceFilesUnchanged(before, after) {
  const added = [...after].filter((name) => !before.has(name))
  return added
}

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

async function shot(page, name, intent) {
  shotIndex += 1
  const file = resolve(output, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await page.waitForTimeout(180)
  await page.screenshot({ path: file })
  screenshots.push({ name, file: file.replace(`${root}${sep}`, ''), intent, at: new Date().toISOString() })
  note('截图', `${name} — ${intent}`)
}

async function seedWorkspace(workspace) {
  await mkdir(resolve(workspace, '正文'), { recursive: true })
  await mkdir(resolve(workspace, '大纲'), { recursive: true })
  await writeFile(resolve(workspace, '正文', '001.md'), '# 第一章 试笔\n\n雾比灯先到，把码头的广播塔切成一段一段的影子。\n')
  await writeFile(resolve(workspace, 'cover.png'), Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ))
}

function envFor(home) {
  const env = {
    ...process.env,
    DSH_TELEMETRY_DISABLED: '1',
    DSH_DESKTOP_NODE_PATH: process.execPath,
    DSH_DESKTOP_CLI_PATH: cli,
    DSH_DESKTOP_PROFILE_TEMPLATE: home === beforeHome ? beforeTemplate : currentTemplate,
    DSH_HOME: home,
    DSH_EDITOR_PROJECTS_ROOT: resolve(devRoot, home === beforeHome ? 'ui-overhaul-before-projects' : 'ui-overhaul-projects'),
    DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
    SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-ui-overhaul',
    DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key',
  }
  delete env.DSH_EDITOR_CUSTOM_API_KEY
  return env
}

async function openSeededWorkspace(page, workspace) {
  await page.getByRole('button', { name: '打开作品' }).first().click()
  const pathBox = page.getByLabel('作品文件夹路径')
  await pathBox.waitFor({ state: 'visible' })
  await pathBox.fill(workspace)
  await page.getByRole('button', { name: '打开此目录' }).click()
  await page.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })
}

async function returnHome(page, { menuItem }) {
  await page.getByRole('button', { name: '作品菜单' }).click()
  if (menuItem) await page.getByRole('menuitem', { name: '返回作品列表' }).click()
  else await page.getByRole('button', { name: '返回作品列表' }).click()
}

async function firstReturn(page, { expectStay, label, menuItem }) {
  await returnHome(page, { menuItem })
  await page.waitForTimeout(1_200)
  const homeVisible = await page.locator('.home-stage').isVisible().catch(() => false)
  const treeVisible = await page.locator('.tree').isVisible().catch(() => false)
  const result = { homeVisible, treeVisible, stayed: homeVisible && !treeVisible }
  note(`${label} 首次返回`, JSON.stringify(result))
  if (expectStay && !result.stayed) fail(`${label}: first home return did not hold (home=${homeVisible}, tree=${treeVisible})`)
  return result
}

async function runSession({ label, home, workspace, template, videoName, fullChecks }) {
  await rm(home, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
  await mkdir(resolve(home, 'electron-user-data'), { recursive: true })
  await seedWorkspace(workspace)
  await deployProfile(home, template, resolve(runtime, 'node_modules'))

  let browser
  let dshChild
  let context
  try {
    const started = await startDsh(envFor(home))
    dshChild = started.child
    browser = await chromium.launch({ headless: true })
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN',
      recordVideo: { dir: resolve(output, `video-${videoName}`), size: { width: 1440, height: 900 } },
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    page.on('pageerror', (error) => fail(`${label} pageerror: ${error.message}`))

    await page.goto(started.url.href, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell')), undefined, { timeout: 45_000 })
    await dismissNativeOnboarding(page)
    await dismissNativeOnboarding(page)
    if (fullChecks) await shot(page, 'home-paper', '首页 · 纸主题 · 52px chrome')
    if (fullChecks) {
      await page.getByRole('button', { name: '新建', exact: true }).click()
      const createDialog = page.locator('.create-dialog')
      await createDialog.waitFor({ state: 'visible' })
      const createInput = createDialog.locator('input').first()
      await createInput.fill('ime-new-project')
      const createComposing = await pressTrustedEnterWithFlags(page, createInput, { isComposing: true, keyCode: 13 })
      if (!createComposing?.trusted) fail(`NewProject IME isComposing Enter was not trusted: ${JSON.stringify(createComposing)}`)
      if (!createComposing.defaultPrevented) fail('NewProject IME isComposing Enter did not preventDefault')
      if (!(await createDialog.isVisible())) fail('NewProject IME isComposing Enter submitted')
      const create229 = await pressTrustedEnterWithFlags(page, createInput, { isComposing: false, keyCode: 229 })
      if (!create229?.defaultPrevented) fail('NewProject IME keyCode 229 Enter did not preventDefault')
      if (!(await createDialog.isVisible())) fail('NewProject IME keyCode 229 Enter submitted')
      await page.keyboard.press('Escape')
      await createDialog.waitFor({ state: 'detached' })
      note('NewProject IME', 'trusted composing/229 did not create a work')
    }

    await openSeededWorkspace(page, workspace)
    if (fullChecks) await shot(page, 'workbench-paper', '工作台 · 纸 vs chrome 分层')

    const first = await firstReturn(page, { expectStay: fullChecks, label, menuItem: fullChecks })
    if (fullChecks) await shot(page, 'first-return-home', '首次返回首页且无需刷新')
    if (fullChecks && first.stayed) {
      await page.waitForTimeout(800)
      if (!(await page.locator('.home-stage').isVisible())) fail('home bounced after first return wait')
    }

    if (fullChecks) {
      await openSeededWorkspace(page, workspace)
      const settingsTrigger = page.locator('.native-settings-control button').first()
      await settingsTrigger.click()
      const settings = page.locator('.settings-dialog')
      await settings.waitFor({ state: 'visible' })

      const language = settings.locator('.select-trigger').first()
      await language.focus()
      await page.keyboard.press('ArrowDown')
      const list = page.getByRole('listbox')
      await list.waitFor({ state: 'visible' })
      await page.keyboard.press('Escape')
      await list.waitFor({ state: 'detached' })
      if (!(await settings.isVisible())) fail('Escape from select closed parent settings')
      if (!(await language.evaluate((el) => document.activeElement === el))) fail('Escape did not restore select trigger focus')
      note('Select Escape', 'list closed, settings stayed, focus returned')

      const modelsTab = settings.getByRole('tab', { name: '模型' })
      if (!(await modelsTab.count())) fail('settings is missing the 模型 tab')
      await modelsTab.click()
      const addCustom = settings.getByRole('button', { name: '添加自定义提供方' })
      const addProvider = settings.getByRole('button', { name: '添加提供方', exact: true })
      if (await addCustom.count() && await addCustom.isEnabled()) {
        await addCustom.click()
        await settings.getByLabel('Provider ID').fill('e2e-synth')
        await settings.getByRole('textbox', { name: '显示名称' }).fill('e2e-synth')
        await settings.getByLabel('API 地址').fill('https://example.invalid/v1')
        await settings.locator('input[type="password"]').first().fill('dsh-editor-e2e-placeholder-key')
        const addModel = settings.getByRole('button', { name: /添加模型/ })
        if (!(await addModel.count())) fail('custom provider form is missing 添加模型')
        await addModel.click()
        await settings.getByLabel(/模型 id/).fill('e2e-model')
        await settings.getByRole('button', { name: '创建提供方' }).click()
      } else if (await addProvider.count() && await addProvider.isEnabled()) {
        await addProvider.click()
        const key = settings.locator('input[type="password"]').first()
        await key.waitFor({ state: 'visible' })
        await key.fill('dsh-editor-e2e-placeholder-key')
        await settings.getByRole('button', { name: '保存' }).click()
      } else {
        fail('models tab has no enabled add-provider control')
      }
      const deleteBtn = settings.getByRole('button', { name: /删除/ }).first()
      await deleteBtn.waitFor({ state: 'visible', timeout: 10_000 })
      if (!(await deleteBtn.isEnabled())) fail('seeded provider is not deletable')
      await deleteBtn.click()
      const confirm = page.locator('.confirm-dialog')
      await confirm.waitFor({ state: 'visible', timeout: 5_000 })
      const cancel = confirm.getByRole('button', { name: '取消' })
      await cancel.waitFor({ state: 'visible' })
      if (!(await cancel.evaluate((el) => document.activeElement === el))) fail('nested confirm did not focus Cancel')
      await page.keyboard.press('Tab')
      const tabInside = await confirm.evaluate((el) => el.contains(document.activeElement))
      if (!tabInside) fail('Tab left nested confirm')
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => {
        const el = document.querySelector('.confirm-dialog')
        return !el || el.getAttribute('data-state') === 'closed' || !el.offsetParent
      })
      await confirm.waitFor({ state: 'detached' })
      if (!(await settings.isVisible())) fail('Escape from nested confirm closed settings')
      if (await settings.getByRole('button', { name: /删除/ }).count() === 0) fail('Escape deleted the provider')
      const deleteFocused = await deleteBtn.evaluate((el) => document.activeElement === el || el.contains(document.activeElement)).catch(() => false)
      if (!deleteFocused) {
        const active = await page.evaluate(() => document.activeElement?.textContent || document.activeElement?.getAttribute('aria-label') || '')
        if (!String(active).includes('删除')) fail(`focus did not return to delete invoker; active=${JSON.stringify(active)}`)
      }
      await shot(page, 'nested-confirm', 'settings → select Escape → nested delete confirm')
      note('嵌套确认', 'Cancel focused, Tab trapped, Escape cancelled without deletion')

      const exitWatch = observeDialogExit(page, '.settings-dialog')
      await page.getByRole('button', { name: '关闭设置' }).click()
      const exit = await exitWatch
      if (!exit.sawClosed) fail(`settings close skipped CSS exit (states=${JSON.stringify(exit.states)})`)
      if (!exit.detached) fail(`settings dialog remained after exit (states=${JSON.stringify(exit.states)})`)
      await settings.waitFor({ state: 'detached' })
      await page.locator('.settings-overlay').waitFor({ state: 'detached' })
      if (await page.locator('[aria-modal="true"]').count()) fail('settings close left a modal lock')
      const triggerFocused = await settingsTrigger.evaluate((el) => document.activeElement === el || el.contains(document.activeElement))
      if (!triggerFocused) fail('settings close did not restore topbar trigger focus')
      note('设置退场', `closed→detached ${Math.round(exit.duration)}ms`)

      const tokens = await page.evaluate(() => {
        const styles = getComputedStyle(document.documentElement)
        return {
          chrome: styles.getPropertyValue('--chrome-bg').trim(),
          surface: styles.getPropertyValue('--surface').trim(),
          topbar: styles.getPropertyValue('--topbar-h').trim(),
          theme: document.documentElement.getAttribute('data-theme'),
        }
      })
      if (!tokens.chrome || tokens.chrome === tokens.surface) fail(`chrome/paper tokens collapsed: ${JSON.stringify(tokens)}`)
      if (tokens.topbar !== '52px') fail(`topbar token is ${tokens.topbar}, expected 52px`)

      await page.getByRole('button', { name: /主题（当前纸）/ }).click()
      await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'ink')
      await shot(page, 'workbench-ink', '工作台 · 墨主题 chrome')
      await page.getByRole('button', { name: /主题（当前墨）/ }).click()

      const manuscriptRow = page.locator('.tree .tree-directory-row', { has: page.getByText('正文', { exact: true }) }).first()
      const manuscriptToggle = manuscriptRow.locator('.tree-row').first()
      if (await manuscriptToggle.count() && (await manuscriptToggle.getAttribute('aria-expanded')) !== 'true') {
        await manuscriptToggle.click()
      }
      const chapter = page.locator('.tree .tree-row', { hasText: '001.md' }).first()
      await chapter.waitFor({ state: 'visible' })
      const rowBox = await chapter.boundingBox()
      await chapter.click({ button: 'right' })
      const menu = page.locator('.file-context-menu')
      await menu.waitFor({ state: 'visible' })
      const menuBox = await menu.boundingBox()
      if (!rowBox || !menuBox) fail('file context menu has no box')
      if (menuBox.x < 0 || menuBox.y < 0 || menuBox.x + menuBox.width > 1441) fail(`file menu escaped viewport: ${JSON.stringify(menuBox)}`)
      if (Math.abs(menuBox.x - rowBox.x) > 420 || Math.abs(menuBox.y - rowBox.y) > 420) fail(`file menu not near row: row=${JSON.stringify(rowBox)} menu=${JSON.stringify(menuBox)}`)
      await page.keyboard.press('ArrowDown')
      const highlighted = await menu.locator('[data-highlighted], [data-highlighted="true"]').count()
      if (!highlighted) fail('keyboard did not highlight a file menu item')
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'detached' })
      const rowStillFocused = await chapter.evaluate((el) => el === document.activeElement || el.contains(document.activeElement))
      if (!rowStillFocused) {
        const active = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.slice(0, 40) || document.activeElement?.tagName)
        if (active === 'BODY') fail('file menu Escape restored to body instead of the tree row')
      }
      note('文件菜单', 'right-click placement, keyboard navigation, Escape returns row')

      const prompt = page.locator('.prompt-dialog')
      const filesBeforeMenu = new Set(await readdir(resolve(workspace, '正文')))
      await chapter.click({ button: 'right' })
      await menu.waitFor({ state: 'visible' })
      await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
      await prompt.waitFor({ state: 'visible' })
      await page.keyboard.press('Escape')
      await prompt.waitFor({ state: 'detached' })
      const renameFocus = await chapter.evaluate((el) => el === document.activeElement || el.contains(document.activeElement))
      const renameActive = await page.evaluate(() => document.activeElement?.tagName)
      if (!renameFocus && renameActive === 'BODY') fail('rename Escape restored to body, not the tree row')
      await chapter.click({ button: 'right' })
      await menu.waitFor({ state: 'visible' })
      await page.getByRole('menuitem', { name: '删除', exact: true }).click()
      const deleteConfirm = page.locator('.confirm-dialog')
      await deleteConfirm.waitFor({ state: 'visible' })
      await deleteConfirm.getByRole('button', { name: '取消' }).click()
      await deleteConfirm.waitFor({ state: 'detached' })
      const deleteFocus = await chapter.evaluate((el) => el === document.activeElement || el.contains(document.activeElement))
      const deleteActive = await page.evaluate(() => document.activeElement?.tagName)
      if (!deleteFocus && deleteActive === 'BODY') fail('delete Cancel restored to body, not the tree row')
      const filesAfterMenu = new Set(await readdir(resolve(workspace, '正文')))
      const mutated = workspaceFilesUnchanged(filesBeforeMenu, filesAfterMenu)
      if (mutated.length) fail(`menu dialog cancel mutated files: ${mutated.join(', ')}`)
      note('菜单焦点', 'rename/delete cancel returned to tree row without mutation')

      const searchBox = page.locator('.sidebar input.side-search')
      await searchBox.click()
      const searchPanel = page.getByRole('region', { name: '全文搜索' })
      await searchPanel.waitFor({ state: 'visible' })
      const scope = searchPanel.getByRole('combobox', { name: '搜索范围' })
      await scope.waitFor({ state: 'visible' })
      const visibleNativeScope = await searchPanel.locator('select').evaluateAll((els) => els.some((el) => {
        const style = getComputedStyle(el)
        const box = el.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && box.width > 2 && box.height > 2
      }))
      if (visibleNativeScope) fail('search scope still uses a visible native select')
      await scope.click()
      const scopeList = page.getByRole('listbox')
      await scopeList.waitFor({ state: 'visible' })
      await page.getByRole('option', { name: '仅正文' }).click()
      await scopeList.waitFor({ state: 'detached' })
      await searchBox.fill('码头')
      await searchPanel.getByRole('button', { name: '开始搜索' }).click()
      await searchPanel.getByText(/处 · 已查/).waitFor({ state: 'visible', timeout: 10_000 })
      note('搜索范围', 'host combobox 仅正文; Radix hidden select proxy allowed')

      const imageRow = page.locator('.tree .tree-row', { hasText: 'cover.png' }).first()
      await imageRow.waitFor({ state: 'visible' })
      await imageRow.click()
      const preview = page.locator('.image-preview-dialog')
      await preview.waitFor({ state: 'visible' })
      const closePreview = preview.getByRole('button', { name: '关闭预览' })
      await closePreview.waitFor({ state: 'visible' })
      if (!(await closePreview.evaluate((el) => document.activeElement === el))) fail('image preview did not focus close')
      const imgBox = await preview.locator('img').boundingBox()
      const vp = page.viewportSize()
      if (!imgBox || !vp) fail('image preview has no box')
      if (imgBox.x < 0 || imgBox.y < 0 || imgBox.x + imgBox.width > vp.width + 1 || imgBox.y + imgBox.height > vp.height + 1) {
        fail(`image preview escaped viewport: ${JSON.stringify(imgBox)} vp=${JSON.stringify(vp)}`)
      }
      const previewExit = observeDialogExit(page, '.image-preview-dialog')
      await page.keyboard.press('Escape')
      const previewGone = await previewExit
      if (!previewGone.sawClosed) fail(`image preview skipped CSS exit (states=${JSON.stringify(previewGone.states)})`)
      await preview.waitFor({ state: 'detached' })
      const imageRowFocused = await imageRow.evaluate((el) => el === document.activeElement || el.contains(document.activeElement))
      if (!imageRowFocused) {
        const active = await page.evaluate(() => document.activeElement?.tagName)
        if (active === 'BODY') fail('image preview Escape restored to body')
      }
      note('图像预览', 'focus close, bounds, Escape CSS exit')

      const manuscript = page.locator('.tree .tree-directory-row', { has: page.getByText('正文', { exact: true }) }).first()
      await manuscript.click({ button: 'right' })
      await menu.waitFor({ state: 'visible' })
      const newFile = page.getByRole('menuitem', { name: '新建文件', exact: true })
      if (!(await newFile.count())) fail('directory menu is missing 新建文件')
      await newFile.click()
      await prompt.waitFor({ state: 'visible' })
      const promptInput = prompt.locator('input').first()
      await promptInput.fill('ime-probe.md')
      const beforeFiles = new Set(await readdir(resolve(workspace, '正文')))
      const composing = await pressTrustedEnterWithFlags(page, promptInput, { isComposing: true, keyCode: 13 })
      if (!composing?.trusted) fail(`IME isComposing Enter was not trusted: ${JSON.stringify(composing)}`)
      if (!composing.defaultPrevented) fail('IME isComposing Enter did not preventDefault (guard missing?)')
      if (!(await prompt.isVisible())) fail('IME isComposing Enter submitted the new-file prompt')
      const key229 = await pressTrustedEnterWithFlags(page, promptInput, { isComposing: false, keyCode: 229 })
      if (!key229?.trusted) fail(`IME keyCode 229 Enter was not trusted: ${JSON.stringify(key229)}`)
      if (!key229.defaultPrevented) fail('IME keyCode 229 Enter did not preventDefault (guard missing?)')
      if (!(await prompt.isVisible())) fail('IME keyCode 229 Enter submitted the new-file prompt')
      const afterIme = new Set(await readdir(resolve(workspace, '正文')))
      const imeCreated = workspaceFilesUnchanged(beforeFiles, afterIme)
      if (imeCreated.length) fail(`IME Enter created a file: ${imeCreated.join(', ')}`)
      await page.keyboard.press('Escape')
      await prompt.waitFor({ state: 'detached' })
      const chapterAfterIme = page.locator('.tree .tree-row', { hasText: '001.md' }).first()
      await chapterAfterIme.click({ button: 'right' })
      await menu.waitFor({ state: 'visible' })
      await page.getByRole('menuitem', { name: '新建文件', exact: true }).click()
      await prompt.waitFor({ state: 'visible' })
      const createInput = prompt.locator('input').first()
      await createInput.fill('ime-control.md')
      const beforeControl = new Set(await readdir(resolve(workspace, '正文')))
      await createInput.press('Enter')
      await prompt.waitFor({ state: 'detached', timeout: 8_000 })
      const afterControl = new Set(await readdir(resolve(workspace, '正文')))
      const created = workspaceFilesUnchanged(beforeControl, afterControl)
      if (!created.some((name) => name === 'ime-control.md' || name.startsWith('ime-control'))) {
        fail(`non-IME Enter did not create the control file; added=${JSON.stringify(created)}`)
      }
      note('IME', 'trusted composing/229 blocked; non-IME Enter created ime-control.md')

      const editor = page.locator('[data-testid="paper-editor"] .cm-content')
      if (await editor.count()) {
        await editor.click()
        await page.keyboard.type('dirty-guard')
        await returnHome(page, { menuItem: true })
        if (await page.locator('.home-stage').isVisible().catch(() => false)) fail('dirty editor was allowed to leave home')
        if (!(await page.locator('.tree').isVisible())) fail('dirty cancel did not keep the workbench')
        note('dirty 取消', 'unsaved editor blocked first home leave')
      }

      await settingsTrigger.click()
      await settings.waitFor({ state: 'visible' })
      await page.keyboard.press('Escape')
      await settingsTrigger.click()
      const liveSettings = page.locator('.settings-dialog[data-state="open"]')
      await liveSettings.waitFor({ state: 'visible' })
      await liveSettings.getByRole('tab', { name: '通用设置', exact: true }).click()
      const languageCombo = liveSettings.getByRole('combobox', { name: '语言', exact: true })
      await languageCombo.waitFor({ state: 'visible' })
      if (!(await languageCombo.isVisible()) || !(await languageCombo.isEnabled())) fail('rapid open during exit left settings unusable')
      await languageCombo.click()
      const languageList = page.getByRole('listbox', { name: '语言' })
      await languageList.waitFor({ state: 'visible' })
      const listFocus = await languageList.evaluate((el) => el === document.activeElement || el.contains(document.activeElement))
      const dialogFocus = await liveSettings.evaluate((el) => el.contains(document.activeElement))
      if (!listFocus && !dialogFocus) fail('rapid reopen language listbox left the settings focus trap')
      await page.keyboard.press('Escape')
      await languageList.waitFor({ state: 'detached' })
      if (!(await liveSettings.isVisible()) || (await liveSettings.getAttribute('data-state')) !== 'open') {
        fail('Escape from language select closed parent settings after rapid reopen')
      }
      if (!(await languageCombo.evaluate((el) => document.activeElement === el))) fail('language combobox did not keep focus after list Escape')
      await page.keyboard.press('Tab')
      if (!(await liveSettings.evaluate((el) => el.contains(document.activeElement)))) fail('Tab left settings after rapid reopen')
      const rapidWatch = observeDialogExit(page, '.settings-dialog')
      await page.keyboard.press('Escape')
      const rapidExit = await rapidWatch
      if (!rapidExit.sawClosed) fail(`rapid-open follow-up close skipped CSS exit (states=${JSON.stringify(rapidExit.states)})`)
      await settings.waitFor({ state: 'detached' })
      await page.locator('.settings-overlay').waitFor({ state: 'detached' })

      await page.setViewportSize({ width: 1280, height: 720 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await settingsTrigger.click()
      await settings.waitFor({ state: 'visible' })
      const dialogMotion = await settings.evaluate((el) => getComputedStyle(el).animationName)
      if (dialogMotion !== 'none') fail(`settings dialog ignores reduced motion: ${dialogMotion}`)
      await page.keyboard.press('Escape')
      await settings.waitFor({ state: 'detached' })
      await shot(page, 'min-desktop', '1280x720 + reduced motion')
    }

    const video = page.video()
    await context.close()
    context = undefined
    if (video) {
      const raw = await video.path()
      const dest = resolve(output, `${videoName}.webm`)
      try { await rename(raw, dest) } catch { await cp(raw, dest) }
      note('视频', dest.replace(`${root}${sep}`, ''))
    }
  } catch (error) {
    fail(`${label}: ${error instanceof Error ? error.stack || error.message : String(error)}`)
    if (context) {
      for (const openPage of context.pages()) {
        await openPage.screenshot({ path: resolve(output, `${label}-failure.png`), fullPage: true }).catch(() => undefined)
      }
    }
  } finally {
    if (context) await context.close().catch(() => undefined)
    if (browser) await browser.close().catch(() => undefined)
    if (dshChild) await stop(dshChild)
  }
}

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await rm(beforeTemplate, { recursive: true, force: true })
await cp(baselineTemplate, beforeTemplate, { recursive: true })

note('before', 'baseline template first-return video')
await runSession({
  label: 'before',
  home: beforeHome,
  workspace: beforeWorkspace,
  template: beforeTemplate,
  videoName: 'before',
  fullChecks: false,
})

note('after', 'current build first-return + settings chain')
await runSession({
  label: 'after',
  home: afterHome,
  workspace: afterWorkspace,
  template: currentTemplate,
  videoName: 'after',
  fullChecks: true,
})

const report = {
  ok: failures.length === 0,
  failures,
  notes,
  screenshots,
  videos: ['e2e/out/ui-overhaul/before.webm', 'e2e/out/ui-overhaul/after.webm'],
  startedAt: new Date().toISOString(),
}
await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ ok: report.ok, failures: report.failures, shots: screenshots.length }, null, 2))
if (!report.ok) process.exitCode = 1
