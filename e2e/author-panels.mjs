/**
 * Focused M3 author-panel acceptance.
 *
 * Isolated fixtures: `.dev/author-panels-*` and `e2e/out/author-panels`.
 * Real local DSH host plus synthetic RPC routes. Never reads credentials
 * or invokes paid models.
 *
 * Runtime command (after primary exclusive e2e/build lease + integrated build):
 *   node e2e/author-panels.mjs
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const home = resolve(devRoot, 'author-panels-home')
const workspace = resolve(devRoot, 'author-panels-workspace')
const output = resolve(root, 'e2e', 'out', 'author-panels')

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
const checks = []
const screenshots = []
let browser
let dshChild
let shotIndex = 0

function note(label, detail = '') {
  notes.push({ label, detail, at: new Date().toISOString() })
  console.log(`[author-panels] ${label}${detail ? ` — ${detail}` : ''}`)
}
function fail(message) {
  failures.push(message)
  console.error(`[author-panels] ${message}`)
}
function ok(label) {
  checks.push(label)
  note('check', label)
}
function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)) }

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
async function exists(target) {
  try { await stat(target); return true } catch { return false }
}
async function waitFor(probe, label, timeout = 15_000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = await probe()
    if (last) return last
    await delay(120)
  }
  throw new Error(`${label} timed out`)
}

function memorySummary(memory) {
  return memory.getByRole('button', { name: '记录港口为海关闸口' })
}

async function waitMemoryRowStatus(memory, status) {
  const row = memorySummary(memory)
  await row.scrollIntoViewIfNeeded()
  await waitFor(async () => {
    const text = await row.innerText()
    return text.includes(status) ? text : null
  }, `memory row ${status}`, 10_000)
  return row
}

async function waitMemoryRowStableExpanded(memory, { undoVisible = false } = {}) {
  const row = memorySummary(memory)
  let hits = 0
  await waitFor(async () => {
    const expanded = await row.getAttribute('aria-expanded')
    if (expanded !== 'true') {
      hits = 0
      return null
    }
    if (undoVisible) {
      const undo = memory.getByRole('button', { name: '撤销写入' })
      if (await undo.count() === 0 || !(await undo.isVisible())) {
        hits = 0
        return null
      }
    }
    hits += 1
    return hits >= 3 ? row : null
  }, undoVisible ? 'memory row stayed expanded with undo after apply' : 'memory row expanded', 10_000)
  return row
}

async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise((resolveExit) => child.once('exit', () => resolveExit(true))),
    delay(5_000).then(() => false),
  ])
  if (!exited && process.platform === 'win32' && child.pid) {
    await new Promise((resolveKill) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('error', () => resolveKill())
      killer.once('exit', () => resolveKill())
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
  const ready = new Promise((resolveReady, reject) => {
    let buffer = ''
    const inspect = (chunk) => {
      const text = String(chunk)
      logs.push(text)
      buffer += text
      const match = /https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/.exec(buffer)
      if (match) resolveReady(new URL(match[0]))
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
  if (await configureLater.isVisible({ timeout: 2_000 }).catch(() => false)) await configureLater.click()
}

function hostPage(scope) {
  return typeof scope.page === 'function' ? scope.page() : scope
}

async function chooseCustomSelect(scope, ariaLabel, matcher) {
  const page = hostPage(scope)
  const trigger = scope.getByRole('combobox', { name: ariaLabel }).first()
  await trigger.waitFor({ state: 'visible', timeout: 10_000 })
  await trigger.click()
  let list = page.getByRole('listbox', { name: ariaLabel })
  if (!(await list.isVisible({ timeout: 2_000 }).catch(() => false))) {
    list = page.getByRole('listbox').last()
  }
  await list.waitFor({ state: 'visible', timeout: 10_000 })
  const options = list.getByRole('option')
  const labels = await options.allTextContents()
  const index = labels.findIndex((label) => matcher(label))
  if (index < 0) {
    await page.keyboard.press('Escape')
    throw new Error(`${ariaLabel} option not found in ${JSON.stringify(labels)}`)
  }
  await options.nth(index).click()
  await list.waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => undefined)
  return labels[index]
}

async function shot(page, name, intent) {
  shotIndex += 1
  const file = resolve(output, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await page.waitForTimeout(180)
  await page.screenshot({ path: file })
  screenshots.push({ name, file, intent })
  note('screenshot', `${name} — ${intent}`)
}

async function setTheme(page, theme) {
  const current = await page.locator('html').getAttribute('data-theme')
  if (current === theme) return
  await page.locator('.chrome .theme-toggle').click()
  await page.waitForFunction((expected) => document.documentElement.getAttribute('data-theme') === expected, theme, { timeout: 8_000 })
}

async function openZhihuSettings(page) {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.locator('.settings-nav').getByRole('tab', { name: '知乎资料', exact: true }).click()
  const embedded = page.getByTestId('zhihu-settings-embed')
  await embedded.waitFor()
  await embedded.getByRole('tab', { name: '连接测试', exact: true }).click()
}

async function rpcEnvelope(route, result) {
  const response = await route.fetch()
  const body = await response.json()
  body.result = result
  await route.fulfill({ response, json: body })
}

const memoryPending = {
  id: 'mu-e2e',
  path: '世界书/港口.md',
  summary: '记录港口为海关闸口',
  status: 'pending',
  createdAt: '2026-09-11T00:00:00.000Z',
  version: 1,
  sessionId: 's',
  update: {
    path: '世界书/港口.md',
    operation: 'edit',
    summary: '记录港口为海关闸口',
    expectedVersion: null,
    category: 'fact',
    certainty: 'explicit',
    evidence: [{ kind: 'file', path: '正文/001.md', version: '1', quote: '海关记忆税闸口' }],
    oldText: '雾港港口。',
    newText: '雾港港口是海关闸口。',
  },
  before: '雾港港口。',
  after: '雾港港口是海关闸口。',
}
let memoryRecord = { ...memoryPending }

await rm(workspace, { recursive: true, force: true })
await rm(home, { recursive: true, force: true })
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await mkdir(resolve(home, 'electron-user-data'), { recursive: true })
await mkdir(resolve(workspace, '正文'), { recursive: true })
await mkdir(resolve(workspace, '人物卡'), { recursive: true })
await mkdir(resolve(workspace, '世界书'), { recursive: true })
await writeFile(resolve(workspace, '正文', '001.md'), '# 第一章\n\n林简站在海关记忆税闸口。甲,乙。\n')
await writeFile(resolve(workspace, '人物卡', '林简.md'), '---\nname: 林简\nrole: 主角\n---\n\n维修师。\n')
await writeFile(resolve(workspace, '世界书', '港口.md'), '---\ncategory: 地点\ntriggers: [港口]\nenabled: true\npriority: 1\n---\n\n雾港港口。\n')

const env = {
  ...process.env,
  DSH_TELEMETRY_DISABLED: '1',
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: cli,
  DSH_DESKTOP_PROFILE_TEMPLATE: template,
  DSH_HOME: home,
  DSH_EDITOR_PROJECTS_ROOT: resolve(devRoot, 'author-panels-projects'),
  DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
  SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-author-panels',
  DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key',
}
delete env.DSH_EDITOR_CUSTOM_API_KEY
await deployProfile(home, template, resolve(runtime, 'node_modules'))

const report = { ok: false, checks, failures, notes, screenshots }

try {
  const started = await startDsh(env)
  dshChild = started.child
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  page.setDefaultTimeout(20_000)
  page.on('pageerror', (error) => fail(`pageerror: ${error.message}`))

  await page.route('**/dsh-editor-workbench/memory.**', async (route) => {
    const url = route.request().url()
    try {
      if (url.includes('memory.list')) {
        await rpcEnvelope(route, { ok: true, value: { items: [{ id: memoryRecord.id, path: memoryRecord.path, summary: memoryRecord.summary, status: memoryRecord.status, createdAt: memoryRecord.createdAt }] } })
        return
      }
      if (url.includes('memory.get')) {
        await rpcEnvelope(route, { ok: true, value: { record: memoryRecord } })
        return
      }
      if (url.includes('memory.apply')) {
        memoryRecord = { ...memoryRecord, status: 'applied' }
        await rpcEnvelope(route, { ok: true, value: { marker: 'dsh-editor.memory-update', version: 1, id: memoryRecord.id, path: memoryRecord.path, summary: memoryRecord.summary, status: 'applied', createdAt: memoryRecord.createdAt } })
        return
      }
      if (url.includes('memory.undo')) {
        memoryRecord = { ...memoryRecord, status: 'undone' }
        await rpcEnvelope(route, { ok: true, value: { marker: 'dsh-editor.memory-update', version: 1, id: memoryRecord.id, path: memoryRecord.path, summary: memoryRecord.summary, status: 'undone', createdAt: memoryRecord.createdAt } })
        return
      }
    } catch (error) {
      throw new Error(`memory route failed: ${error}`)
    }
    await route.continue()
  })

  await page.goto(started.url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell')),
    undefined,
    { timeout: 45_000 },
  )
  await dismissNativeOnboarding(page)
  await page.getByRole('button', { name: '打开作品' }).first().click()
  const pathBox = page.getByLabel('作品文件夹路径')
  await pathBox.waitFor({ state: 'visible' })
  await pathBox.fill(workspace)
  await page.getByRole('button', { name: '打开此目录' }).click()
  await page.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })
  await setTheme(page, 'paper')

  await page.keyboard.press('Control+Shift+C')
  const cards = page.getByRole('region', { name: '人物卡' })
  await cards.waitFor({ state: 'visible' })
  await cards.getByText('林简').first().waitFor()
  await shot(page, 'cards-paper', '人物卡列表 纸')
  await cards.getByRole('button', { name: '林简' }).first().click()
  const detail = page.getByRole('region', { name: '人物卡详情' })
  await detail.waitFor({ state: 'visible' })
  await detail.getByRole('button', { name: '引用' }).click()
  await page.getByRole('button', { name: /第 \d+ 行/ }).first().waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: /第 \d+ 行/ }).first().click()
  await page.locator('[data-testid="paper-path"]', { hasText: '正文/001.md' }).waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('[data-testid="paper-editor"]').waitFor({ state: 'visible', timeout: 15_000 })
  if (await detail.isVisible().catch(() => false)) throw new Error('cards detail overlay still covering manuscript after same-chapter reference')
  await waitFor(async () => {
    const selected = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="paper-editor"]')
      const view = /** @type {any} */ (el)?.__cmView
      if (!view) return ''
      const main = view.state.selection.main
      return view.state.doc.sliceString(main.from, main.to)
    })
    return selected.includes('林简') ? selected : null
  }, 'same-chapter reference range 林简', 8_000)
  ok('cards reference jump')
  await cards.waitFor({ state: 'visible' })
  await page.keyboard.press('Control+Shift+C')
  await cards.waitFor({ state: 'visible' })
  await cards.getByRole('button', { name: '新建人物卡' }).click()
  const create = page.getByRole('dialog', { name: '新建人物卡' })
  await create.waitFor({ state: 'visible' })
  const portal = page.locator('.dsh-ui.file-dialog, .dsh-ui.prompt-dialog').first()
  await portal.waitFor({ state: 'visible' })
  const portalBox = await portal.boundingBox()
  if (!portalBox || portalBox.width < 200) throw new Error(`create dialog portal bounds unexpected ${JSON.stringify(portalBox)}`)
  const title = create.getByLabel('卡片标题')
  await title.fill('IME角色')
  const composing = await pressTrustedEnterWithFlags(page, title, { isComposing: true, keyCode: 13 })
  if (!composing?.trusted) throw new Error(`cards IME isComposing Enter was not trusted: ${JSON.stringify(composing)}`)
  if (!composing.defaultPrevented) throw new Error('cards IME isComposing Enter did not preventDefault')
  if (!(await create.isVisible())) throw new Error('cards IME isComposing Enter submitted')
  if (await exists(resolve(workspace, '人物卡', 'IME角色.md'))) throw new Error('IME isComposing Enter created a card')
  const key229 = await pressTrustedEnterWithFlags(page, title, { isComposing: false, keyCode: 229 })
  if (!key229?.trusted) throw new Error(`cards IME keyCode 229 Enter was not trusted: ${JSON.stringify(key229)}`)
  if (!key229.defaultPrevented) throw new Error('cards IME keyCode 229 Enter did not preventDefault')
  if (!(await create.isVisible())) throw new Error('cards IME keyCode 229 Enter submitted')
  if (await exists(resolve(workspace, '人物卡', 'IME角色.md'))) throw new Error('IME keyCode 229 Enter created a card')
  ok('cards create IME Enter does not mutate')
  await title.press('Enter')
  await waitFor(() => exists(resolve(workspace, '人物卡', 'IME角色.md')), 'created IME角色.md', 15_000)
  await create.waitFor({ state: 'hidden', timeout: 15_000 })
  await page.locator('[data-testid="paper-path"]', { hasText: '人物卡/IME角色.md' }).waitFor({ state: 'visible', timeout: 15_000 })
  ok('cards create normal Enter')
  await cards.getByRole('button', { name: '关闭卡片面板' }).click()
  await cards.waitFor({ state: 'hidden', timeout: 8_000 })
  ok('cards close')

  await page.keyboard.press('Control+Shift+W')
  const world = page.getByRole('region', { name: '世界书' })
  await world.waitFor({ state: 'visible' })
  await world.getByText('港口').first().click()
  const worldDetail = page.getByRole('region', { name: '世界书详情' })
  await worldDetail.waitFor({ state: 'visible' })
  await chooseCustomSelect(page, '世界书分类', (label) => label.includes('地点'))
  await worldDetail.getByRole('button', { name: '保存', exact: true }).click()
  await waitFor(async () => {
    const text = await readFile(resolve(workspace, '世界书', '港口.md'), 'utf8')
    return text.includes('category: 地点')
  }, 'worldbook category persisted', 10_000)
  ok('worldbook category Select persist')
  await worldDetail.getByRole('button', { name: '关闭卡片详情' }).click()

  await page.keyboard.press('Control+Shift+O')
  const overview = page.getByRole('region', { name: '作品概览' })
  await overview.waitFor({ state: 'visible' })
  await overview.getByRole('region', { name: '章节列表' }).waitFor()
  await shot(page, 'overview-paper', '作品概览 纸')
  await chooseCustomSelect(page, /章节状态/, (label) => label.includes('已定稿') || label.includes('Final'))
  await waitFor(async () => {
    const raw = await readFile(resolve(workspace, '.dsh-editor', 'chapter-status.json'), 'utf8').catch(() => '')
    return raw.includes('final')
  }, 'chapter status persisted', 10_000)
  ok('overview chapter status Select persist')
  await overview.getByRole('button', { name: '关闭概览' }).click()
  await overview.waitFor({ state: 'hidden', timeout: 8_000 })
  ok('overview close')

  await page.keyboard.press('Control+Shift+L')
  if (await page.getByRole('region', { name: '校对', exact: true }).count()) throw new Error('paused proofreading panel is visible')
  ok('private proofreading panel is paused')

  await page.getByRole('button', { name: '搜索与命令' }).click()
  const palette = page.locator('.palette-content input')
  await palette.waitFor({ state: 'visible' })
  await palette.fill('记忆维护')
  await page.locator('.palette-item').filter({hasText:'记忆维护'}).click()
  const memory = page.getByRole('region', { name: '记忆更新' })
  await memory.waitFor({ state: 'visible', timeout: 10_000 })
  await memory.getByText('记录港口为海关闸口').waitFor()
  const summary = memorySummary(memory)
  await waitMemoryRowStatus(memory, '待确认')
  await summary.scrollIntoViewIfNeeded()
  await summary.click()
  await waitMemoryRowStableExpanded(memory)
  await memory.getByText('正文/001.md').waitFor()
  const confirm = memory.getByRole('button', { name: '确认写入' })
  await confirm.waitFor()
  await confirm.scrollIntoViewIfNeeded()
  await confirm.click()
  await waitMemoryRowStatus(memory, '已应用')
  await waitMemoryRowStableExpanded(memory, { undoVisible: true })
  const undo = memory.getByRole('button', { name: '撤销写入' })
  await undo.scrollIntoViewIfNeeded()
  await undo.click()
  await waitMemoryRowStatus(memory, '已撤销')
  await waitMemoryRowStableExpanded(memory)
  const undoneRow = await summary.innerText()
  if (!undoneRow.includes('已撤销')) throw new Error(`memory undone row missing status: ${undoneRow}`)
  ok('memory list/detail/apply/undo')
  await memory.getByRole('button', { name: '关闭记忆面板' }).click()
  await memory.waitFor({ state: 'hidden', timeout: 8_000 })
  ok('memory close')

  if (await page.getByTestId('proofread-open').count()) throw new Error('paused quick proofreading launcher is visible')
  if (await page.getByTestId('zhihu-open').count()) throw new Error('Zhihu launcher must be inside settings')
  ok('desktop proofread and Zhihu launchers remain absent')

  await openZhihuSettings(page)
  const zhihu = page.getByTestId('zhihu-settings-embed')
  await zhihu.waitFor({ state: 'visible' })
  await page.route('**/zhihu/search', async (route) => {
    await rpcEnvelope(route, {
      ok: true,
      value: { items: [{ title: '合成资料', type: '回答', url: 'https://www.zhihu.com/x', summary: '合成', votes: 0, comments: 0, author: '测试', editTime: '' }] },
    })
  })
  await zhihu.getByTestId('zhihu-query').fill('合成查询')
  await zhihu.getByTestId('zhihu-search').click()
  await zhihu.getByTestId('zhihu-results').waitFor({ timeout: 10_000 })
  await shot(page, 'zhihu-paper', '知乎 纸')
  await page.keyboard.press('Escape')
  await zhihu.waitFor({ state: 'hidden', timeout: 8_000 })
  await page.waitForFunction(() => document.activeElement === document.querySelector('.native-settings-control button'), undefined, { timeout: 8_000 })
  ok('zhihu synthetic search/close/focus return')
  await page.unroute('**/zhihu/search')

  await openZhihuSettings(page)
  await zhihu.waitFor({ state: 'visible' })
  await page.route('**/zhihu/search', async (route) => {
    await delay(400)
    await rpcEnvelope(route, { ok: true, value: { items: [] } })
  })
  await zhihu.getByTestId('zhihu-query').fill('取消查询')
  await zhihu.getByTestId('zhihu-search').click()
  await zhihu.getByRole('status').filter({ hasText: '正在请求' }).waitFor()
  await zhihu.getByRole('button', { name: '取消' }).click()
  await page.keyboard.press('Escape')
  await zhihu.waitFor({ state: 'hidden', timeout: 8_000 })
  ok('zhihu cancel then Esc close')
  await page.unroute('**/zhihu/search')

  await setTheme(page, 'ink')
  await page.keyboard.press('Control+Shift+C')
  await cards.waitFor({ state: 'visible' })
  await shot(page, 'cards-ink', '人物卡 墨')
  await cards.getByRole('button', { name: '关闭卡片面板' }).click()
  await page.keyboard.press('Control+Shift+O')
  await overview.waitFor({ state: 'visible' })
  await shot(page, 'overview-ink', '概览 墨')
  await overview.getByRole('button', { name: '关闭概览' }).click()
  await openZhihuSettings(page)
  await zhihu.waitFor({ state: 'visible' })
  await shot(page, 'zhihu-ink', '知乎 墨')
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.keyboard.press('Control+Shift+C')
  await cards.waitFor({ state: 'visible' })
  await shot(page, 'cards-min', '人物卡 1280x720')
  await cards.getByRole('button', { name: '关闭卡片面板' }).click()
  await page.keyboard.press('Control+Shift+O')
  await overview.waitFor({ state: 'visible' })
  await shot(page, 'overview-min', '概览 1280x720')
  await overview.getByRole('button', { name: '关闭概览' }).click()
  await openZhihuSettings(page)
  await zhihu.waitFor({ state: 'visible' })
  await shot(page, 'zhihu-min', '知乎 1280x720')
  ok('paper/ink/1280x720 screenshots')
} catch (error) {
  fail(String(error))
  await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
} finally {
  await browser?.close()
  await stop(dshChild)
}

report.ok = failures.length === 0
await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exitCode = 1
