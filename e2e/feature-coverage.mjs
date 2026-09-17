/**
 * Real-machine feature coverage for the DSH Editor shell.
 *
 * Boots an isolated DSH home, drives the visible UI through the current
 * generic writing workbench, then uses MiniMax-M3 for chat, rewrite, FIM,
 * and one writing_propose. Product files are created through the UI.
 *
 * Credentials default to ~/.mmx/config.json. They are never printed.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const JSZip = createRequire(resolve(root, 'packages/dsh-editor-shell/package.json'))('jszip')
const devRoot = resolve(root, '.dev')
const projectsRoot = resolve(devRoot, 'feature-coverage-projects')
const book = '功能验收'
const workspace = resolve(projectsRoot, book)
const home = resolve(devRoot, 'feature-coverage-home')
const output = resolve(root, 'e2e', 'out', 'feature-coverage')
const sendTimeout = Number(process.env.E2E_FEATURE_SEND_TIMEOUT_MS || 180_000)
const modelId = 'MiniMax-M3'
const aiOnly = process.env.E2E_FEATURE_AI_ONLY === '1'
const workbenchOnly = process.env.E2E_FEATURE_WORKBENCH_ONLY === '1'
if (aiOnly && workbenchOnly) throw new Error('Select only one feature coverage scope')

for (const target of [projectsRoot, workspace, home]) {
  if (!target.startsWith(`${devRoot}${sep}`)) throw new Error(`unsafe test path: ${target}`)
}
if (!output.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) throw new Error(`unsafe output path: ${output}`)

const mmxPath = process.env.MMX_CONFIG_PATH || join(homedir(), '.mmx', 'config.json')
const mmx = workbenchOnly ? {} : JSON.parse(await readFile(mmxPath, 'utf8'))
const apiKey = String(process.env.MINIMAX_API_KEY || mmx.api_key || '').trim()
if (!workbenchOnly && !apiKey) throw new Error('MiniMax API key is unavailable')
const configuredBase = String(process.env.MINIMAX_BASE_URL || mmx.base_url || (mmx.region === 'cn' ? 'https://api.minimaxi.com' : 'https://api.minimax.io'))
const apiBase = `${configuredBase.replace(/\/+$/, '')}/v1`

const dsh = resolveDshInstallation('0.1.5-rc.2')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')
const report = {
  startedAt: new Date().toISOString(),
  book,
  workspace,
  dsh: dsh.version ?? '0.1.5-rc.2',
  model: workbenchOnly ? null : modelId,
  scope: workbenchOnly ? 'workbench UI without model calls' : aiOnly ? 'model UI workflows with fresh documents' : 'full feature coverage',
  phases: [],
  features: [],
  failures: [],
  screenshots: [],
}

function recordPhase(name, detail = '') {
  report.phases.push({ name, detail, at: new Date().toISOString() })
  console.log(`[feature-coverage] ${name}${detail ? `: ${detail}` : ''}`)
  return flushReport()
}

function recordFeature(name, ok, detail = '') {
  report.features.push({ name, ok, detail })
  console.log(`[feature-coverage] feature ${name}: ${ok ? 'ok' : 'miss'}${detail ? ` (${detail})` : ''}`)
}

function fail(message) {
  report.failures.push(message)
  console.error(`[feature-coverage] ${message}`)
}

function sanitize(value) {
  return (apiKey ? String(value).replaceAll(apiKey, '[redacted]') : String(value)).replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function flushReport() {
  report.ok = report.failures.length === 0
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

function run(script, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    child.stdout.on('data', (chunk) => process.stdout.write(sanitize(chunk)))
    child.stderr.on('data', (chunk) => process.stderr.write(sanitize(chunk)))
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`preparation exited ${code}`)))
  })
}

async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise((resolvePromise) => child.once('exit', () => resolvePromise(true))),
    delay(5_000).then(() => false),
  ])
  if (!exited && process.platform === 'win32' && child.pid) {
    await new Promise((resolvePromise) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('error', () => resolvePromise())
      killer.once('exit', () => resolvePromise())
    })
  }
}

async function exists(target) {
  return stat(target).then(() => true, () => false)
}

async function waitFor(check, label, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(150)
  }
  throw new Error(`timed out: ${label}`)
}

async function startDsh(env) {
  const logs = []
  const logFile = resolve(output, 'dsh.log')
  await writeFile(logFile, '', 'utf8')
  const child = spawn(process.execPath, [cli, '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const ready = new Promise((resolvePromise, reject) => {
    let buffer = ''
    const inspect = (chunk) => {
      const text = sanitize(chunk)
      logs.push(text)
      void writeFile(logFile, text, { flag: 'a' }).catch(() => undefined)
      buffer += text
      const match = /https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/.exec(buffer)
      if (match) resolvePromise(new URL(match[0]))
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
  return { child, url, logs }
}

let shotIndex = 0
async function shot(page, name) {
  shotIndex += 1
  const file = resolve(output, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file })
  report.screenshots.push(file)
}

let activePage

const openOverlaySelector = [
  '.palette-content[data-state="open"]',
  '.palette-overlay[data-state="open"]',
  '.file-dialog-overlay[data-state="open"]',
  '.file-dialog[data-state="open"]',
  '.import-overlay[data-state="open"]',
  '.settings-overlay[data-state="open"]',
].join(', ')

async function openOverlayCount(page) {
  return page.locator(openOverlaySelector).count()
}

async function closePalette(page = activePage) {
  if (!page) return
  if (!(await page.locator('.palette-content[data-state="open"], .palette-overlay[data-state="open"]').count())) return
  await page.keyboard.press('Escape')
  await waitFor(async () => !(await page.locator('.palette-content[data-state="open"], .palette-overlay[data-state="open"]').count()), 'palette closed', 5_000)
}

async function clickOpenOverlayDismiss(page) {
  const labeled = page.locator('[data-state="open"] button[aria-label="关闭"], [data-state="open"] button[aria-label="取消"]')
  if (await labeled.count()) {
    await labeled.last().click({ force: true })
    return
  }
  const named = page.locator('[data-state="open"] button').filter({ hasText: /^(关闭|取消)$/ })
  if (await named.count()) {
    await named.last().click({ force: true })
    return
  }
  await page.keyboard.press('Escape')
}

async function dismissOverlays(page = activePage) {
  if (!page) return
  for (let step = 0; step < 10; step += 1) {
    const closeCardDetail = page.getByRole('button', { name: '关闭卡片详情' })
    if (await closeCardDetail.isVisible().catch(() => false)) {
      await closeCardDetail.click()
      await delay(200)
      continue
    }
    const workspaceMenu = page.locator('#workspace-actions')
    if (await workspaceMenu.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape')
      await workspaceMenu.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => undefined)
      continue
    }
    if (!(await openOverlayCount(page))) return
    await clickOpenOverlayDismiss(page).catch(() => undefined)
    await delay(200)
  }
  await waitFor(async () => !(await openOverlayCount(page)), 'overlays closed', 5_000).catch(() => undefined)
}

async function ensureOverlaysClosed(page = activePage) {
  await dismissOverlays(page)
  await waitFor(async () => !(await openOverlayCount(page)), 'overlays still open', 8_000)
}

async function cover(name, action) {
  try {
    await dismissOverlays()
    const detail = await action()
    recordFeature(name, true, typeof detail === 'string' ? detail : '')
    return true
  } catch (error) {
    const detail = sanitize(error instanceof Error ? error.message : String(error))
    recordFeature(name, false, detail)
    fail(`${name}: ${detail}`)
    if (activePage) {
      await shot(activePage, `failed-${name}`).catch(() => undefined)
      await writeFile(resolve(output, `failed-${name}.html`), sanitize(await activePage.content())).catch(() => undefined)
    }
    await dismissOverlays().catch(() => undefined)
    return false
  }
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

async function chooseCustomSelect(scope, ariaLabel, matcher) {
  const page = typeof scope.page === 'function' ? scope.page() : scope
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

async function openShellSettings(page) {
  const trigger = page.locator('.native-settings-control button').first()
  if (await trigger.isVisible().catch(() => false)) await trigger.click()
  else await page.keyboard.press('Control+,')
  await page.getByRole('dialog', { name: '设置' }).waitFor({ state: 'visible', timeout: 30_000 })
}

async function closeShellSettings(page) {
  const close = page.getByRole('button', { name: '关闭设置' })
  if (await close.isVisible().catch(() => false)) await close.click()
  else await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: '设置' }).waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined)
}

async function fillCustomMiniMaxCard(card) {
  await card.getByLabel('Provider ID').fill('minimax-e2e')
  await card.getByLabel('显示名称').fill('MiniMax')
  await card.getByLabel('API 地址').fill(apiBase)
  await forceProtocol(card)
  await card.getByLabel('API 密钥').fill(apiKey)
  if (!(await card.getByLabel('模型 id 1').isVisible().catch(() => false))) {
    await card.getByRole('button', { name: /添加模型/ }).click()
  }
  await card.getByLabel('模型 id 1').fill(modelId)
}

async function waitModelsReady(models) {
  await waitFor(async () => !(await models.getByText('正在读取…').isVisible().catch(() => false)), 'models page loaded', 45_000)
}

async function submitCustomMiniMax(models) {
  const addCustom = models.getByRole('button', { name: '添加自定义提供方' })
  await addCustom.waitFor({ state: 'visible', timeout: 30_000 })
  const setupCancel = models.locator('.models-editor').first().getByRole('button', { name: '取消' })
  if (await setupCancel.isVisible().catch(() => false) && !(await models.locator('.models-add-card').count())) {
    await setupCancel.click()
    await waitModelsReady(models)
  }
  if (await models.locator('.models-row-card').filter({ hasText: /minimax-e2e|MiniMax/i }).count()) {
    return 'already configured'
  }
  await addCustom.click()
  const card = models.locator('.models-add-card')
  await card.waitFor({ state: 'visible', timeout: 15_000 })
  await fillCustomMiniMaxCard(card)
  const create = card.getByRole('button', { name: '创建提供方' })
  await waitFor(async () => {
    if (await models.getByText('正在读取…').isVisible().catch(() => false)) return false
    if (!(await card.isVisible().catch(() => false))) {
      if (await addCustom.isVisible().catch(() => false)) await addCustom.click()
      return false
    }
    const provider = await card.getByLabel('Provider ID').inputValue().catch(() => '')
    if (!provider) {
      await fillCustomMiniMaxCard(card)
      return false
    }
    return create.isEnabled()
  }, 'custom MiniMax create enabled', 30_000)
  await create.click({ force: true })
  return 'created'
}

async function forceProtocol(scope) {
  const customized = scope.locator('summary').filter({ hasText: '自定义设置' })
  if (await customized.isVisible().catch(() => false)) {
    const expanded = await customized.evaluate((el) => el.closest('details')?.open === true).catch(() => false)
    if (!expanded) await customized.click()
  }
  const protocolTrigger = scope.getByRole('combobox', { name: 'API 协议' })
  await protocolTrigger.waitFor({ state: 'visible', timeout: 10_000 })
  const current = await protocolTrigger.innerText()
  if (/openai-completions/i.test(current)) return
  await chooseCustomSelect(scope, 'API 协议', (label) => /openai-completions/i.test(label) || /^openai$/i.test(label))
}

async function configureMiniMax(page) {
  await openShellSettings(page)
  const dialog = page.locator('.settings-dialog')
  if (!aiOnly) {
  await dialog.locator('.settings-nav').getByRole('tab', { name: '通用设置', exact: true }).click()
  await dialog.getByRole('region', { name: '通用设置' }).waitFor({ state: 'visible', timeout: 15_000 })
  await chooseCustomSelect(dialog, '语言', (label) => /English/i.test(label))
  await dialog.locator('.settings-nav').getByRole('tab', { name: 'General', exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
  recordFeature('i18n-english', true)
  await chooseCustomSelect(dialog, 'Language', (label) => /中文/.test(label))
  await dialog.locator('.settings-nav').getByRole('tab', { name: '通用设置', exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
  recordFeature('i18n-chinese', true)

  await dialog.locator('.settings-nav').getByRole('tab', { name: '写作', exact: true }).click()
  const authorBox = dialog.getByRole('textbox', { name: '跨作品作者约定' })
  await authorBox.waitFor({ state: 'visible', timeout: 15_000 })
  await authorBox.fill('第三人称限知；少用感叹号；对白保持克制。')
  const savePrefs = dialog.getByRole('button', { name: '保存作者约定' })
  if (await savePrefs.isEnabled().catch(() => false)) await savePrefs.click()
  const prefsFailed = await dialog.getByRole('alert').filter({ hasText: /未能保存/ }).isVisible().catch(() => false)
  recordFeature('author-preferences', !prefsFailed, prefsFailed ? 'settings scope did not commit' : 'saved')

  try {
    const typewriter = dialog.getByRole('checkbox', { name: /打字机滚动/ })
    if (await typewriter.isVisible().catch(() => false) && !(await typewriter.isChecked().catch(() => false))) {
      await typewriter.evaluate((el) => {
        if (el instanceof HTMLInputElement && !el.checked) el.click()
      })
    }
    const fontSize = dialog.getByRole('slider', { name: /字号/ })
    if (await fontSize.isVisible().catch(() => false)) {
      await fontSize.focus()
      const now = Number(await fontSize.getAttribute('aria-valuenow'))
      if (Number.isFinite(now) && now !== 18) {
        const key = now < 18 ? 'ArrowRight' : 'ArrowLeft'
        for (let i = 0; i < Math.abs(18 - now); i += 1) await fontSize.press(key)
      }
    }
    recordFeature('writing-paper', true)
  } catch (error) {
    recordFeature('writing-paper', false, sanitize(error instanceof Error ? error.message : String(error)))
  }

  await closeShellSettings(page)
  await openShellSettings(page)
  await dialog.locator('.settings-nav').getByRole('tab', { name: '知乎资料', exact: true }).click()
  await page.getByTestId('zhihu-settings-embed').getByText('Access Secret', { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 })
  await closeShellSettings(page)
  await openShellSettings(page)
  recordFeature('zhihu-panel-settings', true)
  await dialog.locator('.settings-nav').getByRole('tab', { name: '用量', exact: true }).click()
  await dialog.getByRole('region', { name: '用量' }).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)
  recordFeature('settings-usage', true)

  }
  await dialog.locator('.settings-nav').getByRole('tab', { name: '模型', exact: true }).click()
  const models = dialog.getByRole('region', { name: '模型', exact: true })
  await models.waitFor({ state: 'visible', timeout: 15_000 })
  await waitModelsReady(models)
  const created = await submitCustomMiniMax(models)
  if (created === 'created') {
    await models.getByText('已保存。', { exact: true }).waitFor({ state: 'visible', timeout: 45_000 })
  }
  await waitModelsReady(models)
  await shot(page, 'settings-minimax-m3')
  await closeShellSettings(page)
  recordFeature('settings-minimax', true, `custom MiniMax ${modelId} (${created})`)
  await recordPhase('接口连接成功', `MiniMax custom provider minimax-e2e / ${modelId}`)
}

async function createProjectFromHome(page) {
  await dismissNativeOnboarding(page)
  await page.getByRole('button', { name: '新建', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '新建作品' })
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.getByLabel('作品名称').fill(book)
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await page.getByRole('tree', { name: '稿件目录' }).waitFor({ state: 'visible', timeout: 45_000 })
  await page.locator('.tree-empty').waitFor({ state: 'visible', timeout: 20_000 })
  for (const extra of ['正文', '大纲', '人物卡', '世界书']) {
    if (await exists(resolve(workspace, extra))) throw new Error(`new project should not pre-seed ${extra}`)
    if (await page.locator('.tree').getByText(extra, { exact: true }).count()) {
      throw new Error(`new project should not pre-seed ${extra}`)
    }
  }
  await recordPhase('新建作品', workspace)
}

async function createFolder(page, name) {
  if (await exists(resolve(workspace, name)) || await page.locator('.tree-row', { hasText: name }).first().isVisible().catch(() => false)) {
    await page.locator('.tree-row', { hasText: name }).first().waitFor({ state: 'visible', timeout: 20_000 })
    return
  }
  const tree = page.locator('.tree')
  const box = await tree.boundingBox()
  if (!box) throw new Error('tree missing')
  await tree.click({ button: 'right', position: { x: 16, y: Math.max(12, box.height - 18) } })
  await page.getByRole('menu', { name: '文档操作' }).getByRole('menuitem', { name: '新建文件夹' }).click()
  const dialog = page.getByRole('dialog', { name: '新建文件夹' })
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.getByLabel('文件夹名称').fill(name)
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await dialog.waitFor({ state: 'detached', timeout: 15_000 })
  await page.locator('.tree-row', { hasText: name }).first().waitFor({ state: 'visible', timeout: 20_000 })
}

async function hoverDirectoryRow(page, directory) {
  const row = page.locator('.tree-row').filter({ hasText: directory }).first()
  await row.waitFor({ state: 'attached', timeout: 15_000 })
  await row.scrollIntoViewIfNeeded()
  await row.waitFor({ state: 'visible', timeout: 15_000 })
  await row.hover()
}

async function createFileIn(page, directory, name) {
  await expandDirectory(page, directory)
  await hoverDirectoryRow(page, directory)
  await page.getByRole('button', { name: `在 ${directory} 中新建文件`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建文件' })
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.getByLabel('文件名称（无扩展名时按 .md 创建）').fill(name)
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await dialog.waitFor({ state: 'detached', timeout: 15_000 })
  await page.locator('[data-testid="paper-path"]', { hasText: `${directory}/${name}.md` }).waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('[data-testid="paper-save-state"]', { hasText: '已保存' }).waitFor({ state: 'visible', timeout: 15_000 })
  await expandDirectory(page, directory)
}

async function savePaper(page) {
  const save = page.getByRole('button', { name: '保存', exact: true })
  if (await save.isVisible().catch(() => false) && await save.isEnabled().catch(() => false)) await save.click()
  else await page.keyboard.press('Control+s')
  await page.locator('[data-testid="paper-save-state"]', { hasText: '已保存' }).waitFor({ state: 'visible', timeout: 15_000 })
}

async function typeIntoPaper(page, text) {
  const content = page.locator('[data-testid="paper-editor"] .cm-content')
  await content.waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('[data-testid="paper-save-state"]', { hasText: '已保存' }).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)
  await content.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText(text)
  await savePaper(page)
  try {
    await page.locator('[data-testid="paper-save-state"]', { hasText: '已保存' }).waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    await delay(800)
    await savePaper(page)
    await page.locator('[data-testid="paper-save-state"]', { hasText: '已保存' }).waitFor({ state: 'visible', timeout: 15_000 })
  }
}

async function directoryRow(page, name) {
  return page.locator('.tree-directory-row').filter({ hasText: name }).locator('.tree-row[aria-expanded]').first()
}

async function expandDirectory(page, name) {
  await dismissOverlays(page)
  const dir = await directoryRow(page, name)
  await dir.waitFor({ state: 'attached', timeout: 15_000 })
  await dir.scrollIntoViewIfNeeded()
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await dir.getAttribute('aria-expanded') === 'true') return
    await dir.click({ force: true })
    await delay(250)
  }
  await waitFor(async () => (await dir.getAttribute('aria-expanded')) === 'true', `expand ${name}`, 8_000)
}

async function treeFileRow(page, name) {
  const row = page.locator('.tree-row.tree-main').filter({ hasText: name }).first()
  await row.waitFor({ state: 'attached', timeout: 15_000 })
  await row.scrollIntoViewIfNeeded()
  return row
}

async function openTreeFile(page, name, directory) {
  await dismissOverlays(page)
  const expected = directory ? `${directory}/${name}` : name
  if (directory) await expandDirectory(page, directory)
  const row = page.locator('.tree-row.tree-main').filter({ hasText: name })
  try {
    await waitFor(async () => (await row.count()) > 0, `tree file ${name}`, 8_000)
  } catch {
    if (!directory) throw new Error(`tree file ${name} missing`)
    const dir = await directoryRow(page, directory)
    await dir.click({ force: true })
    await delay(300)
    if (await dir.getAttribute('aria-expanded') !== 'true') await dir.click({ force: true })
    await waitFor(async () => (await row.count()) > 0, `tree file ${name} after re-expand`, 8_000)
  }
  const current = await page.locator('[data-testid="paper-path"]').innerText().catch(() => '')
  if (current.trim() !== expected) {
    await row.first().scrollIntoViewIfNeeded()
    await row.first().click({ force: true })
    await page.locator('[data-testid="paper-path"]', { hasText: expected }).waitFor({ state: 'visible', timeout: 20_000 })
  }
}

async function ensureWorkbench(page) {
  await dismissNativeOnboarding(page)
  if (await page.locator('.shell.focus-mode').isVisible().catch(() => false)) {
    await page.keyboard.press('Control+\\')
    await page.locator('.shell.focus-mode').waitFor({ state: 'detached', timeout: 10_000 })
  }
  if (await page.locator('.home-stage').isVisible().catch(() => false)) {
    await page.locator('.home-recent').getByRole('button', { name: new RegExp(book) }).first().click()
  }
  await page.locator('.tree').waitFor({ state: 'visible', timeout: 45_000 })
}

async function ensureAssistantOpen(page) {
  await ensureWorkbench(page)
  const assistant = page.locator('aside.chat')
  if (await assistant.isVisible().catch(() => false)) return page.getByRole('complementary', { name: '写作助手' })
  const launcher = page.getByRole('button', { name: '打开写作搭档' })
  if (await launcher.isVisible().catch(() => false)) await launcher.click()
  else await page.getByRole('button', { name: '搭档', exact: true }).click()
  await assistant.waitFor({ state: 'visible', timeout: 30_000 })
  return page.getByRole('complementary', { name: '写作助手' })
}

async function confirmWritingPreset(page) {
  const picker = page.getByRole('dialog', { name: '选择对话模式' })
  await picker.waitFor({ state: 'visible', timeout: 15_000 })
  const writing = picker.getByRole('radio', { name: /通用写作/ })
  await writing.waitFor({ state: 'visible', timeout: 15_000 })
  if (await writing.isDisabled()) throw new Error('通用写作 preset is unavailable')
  await writing.click()
  const confirm = picker.getByRole('button', { name: '开始对话' })
  await waitFor(async () => confirm.isEnabled(), 'writing preset confirm enabled', 10_000)
  await confirm.click()
  await picker.waitFor({ state: 'hidden', timeout: 20_000 })
}

async function startWritingConversation(page, assistant) {
  await assistant.getByRole('button', { name: '新对话' }).click()
  const discard = page.getByRole('button', { name: '放弃并继续', exact: true })
  if (await discard.isVisible({ timeout: 2_000 }).catch(() => false)) await discard.click()
  await confirmWritingPreset(page)
}

async function waitProofreadFinished(panel, expectedFiles, label) {
  await waitFor(async () => {
    const text = (await panel.innerText()).replace(/\s+/g, ' ')
    if (/操作未能完成|未能读取|会话已失效|未找到该文件/.test(text)) {
      throw new Error(`${label}: ${text.slice(0, 240)}`)
    }
    return /\d+ 处 · 已查 \d+ 份文件/.test(text) && !/检查中/.test(text)
  }, label, 25_000)
  const text = (await panel.innerText()).replace(/\s+/g, ' ')
  const match = /(\d+) 处 · 已查 (\d+) 份文件/.exec(text)
  if (!match) throw new Error(`${label}: missing summary (${text.slice(0, 240)})`)
  const files = Number(match[2])
  const wanted = typeof expectedFiles === 'number' ? expectedFiles : expectedFiles.min
  if (typeof expectedFiles === 'number') {
    if (files !== wanted) throw new Error(`${label}: scanned ${files} files, expected ${wanted}`)
  } else if (files < wanted) {
    throw new Error(`${label}: scanned ${files} files, expected at least ${wanted}`)
  }
}

async function runPaletteCommand(page, query, label) {
  await dismissOverlays(page)
  await closePalette(page)
  await page.getByRole('button', { name: '搜索与命令' }).click()
  await page.locator('.palette-overlay').waitFor({ state: 'attached', timeout: 10_000 })
  const input = page.locator('.palette-input')
  await input.waitFor({ state: 'visible', timeout: 5_000 })
  await input.fill(query)
  const item = page.getByRole('option', { name: new RegExp(label) }).first()
  await item.waitFor({ state: 'visible', timeout: 10_000 })
  if (await item.getAttribute('aria-disabled') === 'true') {
    const paperPath = (await page.locator('[data-testid="paper-path"]').innerText().catch(() => '')).trim()
    await closePalette(page)
    throw new Error(`palette command ${label} is disabled (paper-path=${paperPath || 'empty'})`)
  }
  await item.click()
  await waitFor(async () => !(await page.locator('.palette-content[data-state="open"], .palette-overlay[data-state="open"]').count()), 'palette closed after command', 8_000).catch(() => undefined)
}

async function selectPaperRange(page, from, to) {
  await page.locator('[data-testid="paper-editor"]').waitFor({ state: 'visible', timeout: 10_000 })
  const ok = await page.evaluate(({ start, end }) => {
    const el = document.querySelector('[data-testid="paper-editor"]')
    const view = /** @type {any} */ (el)?.__cmView
    if (!view) return false
    const length = view.state.doc.length
    view.dispatch({ selection: { anchor: Math.max(0, Math.min(start, length)), head: Math.max(0, Math.min(end, length)) } })
    view.focus()
    return true
  }, { start: from, end: to })
  if (!ok) throw new Error('CodeMirror view missing')
}

async function answerPending(page) {
  const approval = page.getByRole('article', { name: '工具审批' }).last()
  if (await approval.isVisible().catch(() => false)) {
    await approval.getByRole('button', { name: '允许一次' }).click()
    return true
  }
  const question = page.getByRole('form', { name: '回答问题' }).last()
  if (await question.isVisible().catch(() => false)) {
    const tabs = question.locator('.question-tab')
    const tabCount = await tabs.count()
    for (let index = 0; index < Math.max(tabCount, 1); index += 1) {
      if (tabCount) await tabs.nth(index).click()
      const options = question.locator('.question-option')
      if (await options.count()) {
        await options.first().click()
      } else {
        await question.locator('.question-custom').fill('按已给出的设定继续。')
      }
    }
    await question.getByRole('button', { name: '提交全部回答' }).click()
    return true
  }
  const memory = page.getByRole('article', { name: '作者侧写建议' }).last()
  if (await memory.isVisible().catch(() => false)) {
    const ignore = memory.getByRole('button', { name: '忽略' })
    if (await ignore.isVisible().catch(() => false)) {
      await ignore.click()
      return true
    }
  }
  return false
}

async function sendChat(page, prompt, label, timeout = 90_000) {
  const assistantBefore = await page.locator('.chat-row.assistant').count()
  const warningBaseline = await page.locator('.chat-history .warning').filter({ hasText: /未能完成|中断/ }).count()
  const composer = page.getByRole('textbox', { name: '输入消息' })
  await composer.fill(prompt)
  const send = page.getByRole('button', { name: '发送', exact: true })
  await waitFor(async () => send.isEnabled(), `${label}: send enabled`, 30_000)
  await send.click()
  await waitFor(async () => page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false), `${label}: turn started`, 30_000)
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await answerPending(page)
    if (await page.locator('.chat-history .warning').filter({ hasText: /未能完成|中断/ }).count() > warningBaseline) {
      throw new Error(`${label}: 写作助手未能完成这次请求`)
    }
    const count = await page.locator('.chat-row.assistant').count()
    const stopVisible = await page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)
    if (count > assistantBefore && !stopVisible) {
      const text = (await page.locator('.chat-row.assistant').last().innerText()).trim()
      if (text && !/^正在回复/.test(text)) return text
    }
    await delay(400)
  }
  const diag = await page.locator('aside.chat').evaluate((el) => ({
    face: el.getAttribute('data-chat-face'),
    nodes: el.getAttribute('data-chat-nodes'),
    text: el.innerText.replace(/\s+/g, ' ').slice(0, 240),
  })).catch(() => ({}))
  throw new Error(`${label}: timed out without assistant reply (${JSON.stringify(diag)})`)
}

async function waitForProposal(page, previousCount, previousAssistantCount, label, expectedPath) {
  const cards = page.getByRole('article', { name: '文件修改建议' })
  const warnings = page.locator('.chat-history .warning').filter({ hasText: /未能完成|中断/ })
  const warningBaseline = await warnings.count()
  const deadline = Date.now() + sendTimeout
  let completedWithoutProposalAt = 0
  while (Date.now() < deadline) {
    await answerPending(page)
    const count = await cards.count()
    if (count > previousCount) {
      const card = cards.last()
      const text = await card.innerText().catch(() => '')
      if (expectedPath && !text.includes(expectedPath)) {
        await delay(400)
        continue
      }
      const ready = await card.getByText('可以安全应用', { exact: true }).isVisible().catch(() => false)
      const applied = await card.getByText('已应用到作品', { exact: true }).isVisible().catch(() => false)
      if (ready || applied) return card
    }
    if (await warnings.count() > warningBaseline) throw new Error(`${label}: ${await warnings.last().innerText()}`)
    const assistantCount = await page.locator('.chat-row.assistant').count()
    const stopVisible = await page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)
    if (assistantCount > previousAssistantCount && !stopVisible) {
      if (!completedWithoutProposalAt) completedWithoutProposalAt = Date.now()
      if (Date.now() - completedWithoutProposalAt > 8_000) {
        throw new Error(`${label}: turn completed without a usable proposal`)
      }
    } else completedWithoutProposalAt = 0
    await delay(400)
  }
  throw new Error(`${label}: no proposal within timeout`)
}

async function sendAndApply(page, prompt, expectedPath, label) {
  const cards = page.getByRole('article', { name: '文件修改建议' })
  const before = await cards.count()
  const assistantBefore = await page.locator('.chat-row.assistant').count()
  const composer = page.getByRole('textbox', { name: '输入消息' })
  await composer.fill(prompt)
  const send = page.getByRole('button', { name: '发送', exact: true })
  await waitFor(async () => send.isEnabled(), `${label}: send enabled`, 30_000)
  await send.click()
  await waitFor(async () => {
    if (await cards.count() > before) return true
    return page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)
  }, `${label}: turn started`, 30_000)
  const card = await waitForProposal(page, before, assistantBefore, label, expectedPath)
  const appliedOnCard = () => cards.last().getByText('已应用到作品', { exact: true }).isVisible().catch(() => false)
  if (!(await appliedOnCard())) {
    const apply = cards.last().getByRole('button', { name: '应用', exact: true })
    if (await apply.isVisible().catch(() => false)) await apply.click()
    await waitFor(async () => {
      if (await appliedOnCard()) return true
      if (!expectedPath) return false
      const onDisk = await exists(resolve(workspace, ...expectedPath.split('/')))
      const paper = await page.locator('[data-testid="paper-path"]').innerText().catch(() => '')
      return onDisk && paper.includes(expectedPath)
    }, `${label}: applied`, 45_000)
  }
  await recordPhase(label, expectedPath)
}

async function openAssistantWithModel(page) {
  const assistant = await ensureAssistantOpen(page)
  const currentModel = await assistant.locator('.model-picker, .composer-model').innerText().catch(() => '')
  if (/MiniMax-M3/i.test(currentModel)) {
    report.model = currentModel.replace(/\s+/g, ' ').trim()
    await recordPhase('沿用当前对话模型', report.model)
    return
  }
  try {
    const chosen = await chooseCustomSelect(assistant, '选择模型', (label) => /MiniMax-M3/i.test(label))
    report.model = chosen.replace(/\s+/g, ' ').trim()
    await recordPhase('切换对话模型', report.model)
    return
  } catch { /* fall back to a new conversation, then pick in the composer */ }
  await startWritingConversation(page, assistant)
  const chosen = await chooseCustomSelect(assistant, '选择模型', (label) => /MiniMax-M3/i.test(label))
  const effort = assistant.getByRole('combobox', { name: '思考强度' })
  if (await effort.isVisible().catch(() => false)) {
    const current = await effort.innerText()
    if (!/low|medium/i.test(current)) {
      try {
        await chooseCustomSelect(assistant, '思考强度', (label) => /^low$/i.test(label.trim()))
      } catch {
        await chooseCustomSelect(assistant, '思考强度', (label) => /^medium$/i.test(label.trim()))
      }
    }
  }
  report.model = chosen
  await recordPhase('新对话模型', chosen)
}

async function openExportPreview(page) {
  await runPaletteCommand(page, '导出', '导出稿件')
  const dialog = page.getByRole('dialog', { name: '导出稿件' })
  await dialog.waitFor({ state: 'visible', timeout: 20_000 })
  await waitFor(async () => {
    const markdown = await dialog.getByRole('button', { name: '导出 Markdown' }).isEnabled().catch(() => false)
    const docx = await dialog.getByRole('button', { name: '导出 DOCX' }).isEnabled().catch(() => false)
    const epub = await dialog.getByRole('button', { name: '导出 EPUB' }).isEnabled().catch(() => false)
    return markdown && docx && epub
  }, 'export preview ready', 20_000)
  return dialog
}

async function closeExportPreview(page, dialog) {
  if (await dialog.isVisible().catch(() => false)) {
    const cancel = dialog.getByRole('button', { name: '取消' })
    if (await cancel.isVisible().catch(() => false)) await cancel.click()
  }
  await page.getByRole('dialog', { name: '导出稿件' }).waitFor({ state: 'hidden', timeout: 10_000 })
}

async function saveExportDownload(page, dialog, buttonName) {
  const downloadWait = page.waitForEvent('download', { timeout: 30_000 })
  try {
    const [download] = await Promise.all([
      downloadWait,
      dialog.getByRole('button', { name: buttonName }).click(),
    ])
    const filename = download.suggestedFilename() || 'export.bin'
    const target = resolve(output, filename)
    await download.saveAs(target)
    return { filename, target }
  } catch (error) {
    downloadWait.catch(() => undefined)
    throw error
  }
}

function assertPkZip(bytes, label) {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(`${label} is not a zip archive`)
  }
}

async function assertDocxExport(target) {
  const bytes = await readFile(target)
  assertPkZip(bytes, target)
  const zip = await JSZip.loadAsync(bytes)
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) throw new Error(`${target} is missing word/document.xml`)
  for (const needle of ['功能验收', '林简', '雾闸', '把证件给我']) {
    if (!xml.includes(needle)) throw new Error(`${target} is missing ${needle}`)
  }
}

async function assertEpubExport(target) {
  const bytes = await readFile(target)
  assertPkZip(bytes, target)
  const zip = await JSZip.loadAsync(bytes)
  const mime = await zip.file('mimetype')?.async('string')
  if (mime !== 'application/epub+zip') throw new Error(`${target} mimetype is ${mime ?? 'missing'}`)
  const names = Object.keys(zip.files)
  if (!names.includes('META-INF/container.xml') || !names.includes('OEBPS/content.opf') || !names.includes('OEBPS/chapter-001.xhtml')) {
    throw new Error(`${target} is missing EPUB entries: ${names.join(', ')}`)
  }
  const chapter = await zip.file('OEBPS/chapter-001.xhtml')?.async('string')
  if (!chapter?.includes('林简') || !chapter.includes('把证件给我')) {
    throw new Error(`${target} chapter is missing Chinese content`)
  }
  const opf = await zip.file('OEBPS/content.opf')?.async('string')
  if (!opf?.includes('功能验收')) throw new Error(`${target} package document is missing the book title`)
}

async function coverWorkbench(page) {
  await cover('theme-toggle', async () => {
    const themeToggle = page.locator('.chrome .theme-toggle')
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'light')
    const next = before === 'light' ? 'dark' : 'light'
    await themeToggle.click()
    await page.waitForFunction((wanted) => document.documentElement.getAttribute('data-theme') === wanted, next)
    await themeToggle.click()
    await page.waitForFunction((wanted) => document.documentElement.getAttribute('data-theme') === wanted, before)
    return `${before} → ${next} → ${before}`
  })

  await cover('command-palette', async () => {
    await page.getByRole('button', { name: '搜索与命令' }).click()
    await page.locator('.palette-overlay').waitFor({ state: 'visible', timeout: 10_000 })
    await page.keyboard.press('Escape')
    await page.locator('.palette-overlay').waitFor({ state: 'detached', timeout: 5_000 })
  })

  await cover('create-folders', async () => {
    // Journey folders are ordinary directories created after new-project.
    // Skip if 资料 is already present so this step does not create it twice.
    await createFolder(page, '资料')
    return '资料'
  })

  await cover('create-worldbook-file', async () => {
    await createFileIn(page, '世界书', '港口')
    await typeIntoPaper(page, '# 港口\n\n雾港的港口由海关记忆税闸口控制。\n')
    return '世界书/港口.md'
  })

  await cover('open-ordinary-markdown', async () => {
    await openTreeFile(page, '港口.md', '世界书')
    const text = await page.locator('[data-testid="paper-editor"]').innerText()
    if (!text.includes('雾港的港口')) throw new Error('ordinary markdown paper missing body')
    const disk = await readFile(resolve(workspace, '世界书', '港口.md'), 'utf8')
    if (!disk.includes('雾港的港口')) throw new Error('ordinary markdown missing on disk')
    if (/^---[\s\S]*\ntriggers:/.test(disk)) throw new Error('ordinary markdown still uses worldbook schema')
    return '世界书/港口.md as ordinary markdown'
  })

  await cover('create-character-file', async () => {
    await createFileIn(page, '人物卡', '林简')
    await typeIntoPaper(page, '# 林简\n\n维修师，亡姐留下的录音能绕过记忆税。\n')
    return '人物卡/林简.md'
  })

  await cover('create-chapters', async () => {
    await createFileIn(page, '正文', '001')
    await typeIntoPaper(page, [
      '# 第一章 雾闸',
      '',
      '林简站在海关记忆税闸口，口袋里的录音带还带着潮气。锚点词ALPHA 写在闸口灯箱上。',
      '',
      '她听见广播重复同一句：过闸要核验可验证记忆。。。',
      '',
      '“把证件给我。”她说，声音比预想的更完整，像在解释系统。',
      '',
      '拆章锚点：潮水拍上浮岛边缘，灯灭了一拍。',
      '',
      '后面还有一段准备留给拆章的余波。姚梨在窗后记下她的名字。',
    ].join('\n'))
    await createFileIn(page, '正文', '002')
    await typeIntoPaper(page, '# 第二章 回声\n\n姚梨把档案盒推过桌面。林简没有解释记忆税，只问回声库今晚是否开放。\n')
    await createFileIn(page, '正文', '备忘')
    await typeIntoPaper(page, '# 备忘\n\n这是准备归档的临时页。\n')
    return '001 / 002 / 备忘'
  })

  await cover('rename-file', async () => {
    await openTreeFile(page, '备忘.md', '正文')
    await (await treeFileRow(page, '备忘.md')).click({ button: 'right' })
    await page.getByRole('menu', { name: '文档操作' }).getByRole('menuitem', { name: '重命名' }).click()
    const rename = page.getByRole('dialog', { name: '重命名文件' })
    await rename.getByLabel('新名称').fill('归档候选.md')
    await rename.getByRole('button', { name: '保存新名称' }).click()
    await page.locator('[data-testid="paper-path"]', { hasText: '正文/归档候选.md' }).waitFor({ state: 'visible', timeout: 20_000 })
    return '正文/备忘.md → 正文/归档候选.md'
  })

  await cover('copy-paste', async () => {
    await expandDirectory(page, '正文')
    const source = await treeFileRow(page, '归档候选.md')
    await source.click({ button: 'right' })
    await page.getByRole('menu', { name: '文档操作' }).getByRole('menuitem', { name: '复制' }).click()
    await page.getByText(/已复制/).first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined)
    await expandDirectory(page, '正文')
    const again = await treeFileRow(page, '归档候选.md')
    await again.click({ button: 'right' })
    const paste = page.getByRole('menu', { name: '文档操作' }).getByRole('menuitem', { name: '粘贴' })
    await waitFor(async () => paste.isEnabled(), 'paste enabled', 8_000)
    await paste.click()
    const pastedOnDisk = resolve(workspace, '正文', '归档候选 2.md')
    await waitFor(async () => {
      if (await exists(pastedOnDisk)) return true
      return page.locator('.tree-row.tree-main').filter({ hasText: /归档候选 2/ }).count().then((count) => count > 0)
    }, 'pasted copy appears', 15_000)
    return '正文/归档候选 2.md'
  })

  await cover('chapter-meta', async () => {
    await openTreeFile(page, '001.md', '正文')
    await page.getByTestId('paper-editor-menu-trigger').click()
    if (await page.getByTestId('editor-menu-chapter-meta').count()
      || await page.getByTestId('editor-menu-chapter-summary').count()
      || await page.getByTestId('editor-menu-wrap-up').count()) throw new Error('chapter meta / wrap-up entries still in editor menu')
    await page.keyboard.press('Escape')
    return '正文菜单无章纲/章末小结/整理本章入口'
  })

  await cover('typewriter-focus', async () => {
    await openShellSettings(page)
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('tab', { name: '写作', exact: true }).click()
    const typewriter = dialog.getByRole('checkbox', { name: /^打字机滚动/ })
    const focus = dialog.getByRole('checkbox', { name: /^聚焦当前段落/ })
    await typewriter.waitFor({ state: 'visible', timeout: 5_000 })
    await focus.waitFor({ state: 'visible', timeout: 5_000 })
    if (await dialog.getByText(/每日目标/).count()) throw new Error('daily goal still mounted')
    await closeShellSettings(page)
    await page.getByTestId('paper-editor-menu-trigger').click()
    if (await page.getByTestId('editor-menu-typewriter').count() || await page.getByTestId('editor-menu-focus').count()) throw new Error('view settings still in editor menu')
    await page.keyboard.press('Escape')
  })

  await cover('layout-toggles', async () => {
    await page.keyboard.press('Control+b')
    await page.locator('.sidebar').waitFor({ state: 'detached', timeout: 10_000 })
    await page.keyboard.press('Control+b')
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 10_000 })
    await page.keyboard.press('Control+\\')
    await page.locator('.shell.focus-mode').waitFor({ state: 'visible', timeout: 10_000 })
    await shot(page, 'focus-mode')
    await page.keyboard.press('Control+\\')
    await page.locator('.shell.focus-mode').waitFor({ state: 'detached', timeout: 10_000 })
  })

  await cover('in-editor-find', async () => {
    await openTreeFile(page, '001.md', '正文')
    await page.locator('[data-testid="paper-editor"] .cm-content').click()
    await page.keyboard.press('Control+f')
    const find = page.locator('[data-testid="paper-search-query"]')
    await find.waitFor({ state: 'visible', timeout: 8_000 })
    await find.fill('锚点词ALPHA')
    await page.keyboard.press('Enter')
    await page.locator('[data-testid="paper-search-close"]').click()
  })

  await cover('in-editor-replace', async () => {
    await openTreeFile(page, '001.md', '正文')
    await page.locator('[data-testid="paper-editor"] .cm-content').click()
    await page.keyboard.press('Control+h')
    const find = page.locator('[data-testid="paper-search-query"]')
    await find.waitFor({ state: 'visible', timeout: 8_000 })
    await find.fill('记忆税闸口')
    const replace = page.locator('[data-testid="paper-search-replace"]')
    await replace.waitFor({ state: 'visible', timeout: 8_000 })
    await replace.fill('记忆税关口')
    // CodeMirror replaces the selected match; first locate the newly entered query.
    await page.locator('[data-testid="paper-search-next"]').click()
    await page.waitForFunction(() => {
      const view = document.querySelector('[data-testid="paper-editor"]')?.__cmView
      if (!view) return false
      const selection = view.state.selection.main
      return view.state.sliceDoc(selection.from, selection.to) === '记忆税闸口'
    })
    await page.locator('[data-testid="paper-search-replace-one"]').click()
    await page.locator('[data-testid="paper-save-state"]', { hasText: '草稿未保存' }).waitFor({ state: 'visible', timeout: 8_000 })
    await page.locator('[data-testid="paper-search-close"]').click()
    await savePaper(page)
    await waitFor(async () => {
      const disk = await readFile(resolve(workspace, '正文', '001.md'), 'utf8').catch(() => '')
      return disk.includes('记忆税关口') && disk.includes('锚点词ALPHA')
    }, 'in-editor replace saved to disk', 10_000)
  })

  await cover('search-replace', async () => {
    await openTreeFile(page, '001.md', '正文')
    await page.locator('[data-testid="paper-save-state"]', { hasText: '已保存' }).waitFor({ state: 'visible', timeout: 15_000 })
    await waitFor(async () => {
      const disk = await readFile(resolve(workspace, '正文', '001.md'), 'utf8').catch(() => '')
      return disk.includes('记忆税关口') && disk.includes('锚点词ALPHA') && !disk.includes('锚点词BETA')
    }, 'chapter version stable before project search', 10_000)
    await page.keyboard.press('Control+Shift+F')
    const panel = page.getByRole('region', { name: '全文搜索' })
    await panel.waitFor({ state: 'visible', timeout: 10_000 })
    const searchBox = page.getByRole('searchbox', { name: '搜索作品文字' })
    await searchBox.waitFor({ state: 'visible', timeout: 10_000 })
    await searchBox.fill('锚点词ALPHA')
    await panel.getByRole('button', { name: '开始搜索' }).click()
    await panel.getByText(/处 · 已查/).waitFor({ state: 'visible', timeout: 20_000 })
    await panel.getByLabel('替换为').fill('锚点词BETA')
    await panel.getByRole('button', { name: '全部替换…' }).click()
    await page.getByRole('region', { name: '确认跨文件替换' }).waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('button', { name: '确认替换' }).click()
    const outcome = panel.locator('.search-replace-result')
    await outcome.waitFor({ state: 'visible', timeout: 20_000 })
    const outcomeText = (await outcome.innerText()).replace(/\s+/g, ' ')
    if (/已跳过|未能写入/.test(outcomeText)) throw new Error(`replace skipped or failed: ${outcomeText}`)
    if (!/已替换 [1-9]\d* 个文件、[1-9]\d* 处/.test(outcomeText)) throw new Error(`replace did not apply: ${outcomeText}`)
    await waitFor(async () => {
      const disk = await readFile(resolve(workspace, '正文', '001.md'), 'utf8').catch(() => '')
      return disk.includes('锚点词BETA') && !disk.includes('锚点词ALPHA')
    }, 'project replace landed on disk', 10_000)
    await openTreeFile(page, '001.md', '正文')
    const disk = await readFile(resolve(workspace, '正文', '001.md'), 'utf8')
    const text = await page.locator('[data-testid="paper-editor"]').innerText()
    if (!disk.includes('锚点词BETA') || disk.includes('锚点词ALPHA')) throw new Error('replace did not land on disk')
    if (!text.includes('锚点词BETA')) throw new Error('replace did not land in editor')
    return 'disk'
  })

  await cover('overview', async () => {
    await page.keyboard.press('Control+Shift+O')
    const panel = page.getByRole('region', { name: '文档概览' })
    await panel.waitFor({ state: 'visible', timeout: 15_000 })
    await panel.getByRole('region', { name: '文档列表' }).waitFor({ state: 'visible', timeout: 10_000 })
    await shot(page, 'overview')
    const closeOverview = panel.getByRole('button', { name: '关闭概览' })
    if (await closeOverview.isVisible().catch(() => false)) await closeOverview.click()
    await panel.waitFor({ state: 'hidden', timeout: 10_000 })
  })

  await cover('proofread', async () => {
    await dismissOverlays(page)
    await openTreeFile(page, '001.md', '正文')
    await page.locator('[data-testid="paper-path"]', { hasText: '正文/001.md' }).waitFor({ state: 'attached', timeout: 15_000 })
    await page.locator('[data-testid="paper-editor"]').waitFor({ state: 'visible', timeout: 10_000 })
    await page.keyboard.press('Control+Shift+L')
    const panel = page.getByRole('region', { name: '文稿校对' })
    await panel.waitFor({ state: 'visible', timeout: 15_000 })
    if (await page.getByTestId('editor-proofread-panel').count() === 0) {
      throw new Error('shared proofread panel did not mount')
    }
    const kinds = panel.getByRole('group', { name: '问题类型' })
    await kinds.waitFor({ state: 'visible', timeout: 10_000 })
    const kindText = (await kinds.innerText()).replace(/\s+/g, ' ')
    if (/人物卡|\bcard\b/i.test(kindText)) throw new Error(`proofread still exposes card kind: ${kindText}`)
    for (const kind of ['标点', '错别字', '敏感词', '重复', '口癖']) {
      await kinds.getByRole('button', { name: new RegExp(`^${kind}`) }).waitFor({ state: 'visible', timeout: 5_000 })
    }
    await waitProofreadFinished(panel, 1, 'current document proofread')
    await panel.getByRole('button', { name: '全部文档', exact: true }).click()
    await waitProofreadFinished(panel, { min: 2 }, 'all documents proofread')
    await panel.getByRole('button', { name: '关闭文稿校对' }).click()
    await panel.waitFor({ state: 'hidden', timeout: 10_000 })
    await page.keyboard.press('Control+Shift+L')
    const again = page.getByRole('region', { name: '文稿校对' })
    await again.waitFor({ state: 'visible', timeout: 10_000 })
    await waitProofreadFinished(again, 1, 'shortcut current document proofread')
    return 'current + all documents'
  })

  await cover('create-plain-file', async () => {
    await createFileIn(page, '人物卡', '姚梨')
    await typeIntoPaper(page, '# 姚梨\n\n档案员。窗后记下名字。\n')
    await shot(page, 'plain-file-create')
    await expandDirectory(page, '人物卡')
    const yaoli = page.locator('.tree-row.tree-main').filter({ hasText: '姚梨.md' }).first()
    await yaoli.scrollIntoViewIfNeeded()
    await yaoli.waitFor({ state: 'visible', timeout: 15_000 })
    await waitFor(() => exists(resolve(workspace, '人物卡', '姚梨.md')), 'created markdown saved', 10_000)
    return '人物卡/姚梨.md as ordinary markdown'
  })

  await cover('pin-pane', async () => {
    await openTreeFile(page, '港口.md', '世界书')
    await (await treeFileRow(page, '港口.md')).click({ button: 'right' })
    await page.getByRole('menu', { name: '文档操作' }).getByRole('menuitem', { name: '钉在旁边' }).click()
    await page.getByRole('region', { name: /钉住/ }).waitFor({ state: 'visible', timeout: 15_000 })
    await shot(page, 'pinned-pane')
    await page.getByRole('button', { name: '取消钉住' }).click()
    await page.getByRole('region', { name: /钉住/ }).waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined)
  })

  await cover('export', async () => {
    await dismissOverlays(page)
    await openTreeFile(page, '001.md', '正文')
    await page.locator('[data-testid="paper-path"]', { hasText: '正文/001.md' }).waitFor({ state: 'attached', timeout: 15_000 })
    const markdownDialog = await openExportPreview(page)
    const markdown = await saveExportDownload(page, markdownDialog, '导出 Markdown')
    const markdownText = await readFile(markdown.target, 'utf8')
    if (!markdownText.includes('功能验收') || !markdownText.includes('林简') || !markdownText.includes('把证件给我')) {
      throw new Error('markdown export missing Chinese content')
    }
    await closeExportPreview(page, markdownDialog)

    const docxDialog = await openExportPreview(page)
    const docx = await saveExportDownload(page, docxDialog, '导出 DOCX')
    await assertDocxExport(docx.target)
    await closeExportPreview(page, docxDialog)

    const epubDialog = await openExportPreview(page)
    const epub = await saveExportDownload(page, epubDialog, '导出 EPUB')
    await assertEpubExport(epub.target)
    await closeExportPreview(page, epubDialog)
    return `${markdown.filename}, ${docx.filename}, ${epub.filename}`
  })

  await cover('archive-restore', async () => {
    await openTreeFile(page, '归档候选.md', '正文')
    await (await treeFileRow(page, '归档候选.md')).click({ button: 'right' })
    await page.getByRole('menu', { name: '文档操作' }).getByRole('menuitem', { name: '归档' }).click()
    await waitFor(async () => !(await page.locator('.tree-row').filter({ hasText: '归档候选.md' }).count()), 'archived row gone', 15_000)
    await runPaletteCommand(page, '归档', '已归档')
    const archives = page.getByRole('dialog', { name: '已归档' })
    await archives.waitFor({ state: 'visible', timeout: 10_000 })
    await archives.getByRole('button', { name: '恢复' }).first().click()
    await archives.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => undefined)
    await dismissOverlays(page)
    await expandDirectory(page, '正文')
    await page.locator('.tree-row.tree-main').filter({ hasText: /归档候选/ }).first().waitFor({ state: 'attached', timeout: 15_000 })
  })

  await cover('snapshot-commit', async () => {
    await ensureOverlaysClosed(page)
    await page.getByRole('button', { name: '版本', exact: true }).click()
    await page.getByRole('menu', { name: '版本' }).getByRole('menuitem', { name: '保存版本' }).click()
    await page.getByRole('button', { name: '版本', exact: true }).click()
    await page.getByRole('menu', { name: '版本' }).getByRole('menuitem', { name: '历史版本' }).click()
    const history = page.getByRole('region', { name: '历史版本' })
    await history.waitFor({ state: 'visible', timeout: 15_000 })
    await waitFor(async () => (await history.locator('.snapshot-row').count()) > 0, 'snapshot row appears', 20_000)
  })

  await cover('about-dialog', async () => {
    await openShellSettings(page)
    const dialog = page.locator('.settings-dialog')
    await dialog.locator('.settings-nav').getByRole('tab', { name: '关于', exact: true }).click()
    await dialog.getByRole('region', { name: '关于' }).waitFor({ state: 'visible', timeout: 10_000 })
    await dialog.getByRole('button', { name: '检查更新' }).waitFor({ state: 'visible', timeout: 10_000 })
    await closeShellSettings(page)
  })

  await cover('import-entry', async () => {
    await page.getByRole('button', { name: '作品菜单' }).click()
    const workspaceMenu = page.locator('#workspace-actions')
    await workspaceMenu.waitFor({ state: 'visible', timeout: 10_000 })
    if (await workspaceMenu.getByRole('menuitem', { name: '导入作品' }).count()) {
      throw new Error('导入作品 should no longer appear in the workspace menu')
    }
    await page.keyboard.press('Escape')
    return 'import entry removed'
  })

  await cover('chapter-split', async () => {
    await openTreeFile(page, '001.md', '正文')
    await (await treeFileRow(page, '001.md')).click({ button: 'right' })
    await page.getByRole('menu', { name: '文档操作' }).getByRole('menuitem', { name: '拆章…' }).click()
    const dialog = page.getByRole('dialog', { name: '拆章' })
    await dialog.waitFor({ state: 'visible', timeout: 10_000 })
    await dialog.locator('textarea').fill('拆章锚点：潮水拍上浮岛边缘，灯灭了一拍。')
    await dialog.locator('input').last().fill('003.md')
    await dialog.getByRole('button', { name: '预览提案' }).click()
    const review = page.getByRole('dialog', { name: /确认提案|拆章/ }).last()
    await review.getByRole('button', { name: '应用' }).click()
    await page.locator('.tree-row').filter({ hasText: '003.md' }).first().waitFor({ state: 'attached', timeout: 20_000 })
    await review.getByRole('button', { name: '关闭' }).click({ force: true }).catch(() => undefined)
    await page.keyboard.press('Escape')
    await ensureOverlaysClosed(page)
  })

  await cover('chapter-merge', async () => {
    const targetBefore = await readFile(resolve(workspace, '正文', '002.md'), 'utf8')
    const sourceBefore = await readFile(resolve(workspace, '正文', '003.md'), 'utf8')
    await openTreeFile(page, '002.md', '正文')
    // Delay a real pre-merge tree response until after the post-merge refresh.
    // No response data is mocked: only arrival order is controlled.
    let held = false
    let captured = false
    let delivered = false
    let settled = false
    let captureError
    let release = () => {}
    const gate = new Promise((resolvePromise) => { release = resolvePromise })
    const delayedTree = async (route) => {
      try {
        const payload = route.request().postDataJSON()?.payload
        if (held || payload?.path !== '正文') {
          await route.continue()
          return
        }
        held = true
        const response = await route.fetch()
        const body = await response.json()
        if (!(body.result?.value?.entries || []).some((entry) => entry.name === '003.md')) {
          captureError = new Error('Old tree response did not contain merge source')
          captured = true
          if (!settled) {
            settled = true
            await route.continue()
          }
          return
        }
        captured = true
        await gate
        if (settled) return
        settled = true
        await route.fulfill({ response })
        delivered = true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!captureError && !/already handled/i.test(message)) {
          captureError = error instanceof Error ? error : new Error(message)
        }
        if (!settled) {
          settled = true
          await route.continue().catch(() => undefined)
        }
      }
    }
    await ensureOverlaysClosed(page)
    await page.route('**/manuscript/tree.list', delayedTree)
    try {
      const directory = await directoryRow(page, '正文')
      await directory.click({ force: true })
      await directory.click({ force: true })
      await waitFor(() => captured, 'capture pre-merge directory response', 10_000)
      if (captureError) throw captureError
      await (await treeFileRow(page, '002.md')).click({ button: 'right' })
      await page.getByRole('menu', { name: '文档操作' }).getByRole('menuitem', { name: '与下一章合并' }).click()
      const review = page.getByRole('dialog', { name: '合章' })
      await review.waitFor({ state: 'visible', timeout: 10_000 })
      await review.getByRole('button', { name: '应用' }).click()
      await waitFor(async () => !(await exists(resolve(workspace, '正文', '003.md'))), 'merged source removed from disk', 20_000)
      await waitFor(async () => !(await page.locator('.tree-row.tree-main').filter({ hasText: '003.md' }).count()), 'pre-release tree dropped merge source', 15_000)
      release()
      await waitFor(() => delivered || settled, 'release old directory response', 10_000)
      if (captureError) throw captureError
      if (!delivered) throw new Error('Delayed pre-merge tree response was not fulfilled')
      await page.evaluate(() => new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise))))
      if (await page.locator('.tree-row.tree-main').filter({ hasText: '003.md' }).count()) throw new Error('Late pre-merge response restored archived chapter in tree')
      await review.getByRole('button', { name: '关闭' }).click({ force: true }).catch(() => undefined)
      await ensureOverlaysClosed(page)
      const directoryAfter = await directoryRow(page, '正文')
      if (await directoryAfter.getAttribute('aria-expanded') === 'true') await directoryAfter.click({ force: true })
      await expandDirectory(page, '正文')
      const mergedRow = page.locator('.tree-row.tree-main').filter({ hasText: '002.md' }).first()
      await waitFor(async () => (await page.locator('.tree-row.tree-main').filter({ hasText: '002.md' }).count()) > 0, 'merged target row present', 15_000)
      await mergedRow.scrollIntoViewIfNeeded()
      await mergedRow.waitFor({ state: 'visible', timeout: 15_000 })
      if (await page.locator('.tree-row.tree-main').filter({ hasText: '003.md' }).count()) throw new Error('Archived chapter remains in tree after merge')
      report.treeRace = { realResponseDelayed: true, archivedRowRemainsAbsent: true }
      await shot(page, 'merge-refreshed')
      if (await exists(resolve(workspace, '正文', '003.md'))) throw new Error('Merged source remains on disk')
      const merged = await readFile(resolve(workspace, '正文', '002.md'), 'utf8')
      if (merged !== `${targetBefore.trimEnd()}\n\n${sourceBefore.trim()}\n`) throw new Error('Merged text does not preserve both source chapters')
      await page.locator('[data-testid="paper-path"]', { hasText: /正文\/002\.md/ }).waitFor({ state: 'attached', timeout: 15_000 })
    } finally {
      release()
      await waitFor(() => !held || settled || delivered, 'delayed tree handler settled', 8_000).catch(() => undefined)
      settled = true
      await page.unroute('**/manuscript/tree.list', delayedTree)
    }
  })

  await cover('chapter-navigation', async () => {
    await openTreeFile(page, '001.md', '正文')
    await page.locator('[data-testid="paper-next"]').click()
    await page.locator('[data-testid="paper-path"]', { hasText: /正文\/002\.md/ }).waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator('[data-testid="paper-prev"]').click()
    await page.locator('[data-testid="paper-path"]', { hasText: /正文\/001\.md/ }).waitFor({ state: 'visible', timeout: 15_000 })
  })

  await recordPhase('工作台功能覆盖', report.features.filter((item) => item.ok).map((item) => item.name).join(', '))
}

async function coverAi(page) {
  await dismissOverlays(page)
  const initIgnore = page.getByRole('article', { name: '作品初始化' }).getByRole('button', { name: '忽略' })
  if (await initIgnore.isVisible().catch(() => false)) await initIgnore.click()
  await openAssistantWithModel(page)
  await shot(page, 'assistant-ready')

  await cover('chat-ping', async () => {
    const reply = await sendChat(page, '请只回复一个英文单词 pong，不要使用任何工具。', '模型连通探测', sendTimeout)
    if (!/pong/i.test(reply)) throw new Error(`unexpected ping reply: ${reply.slice(0, 120)}`)
    return reply.slice(0, 80)
  })

  await cover('rewrite-custom', async () => {
    await openTreeFile(page, '001.md', '正文')
    const text = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="paper-editor"]')
      const view = /** @type {any} */ (el)?.__cmView
      return view ? view.state.doc.toString() : ''
    })
    const needle = '她听见广播重复同一句'
    const start = text.indexOf(needle)
    if (start < 0) throw new Error('rewrite needle missing')
    const end = text.indexOf('\n', start)
    await selectPaperRange(page, start, end > start ? end : start + needle.length + 12)
    await page.getByTestId('paper-editor-menu-trigger').click()
    await page.getByTestId('editor-menu-rewrite').click()
    const custom = page.getByRole('dialog', { name: '自定义改写' })
    await custom.getByLabel('输入改写要求').fill('缩短并保留信息')
    await custom.getByRole('button', { name: '改写', exact: true }).click()
    const proposal = page.locator('[aria-label="选段修改建议"]')
    await waitFor(async()=>{
      if(await proposal.isVisible().catch(()=>false))return true
      const notice=await page.locator('[data-testid="paper-notice"]').innerText().catch(()=> '')
      if(!/^正在/.test(notice)&&/未返回|失败|未启用/.test(notice))throw new Error(notice)
      return false
    },'usable rewrite suggestion',sendTimeout)
    if(/<\/?think>/.test(await proposal.innerText()))throw new Error('reasoning leaked into rewrite proposal');
    await proposal.getByRole('button', { name: '应用修改' }).click()
    await savePaper(page)
    await shot(page, 'rewrite')

    await createFileIn(page, '资料', 'draft')
    await typeIntoPaper(page, '普通文档改写探针。她听见广播重复同一句话，脚步停在栈桥上。\n')
    await openTreeFile(page, 'draft.md', '资料')
    const ordinary = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="paper-editor"]')
      const view = /** @type {any} */ (el)?.__cmView
      return view ? view.state.doc.toString() : ''
    })
    const ordinaryNeedle = '她听见广播重复同一句'
    const ordinaryStart = ordinary.indexOf(ordinaryNeedle)
    if (ordinaryStart < 0) throw new Error('ordinary rewrite needle missing')
    await selectPaperRange(page, ordinaryStart, ordinaryStart + ordinaryNeedle.length)
    await page.getByTestId('paper-editor-menu-trigger').click()
    await page.getByTestId('editor-menu-rewrite').click()
    const ordinaryCustom = page.getByRole('dialog', { name: '自定义改写' })
    await ordinaryCustom.waitFor({ state: 'visible', timeout: 10_000 })
    await ordinaryCustom.getByRole('button', { name: '取消', exact: true }).click()
    await ordinaryCustom.waitFor({ state: 'detached', timeout: 10_000 })
    return '正文/001.md rewritten; 资料/draft.md rewrite eligible'
  })

  await cover('fim-complete', async () => {
    await openTreeFile(page, '002.md', '正文')
    const content = page.locator('[data-testid="paper-editor"] .cm-content')
    await content.click()
    await page.keyboard.press('Control+End')
    // Give completion a reproducible unfinished sentence at the document end.
    await page.keyboard.insertText('\n\n林简推开门，发现窗边的人正握着录音带，她')
    await savePaper(page)
    await page.waitForFunction(() => {
      const view = document.querySelector('[data-testid="paper-editor"]')?.__cmView
      return view && view.state.selection.main.head === view.state.doc.length
    })
    await page.getByTestId('paper-editor-menu-trigger').click()
    await page.getByTestId('editor-menu-complete').click()
    await waitFor(async () => {
      if (await page.locator('[data-testid="paper-ghost"]').count()) return true
      const notice = await page.locator('[data-testid="paper-notice"]').innerText().catch(() => '')
      return !/^正在/.test(notice) && /未返回|失败|已停止|未启用/.test(notice)
    }, 'fim result', sendTimeout)
    if (await page.locator('[data-testid="paper-ghost"]').count()) {
      const accept = page.getByRole('button', { name: '接受补全' })
      if (await accept.isVisible().catch(() => false)) await accept.click()
      await savePaper(page)
      const saved=await readFile(resolve(workspace,'正文','002.md'),'utf8');if(/<\/?think>/.test(saved))throw new Error('reasoning leaked into saved document');
      return 'ghost accepted; saved text excludes reasoning'
    }
    throw new Error('MiniMax-M3 returned no usable ghost: ' + await page.locator('[data-testid="paper-notice"]').innerText().catch(() => 'no notice'))
  })

  await cover('chat-proposal', async () => {
    await sendAndApply(page, `请读取 正文/001.md。只调用一次 writing_propose（V2）create：对 大纲/总纲.md 使用 create（只传 path、text、summary）。不要传 targetVersion。该文件必须尚不存在；不要覆盖任何已有文件，也不要改成 edit。若你先读了 正文/001.md，它只能进 basis，不能代替目标生成基线。用不超过 400 字写两章章纲，点出雾港记忆税和林简。不要提问，不要只在聊天回答。不要调用 novel_propose、novel_memory_update，也不要写 index、scratch 或调用 context.compile。`, '大纲/总纲.md', '规划总纲')
    if (!(await exists(resolve(workspace, '大纲', '总纲.md')))) throw new Error('大纲/总纲.md missing after apply')
  })

  await cover('conversation-menu', async () => {
    const assistant = await ensureAssistantOpen(page)
    await startWritingConversation(page, assistant)
    await delay(800)
    await assistant.getByRole('button', { name: '对话操作' }).click()
    const menu = page.getByRole('menu', { name: '对话操作' })
    await menu.getByRole('menuitem', { name: '归档' }).click()
    await delay(800)
    await assistant.getByRole('button', { name: '对话操作' }).click()
    if (await menu.getByRole('menuitem', { name: '恢复' }).isEnabled().catch(() => false)) {
      await menu.getByRole('menuitem', { name: '恢复' }).click()
    }
  })
}

await rm(projectsRoot, { recursive: true, force: true })
await rm(home, { recursive: true, force: true })
await rm(output, { recursive: true, force: true })
await mkdir(resolve(home, 'electron-user-data'), { recursive: true })
await mkdir(output, { recursive: true })
await flushReport()

const env = {
  ...process.env,
  DSH_TELEMETRY_DISABLED: '1',
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: cli,
  DSH_DESKTOP_PROFILE_TEMPLATE: template,
  DSH_HOME: home,
  DSH_EDITOR_PROJECTS_ROOT: projectsRoot,
  DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
  SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-feature-coverage',
}
delete env.DSH_EDITOR_CUSTOM_API_KEY

await run(resolve(root, 'scripts', 'prepare-desktop-dev.mjs'), [], env)
await deployProfile(home, template, resolve(runtime, 'node_modules'))

let browser
let child
let page
try {
  const started = await startDsh(env)
  child = started.child
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', acceptDownloads: true })
  activePage = page
  page.setDefaultTimeout(30_000)
  report.rpc=[]
  page.on('response',async response=>{
    if(!/\/manuscript\/(fim|patch)\.complete/.test(response.url()))return;
    try{const body=(await response.json()).result;report.rpc.push({endpoint:response.url().split('/').at(-1),status:response.status(),ok:body?.ok,route:body?.value?.route,textChars:body?.value?.text?.length??0,error:body?.error?.message});}catch{report.rpc.push({endpoint:response.url().split('/').at(-1),status:response.status(),read:'unavailable'})}
  })
  page.on('pageerror', (error) => fail(`pageerror: ${sanitize(error.message)}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    report.consoleErrors = report.consoleErrors || []
    report.consoleErrors.push(sanitize(message.text()).slice(0, 240))
  })
  await page.goto(started.url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.title === 'DSH Editor', undefined, { timeout: 45_000 })
  await dismissNativeOnboarding(page)
  await page.waitForFunction(() => {
    const text = document.body.innerText || ''
    return text.includes('打开作品') || text.includes('空白稿纸') || Boolean(document.querySelector('[aria-label="稿件目录"]'))
  }, undefined, { timeout: 45_000 })
  await shot(page, 'home')

  if (!workbenchOnly) await configureMiniMax(page)
  {
    await createProjectFromHome(page)
    for (const name of ['正文', '大纲', '人物卡', '世界书', '资料']) await createFolder(page, name)
    await shot(page, 'project-open');
    if(aiOnly){
      await createFolder(page,'大纲');
      await createFileIn(page,'正文','001');await typeIntoPaper(page,'# 第一章 雾港\n\n林简站在港口，望着雾里的灯。她听见广播重复同一句话，脚步缓缓地停在空荡荡的栈桥上。\n');
      await createFileIn(page,'正文','002');await typeIntoPaper(page,'# 第二章 回声\n\n姚梨把档案盒推过桌面。林简推开门，');
    }else await coverWorkbench(page)
  }
  if (!workbenchOnly) await coverAi(page)
  await shot(page, 'complete')
  await recordPhase('功能覆盖完成', `${report.features.filter((item) => item.ok).length}/${report.features.length} ok`)
} catch (error) {
  fail(sanitize(error instanceof Error ? error.stack || error.message : String(error)))
  if (page) {
    await shot(page, 'failure').catch(() => undefined)
    await writeFile(resolve(output, 'failure.html'), sanitize(await page.content().catch(() => '')), 'utf8')
  }
  try {
    report.dshLogTail = sanitize(await readFile(resolve(output, 'dsh.log'), 'utf8')).slice(-6_000)
  } catch { /* optional */ }
} finally {
  if (browser) await browser.close().catch(() => undefined)
  await stop(child)
  report.finishedAt = new Date().toISOString()
  report.ok = report.failures.length === 0
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

console.log(JSON.stringify({
  ok: report.ok,
  model: report.model,
  phases: report.phases.length,
  features: report.features,
  failures: report.failures,
}, null, 2))
if (!report.ok) process.exitCode = 1
