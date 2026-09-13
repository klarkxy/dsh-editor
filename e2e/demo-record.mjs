/**
 * Record a from-zero DSH Editor demo.
 *
 * Chapter bodies are typed into the paper. MiniMax-M3 only proposes
 * chapter plans, recaps, character cards, and worldbook entries.
 *
 * Credentials default to ~/.mmx/config.json and are never printed.
 */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const demoDir = resolve(root, 'e2e', 'demo')
const devRoot = resolve(root, '.dev')
const projectsRoot = resolve(devRoot, 'demo-video-projects')
const book = '雾港回声'
const workspace = resolve(projectsRoot, book)
const home = resolve(devRoot, 'demo-video-home')
const output = resolve(root, 'e2e', 'out', 'demo')
const rawDir = resolve(output, 'raw')
const reset = process.env.E2E_DEMO_RESUME !== '1'
const sendTimeout = Number(process.env.E2E_DEMO_SEND_TIMEOUT_MS || 720_000)
const typeDelay = Number(process.env.E2E_DEMO_TYPE_DELAY_MS || 28)
const modelId = 'MiniMax-M3'

for (const target of [projectsRoot, workspace, home]) {
  if (!target.startsWith(`${devRoot}${sep}`)) throw new Error(`unsafe test path: ${target}`)
}
if (!output.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) throw new Error(`unsafe output path: ${output}`)

const mmxPath = process.env.MMX_CONFIG_PATH || join(homedir(), '.mmx', 'config.json')
const mmx = JSON.parse(await readFile(mmxPath, 'utf8'))
const apiKey = String(process.env.MINIMAX_API_KEY || mmx.api_key || '').trim()
if (!apiKey) throw new Error('MiniMax API key is unavailable')
const configuredBase = String(process.env.MINIMAX_BASE_URL || mmx.base_url || (mmx.region === 'cn' ? 'https://api.minimaxi.com' : 'https://api.minimax.io'))
const apiBase = `${configuredBase.replace(/\/+$/, '')}/v1`

resolveDshInstallation('0.1.5-rc.2')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')

const prompts = JSON.parse(await readFile(resolve(demoDir, 'prompts.json'), 'utf8'))
const manuscript = {
  ch1: await readFile(resolve(demoDir, 'manuscript', 'ch1.txt'), 'utf8'),
  ch1Tail: (await readFile(resolve(demoDir, 'manuscript', 'ch1-tail.txt'), 'utf8')).trimEnd(),
  ch2: await readFile(resolve(demoDir, 'manuscript', 'ch2.txt'), 'utf8'),
  ch3: await readFile(resolve(demoDir, 'manuscript', 'ch3.txt'), 'utf8'),
  rewriteNeedle: (await readFile(resolve(demoDir, 'manuscript', 'rewrite-needle.txt'), 'utf8')).trim(),
}

const chapters = [
  { name: '第一章 残片', path: '正文/第一章 残片.md' },
  { name: '第二章 回声', path: '正文/第二章 回声.md' },
  { name: '第三章 藏匿', path: '正文/第三章 藏匿.md' },
]

const report = {
  startedAt: new Date().toISOString(),
  book,
  workspace,
  model: modelId,
  phases: [],
  failures: [],
  screenshots: [],
}
const timeline = { startedAt: '', events: [] }
let videoOrigin = 0
let shotIndex = 0

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function sanitize(value) {
  return String(value).replaceAll(apiKey, '[redacted]').replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
}

function mark(kind, note = '') {
  timeline.events.push({ t: videoOrigin ? (Date.now() - videoOrigin) / 1000 : 0, kind, note, at: new Date().toISOString() })
  return flushTimeline()
}

async function flushReport() {
  report.ok = report.failures.length === 0
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

async function flushTimeline() {
  await writeFile(resolve(output, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`, 'utf8')
}

function recordPhase(name, detail = '') {
  report.phases.push({ name, detail, at: new Date().toISOString() })
  console.log(`[demo] ${name}${detail ? `: ${detail}` : ''}`)
  return flushReport()
}

function fail(message) {
  report.failures.push(message)
  console.error(`[demo] ${message}`)
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

async function shot(page, name) {
  shotIndex += 1
  const file = resolve(output, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file })
  report.screenshots.push(file)
}

async function hold(ms) {
  await mark('hold')
  await delay(ms)
  await mark('action')
}

async function clickVisible(page, locator, options = {}) {
  await locator.scrollIntoViewIfNeeded().catch(() => undefined)
  const box = await locator.boundingBox()
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 })
  await locator.click(options)
}

async function installCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById('dsh-demo-cursor')) return
    const el = document.createElement('div')
    el.id = 'dsh-demo-cursor'
    el.style.cssText = 'position:fixed;z-index:2147483647;width:18px;height:18px;margin:-9px 0 0 -9px;border:2px solid #1b365d;border-radius:50%;background:rgba(27,54,93,.2);pointer-events:none;transition:left .07s linear,top .07s linear,transform .08s ease,background .08s ease;'
    document.documentElement.appendChild(el)
    const move = (event) => {
      el.style.left = `${event.clientX}px`
      el.style.top = `${event.clientY}px`
    }
    window.addEventListener('mousemove', move, true)
    window.addEventListener('mousedown', () => {
      el.style.background = 'rgba(27,54,93,.5)'
      el.style.transform = 'scale(1.35)'
    }, true)
    window.addEventListener('mouseup', () => {
      el.style.background = 'rgba(27,54,93,.2)'
      el.style.transform = 'scale(1)'
    }, true)
  })
}

async function dismissNativeOnboarding(page) {
  const continueNotice = page.getByRole('button', { name: '继续', exact: true })
  for (let step = 0; step < 5; step += 1) {
    if (!(await continueNotice.isVisible({ timeout: 800 }).catch(() => false))) break
    await continueNotice.click()
    await delay(200)
  }
  const configureLater = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await configureLater.isVisible({ timeout: 1_500 }).catch(() => false)) await configureLater.click()
}

async function dismissInitGuide(page) {
  const card = page.getByRole('article', { name: '项目初始化' })
  if (!(await card.isVisible().catch(() => false))) return
  const ignore = card.getByRole('button', { name: '忽略' })
  if (await ignore.isVisible().catch(() => false)) await ignore.click()
}

async function dismissOverlays(page) {
  for (let step = 0; step < 6; step += 1) {
    const closeDetail = page.getByRole('button', { name: '关闭卡片详情' })
    if (await closeDetail.isVisible().catch(() => false)) {
      await closeDetail.click()
      await delay(200)
      continue
    }
    const closePanel = page.getByRole('button', { name: /关闭卡片面板/ })
    if (await closePanel.isVisible().catch(() => false)) {
      await closePanel.click()
      await delay(200)
      continue
    }
    const overlay = page.locator('.file-dialog-overlay, .palette-overlay, .settings-overlay, .dsh-ui.file-dialog').first()
    if (!(await overlay.isVisible().catch(() => false))) return
    const close = overlay.getByRole('button', { name: /^(关闭|取消)$/ }).first()
    if (await close.isVisible().catch(() => false)) await close.click({ force: true }).catch(() => undefined)
    else await page.keyboard.press('Escape')
    await delay(200)
  }
}

function hostPage(scope) {
  return typeof scope.page === 'function' ? scope.page() : scope
}

async function chooseCustomSelect(scope, ariaLabel, matcher) {
  const page = hostPage(scope)
  const trigger = scope.getByRole('combobox', { name: ariaLabel }).first()
  await trigger.waitFor({ state: 'visible', timeout: 15_000 })
  await trigger.click()
  let list = page.getByRole('listbox', { name: ariaLabel })
  if (!(await list.isVisible({ timeout: 2_000 }).catch(() => false))) list = page.getByRole('listbox').last()
  await list.waitFor({ state: 'visible', timeout: 10_000 })
  const options = list.getByRole('option')
  const labels = await options.allTextContents()
  const trimmed = labels.map((label) => label.replace(/\s+/g, ' ').trim())
  const index = trimmed.findIndex((label) => matcher(label, trimmed))
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

async function configureMiniMax(page) {
  const yaml = await readFile(resolve(home, 'settings.yaml'), 'utf8').catch(() => '')
  if (/minimax-e2e|MiniMax-M3/.test(yaml)) {
    await recordPhase('接口已配置，跳过')
    return
  }
  await openShellSettings(page)
  const dialog = page.getByRole('dialog', { name: '设置' })
  const writingTab = dialog.locator('.settings-nav').getByRole('tab', { name: '写作', exact: true })
  if (await writingTab.isVisible().catch(() => false)) await writingTab.click()
  else await dialog.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '写作' }).click()
  const authorBox = dialog.getByRole('textbox', { name: '跨作品作者约定' })
  if (await authorBox.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await authorBox.fill('第三人称限知；少用感叹号；对白保持克制，不解释系统。')
    const savePrefs = dialog.getByRole('button', { name: '保存作者约定' })
    if (await savePrefs.isEnabled().catch(() => false)) await savePrefs.click()
  }
  const modelsTab = dialog.locator('.settings-nav').getByRole('tab', { name: '模型', exact: true })
  if (await modelsTab.isVisible().catch(() => false)) await modelsTab.click()
  else await dialog.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '模型' }).click()
  const models = dialog.getByRole('region', { name: '模型', exact: true })
  await models.waitFor({ state: 'visible', timeout: 15_000 })
  await waitFor(async () => !(await models.getByText('正在读取…').isVisible().catch(() => false)), 'models page loaded', 45_000)
  if (!(await models.locator('.models-row-card').filter({ hasText: /minimax-e2e|MiniMax/i }).count())) {
    const addCustom = models.getByRole('button', { name: '添加自定义提供方' })
    const setupCancel = models.locator('.models-editor').first().getByRole('button', { name: '取消' })
    if (await setupCancel.isVisible().catch(() => false) && !(await models.locator('.models-add-card').count())) {
      await setupCancel.click()
    }
    await addCustom.click()
    const card = models.locator('.models-add-card')
    await card.waitFor({ state: 'visible', timeout: 15_000 })
    await fillCustomMiniMaxCard(card)
    const create = card.getByRole('button', { name: '创建提供方' })
    await waitFor(async () => create.isEnabled(), 'custom MiniMax create enabled', 30_000)
    await create.click({ force: true })
    await models.getByText('已保存。', { exact: true }).waitFor({ state: 'visible', timeout: 45_000 }).catch(() => undefined)
  }
  await closeShellSettings(page)
  await recordPhase('接口连接成功', `MiniMax ${modelId}`)
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
      if (await options.count()) await options.first().click()
      else await question.locator('.question-custom').fill('按已给出的设定和推荐方案继续，不增加新分支。')
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

async function ensureAssistantOpen(page) {
  const assistant = page.locator('aside.chat')
  if (await assistant.isVisible().catch(() => false)) return page.getByRole('complementary', { name: '写作助手' })
  const launcher = page.getByRole('button', { name: '打开写作搭档' })
  if (await launcher.isVisible().catch(() => false)) await clickVisible(page, launcher)
  else await clickVisible(page, page.getByRole('button', { name: '搭档', exact: true }))
  await assistant.waitFor({ state: 'visible', timeout: 30_000 })
  await dismissInitGuide(page)
  return page.getByRole('complementary', { name: '写作助手' })
}

async function openAssistantWithModel(page) {
  const assistant = await ensureAssistantOpen(page)
  const currentModel = await assistant.locator('.model-picker, .composer-model').innerText().catch(() => '')
  if (/MiniMax-M3/i.test(currentModel)) {
    report.model = currentModel.replace(/\s+/g, ' ').trim()
    return
  }
  const chosen = await chooseCustomSelect(assistant, '选择模型', (label, labels) => {
    const pick = labels.find((item) => /MiniMax-M3/i.test(item))
      || labels.find((item) => /MiniMax/i.test(item))
      || labels[0]
    return label === pick
  })
  report.model = String(chosen || modelId)
  const effort = assistant.getByRole('combobox', { name: '思考强度' })
  if (await effort.isVisible().catch(() => false)) {
    const current = await effort.innerText()
    if (!/low|Low|低|medium|Medium|中/.test(current)) {
      await chooseCustomSelect(assistant, '思考强度', (label) => /low|Low|低|medium|Medium|中/.test(label)).catch(() => undefined)
    }
  }
  await dismissInitGuide(page)
}

function proposalCards(page) {
  return page.locator('[aria-label="文件修改建议"]')
}

function proposalFor(page, expectedPath) {
  return proposalCards(page).filter({ hasText: expectedPath }).last()
}

function proposalSettled(text) {
  return /已应用到作品|已应用/.test(text)
}

async function waitForProposal(page, previousCount, previousAssistantCount, label, expectedPath, warningBaseline = 0) {
  const cards = proposalCards(page)
  const warnings = page.locator('.chat-history .warning').filter({ hasText: /未能完成|中断/ })
  const deadline = Date.now() + sendTimeout
  let completedWithoutProposalAt = 0
  while (Date.now() < deadline) {
    await answerPending(page)
    const card = proposalFor(page, expectedPath)
    if (await card.count()) {
      const text = await card.innerText().catch(() => '')
      if (/文件已经变化|需要重新生成/.test(text)) throw new Error(`${label}: stale-proposal`)
      const ready = await card.getByRole('button', { name: /^(应用|采用)$/ }).isVisible().catch(() => false)
      if (ready || proposalSettled(text)) return card
    } else if (await cards.count() > previousCount) {
      await delay(400)
      continue
    }
    if (await warnings.count() > warningBaseline) throw new Error(`${label}: ${await warnings.last().innerText()}`)
    const assistantCount = await page.locator('.chat-row.assistant').count()
    const stopVisible = await page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)
    if (assistantCount > previousAssistantCount && !stopVisible) {
      if (!completedWithoutProposalAt) completedWithoutProposalAt = Date.now()
      if (Date.now() - completedWithoutProposalAt > 16_000) {
        throw new Error(`${label}: turn completed without a usable proposal`)
      }
    } else completedWithoutProposalAt = 0
    await delay(400)
  }
  throw new Error(`${label}: no proposal within timeout`)
}

async function waitUntilApplied(page, expectedPath, label) {
  await waitFor(async () => {
    const text = await proposalFor(page, expectedPath).innerText().catch(() => '')
    return proposalSettled(text)
  }, `${label}: applied`, 90_000)
}

async function sendAndApply(page, prompt, expectedPath, label, attempt = 0) {
  await dismissOverlays(page)
  await ensureAssistantOpen(page)
  const before = await proposalCards(page).count()
  const assistantBefore = await page.locator('.chat-row.assistant').count()
  const warningBaseline = await page.locator('.chat-history .warning').filter({ hasText: /未能完成|中断/ }).count()
  const composer = page.getByRole('textbox', { name: '输入消息' })
  await clickVisible(page, composer)
  await composer.fill(prompt)
  await hold(600)
  const send = page.getByRole('button', { name: '发送', exact: true })
  await waitFor(async () => send.isEnabled(), `${label}: send enabled`, 30_000)
  await mark('wait', label)
  try {
    await send.click({ force: true })
    await waitFor(async () => {
      if (await proposalCards(page).count() > before) return true
      return page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)
    }, `${label}: turn started`, 90_000)
    const card = await waitForProposal(page, before, assistantBefore, label, expectedPath, warningBaseline)
    await mark('action', `${label}:proposal`)
    await hold(1_400)
    const text = await card.innerText().catch(() => '')
    if (!proposalSettled(text)) {
      await clickVisible(page, card.getByRole('button', { name: /^(应用|采用)$/ }))
      await waitUntilApplied(page, expectedPath, label)
    }
    await hold(1_200)
    await recordPhase(label, expectedPath)
    return proposalFor(page, expectedPath)
  } catch (error) {
    const message = String(error)
    if (attempt < 1 && /stale-proposal|未能完成|without a usable proposal|turn started/.test(message)) {
      await recordPhase(`${label} 失败，重试`, message.slice(0, 120))
      await startFreshConversation(page)
      await delay(1_000)
      return sendAndApply(page, prompt, expectedPath, label, attempt + 1)
    }
    throw error
  }
}

async function startFreshConversation(page) {
  await dismissOverlays(page)
  const assistant = await ensureAssistantOpen(page)
  await clickVisible(page, assistant.getByRole('button', { name: '新对话' }))
  const discard = page.getByRole('button', { name: '放弃并继续', exact: true })
  if (await discard.isVisible({ timeout: 1_200 }).catch(() => false)) await discard.click()
  await dismissInitGuide(page)
}

async function createProjectFromHome(page) {
  await clickVisible(page, page.getByRole('button', { name: '新建', exact: true }).first())
  const dialog = page.getByRole('dialog', { name: '新建作品' })
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.getByLabel('作品名称').fill(book)
  await hold(700)
  await clickVisible(page, dialog.getByRole('button', { name: '创建', exact: true }))
  await page.getByRole('navigation', { name: '稿件目录' }).waitFor({ state: 'visible', timeout: 45_000 })
  await page.locator('.tree-row', { hasText: '正文' }).first().waitFor({ state: 'visible', timeout: 20_000 })
  await recordPhase('新建作品', workspace)
}

async function createChapter(page, name, first) {
  const writeFirst = page.getByRole('button', { name: '写第一章', exact: true })
  if (first && await writeFirst.isVisible().catch(() => false)) {
    await clickVisible(page, writeFirst)
  } else {
    const row = page.locator('.tree-row').filter({ hasText: '正文' }).first()
    await row.waitFor({ state: 'visible', timeout: 15_000 })
    if (await row.getAttribute('aria-expanded') !== 'true') await clickVisible(page, row)
    await row.hover()
    const createIn = page.getByRole('button', { name: '在 正文 中新建文件', exact: true })
    if (await createIn.isVisible().catch(() => false)) await clickVisible(page, createIn)
    else {
      await clickVisible(page, row, { button: 'right' })
      await page.getByRole('menu', { name: '文档操作' }).getByRole('menuitem', { name: '新建文件' }).click()
    }
  }
  const dialog = page.getByRole('dialog', { name: '新建文件' })
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.getByLabel('文件名称（无扩展名时按 .md 创建）').fill(name)
  await hold(500)
  await clickVisible(page, dialog.getByRole('button', { name: '创建', exact: true }))
  await dialog.waitFor({ state: 'detached', timeout: 15_000 })
  await page.locator('[data-testid="paper-path"]', { hasText: `正文/${name}.md` }).waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('[data-testid="paper-save-state"]', { hasText: '已保存' }).waitFor({ state: 'visible', timeout: 15_000 })
}

async function savePaper(page) {
  const save = page.getByRole('button', { name: '保存', exact: true })
  if (await save.isVisible().catch(() => false) && await save.isEnabled().catch(() => false)) await clickVisible(page, save)
  else await page.keyboard.press('Control+s')
  await page.locator('[data-testid="paper-save-state"]', { hasText: '已保存' }).waitFor({ state: 'visible', timeout: 15_000 })
}

async function readPaper(page) {
  return page.evaluate(() => {
    const view = document.querySelector('[data-testid="paper-editor"]')?.__cmView
    return view ? view.state.doc.toString() : ''
  })
}

async function typeIntoPaper(page, text) {
  const content = page.locator('[data-testid="paper-editor"] .cm-content')
  await content.waitFor({ state: 'visible', timeout: 15_000 })
  await clickVisible(page, content)
  await page.keyboard.press('Control+End')
  const existing = await readPaper(page)
  if (existing.trim() && !existing.endsWith('\n')) await page.keyboard.insertText('\n\n')
  else if (existing.trim() && existing.endsWith('\n') && !existing.endsWith('\n\n')) await page.keyboard.insertText('\n')
  await mark('type', `chars=${text.replace(/\s/g, '').length}`)
  for (const char of text) {
    await page.keyboard.insertText(char)
    await delay(char === '\n' ? Math.max(70, typeDelay * 2) : typeDelay)
  }
  await mark('action', 'typed')
  await savePaper(page)
}

async function selectPaperRange(page, from, to) {
  const ok = await page.evaluate(({ start, end }) => {
    const view = document.querySelector('[data-testid="paper-editor"]')?.__cmView
    if (!view) return false
    const length = view.state.doc.length
    view.dispatch({ selection: { anchor: Math.max(0, Math.min(start, length)), head: Math.max(0, Math.min(end, length)) } })
    view.focus()
    return true
  }, { start: from, end: to })
  if (!ok) throw new Error('CodeMirror view missing')
}

async function expandPlanStrip(page) {
  const strip = page.locator('.chapter-plan-strip')
  if (!(await strip.count())) return
  const summary = strip.locator('summary')
  if (await summary.isVisible().catch(() => false)) {
    await clickVisible(page, summary)
    await hold(2_200)
  }
}

async function openChapterMeta(page, name) {
  try {
    await clickVisible(page, page.getByRole('button', { name: '正文操作', exact: true }))
    await clickVisible(page, page.getByRole('menuitem', { name, exact: true }))
    const dialog = page.getByRole('dialog', { name, exact: true })
    await dialog.waitFor({ state: 'visible', timeout: 10_000 })
    await hold(2_400)
    const cancel = dialog.getByRole('button', { name: '取消', exact: true })
    if (await cancel.isVisible().catch(() => false)) await clickVisible(page, cancel)
    await dialog.waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => undefined)
  } catch (error) {
    await recordPhase(`${name}对话框跳过`, sanitize(error instanceof Error ? error.message : String(error)).slice(0, 160))
    await page.keyboard.press('Escape').catch(() => undefined)
  }
}

async function closeCardSurfaces(page, panel) {
  const closeDetail = page.getByRole('button', { name: '关闭卡片详情' })
  if (await closeDetail.isVisible().catch(() => false)) {
    await clickVisible(page, closeDetail)
    await delay(250)
  }
  const closePanel = panel.getByRole('button', { name: '关闭卡片面板' })
  if (await closePanel.isVisible().catch(() => false)) await clickVisible(page, closePanel)
  else await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => undefined)
}

async function showPanelCard(page, panelName, cardName, pin = false) {
  try {
    await page.keyboard.press(panelName === '人物卡' ? 'Control+Shift+C' : 'Control+Shift+W')
    const panel = page.getByRole('region', { name: panelName })
    await panel.waitFor({ state: 'visible', timeout: 12_000 })
    await hold(900)
    const card = panel.getByRole('button', { name: new RegExp(cardName) }).first()
    if (await card.isVisible().catch(() => false)) {
      await clickVisible(page, card)
      await page.getByRole('region', { name: `${panelName}详情` }).waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined)
      await hold(2_600)
      if (pin) {
        const pinBtn = page.getByRole('button', { name: '钉在旁边' })
        if (await pinBtn.isVisible().catch(() => false)) {
          await clickVisible(page, pinBtn)
          await page.getByRole('region', { name: /钉住/ }).waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined)
          await hold(2_200)
        }
      }
    }
    await closeCardSurfaces(page, panel)
  } catch (error) {
    await recordPhase(`${panelName}展示跳过`, sanitize(error instanceof Error ? error.message : String(error)).slice(0, 160))
    await page.keyboard.press('Escape').catch(() => undefined)
  }
}

async function unpin(page) {
  const button = page.getByRole('button', { name: '取消钉住' })
  if (await button.isVisible().catch(() => false)) {
    await clickVisible(page, button)
    await page.getByRole('region', { name: /钉住/ }).waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => undefined)
  }
}

async function tryComplete(page) {
  const content = page.locator('[data-testid="paper-editor"] .cm-content')
  await clickVisible(page, content)
  await page.keyboard.press('Control+End')
  await mark('wait', 'fim')
  await clickVisible(page, page.getByTestId('paper-editor-menu-trigger'))
  await clickVisible(page, page.getByTestId('editor-menu-complete'))
  const deadline = Date.now() + Math.min(sendTimeout, 180_000)
  while (Date.now() < deadline) {
    if (await page.locator('[data-testid="paper-ghost"]').count()) {
      await mark('action', 'fim-ready')
      await hold(1_000)
      const accept = page.getByRole('button', { name: '接受补全' })
      if (await accept.isVisible().catch(() => false)) await clickVisible(page, accept)
      else await page.keyboard.press('Tab')
      await savePaper(page)
      await recordPhase('光标补全', 'accepted')
      return true
    }
    const notice = await page.locator('[data-testid="paper-notice"]').innerText().catch(() => '')
    if (notice && /未返回|失败|未启用/.test(notice) && !/^正在/.test(notice)) break
    await delay(400)
  }
  await mark('action', 'fim-skip')
  await page.keyboard.press('Escape').catch(() => undefined)
  await recordPhase('光标补全未出建议', 'typed fallback')
  return false
}

async function rewriteNeedle(page) {
  const text = await readPaper(page)
  const start = text.indexOf(manuscript.rewriteNeedle)
  if (start < 0) throw new Error('rewrite needle missing from paper')
  await selectPaperRange(page, start, start + manuscript.rewriteNeedle.length)
  await hold(700)
  await mark('wait', 'rewrite')
  await clickVisible(page, page.getByTestId('paper-editor-menu-trigger'))
  await clickVisible(page, page.getByTestId('editor-menu-rewrite'))
  const custom = page.getByRole('dialog', { name: '自定义改写' })
  await custom.waitFor({ state: 'visible', timeout: 10_000 })
  await custom.getByLabel('输入改写要求').fill('改成更短、更冲的对白，不要解释记忆税是什么，但保留她在挡人、只承认自己修塔。')
  await clickVisible(page, custom.getByRole('button', { name: '改写', exact: true }))
  const proposal = page.locator('[aria-label="选段修改建议"]')
  await waitFor(async () => {
    if (await proposal.isVisible().catch(() => false)) return true
    const notice = await page.locator('[data-testid="paper-notice"]').innerText().catch(() => '')
    if (notice && !/^正在/.test(notice) && /未返回|失败|未启用/.test(notice)) throw new Error(notice)
    return false
  }, 'rewrite suggestion', sendTimeout)
  await mark('action', 'rewrite-ready')
  await hold(1_600)
  await clickVisible(page, proposal.getByRole('button', { name: '应用修改' }))
  await savePaper(page)
  await recordPhase('选段改写', 'applied')
}

async function tourWorkbench(page) {
  await hold(1_200)
  await page.keyboard.press('Control+b')
  await page.locator('.sidebar').waitFor({ state: 'detached', timeout: 8_000 }).catch(() => undefined)
  await hold(700)
  await page.keyboard.press('Control+b')
  await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 8_000 })
  await hold(600)
  await page.keyboard.press('Control+\\')
  await page.locator('.shell.focus-mode').waitFor({ state: 'visible', timeout: 8_000 })
  await hold(1_400)
  await page.keyboard.press('Control+\\')
  await page.locator('.shell.focus-mode').waitFor({ state: 'detached', timeout: 8_000 })
  await ensureAssistantOpen(page)
  await hold(1_000)
}

if (reset) {
  await rm(projectsRoot, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
  await rm(rawDir, { recursive: true, force: true })
  await rm(resolve(output, 'work'), { recursive: true, force: true })
  await rm(resolve(output, 'report.json'), { force: true })
  await rm(resolve(output, 'timeline.json'), { force: true })
  await rm(resolve(output, 'dsh.log'), { force: true })
}
await mkdir(resolve(home, 'electron-user-data'), { recursive: true })
await mkdir(rawDir, { recursive: true })
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
  SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-demo-video',
}
delete env.DSH_EDITOR_CUSTOM_API_KEY

await run(resolve(root, 'scripts', 'prepare-desktop-dev.mjs'), [], env)
await deployProfile(home, template, resolve(runtime, 'node_modules'))

let browser
let child
let recordContext
let page
try {
  const started = await startDsh(env)
  child = started.child
  browser = await chromium.launch({ headless: true })

  const setup = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'zh-CN' })
  const setupPage = await setup.newPage()
  setupPage.setDefaultTimeout(30_000)
  await setupPage.goto(started.url.href, { waitUntil: 'domcontentloaded' })
  await setupPage.waitForFunction(() => document.title === 'DSH Editor', undefined, { timeout: 45_000 })
  await dismissNativeOnboarding(setupPage)
  await configureMiniMax(setupPage)
  await setup.close()

  recordContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-CN',
    deviceScaleFactor: 1,
    recordVideo: { dir: rawDir, size: { width: 1920, height: 1080 } },
  })
  page = await recordContext.newPage()
  page.setDefaultTimeout(30_000)
  page.on('pageerror', (error) => fail(`pageerror: ${sanitize(error.message)}`))
  await page.goto(started.url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.title === 'DSH Editor', undefined, { timeout: 45_000 })
  await dismissNativeOnboarding(page)
  await installCursor(page)
  videoOrigin = Date.now()
  timeline.startedAt = new Date().toISOString()
  await mark('action', 'record-start')

  await mark('vo', '00-open')
  await page.getByRole('button', { name: '新建', exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
  await shot(page, 'home')
  await hold(6_500)

  await mark('vo', '02-create')
  await hold(800)
  await createProjectFromHome(page)
  await installCursor(page)
  await shot(page, 'empty-workbench')
  await hold(2_000)

  await mark('vo', '01-ui')
  await tourWorkbench(page)
  await openAssistantWithModel(page)
  await shot(page, 'assistant-ready')

  await mark('vo', '03-ch1-plan')
  await createChapter(page, chapters[0].name, true)
  await ensureAssistantOpen(page)
  await sendAndApply(page, prompts.ch1Plan, chapters[0].path, '第一章章纲')
  await expandPlanStrip(page)
  await openChapterMeta(page, '章纲')

  await mark('vo', '03-ch1-write')
  await typeIntoPaper(page, manuscript.ch1.trimEnd())
  await page.keyboard.insertText('\n\n')
  await typeIntoPaper(page, manuscript.ch1Tail)
  const completed = await tryComplete(page)
  if (!completed) {
    await typeIntoPaper(page, '里，有人正在换班。')
  }
  await hold(1_200)

  await mark('vo', '03-ch1-assets')
  await sendAndApply(page, prompts.ch1Summary, chapters[0].path, '第一章小结')
  await openChapterMeta(page, '章末小结')
  await sendAndApply(page, prompts.ch1Card, '人物卡/林简.md', '人物卡林简')
  await showPanelCard(page, '人物卡', '林简', true)
  await sendAndApply(page, prompts.ch1World, '世界书/港口.md', '世界书港口')
  await showPanelCard(page, '世界书', '港口')
  await shot(page, 'chapter-1')
  await unpin(page)

  await mark('vo', '04-ch2')
  await dismissOverlays(page)
  await createChapter(page, chapters[1].name, false)
  await sendAndApply(page, prompts.ch2Plan, chapters[1].path, '第二章章纲')
  await expandPlanStrip(page)
  await typeIntoPaper(page, manuscript.ch2.trim())
  await hold(1_000)

  await mark('vo', '04-ch2-assets')
  await sendAndApply(page, prompts.ch2Summary, chapters[1].path, '第二章小结')
  await openChapterMeta(page, '章末小结')
  await sendAndApply(page, prompts.ch2Card, '人物卡/姚梨.md', '人物卡姚梨')
  await sendAndApply(page, prompts.ch2World, '世界书/回声库.md', '世界书回声库')
  await sendAndApply(page, prompts.ch2Update, '人物卡/林简.md', '更新林简')
  await showPanelCard(page, '人物卡', '姚梨', true)
  await showPanelCard(page, '世界书', '回声库')
  await shot(page, 'chapter-2')
  await unpin(page)

  await mark('vo', '05-ch3-write')
  await dismissOverlays(page)
  await createChapter(page, chapters[2].name, false)
  await sendAndApply(page, prompts.ch3Plan, chapters[2].path, '第三章章纲')
  await expandPlanStrip(page)
  await typeIntoPaper(page, manuscript.ch3.trim())
  await hold(1_000)

  await mark('vo', '05-ch3-rewrite')
  await rewriteNeedle(page)
  await hold(1_200)

  await mark('vo', '05-ch3-assets')
  await sendAndApply(page, prompts.ch3Summary, chapters[2].path, '第三章小结')
  await sendAndApply(page, prompts.ch3Card, '人物卡/季衡.md', '人物卡季衡')
  await sendAndApply(page, prompts.ch3World, '世界书/记忆税.md', '世界书记忆税')
  await sendAndApply(page, prompts.ch3Update, '人物卡/林简.md', '再更新林简')
  await showPanelCard(page, '人物卡', '季衡')
  await showPanelCard(page, '世界书', '记忆税')
  await showPanelCard(page, '人物卡', '林简')
  await shot(page, 'chapter-3')

  await mark('vo', '06-close')
  await page.keyboard.press('Control+Shift+O')
  const overview = page.getByRole('region', { name: '作品概览' })
  await overview.waitFor({ state: 'visible', timeout: 15_000 })
  await hold(3_200)
  await shot(page, 'overview')
  const closeOverview = overview.getByRole('button', { name: '关闭概览' })
  if (await closeOverview.isVisible().catch(() => false)) await clickVisible(page, closeOverview)
  await hold(2_400)
  await mark('action', 'record-end')
  await recordPhase('拍摄完成', chapters.map((item) => item.path).join(', '))
} catch (error) {
  fail(sanitize(error instanceof Error ? error.stack || error.message : String(error)))
  if (page) await shot(page, 'failure').catch(() => undefined)
} finally {
  if (page) await page.close().catch(() => undefined)
  if (recordContext) await recordContext.close().catch(() => undefined)
  if (browser) await browser.close().catch(() => undefined)
  await stop(child)
  report.finishedAt = new Date().toISOString()
  await flushTimeline()
  await flushReport()
}

console.log(JSON.stringify({
  ok: report.ok,
  phases: report.phases,
  failures: report.failures,
  events: timeline.events.length,
}, null, 2))
if (!report.ok) process.exitCode = 1
