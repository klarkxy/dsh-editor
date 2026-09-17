/**
 * Human-friendliness walkthrough with optional MiniMax-M3 live turns.
 * Never prints credentials.
 */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const devRoot = resolve(root, '.dev')
const home = resolve(devRoot, 'human-audit-home')
const projects = resolve(devRoot, 'human-audit-projects')
const book = '雾港夜航'
const seeded = resolve(projects, book)
const output = resolve(root, 'e2e', 'out', 'human-audit')
const sendTimeout = Number(process.env.E2E_FEATURE_SEND_TIMEOUT_MS || 180_000)
const modelId = 'MiniMax-M3'

for (const target of [home, projects, seeded, output]) {
  if (!target.startsWith(`${devRoot}${sep}`) && !target.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) {
    throw new Error(`unsafe path: ${target}`)
  }
}

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

const report = {
  startedAt: new Date().toISOString(),
  model: modelId,
  screenshots: [],
  failures: [],
  notes: [],
  findings: [],
  a11y: [],
  live: {},
}

function sanitize(value) {
  return String(value).replaceAll(apiKey, '[redacted]').replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
}
function note(title, detail = '') {
  report.notes.push({ title, detail: sanitize(detail), at: new Date().toISOString() })
  console.log(`[human-audit] ${title}${detail ? `: ${sanitize(detail)}` : ''}`)
}
function finding(severity, title, detail = '') {
  report.findings.push({ severity, title, detail: sanitize(detail) })
  console.log(`[human-audit] [${severity}] ${title}${detail ? `: ${sanitize(detail)}` : ''}`)
}
function fail(message) {
  report.failures.push(sanitize(message))
  console.error(`[human-audit] ${sanitize(message)}`)
}
function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)) }

async function waitFor(check, label, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(150)
  }
  throw new Error(`timed out: ${label}`)
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

function run(script, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    child.stdout.on('data', (chunk) => process.stdout.write(sanitize(chunk)))
    child.stderr.on('data', (chunk) => process.stderr.write(sanitize(chunk)))
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`preparation exited ${code}`)))
  })
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
  note('DSH spawn', `pid=${child.pid}`)
  const ready = new Promise((resolveReady, reject) => {
    let buffer = ''
    const inspect = (chunk) => {
      const text = sanitize(chunk)
      logs.push(text)
      void writeFile(logFile, text, { flag: 'a' }).catch(() => undefined)
      process.stdout.write(text)
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
    delay(120_000).then(() => { throw new Error(`DSH readiness timed out: ${logs.join('').slice(-4_000)}`) }),
  ])
  return { child, url, logs }
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
  await page.waitForTimeout(180)
  await page.screenshot({ path: file })
  report.screenshots.push({ name, file: file.replace(`${root}${sep}`, ''), intent, at: new Date().toISOString() })
  note('截图', `${name} — ${intent}`)
}

async function safe(label, fn) {
  try {
    await fn()
  } catch (error) {
    fail(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    if (activePage) await shot(activePage, `failed-${label.replace(/\s+/g, '-')}`, `失败：${label}`).catch(() => undefined)
  }
}

async function collectA11y(page, surface) {
  const issues = await page.evaluate(() => {
    const visible = (el) => {
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const nameOf = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim()
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(visible)
    const unnamed = buttons.filter((el) => !nameOf(el)).map((el) => (el.className || '').toString().slice(0, 80))
    const tiny = buttons.filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24)
    }).map((el) => ({ name: nameOf(el).slice(0, 40), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }))
    const inputs = [...document.querySelectorAll('input, textarea, select')].filter(visible)
    const unlabeled = inputs.filter((el) => {
      const id = el.id
      const labelled = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest('label') || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
      return !labelled
    }).map((el) => el.getAttribute('placeholder') || el.name || el.className)
    return { unnamed, tiny, unlabeled, buttonCount: buttons.length }
  })
  report.a11y.push({ surface, ...issues })
  if (issues.unnamed.length) finding('high', `${surface} 有无名按钮`, issues.unnamed.slice(0, 8).join(' | '))
  if (issues.unlabeled.length) finding('high', `${surface} 有未标注输入框`, issues.unlabeled.slice(0, 8).join(' | '))
  if (issues.tiny.length) finding('medium', `${surface} 有过小点击目标`, JSON.stringify(issues.tiny.slice(0, 6)))
}

async function chooseCustomSelect(scope, ariaLabel, matcher) {
  const page = typeof scope.page === 'function' ? scope.page() : scope
  const trigger = scope.getByRole('combobox', { name: ariaLabel }).first()
  await trigger.waitFor({ state: 'visible', timeout: 10_000 })
  await trigger.click()
  let list = page.getByRole('listbox', { name: ariaLabel })
  if (!(await list.isVisible({ timeout: 2_000 }).catch(() => false))) list = page.getByRole('listbox').last()
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

async function waitModelsReady(models) {
  await waitFor(async () => !(await models.getByText('正在读取…').isVisible().catch(() => false)), 'models page loaded', 45_000)
}

async function fillCustomMiniMaxCard(card) {
  await card.getByLabel('Provider ID').fill('minimax-e2e')
  await card.getByLabel('显示名称').fill('MiniMax')
  await card.getByLabel('API 地址').fill(apiBase)
  const customized = card.locator('summary').filter({ hasText: '自定义设置' })
  if (await customized.isVisible().catch(() => false)) {
    const expanded = await customized.evaluate((el) => el.closest('details')?.open === true).catch(() => false)
    if (!expanded) await customized.click()
  }
  const protocolTrigger = card.getByRole('combobox', { name: 'API 协议' })
  if (await protocolTrigger.isVisible().catch(() => false)) {
    const current = await protocolTrigger.innerText()
    if (!/openai-completions/i.test(current) && !/^openai$/i.test(current)) {
      await chooseCustomSelect(card, 'API 协议', (label) => /openai-completions/i.test(label) || /^openai$/i.test(label))
    }
  }
  await card.getByLabel('API 密钥').fill(apiKey)
  if (!(await card.getByLabel('模型 id 1').isVisible().catch(() => false))) {
    await card.getByRole('button', { name: /添加模型/ }).click()
  }
  await card.getByLabel('模型 id 1').fill(modelId)
}

async function configureMiniMax(page) {
  await openShellSettings(page)
  const dialog = page.locator('.settings-dialog')
  await dialog.locator('.settings-nav').getByRole('tab', { name: '模型', exact: true }).click()
  const models = dialog.getByRole('region', { name: '模型', exact: true })
  await models.waitFor({ state: 'visible', timeout: 15_000 })
  await waitModelsReady(models)
  await shot(page, 'settings-models-empty', '配置前的模型页：作者第一次要面对的接口表单')
  const addCustom = models.getByRole('button', { name: '添加自定义提供方' })
  await addCustom.waitFor({ state: 'visible', timeout: 30_000 })
  const setupCancel = models.locator('.models-editor').first().getByRole('button', { name: '取消' })
  if (await setupCancel.isVisible().catch(() => false) && !(await models.locator('.models-add-card').count())) {
    await setupCancel.click()
    await waitModelsReady(models)
  }
  if (!(await models.locator('.models-row-card').filter({ hasText: /minimax-e2e|MiniMax/i }).count())) {
    await addCustom.click()
    const card = models.locator('.models-add-card')
    await card.waitFor({ state: 'visible', timeout: 15_000 })
    await fillCustomMiniMaxCard(card)
    await shot(page, 'settings-models-custom-form', '自定义提供方表单：Provider ID / API 协议 / 模型 id')
    const create = card.getByRole('button', { name: '创建提供方' })
    await waitFor(async () => create.isEnabled(), 'custom MiniMax create enabled', 30_000)
    await create.click({ force: true })
    await models.getByText('已保存。', { exact: true }).waitFor({ state: 'visible', timeout: 45_000 }).catch(() => undefined)
  }
  await waitModelsReady(models)
  await shot(page, 'settings-minimax-ready', 'MiniMax-M3 已写入模型页')
  await closeShellSettings(page)
}

async function expandDirectory(page, name) {
  const dir = page.locator('.tree-directory-row').filter({ hasText: name }).locator('.tree-row[aria-expanded]').first()
  if (!(await dir.count())) {
    const row = page.locator('.tree .tree-row', { has: page.getByText(name, { exact: true }) }).first()
    if (await row.count() && (await row.getAttribute('aria-expanded')) !== 'true') await row.click()
    return
  }
  if ((await dir.getAttribute('aria-expanded')) !== 'true') await dir.click()
}

async function answerPending(page) {
  const approval = page.getByRole('article', { name: '工具审批' }).last()
  if (await approval.isVisible().catch(() => false)) {
    await shot(page, 'chat-tool-approval', '写作助手请求工具审批')
    await approval.getByRole('button', { name: '允许一次' }).click()
    return true
  }
  const question = page.getByRole('form', { name: '回答问题' }).last()
  if (await question.isVisible().catch(() => false)) {
    await shot(page, 'chat-questions', '写作助手向作者提问')
    const options = question.locator('.question-option')
    if (await options.count()) await options.first().click()
    else await question.locator('.question-custom').fill('按已给出的设定继续。')
    await question.getByRole('button', { name: '提交全部回答' }).click()
    return true
  }
  return false
}

async function sendChat(page, prompt, label, timeout = sendTimeout) {
  const assistantBefore = await page.locator('.chat-row.assistant').count()
  const warningBaseline = await page.locator('.chat-history .warning').filter({ hasText: /未能完成|中断/ }).count()
  const composer = page.getByRole('textbox', { name: '输入消息' })
  await composer.fill(prompt)
  await shot(page, `chat-compose-${label}`, `发送前：${label}`)
  const send = page.getByRole('button', { name: '发送', exact: true })
  await waitFor(async () => send.isEnabled(), `${label}: send enabled`, 30_000)
  await send.click()
  await waitFor(async () => page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false), `${label}: turn started`, 30_000)
  await shot(page, `chat-sending-${label}`, `发送中：${label}`)
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
  throw new Error(`${label}: timed out without assistant reply`)
}

let activePage

await rm(home, { recursive: true, force: true })
await rm(projects, { recursive: true, force: true })
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await mkdir(resolve(home, 'electron-user-data'), { recursive: true })
await mkdir(resolve(seeded, '正文'), { recursive: true })
await mkdir(resolve(seeded, '大纲'), { recursive: true })
await mkdir(resolve(seeded, '人物卡'), { recursive: true })
await mkdir(resolve(seeded, '世界书'), { recursive: true })
await writeFile(resolve(seeded, '正文', '001 雾比灯先到.md'), `# 第一章 雾比灯先到

雾比灯先到，把码头的广播塔切成一段一段的影子。林简把船票收回口袋，沿着没有亮灯的栈桥往前走。

广播念到她的名字时，她停了下来。
`)
await writeFile(resolve(seeded, '大纲', '总纲.md'), `# 总纲\n\n发现录音 → 档案室对质 → 银桥现身。\n`)
await writeFile(resolve(seeded, '人物卡', '林简.md'), `---\nname: 林简\nrole: 主角\n---\n\n外门维修师。说话短。不信系统面板。\n`)
await writeFile(resolve(seeded, '世界书', '雾港.md'), `---\ncategory: 地点\n---\n\n入港盘查与夜禁。雾比灯先到。\n`)
await writeFile(resolve(seeded, 'AGENTS.md'), '# 不应出现在文件树\n')

const env = {
  ...process.env,
  DSH_TELEMETRY_DISABLED: '1',
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: cli,
  DSH_DESKTOP_PROFILE_TEMPLATE: template,
  DSH_HOME: home,
  DSH_EDITOR_PROJECTS_ROOT: projects,
  DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
  SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-human-audit',
}
delete env.DSH_EDITOR_CUSTOM_API_KEY

note('准备桌面运行时')
await run(resolve(root, 'scripts', 'prepare-desktop-dev.mjs'), [], env)
await deployProfile(home, template, resolve(runtime, 'node_modules'))

let browser
let dshChild
try {
  const started = await startDsh(env)
  dshChild = started.child
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  activePage = page
  page.setDefaultTimeout(15_000)
  page.on('pageerror', (error) => fail(`pageerror: ${error.message}`))

  await page.goto(started.url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell')), undefined, { timeout: 45_000 })
  await page.waitForTimeout(400)
  if (await page.getByRole('button', { name: '继续', exact: true }).isVisible().catch(() => false)
    || await page.getByText('内测').first().isVisible().catch(() => false)) {
    await shot(page, 'onboarding', '首次进入：宿主声明 / 引导')
  }
  await dismissNativeOnboarding(page)
  await dismissNativeOnboarding(page)
  await page.waitForTimeout(300)

  await shot(page, 'home-first-run', '首次首页：空白最近、新建/打开')
  await collectA11y(page, '首页')
  const homeText = await page.locator('.home-stage').innerText()
  if (!homeText.includes('继续未完') && !homeText.includes('第一行字')) {
    finding('high', '首页入口卡没有说明文案', 'openWorkDesc / newDesc 未上屏')
  }
  if (homeText.includes('{month}') || homeText.includes('{day}')) finding('high', '最近作品日期插值失败', homeText)

  await safe('设置各页', async () => {
    await openShellSettings(page)
    await shot(page, 'settings-general', '设置 · 通用')
    for (const [tab, name] of [
      ['助手', 'settings-assistant'],
      ['写作', 'settings-writing'],
      ['插件', 'settings-plugins'],
      ['用量', 'settings-usage'],
      ['知乎资料', 'settings-zhihu'],
      ['关于', 'settings-about'],
    ]) {
      await page.locator('.settings-nav').getByRole('tab', { name: tab, exact: true }).click()
      await page.waitForTimeout(250)
      await shot(page, name, `设置 · ${tab}`)
    }
    await closeShellSettings(page)
  })

  await safe('配置 MiniMax-M3', async () => {
    await configureMiniMax(page)
  })

  await safe('新建空作品', async () => {
    await page.getByRole('button', { name: '新建', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: '新建作品' })
    await dialog.waitFor({ state: 'visible' })
    await shot(page, 'dialog-new-empty', '新建作品：空表单')
    const create = dialog.getByRole('button', { name: '创建', exact: true })
    if (await create.isDisabled()) {
      finding('medium', '空名称时「创建」被禁用，但没有说明为什么不能创建')
      await shot(page, 'dialog-new-invalid', '新建作品：名称为空时创建不可用')
    } else {
      await create.click()
      await page.waitForTimeout(200)
      await shot(page, 'dialog-new-invalid', '新建作品：未填名称就创建')
    }
    await dialog.getByLabel('作品名称').fill('一部还没起好名字的练习')
    await waitFor(async () => create.isEnabled(), 'new-work create enabled', 5_000)
    await create.click()
    await page.locator('.tree').waitFor({ state: 'visible', timeout: 45_000 })
    await shot(page, 'workbench-empty-new', '刚新建的空作品')
    await collectA11y(page, '空作品工作台')
    const emptyPaper = await page.locator('.empty-paper, .home-stage').last().innerText().catch(() => '')
    if (emptyPaper && !emptyPaper.includes('从这里写下') && !emptyPaper.includes('或在左侧')) {
      finding('high', '空稿纸只有按钮、没有引导说明', emptyPaper.slice(0, 160) || '(无正文)')
    }
  })

  await safe('打开已有作品', async () => {
    if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '作品菜单' }).click()
    await page.getByRole('menuitem', { name: '返回作品列表' }).click()
    await page.locator('.home-stage').waitFor({ state: 'visible' })
    await shot(page, 'home-with-recent', '已有最近作品的首页')
    const recent = await page.locator('.home-recent').innerText()
    if (recent.includes('{month}') || recent.includes('{day}')) finding('high', '最近作品日期显示占位符', recent)
    await page.getByRole('button', { name: '打开作品' }).first().click()
    const pathBox = page.getByLabel('作品文件夹路径')
    await pathBox.waitFor({ state: 'visible' })
    await shot(page, 'dialog-open-path', '打开作品：路径回退框')
    await pathBox.fill(seeded)
    await page.getByRole('button', { name: '打开此目录' }).click()
    await page.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })
    for (const label of ['正文', '大纲', '人物卡', '世界书']) await expandDirectory(page, label)
    const chapter = page.locator('.tree-row.tree-main').filter({ hasText: '001 雾比灯先到' }).first()
    if (await chapter.count()) await chapter.click()
    await page.locator('[data-testid="paper-editor"] .cm-content').waitFor({ state: 'visible', timeout: 20_000 })
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="paper-editor"]')
      const view = el && /** @type {any} */ (el).__cmView
      if (view) view.dispatch({ selection: { anchor: view.state.doc.length } })
    })
    await shot(page, 'workbench-seeded', '已有作品三栏：目录、稿纸、搭档')
    await collectA11y(page, '已有作品工作台')
    if (await page.locator('.tree').getByText('AGENTS.md').count()) finding('high', '辅助文件 AGENTS.md 出现在作者文件树')
  })

  await safe('菜单与搜索', async () => {
    await page.getByTestId('paper-editor-menu-trigger').click()
    await page.waitForTimeout(200)
    await shot(page, 'editor-menu', '稿纸 ⋯ 正文操作菜单')
    await page.keyboard.press('Escape')
    await page.locator('[data-testid="paper-editor"] .cm-content').click({ button: 'right' })
    await page.waitForTimeout(200)
    await shot(page, 'editor-context-menu', '正文右键菜单')
    await page.keyboard.press('Escape')
    const row = page.locator('.tree-row.tree-main').filter({ hasText: '001 雾比灯先到' }).first()
    await row.click({ button: 'right' })
    await page.waitForTimeout(200)
    await shot(page, 'tree-context-menu', '文件树右键')
    await page.keyboard.press('Escape')
    const search = page.getByRole('searchbox', { name: /搜索/ }).first()
    await search.fill('雾比灯先到')
    await search.press('Enter')
    await page.waitForTimeout(400)
    await shot(page, 'sidebar-search', '侧栏全文搜索')
    await search.fill('')
    await page.keyboard.press('Control+K')
    await page.locator('.palette-overlay').waitFor({ state: 'visible', timeout: 8_000 })
    await shot(page, 'command-palette', '命令面板')
    await page.keyboard.press('Escape')
  })

  await safe('新对话与空搭档', async () => {
    const neu = page.getByRole('button', { name: '新对话', exact: true })
    if (await neu.isVisible().catch(() => false)) {
      await neu.click()
      await page.waitForTimeout(300)
      await shot(page, 'chat-preset-picker', '新对话：选择对话模式')
      const writing = page.getByRole('radio', { name: /通用写作/ })
      if (await writing.isVisible().catch(() => false)) {
        await writing.click()
        await page.getByRole('button', { name: '开始对话' }).click()
        await page.getByRole('dialog', { name: '选择对话模式' }).waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => undefined)
      } else {
        await page.keyboard.press('Escape')
      }
    }
    await shot(page, 'chat-empty', '写作搭档空对话')
    const chat = await page.locator('.chat').innerText().catch(() => '')
    if (chat.includes('Agent')) finding('medium', '搭档区对作者露出 Agent 术语', chat.match(/.{0,16}Agent.{0,40}/)?.[0] || 'Agent')
    if (chat.includes('设置接口')) finding('low', '空搭档用「设置接口」而不是「去配置模型」')
    const picker = page.getByRole('combobox', { name: '选择模型' })
    if (await picker.isVisible().catch(() => false)) {
      const current = await picker.innerText()
      if (!/MiniMax-M3/i.test(current)) {
        await chooseCustomSelect(page.getByRole('complementary', { name: '写作助手' }), '选择模型', (label) => /MiniMax-M3/i.test(label))
      }
    }
  })

  await safe('实机对话', async () => {
    const reply = await sendChat(page, '先别改任何文件。只读第一章，用两三句告诉我这个开头有没有让人想往下看的地方。不要列表，不要术语。', 'critique')
    report.live.chat = reply.slice(0, 400)
    await shot(page, 'chat-reply', 'MiniMax-M3 真实回复：审开头')
    const cards = page.getByRole('article', { name: '文件修改建议' })
    if (await cards.count()) {
      finding('medium', '作者说了先别改文件，仍出现提案卡')
      await shot(page, 'chat-unexpected-proposal', '未要求改文件却出现提案')
    }
  })

  await safe('实机提案', async () => {
    const before = await page.getByRole('article', { name: '文件修改建议' }).count()
    await sendChat(page, '请给「雾港」世界书补一句夜禁的具体时间，先出提案让我预览，不要直接写入。', 'proposal')
    await waitFor(async () => (await page.getByRole('article', { name: '文件修改建议' }).count()) > before, 'proposal card', 20_000).catch(() => undefined)
    await shot(page, 'chat-proposal', '世界书修改提案卡')
    const card = page.getByRole('article', { name: '文件修改建议' }).last()
    if (await card.isVisible().catch(() => false)) {
      const apply = card.getByRole('button', { name: '应用', exact: true })
      const ignore = card.getByRole('button', { name: '忽略', exact: true })
      if (!(await apply.count()) || !(await ignore.count())) finding('high', '提案卡缺少应用/忽略')
    } else {
      finding('medium', '请搭档提案后没有出现可见提案卡')
    }
  })

  await safe('实机补全', async () => {
    await page.locator('[data-testid="paper-editor"] .cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\n\n她把船票捏皱，听见雾里有人叫她的名字，她')
    await page.keyboard.press('Control+s')
    await page.getByTestId('paper-editor-menu-trigger').click()
    await page.getByTestId('editor-menu-complete').click()
    await waitFor(async () => {
      if (await page.locator('[data-testid="paper-ghost"]').count()) return true
      const notice = await page.locator('[data-testid="paper-notice"]').innerText().catch(() => '')
      return Boolean(notice) && !/^正在/.test(notice)
    }, 'fim result', sendTimeout)
    await shot(page, 'paper-fim', '光标处补全：幽灵字或失败提示')
    report.live.fim = await page.locator('[data-testid="paper-notice"]').innerText().catch(() => '')
    if (await page.locator('[data-testid="paper-ghost"]').count()) {
      const ghost = await page.locator('[data-testid="paper-ghost"]').innerText()
      report.live.ghost = ghost.slice(0, 200)
      if (/<\/?think>/.test(ghost)) finding('high', '补全幽灵字泄漏了 think 标签')
    }
    await page.keyboard.press('Escape')
  })

  await safe('实机改写', async () => {
    const text = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="paper-editor"]')
      const view = /** @type {any} */ (el)?.__cmView
      return view ? view.state.doc.toString() : ''
    })
    const needle = '雾比灯先到，把码头的广播塔切成一段一段的影子。'
    const start = text.indexOf(needle)
    if (start < 0) throw new Error('rewrite needle missing')
    await page.evaluate(({ from, to }) => {
      const el = document.querySelector('[data-testid="paper-editor"]')
      const view = /** @type {any} */ (el)?.__cmView
      if (view) {
        view.dispatch({ selection: { anchor: from, head: to } })
        view.focus()
      }
    }, { from: start, to: start + needle.length })
    await page.getByTestId('paper-editor-menu-trigger').click()
    await page.getByTestId('editor-menu-rewrite').click()
    const custom = page.getByRole('dialog', { name: '自定义改写' })
    await custom.waitFor({ state: 'visible', timeout: 10_000 })
    await shot(page, 'rewrite-dialog', '选段改写弹窗')
    await custom.getByLabel('输入改写要求').fill('缩短，保留雾和广播塔')
    await custom.getByRole('button', { name: '改写', exact: true }).click()
    const proposal = page.locator('[aria-label="选段修改建议"]')
    await waitFor(async () => {
      if (await proposal.isVisible().catch(() => false)) return true
      const notice = await page.locator('[data-testid="paper-notice"]').innerText().catch(() => '')
      return Boolean(notice) && !/^正在/.test(notice)
    }, 'rewrite result', sendTimeout)
    await shot(page, 'rewrite-result', '选段改写结果或失败提示')
    if (await proposal.isVisible().catch(() => false) && /<\/?think>/.test(await proposal.innerText())) {
      finding('high', '改写提案泄漏 think 标签')
    }
    await page.keyboard.press('Escape')
  })

  await safe('概览导出专注深色窄窗', async () => {
    await page.keyboard.press('Control+Shift+O')
    await page.waitForTimeout(600)
    await shot(page, 'overview', '作品概览')
    await page.getByRole('button', { name: '作品菜单' }).click()
    await page.getByRole('menuitem', { name: /导出/ }).click()
    await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15_000 })
    await shot(page, 'export-dialog', '导出稿件')
    await page.getByRole('button', { name: /取消|关闭/ }).first().click()
    await page.getByRole('button', { name: /专注/ }).click()
    await page.waitForTimeout(250)
    await shot(page, 'focus-mode', '专注写作')
    await page.getByRole('button', { name: /退出专注|专注/ }).click()
    const toggle = page.locator('.theme-toggle')
    if (await toggle.count()) await toggle.click()
    await page.waitForTimeout(300)
    await shot(page, 'workbench-dark', '深色工作台')
    await page.setViewportSize({ width: 980, height: 800 })
    await page.waitForTimeout(400)
    await shot(page, 'workbench-narrow', '窄窗搭档抽屉')
    await page.setViewportSize({ width: 720, height: 800 })
    await page.waitForTimeout(350)
    await shot(page, 'workbench-compact', '更窄窗口')
  })
} catch (error) {
  fail(error instanceof Error ? error.stack || error.message : String(error))
  if (activePage) await shot(activePage, 'failure', '未捕获失败').catch(() => undefined)
} finally {
  if (browser) await browser.close().catch(() => undefined)
  if (dshChild) await stop(dshChild)
}

report.finishedAt = new Date().toISOString()
report.ok = report.failures.length === 0
await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({
  ok: report.ok,
  shots: shotIndex,
  findings: report.findings,
  live: report.live,
  failures: report.failures,
}, null, 2))
if (!report.ok) process.exitCode = 1
