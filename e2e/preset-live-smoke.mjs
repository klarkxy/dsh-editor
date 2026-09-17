/**
 * Credentialed four-preset smoke. One fresh workspace; four picker
 * conversations (通用写作 / 小说创作 / 文章与自媒体 / 技术文档); one
 * writing_propose V2 create each. Proves Host preset identity and apply
 * writeback, not writing quality.
 *
 * MiniMax credentials come from env or ~/.mmx/config.json and are never
 * printed. Always stop DSH/browser in finally.
 */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const devRoot = resolve(root, '.dev')
const projectsRoot = resolve(devRoot, 'preset-live-smoke-projects')
const book = 'preset-live-smoke'
const workspace = resolve(projectsRoot, book)
const home = resolve(devRoot, 'preset-live-smoke-home')
const output = resolve(root, 'e2e', 'out', 'preset-live-smoke')
const sendTimeout = Number(process.env.E2E_PRESET_LIVE_SEND_TIMEOUT_MS || 360_000)

const NOVEL_DIRS = ['正文', '大纲', '人物卡', '世界书']
const ARTICLE_DIRS = ['选题', '资料', '主稿', '渠道稿']
const TECHNICAL_DIRS = ['需求', '决策', '文档', '验收']
const SEED_DIRS = [...NOVEL_DIRS, ...ARTICLE_DIRS, ...TECHNICAL_DIRS]
const PRESETS = [
  { id: 'dsh-editor-writing', radio: /通用写作/, path: '通用冒烟.md', parent: null, marker: 'PRESET_LIVE_WRITING' },
  { id: 'dsh-editor-novel', radio: /小说创作/, path: '正文/小说冒烟.md', parent: '正文', marker: 'PRESET_LIVE_NOVEL' },
  { id: 'dsh-editor-article', radio: /文章与自媒体/, path: '主稿/文章冒烟.md', parent: '主稿', marker: 'PRESET_LIVE_ARTICLE' },
  { id: 'dsh-editor-technical', radio: /技术文档/, path: '文档/技术冒烟.md', parent: '文档', marker: 'PRESET_LIVE_TECHNICAL' },
]
const strayParents = PRESETS.map((item) => item.parent).filter((parent) => parent && !SEED_DIRS.includes(parent))
if (strayParents.length) throw new Error(`PRESETS parents missing from SEED_DIRS: ${strayParents.join(', ')}`)

let capturedSessionId = ''
let lastBoundSessionId = ''
const hostBindings = []

for (const target of [projectsRoot, workspace, home]) {
  if (!target.startsWith(`${devRoot}${sep}`)) throw new Error(`unsafe test path: ${target}`)
}
if (!output.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) throw new Error(`unsafe output path: ${output}`)

const mmxPath = process.env.MMX_CONFIG_PATH || join(homedir(), '.mmx', 'config.json')
const mmx = JSON.parse(await readFile(mmxPath, 'utf8').catch(() => '{}'))
const apiKey = String(process.env.MINIMAX_API_KEY || mmx.api_key || '').trim()
if (!apiKey) throw new Error('MiniMax API key is unavailable')
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
  method: 'live MiniMax M3; integration only, not writing quality',
  phases: [],
  presets: [],
  screenshots: [],
  failures: [],
  ok: false,
}

function recordPhase(name, detail = '') {
  report.phases.push({ name, detail: sanitize(detail), at: new Date().toISOString() })
  console.log(`[preset-live] ${name}${detail ? `: ${sanitize(detail)}` : ''}`)
  return flushReport()
}

function fail(message) {
  report.failures.push(sanitize(message))
  console.error(`[preset-live] ${sanitize(message)}`)
}

function sanitize(value) {
  return String(value).replaceAll(apiKey, '[redacted]').replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
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
  return { child, url }
}

let shotIndex = 0
async function shot(page, name) {
  shotIndex += 1
  const file = resolve(output, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file })
  report.screenshots.push(file)
}

function walkUnknown(value, visit) {
  if (!value || typeof value !== 'object') return
  visit(value)
  if (Array.isArray(value)) {
    for (const item of value) walkUnknown(item, visit)
    return
  }
  for (const item of Object.values(value)) walkUnknown(item, visit)
}

function noteHostBinding(value, fallbackSessionId = '') {
  walkUnknown(value, (record) => {
    const selected = typeof record.selected === 'string' ? record.selected.trim() : ''
    const named = typeof record.agentPreset === 'string' ? record.agentPreset.trim() : ''
    const preset = PRESETS.some((item) => item.id === named) ? named
      : PRESETS.some((item) => item.id === selected) ? selected
      : ''
    if (!preset) return
    const sessionId = typeof record.sessionId === 'string' && record.sessionId.trim()
      ? record.sessionId.trim()
      : typeof record.agentId === 'string' && record.agentId.trim()
        ? record.agentId.trim()
        : fallbackSessionId
    hostBindings.push({ sessionId, agentPreset: preset })
  })
}

function captureManuscriptSession(request) {
  if (request.method() !== 'POST' || !/\/manuscript\//.test(request.url())) return
  try {
    const id = request.postDataJSON()?.payload?.sessionId
    if (typeof id === 'string' && id.trim()) capturedSessionId = id.trim()
  } catch { /* ignore non-JSON posts */ }
}

function capturePresetSelect(request) {
  try {
    const body = request.postDataJSON()
    if (!body || typeof body !== 'object') return
    const method = String(body.method || body.rpc || '')
    if (!/agentPreset|agent-preset|selectPreset/i.test(method) && !/agentPreset|agent-preset/.test(request.url())) return
    const agentId = body?.payload?.args?.agentId ?? body?.args?.agentId
    if (typeof agentId === 'string' && agentId.trim()) lastBoundSessionId = agentId.trim()
    noteHostBinding(body, capturedSessionId)
  } catch { /* ignore non-JSON posts */ }
}

async function capturePresetSelectResponse(response) {
  try {
    const url = response.url()
    const type = response.headers()['content-type'] || ''
    if (!type.includes('json') && !/rpc|agentPreset|agent-preset/i.test(url)) return
    noteHostBinding(await response.json(), capturedSessionId)
  } catch { /* ignore non-JSON */ }
}

async function manuscriptFileRead(page, path) {
  if (!capturedSessionId) throw new Error(`no manuscript session captured before reading ${path}`)
  const response = await page.request.post(new URL('/manuscript/file.read', page.url()).href, {
    data: {
      type: 'client-request',
      rpcId: `preset-live-${Date.now().toString(36)}`,
      method: 'file.read',
      payload: { sessionId: capturedSessionId, path },
    },
  })
  if (!response.ok()) throw new Error(`file.read ${path}: HTTP ${response.status()}`)
  const result = (await response.json()).result
  if (!result?.ok) throw new Error(`file.read ${path}: ${JSON.stringify(result)}`)
  const text = typeof result.value?.text === 'string' ? result.value.text : ''
  const version = result.value?.version
  if (typeof version !== 'string' || !version.trim()) throw new Error(`file.read ${path}: missing version`)
  return { path, text, version: version.trim() }
}

async function answerPending(page) {
  const approval = page.getByRole('article', { name: '工具审批' }).last()
  if (await approval.isVisible().catch(() => false)) {
    await approval.getByRole('button', { name: '允许一次' }).click()
    return true
  }
  const question = page.getByRole('form', { name: '回答问题' }).last()
  if (await question.isVisible().catch(() => false)) {
    const options = question.locator('.question-option')
    if (await options.count()) await options.first().click()
    else await question.locator('.question-custom').fill('按当前要求继续，不要改路径。')
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

async function dismissNativeOnboarding(page) {
  const continueNotice = page.getByRole('button', { name: '继续', exact: true })
  for (let step = 0; step < 5; step += 1) {
    if (!(await continueNotice.isVisible({ timeout: 1_000 }).catch(() => false))) break
    await continueNotice.click()
    await delay(250)
  }
  const configureLater = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await configureLater.isVisible({ timeout: 2_000 }).catch(() => false)) await configureLater.click()
}

async function ensureWorkbench(page) {
  await dismissNativeOnboarding(page)
  if (await page.locator('.shell.focus-mode').isVisible().catch(() => false)) {
    await page.keyboard.press('Control+\\')
    await page.locator('.shell.focus-mode').waitFor({ state: 'detached', timeout: 10_000 })
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

async function ensureCatalogHasModel(page, card) {
  if (await card.getByLabel('模型 id 1').isVisible().catch(() => false)) {
    await card.getByLabel('模型 id 1').fill('MiniMax-M3')
    return
  }
  await card.getByRole('button', { name: /添加模型/ }).click()
  await card.getByLabel('模型 id 1').fill('MiniMax-M3')
}

async function addCustomMiniMax(page, models) {
  await models.getByRole('button', { name: '添加自定义提供方' }).click()
  const card = models.locator('.models-add-card')
  await card.waitFor({ state: 'visible', timeout: 15_000 })
  await card.getByLabel('Provider ID').fill('minimax-e2e')
  await card.getByLabel('显示名称').fill('MiniMax')
  await card.getByLabel('API 地址').fill(apiBase)
  const protocolTrigger = card.getByRole('combobox', { name: 'API 协议' })
  await protocolTrigger.waitFor({ state: 'visible', timeout: 10_000 })
  const current = await protocolTrigger.innerText()
  if (!/openai-completions/i.test(current)) {
    await chooseCustomSelect(card, 'API 协议', (label) => /openai-completions/i.test(label) || /^openai$/i.test(label))
  }
  await card.getByLabel('API 密钥').fill(apiKey)
  await ensureCatalogHasModel(page, card)
  const create = card.getByRole('button', { name: '创建提供方' })
  await waitFor(async () => create.isEnabled(), 'custom MiniMax create enabled', 20_000)
  await create.click({ force: true })
}

async function configureMiniMax(page) {
  const yaml = await readFile(resolve(home, 'settings.yaml'), 'utf8').catch(() => '')
  if (/minimax-e2e|MiniMax-M3/i.test(yaml)) {
    await recordPhase('接口已配置，跳过')
    return
  }
  await openShellSettings(page)
  const dialog = page.getByRole('dialog', { name: '设置' })
  await dialog.locator('.settings-nav').getByRole('tab', { name: '模型', exact: true }).click()
  const models = dialog.getByRole('region', { name: '模型', exact: true })
  await models.waitFor({ state: 'visible', timeout: 15_000 })
  await waitFor(async () => !(await models.getByText('正在读取…').isVisible().catch(() => false)), 'models page loaded', 45_000)
  const addCustom = models.getByRole('button', { name: '添加自定义提供方' })
  await addCustom.waitFor({ state: 'visible', timeout: 30_000 })
  const setupCancel = models.locator('.models-editor').first().getByRole('button', { name: '取消' })
  if (await setupCancel.isVisible().catch(() => false) && !(await models.locator('.models-add-card').count())) {
    await setupCancel.click()
  }
  await addCustomMiniMax(page, models)
  await models.getByText('已保存。', { exact: true }).waitFor({ state: 'visible', timeout: 45_000 })
  await shot(page, 'settings-minimax')
  await closeShellSettings(page)
  await recordPhase('接口连接成功', 'MiniMax custom provider minimax-e2e')
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
  const seeded = await listSeededDirs(page)
  if (seeded.length) throw new Error(`new project should not pre-seed ${seeded.join(', ')}`)
  await recordPhase('新建作品', workspace)
}

async function listSeededDirs(page) {
  const found = []
  for (const name of SEED_DIRS) {
    if (await exists(resolve(workspace, name))) found.push(`${name}:disk`)
    if (page && await page.locator('.tree').getByText(name, { exact: true }).count()) found.push(`${name}:tree`)
  }
  return found
}

async function assertNoSeededDirs(page, allowed, label) {
  const extra = (await listSeededDirs(page)).filter((item) => !allowed.some((name) => item.startsWith(`${name}:`)))
  if (extra.length) throw new Error(`${label} seeded ${extra.join(', ')}`)
}

async function assertNoLegacySidecars(label) {
  const index = resolve(workspace, '.dsh-editor', '作品索引.md')
  const scratch = resolve(workspace, '.dsh-editor', 'scratch')
  if (await exists(index)) throw new Error(`${label}: legacy index ${index}`)
  if (await exists(scratch)) throw new Error(`${label}: legacy scratch ${scratch}`)
}

async function confirmConversationPreset(page, radioName, presetId) {
  const picker = page.getByRole('dialog', { name: '选择对话模式' })
  await picker.waitFor({ state: 'visible', timeout: 15_000 })
  const labels = await picker.getByRole('radio').allTextContents()
  if (labels.some((label) => /旧采访|写作助手|dsh-editor(?!-)/i.test(label))) {
    throw new Error(`hidden legacy preset is visible: ${JSON.stringify(labels)}`)
  }
  const choice = picker.getByRole('radio', { name: radioName })
  await choice.waitFor({ state: 'visible', timeout: 15_000 })
  if (await choice.isDisabled()) throw new Error(`${presetId} preset is unavailable`)
  await choice.click()
  const confirm = picker.getByRole('button', { name: '开始对话' })
  await waitFor(async () => confirm.isEnabled(), `${presetId} confirm enabled`, 10_000)
  await confirm.click()
  await picker.waitFor({ state: 'hidden', timeout: 20_000 })
}

async function startPresetConversation(page, radioName, presetId) {
  const assistant = await ensureAssistantOpen(page)
  const neu = assistant.getByRole('button', { name: '新对话' })
  await waitFor(async () => neu.isEnabled().catch(() => false), `${presetId}: new conversation enabled`, 20_000)
  await neu.click()
  const discard = page.getByRole('button', { name: '放弃并继续', exact: true })
  if (await discard.isVisible({ timeout: 2_000 }).catch(() => false)) await discard.click()
  await confirmConversationPreset(page, radioName, presetId)
  await assistant.waitFor({ state: 'visible', timeout: 15_000 })
  await page.getByRole('textbox', { name: '输入消息' }).waitFor({ state: 'visible', timeout: 15_000 })
  const mode = assistant.locator('.composer-mode')
  await waitFor(async () => (await mode.getAttribute('data-chat-mode')) === presetId, `${presetId}: current mode visible`, 15_000)
  return assistant
}

async function readActiveSessionId(page) {
  const root = page.locator('aside.chat .conversation-select').first()
  await root.waitFor({ state: 'visible', timeout: 10_000 })
  /* 会话切换 trigger 不暴露 session id（无 data-value、无代理 select）；
     最新的 agentPresets/select 绑定请求是最诚实的当前会话来源。 */
  const fromUi = await root.evaluate((node) => {
    const proxy = node.querySelector('select')
    if (proxy instanceof HTMLSelectElement && proxy.value) return proxy.value.replace(/^v:/, '').trim()
    const trigger = node.querySelector('[role="combobox"]')
    return String(trigger?.getAttribute('data-value') || trigger?.getAttribute('value') || '').replace(/^v:/, '').trim()
  }).catch(() => '')
  return fromUi || lastBoundSessionId || capturedSessionId
}

async function switchConversation(page, sessionId) {
  /* 不做提前返回：线层 fallback（lastBoundSessionId）在手动切换后已过期的。
     打开列表点选目标项，再重新打开列表确认 aria-selected 落在目标上——
     trigger 不暴露 session id，aria-selected 是唯一的真实 UI 证据。 */
  const assistant = await ensureAssistantOpen(page)
  const trigger = assistant.getByRole('combobox', { name: '切换对话' })
  const option = page.locator(`[role="option"][data-value="v:${sessionId}"]`)
  await trigger.click()
  await option.waitFor({ state: 'visible', timeout: 10_000 })
  await option.click()
  await waitFor(async () => {
    await trigger.click()
    const selected = await option.getAttribute('aria-selected').catch(() => null)
    await page.keyboard.press('Escape')
    return selected === 'true'
  }, `switch to ${sessionId}`, 15_000)
}

async function selectMiniMaxM3(page) {
  const assistant = await ensureAssistantOpen(page)
  const current = await assistant.locator('.model-picker, .composer-model').innerText().catch(() => '')
  if (/MiniMax-M3/i.test(current)) return current.replace(/\s+/g, ' ').trim()
  const chosen = await chooseCustomSelect(assistant, '选择模型', (label, labels) => {
    const pick = labels.find((item) => /MiniMax-M3/i.test(item))
      || labels.find((item) => /MiniMax/i.test(item))
    return label === pick
  })
  if (!/MiniMax-M3/i.test(chosen)) throw new Error(`MiniMax M3 was not selectable: ${chosen}`)
  return chosen.replace(/\s+/g, ' ').trim()
}

async function hostPresetFor(sessionId, expected) {
  const fromWire = [...hostBindings].reverse().find((item) => (
    item.agentPreset === expected && (!item.sessionId || item.sessionId === sessionId)
  ))
  if (fromWire) return fromWire.agentPreset
  const fromHome = await scanHomePreset(sessionId)
  if (fromHome === expected) return fromHome
  throw new Error(`${expected}: Host session preset was ${fromHome || 'missing'} (session ${sessionId})`)
}

async function waitHostPreset(sessionId, expected) {
  await waitFor(async () => {
    try {
      await hostPresetFor(sessionId, expected)
      return true
    } catch {
      return false
    }
  }, `${expected} host preset ${sessionId}`, 15_000)
  return hostPresetFor(sessionId, expected)
}

async function scanHomePreset(sessionId) {
  const hits = []
  const skip = new Set(['node_modules', 'electron-user-data', '.git'])
  async function walk(dir, depth) {
    if (depth > 6) return
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (skip.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile() || !/\.(json|yml|yaml)$/i.test(entry.name)) continue
      const text = await readFile(full, 'utf8').catch(() => '')
      if (!text.includes(sessionId) || !/agentPreset|dsh-editor-(?:writing|novel|article|technical)/.test(text)) continue
      try {
        noteHostBinding(JSON.parse(text), sessionId)
      } catch {
        for (const id of PRESETS.map((item) => item.id)) {
          if (text.includes(id)) hits.push(id)
        }
      }
    }
  }
  await walk(home, 0)
  const bound = [...hostBindings].reverse().find((item) => item.sessionId === sessionId)
  return bound?.agentPreset || hits[0] || ''
}

function createPrompt(spec) {
  return [
    `只调用一次 writing_propose（V2）。kind 必须是 create。只传 path、text、summary。`,
    `不要传 targetVersion（目标文件还不存在，没有 generation version）。`,
    `不要传 oldText、newText、basis、sourceVersion。不要 edit / split / merge / renames。`,
    `不要调用 novel_propose、index、scratch、context.compile。不要提问。不要只在聊天回答。`,
    `在 ${spec.path} 创建一份很短的 Markdown，正文只写一句「${spec.marker}」。`,
  ].join('')
}

async function waitForProposal(page, previousCount, previousAssistantCount, label, expectedPath, warningBaseline = 0) {
  const cards = page.locator('.proposal-card[aria-label="文件修改建议"]')
  const warnings = page.locator('.chat-history .warning').filter({ hasText: /未能完成|中断/ })
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
      if (/文件已经变化|需要重新生成/.test(text)) throw new Error(`${label}: stale-proposal`)
      const ready = await card.getByText('可以安全应用', { exact: true }).isVisible().catch(() => false)
      const applied = await card.getByText('已应用到作品', { exact: true }).isVisible().catch(() => false)
      if (ready || applied) return card
    }
    if (await warnings.count() > warningBaseline) {
      throw new Error(`${label}: ${await warnings.last().innerText()}`)
    }
    const assistantCount = await page.locator('.chat-row.assistant').count()
    const stopVisible = await page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)
    if (assistantCount > previousAssistantCount && !stopVisible) {
      if (!completedWithoutProposalAt) completedWithoutProposalAt = Date.now()
      if (Date.now() - completedWithoutProposalAt > 12_000) {
        const tail = (await page.locator('.chat-history').innerText().catch(() => '')).slice(-2_000)
        throw new Error(`${label}: turn completed without a usable proposal; chat tail=${sanitize(tail)}`)
      }
    } else completedWithoutProposalAt = 0
    await delay(500)
  }
  const tail = (await page.locator('.chat-history').innerText().catch(() => '')).slice(-2_000)
  throw new Error(`${label}: no proposal within timeout; chat tail=${sanitize(tail)}`)
}

async function sendForProposal(page, prompt, expectedPath, label) {
  const cards = page.locator('.proposal-card[aria-label="文件修改建议"]')
  const before = await cards.count()
  const assistantBefore = await page.locator('.chat-row.assistant').count()
  const warningBaseline = await page.locator('.chat-history .warning').filter({ hasText: /未能完成|中断/ }).count()
  const composer = page.getByRole('textbox', { name: '输入消息' })
  await composer.fill(prompt)
  const send = page.getByRole('button', { name: '发送', exact: true })
  await waitFor(async () => send.isEnabled().catch(() => false), `${label}: send enabled`, 30_000)
  await send.click()
  await waitFor(async () => {
    if (await cards.count() > before) return true
    return page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)
  }, `${label}: turn started`, 30_000)
  const card = await waitForProposal(page, before, assistantBefore, label, expectedPath, warningBaseline)
  const cardText = await card.innerText()
  if (!cardText.includes(expectedPath)) throw new Error(`${label}: proposed unexpected path: ${cardText.slice(0, 300)}`)
  await shot(page, `${label}-proposal`)
  return card
}

/* 采用已就绪的提案卡（重开后卡片会重新核对，等它回到可应用态再点）。 */
async function applyProposalCard(card, label) {
  await card.getByText('可以安全应用', { exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined)
  if (!(await card.getByText('已应用到作品', { exact: true }).first().isVisible().catch(() => false))) {
    await card.getByRole('button', { name: '应用', exact: true }).click()
    /* 结算后卡片折成 details，摘要与页脚各有一份完成文案，取第一份。 */
    await card.getByText('已应用到作品', { exact: true }).first().waitFor({ state: 'visible', timeout: 90_000 })
  }
  await recordPhase(label)
}

async function verifyWriteback(page, spec) {
  const absolute = resolve(workspace, ...spec.path.split('/'))
  await waitFor(() => exists(absolute), `disk ${spec.path}`, 15_000)
  const disk = await readFile(absolute, 'utf8')
  if (!disk.trim()) throw new Error(`${spec.path}: disk file empty`)
  const rpc = await manuscriptFileRead(page, spec.path)
  if (!rpc.text.trim()) throw new Error(`${spec.path}: RPC file empty`)
  return { diskChars: disk.trim().length, rpcVersion: rpc.version }
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
  SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-preset-live-smoke',
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
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  page.setDefaultTimeout(30_000)
  page.on('request', captureManuscriptSession)
  page.on('request', capturePresetSelect)
  page.on('response', (response) => { void capturePresetSelectResponse(response) })
  page.on('pageerror', (error) => fail(`pageerror: ${sanitize(error.message)}`))
  await page.goto(started.url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.title === 'DSH Editor', undefined, { timeout: 45_000 })
  await dismissNativeOnboarding(page)
  await page.waitForFunction(() => {
    const text = document.body.innerText || ''
    return text.includes('打开作品')
      || text.includes('空白稿纸')
      || Boolean(document.querySelector('[aria-label="稿件目录"]'))
  }, undefined, { timeout: 45_000 })
  await shot(page, 'home')

  await configureMiniMax(page)
  await createProjectFromHome(page)
  await shot(page, 'project-open')

  const sessions = []
  for (const spec of PRESETS) {
    await startPresetConversation(page, spec.radio, spec.id)
    const model = await selectMiniMaxM3(page)
    /* 新会话的绑定以 agentPresets/select 线为准；combobox 不暴露 session id。 */
    await waitFor(async () => {
      const id = await readActiveSessionId(page)
      return Boolean(id) && !sessions.some((item) => item.sessionId === id)
    }, `${spec.id}: fresh session id visible`, 15_000)
    const sessionId = await readActiveSessionId(page)
    if (!sessionId) throw new Error(`${spec.id}: missing session id after picker confirm`)
    const agentPreset = await waitHostPreset(sessionId, spec.id)
    /* 提案只停在预览态：落盘在第二轮统一采用，先证明四套选择都不建目录。
       发过消息的会话不再是空白会话，第二轮才能从切换器里选回它。 */
    await sendForProposal(page, createPrompt(spec), spec.path, spec.id)
    sessions.push({ ...spec, sessionId, model, agentPreset })
    await recordPhase('会话已绑定', `${spec.id} · ${sessionId} · ${model}`)
  }

  await assertNoSeededDirs(page, [], 'after selecting four presets')
  await assertNoLegacySidecars('after selecting four presets')
  await shot(page, 'presets-selected')
  await recordPhase('选中四套 Preset 未建专业目录')

  const allowedParents = []
  for (const spec of sessions) {
    await switchConversation(page, spec.sessionId)
    capturedSessionId = spec.sessionId
    const agentPreset = await waitHostPreset(spec.sessionId, spec.id)
    const card = page.locator('.proposal-card[aria-label="文件修改建议"]').last()
    await card.waitFor({ state: 'visible', timeout: 15_000 })
    if (!(await card.innerText()).includes(spec.path)) throw new Error(`${spec.id}: restored proposal card missing ${spec.path}`)
    await applyProposalCard(card, spec.id)
    const writeback = await verifyWriteback(page, spec)
    if (spec.parent) allowedParents.push(spec.parent)
    await assertNoSeededDirs(page, allowedParents, `after apply ${spec.id}`)
    await assertNoLegacySidecars(`after apply ${spec.id}`)
    const row = {
      id: spec.id,
      model: spec.model,
      path: spec.path,
      sessionId: spec.sessionId,
      agentPreset,
      ...writeback,
      ok: true,
    }
    report.presets.push(row)
    await shot(page, `${spec.id}-applied`)
    await recordPhase('采用并回读', `${spec.id} · ${spec.path} · ${agentPreset}`)
  }
  await recordPhase('四套 Preset 冒烟通过')
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
  phases: report.phases.length,
  presets: report.presets,
  failures: report.failures,
}, null, 2))
if (!report.ok) process.exitCode = 1
