/**
 * Command palette smoke test for the DSH Editor shell.
 *
 * Boots DSH under the dedicated `dsh-editor` profile with an isolated
 * DSH_HOME, opens a seeded workspace, exercises the Cmd/Ctrl+K palette
 * trigger button in the topbar, and captures one screenshot per theme so
 * the rendered overlay can be visually audited. The script never calls
 * any external model and never mutates user state outside its own
 * scratch directories.
 *
 * Output goes to `e2e/out/palette/` — a directory exclusive to this test
 * so that other e2e scripts (which wipe their own `e2e/out/<name>/` at
 * startup) cannot delete these artifacts.
 */
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const home = resolve(devRoot, 'palette-home')
const workspace = resolve(devRoot, 'palette-workspace')
const output = resolve(root, 'e2e', 'out', 'palette')

for (const target of [home, workspace, output]) {
  if (!target.startsWith(`${devRoot}${sep}`) && !target.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) {
    throw new Error(`unsafe path: ${target}`)
  }
}

resolveDshInstallation('0.1.5-rc.2')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')

const failures = []
const notes = []
let browser
let dshChild

function note(label, detail = '') {
  notes.push({ label, detail, at: new Date().toISOString() })
  console.log(`[palette-e2e] ${label}${detail ? ` — ${detail}` : ''}`)
}

function fail(message) {
  failures.push(message)
  console.error(`[palette-e2e] ${message}`)
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

let shotIndex = 0
async function shot(page, name, intent) {
  shotIndex += 1
  const file = resolve(output, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await page.waitForTimeout(220)
  await page.screenshot({ path: file })
  note('截图', `${name} — ${intent}`)
}

await rm(workspace, { recursive: true, force: true })
await rm(home, { recursive: true, force: true })
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await mkdir(resolve(home, 'electron-user-data'), { recursive: true })
await mkdir(resolve(workspace, '正文'), { recursive: true })
await mkdir(resolve(workspace, '大纲'), { recursive: true })
await writeFile(resolve(workspace, '正文', '001.md'), '# 第一章 试笔\n\n雾比灯先到，把码头的广播塔切成一段一段的影子。\n')
await writeFile(resolve(workspace, '大纲', '总纲.md'), '# 总纲\n')

const env = {
  ...process.env,
  DSH_TELEMETRY_DISABLED: '1',
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: cli,
  DSH_DESKTOP_PROFILE_TEMPLATE: template,
  DSH_HOME: home,
  DSH_EDITOR_PROJECTS_ROOT: resolve(devRoot, 'palette-projects'),
  DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
  SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-palette',
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
  page.on('pageerror', (error) => fail(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })

  await page.goto(started.url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell')),
    undefined,
    { timeout: 45_000 },
  )
  await dismissNativeOnboarding(page)
  await dismissNativeOnboarding(page)

  // The home chrome must host the palette trigger alongside the native
  // settings control — verify it exists before exercising it.
  const homeTrigger = page.getByRole('button', { name: '搜索与命令' })
  if (!(await homeTrigger.count())) fail('home chrome is missing the command palette trigger')

  // Walk into the seeded workspace so the palette can also list its
  // markdown files under the "跳转到文档" group.
  await page.getByRole('button', { name: '打开作品' }).first().click()
  const pathBox = page.getByLabel('作品文件夹路径')
  await pathBox.waitFor({ state: 'visible' })
  await pathBox.fill(workspace)
  await page.getByRole('button', { name: '打开此目录' }).click()
  await page.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })

  const workbenchTrigger = page.getByRole('button', { name: '搜索与命令' })
  if (!(await workbenchTrigger.count())) fail('workbench chrome is missing the command palette trigger')

  // Open the palette via the topbar trigger and capture the paper-theme
  // snapshot. The default selection lands on the first workspace command
  // ("打开作品"), giving the accent-soft highlight something to render.
  await workbenchTrigger.click()
  const overlay = page.locator('.palette-overlay')
  await overlay.waitFor({ state: 'visible', timeout: 5_000 })
  const content = page.locator('.palette-content')
  await content.waitFor({ state: 'visible' })
  const searchInput = content.locator('input[cmdk-input]')
  if (!(await searchInput.count())) fail('palette search input is not mounted')
  // Group headings are rendered by cmdk as <div cmdk-group-heading="">; match
  // them by the attribute-with-empty-value form and read the text content of
  // each one so the assertion stays stable if cmdk ever reorders groups.
  const headingTexts = await content.locator('[cmdk-group-heading=""]').allTextContents()
  if (headingTexts.join('|') !== '作品|写作|视图|跳转到文档') {
    fail(`paper palette group headings drifted: ${JSON.stringify(headingTexts)}`)
  }
  // The "跳转到文档" group should list the seeded 001.md chapter; the cmdk
  // item text is the concatenation of label + hint, so just check the label
  // substring rather than asserting an exact textContent.
  const fileItems = await content.locator('[cmdk-item=""]').allTextContents()
  if (!fileItems.some((text) => text.includes('001.md'))) {
    fail(`paper palette is missing the seeded 001.md file entry: ${JSON.stringify(fileItems)}`)
  }
  // The default selection lands on the first item ("打开作品"), which
  // should carry aria-selected="true" out of the box.
  const firstSelected = await content.locator('[cmdk-item=""][aria-selected="true"]').first().textContent()
  if (!firstSelected || !firstSelected.includes('打开作品')) {
    fail(`first item should be pre-selected as "打开作品"; got ${JSON.stringify(firstSelected)}`)
  }
  await shot(page, 'palette-paper', '命令面板打开，纸主题，默认全部命令')

  // Close via ESC to verify the keyboard path works before re-opening
  // through the global Cmd/Ctrl+K shortcut.
  await page.keyboard.press('Escape')
  await overlay.waitFor({ state: 'detached', timeout: 5_000 })

  // Re-open via the documented Cmd/Ctrl+K shortcut. On non-mac the
  // playwright modifier is "Control", matching the listener's
  // (ctrlKey || metaKey) check.
  await page.keyboard.press('Control+k')
  await overlay.waitFor({ state: 'visible', timeout: 5_000 })
  // Toggle closed with the same shortcut — proves Cmd+K is a true
  // toggle, not an open-only binding.
  await page.keyboard.press('Control+k')
  await overlay.waitFor({ state: 'detached', timeout: 5_000 })

  // Switch to ink theme and re-open the palette for the second shot.
  await page.getByRole('button', { name: /主题（当前纸）/ }).click()
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'ink')
  await page.waitForTimeout(200)
  await workbenchTrigger.click()
  await content.waitFor({ state: 'visible' })
  await content.locator('input[cmdk-input]').waitFor({ state: 'visible' })
  // After the theme flipped to ink, the toggle command label must reflect
  // the inverted target ("切换到纸主题" instead of "切换到墨主题").
  const inkItemTexts = await content.locator('[cmdk-item=""]').allTextContents()
  if (!inkItemTexts.some((text) => text.includes('切换到纸主题'))) {
    fail(`ink palette should offer a "切换到纸主题" toggle; got ${JSON.stringify(inkItemTexts)}`)
  }
  await shot(page, 'palette-ink', '命令面板打开，墨主题，确认 token 反转正确')

  // Exercise the shared Radix Select in a real settings dialog. Escape must
  // dismiss only the nested list and restore focus, in both shell themes.
  await page.keyboard.press('Escape')
  await overlay.waitFor({ state: 'detached' })
  for (const theme of ['paper', 'ink']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) {
      await page.locator('.chrome .theme-toggle').click()
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme)
    }
    await page.locator('.native-settings-control button').first().click()
    const settings = page.locator('.settings-dialog')
    await settings.waitFor({ state: 'visible' })
    const language = settings.locator('.select-trigger').first()
    await language.focus()
    await page.keyboard.press('ArrowDown')
    const list = page.getByRole('listbox')
    await list.waitFor({ state: 'visible' })
    const box = await list.boundingBox()
    const viewport = page.viewportSize()
    if (!box || box.x < 0 || box.y < 0 || box.x + box.width > viewport.width + 1 || box.y + box.height > viewport.height + 1) {
      fail(`select escaped viewport in ${theme}`)
    }
    const themeColours = await list.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }))
    if (themeColours.bg === 'rgba(0, 0, 0, 0)' || themeColours.bg === themeColours.fg) fail(`select has unreadable theme colours in ${theme}`)
    await shot(page, `select-${theme}`, '设置下拉：浮层位置、选中状态与主题')
    await page.keyboard.press('Escape')
    await list.waitFor({ state: 'detached' })
    if (!(await settings.isVisible())) fail('Escape from select closed parent settings')
    if (!(await language.evaluate((el) => document.activeElement === el))) fail('Escape did not restore select trigger focus')

    // Exercise the existing persisted preference through keyboard selection.
    const preference = settings.locator('.select-trigger').nth(1)
    const before = await preference.textContent()
    await preference.focus()
    await page.keyboard.press('ArrowDown')
    await list.waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'option')
    await page.keyboard.press('End')
    await page.waitForFunction(() => document.activeElement?.textContent?.includes('插话发送'))
    await page.keyboard.press('Enter')
    await list.waitFor({ state: 'detached' })
    await page.waitForFunction(() => document.querySelectorAll('.settings-dialog .select-trigger')[1]?.textContent?.includes('插话发送'), undefined, { timeout: 5000 })
    if (before === await preference.textContent()) fail('keyboard selection did not change preference')
    await preference.click()
    await list.waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'option')
    await page.keyboard.press('Home')
    await page.waitForFunction(() => document.activeElement?.textContent?.includes('排队发送'))
    await page.keyboard.press('Enter')
    await list.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: '关闭设置' }).click()
    await settings.waitFor({ state: 'detached' })
  }

  // Portaled overlays are outside .shell; reduced motion must cover them too.
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await workbenchTrigger.click()
  await content.waitFor({ state: 'visible' })
  const still = await content.evaluate((el) => ({ animation: getComputedStyle(el).animationName, transition: getComputedStyle(el).transitionDuration }))
  if (still.animation !== 'none' || still.transition.split(',').some((value) => parseFloat(value) !== 0)) fail(`palette ignores reduced motion: ${JSON.stringify(still)}`)
  await page.keyboard.press('Escape')
  await overlay.waitFor({ state: 'detached' })
  await page.locator('.native-settings-control button').first().click()
  await page.locator('.settings-dialog .select-trigger').first().click()
  const reducedList = page.getByRole('listbox')
  await reducedList.waitFor({ state: 'visible' })
  if (await reducedList.evaluate((el) => getComputedStyle(el).animationName) !== 'none') fail('select ignores reduced motion')
  const narrowBox = await reducedList.boundingBox()
  if (!narrowBox || narrowBox.x < 0 || narrowBox.y < 0 || narrowBox.x + narrowBox.width > 1281 || narrowBox.y + narrowBox.height > 721) fail('select escaped narrow viewport')
  await shot(page, 'select-narrow', '最小桌面窗口与减少动态效果')
  await page.keyboard.press('Escape')
  await reducedList.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '关闭设置' }).click()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  note('交互验收', '纸墨主题、键盘选择、嵌套 Escape、焦点返回、减少动态效果')
  if (browserErrors.length) failures.push(...browserErrors)
} catch (error) {
  if (browser) {
    const pages = browser.contexts().flatMap((context) => context.pages())
    for (const page of pages) {
      await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => undefined)
    }
  }
  fail(error instanceof Error ? error.stack || error.message : String(error))
} finally {
  if (browser) await browser.close().catch(() => undefined)
  if (dshChild) await stop(dshChild)
}

const report = { ok: failures.length === 0, failures, notes, startedAt: new Date().toISOString() }
await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ ok: report.ok, failures: report.failures, notes: report.notes.length }, null, 2))
if (!report.ok) process.exitCode = 1
