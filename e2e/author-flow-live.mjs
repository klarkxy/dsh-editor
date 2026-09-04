/**
 * Credentialed author-flow E2E. Starts from zero by default; set
 * E2E_AUTHOR_FLOW_RESUME=1 only when diagnosing an interrupted run.
 *
 * Product files are created through the visible DSH Editor UI: homepage
 * project creation, the file tree, Chat proposals, and the proposal card's
 * Apply button. The harness only reads project files afterwards for
 * acceptance checks.
 *
 * Credentials default to ~/.mmx/config.json. They are never printed.
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
const projectsRoot = resolve(devRoot, 'author-flow-live-projects')
const book = '雾港回声'
const workspace = resolve(projectsRoot, book)
const home = resolve(devRoot, 'author-flow-live-home')
const output = resolve(root, 'e2e', 'out', 'author-flow-live')
const reset = process.env.E2E_AUTHOR_FLOW_RESUME !== '1'
const sendTimeout = Number(process.env.E2E_AUTHOR_FLOW_SEND_TIMEOUT_MS || 720_000)
const minChapterChars = 4_000
const chapterCount = 10

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

const dsh = resolveDshInstallation('0.1.1-rc.2')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')
const report = {
  startedAt: new Date().toISOString(),
  book,
  workspace,
  reset,
  dsh: dsh.version ?? '0.1.1-rc.2',
  phases: [],
  chapters: [],
  features: [],
  failures: [],
  screenshots: [],
}

function recordPhase(name, detail = '') {
  report.phases.push({ name, detail, at: new Date().toISOString() })
  console.log(`[author-flow] ${name}${detail ? `: ${detail}` : ''}`)
  return flushReport()
}

function recordFeature(name, ok, detail = '') {
  report.features.push({ name, ok, detail })
  console.log(`[author-flow] feature ${name}: ${ok ? 'ok' : 'miss'}${detail ? ` (${detail})` : ''}`)
}

function fail(message) {
  report.failures.push(message)
  console.error(`[author-flow] ${message}`)
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
      const match = /https?:\/\/127\.0\.0\.1:\d+\/?/.exec(buffer)
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

function compactChars(text) {
  return text.replace(/\s/g, '').length
}

async function listMarkdown(dir, prefix = '') {
  const result = []
  if (!(await exists(dir))) return result
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...await listMarkdown(absolute, relative))
    else if (entry.isFile() && /\.md$/i.test(entry.name)) result.push(relative)
  }
  return result.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
}

let shotIndex = 0
async function shot(page, name) {
  shotIndex += 1
  const file = resolve(output, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file })
  report.screenshots.push(file)
}

async function answerPending(page) {
  const approval = page.getByRole('article', { name: '工具审批' }).last()
  if (await approval.isVisible().catch(() => false)) {
    await approval.getByRole('button', { name: '允许一次' }).click()
    return true
  }
  const question = page.getByRole('form', { name: '回答问题' }).last()
  if (await question.isVisible().catch(() => false)) {
    for (const input of await question.locator('input').all()) {
      await input.fill('按已给出的设定和推荐方案继续，不增加新分支。')
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

async function ensureWorkbench(page) {
  await dismissNativeOnboarding(page)
  if (await page.locator('.shell.focus-mode').isVisible().catch(() => false)) {
    await page.keyboard.press('Control+\\')
    await page.locator('.shell.focus-mode').waitFor({ state: 'detached', timeout: 10_000 })
  }
  if (await page.locator('.home-stage').isVisible().catch(() => false)) {
    const recent = page.locator('.home-recent').getByRole('button', { name: /雾港回声/ }).first()
    await recent.click()
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

async function waitForProposal(page, previousCount, previousAssistantCount, label, expectedPath, warningBaseline = 0) {
  const cards = page.getByRole('article', { name: '文件修改建议' })
  const warnings = page.locator('.chat-history .warning').filter({ hasText: /未能完成|中断/ })
  const deadline = Date.now() + sendTimeout
  let completedWithoutProposalAt = 0
  let refreshedAfterCompletion = false
  let refreshedAt = 0
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
      if (Date.now() - completedWithoutProposalAt > 5_000) {
        if (!refreshedAfterCompletion) {
          refreshedAfterCompletion = true
          refreshedAt = Date.now()
          completedWithoutProposalAt = 0
          await page.reload({ waitUntil: 'domcontentloaded' })
          await page.waitForFunction(() => document.title === 'DSH Editor', undefined, { timeout: 45_000 })
          await ensureAssistantOpen(page)
          continue
        }
        const tail = (await page.locator('.chat-history').innerText().catch(() => '')).slice(-2_000)
        throw new Error(`${label}: turn completed without a usable proposal; chat tail=${sanitize(tail)}`)
      }
    } else completedWithoutProposalAt = 0
    if (refreshedAt && Date.now() - refreshedAt > 30_000) {
      const tail = (await page.locator('.chat-history').innerText().catch(() => '')).slice(-2_000)
      throw new Error(`${label}: persisted conversation did not expose its proposal; chat tail=${sanitize(tail)}`)
    }
    await delay(500)
  }
  const tail = (await page.locator('.chat-history').innerText().catch(() => '')).slice(-2_000)
  throw new Error(`${label}: no proposal within timeout; chat tail=${sanitize(tail)}`)
}

async function sendAndApply(page, prompt, expectedPath, label, attempt = 0) {
  const cards = page.getByRole('article', { name: '文件修改建议' })
  const before = await cards.count()
  const assistantBefore = await page.locator('.chat-row.assistant').count()
  const warningBaseline = await page.locator('.chat-history .warning').filter({ hasText: /未能完成|中断/ }).count()
  const composer = page.getByRole('textbox', { name: '输入消息' })
  await composer.fill(prompt)
  const send = page.getByRole('button', { name: '发送', exact: true })
  await waitFor(async () => await send.isEnabled().catch(() => false), `${label}: send enabled`, 30_000)
  await send.click()
  await waitFor(async () => {
    if (await cards.count() > before) return true
    return await page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)
  }, `${label}: turn started`, 30_000)
  try {
    const card = await waitForProposal(page, before, assistantBefore, label, expectedPath, warningBaseline)
    const cardText = await card.innerText()
    if (!cardText.includes(expectedPath)) throw new Error(`${label}: proposed unexpected path: ${cardText.slice(0, 300)}`)
    await shot(page, `${label}-proposal`)
    if (!(await card.getByText('已应用到作品', { exact: true }).isVisible().catch(() => false))) {
      await card.getByRole('button', { name: '应用', exact: true }).click()
      await card.getByText('已应用到作品', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
    }
    await recordPhase(label, expectedPath)
  } catch (error) {
    const message = String(error)
    if (attempt < 1 && (message.includes('stale-proposal') || message.includes('未能完成这次请求'))) {
      await recordPhase(`${label} 失败，重试`, message.slice(0, 120))
      await delay(1_200)
      return sendAndApply(page, prompt, expectedPath, label, attempt + 1)
    }
    throw error
  }
}

async function sendMaybeApply(page, prompt, expectedPath, label) {
  const cards = page.getByRole('article', { name: '文件修改建议' })
  const before = await cards.count()
  const assistantBefore = await page.locator('.chat-row.assistant').count()
  const composer = page.getByRole('textbox', { name: '输入消息' })
  await composer.fill(prompt)
  const send = page.getByRole('button', { name: '发送', exact: true })
  await waitFor(async () => await send.isEnabled().catch(() => false), `${label}: send enabled`, 30_000)
  await send.click()
  await waitFor(async () => {
    if (await cards.count() > before) return true
    return await page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)
  }, `${label}: turn started`, 30_000)
  const deadline = Date.now() + sendTimeout
  let completedAt = 0
  while (Date.now() < deadline) {
    await answerPending(page)
    if (await cards.count() > before) {
      const card = cards.last()
      const ready = await card.getByText('可以安全应用', { exact: true }).isVisible().catch(() => false)
      const applied = await card.getByText('已应用到作品', { exact: true }).isVisible().catch(() => false)
      if (!ready && !applied) {
        await delay(400)
        continue
      }
      const cardText = await card.innerText()
      if (!cardText.includes(expectedPath)) {
        await delay(400)
        continue
      }
      await shot(page, `${label}-proposal`)
      if (!applied) {
        await card.getByRole('button', { name: '应用', exact: true }).click()
        await card.getByText('已应用到作品', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
      }
      await recordPhase(label, `applied ${expectedPath}`)
      return 'applied'
    }
    const assistantCount = await page.locator('.chat-row.assistant').count()
    const stopVisible = await page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)
    if (assistantCount > assistantBefore && !stopVisible) {
      if (!completedAt) completedAt = Date.now()
      if (Date.now() - completedAt > 6_000) {
        await shot(page, `${label}-chat`)
        await recordPhase(label, 'chat-only, no file proposal')
        return 'chat-only'
      }
    } else completedAt = 0
    await delay(500)
  }
  throw new Error(`${label}: timed out without proposal or finished turn`)
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

async function chooseCustomSelect(page, ariaLabel, matcher) {
  const trigger = page.getByRole('button', { name: ariaLabel }).first()
  await trigger.click()
  const list = page.getByRole('listbox', { name: ariaLabel })
  await list.waitFor({ state: 'visible', timeout: 10_000 })
  const options = list.getByRole('option')
  const labels = await options.allTextContents()
  const index = labels.findIndex((label) => matcher(label))
  if (index < 0) {
    await page.keyboard.press('Escape')
    throw new Error(`${ariaLabel} option not found in ${JSON.stringify(labels)}`)
  }
  await options.nth(index).click()
  return labels[index]
}

async function configureMiniMax(page) {
  const yaml = await readFile(resolve(home, 'settings.yaml'), 'utf8').catch(() => '')
  if (/minimax-e2e|MiniMax-M2\.7-highspeed/.test(yaml)) {
    await recordPhase('接口已配置，跳过')
    return
  }
  await openShellSettings(page)
  const dialog = page.getByRole('dialog', { name: '设置' })
  await dialog.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '通用设置' }).click()
  await dialog.getByRole('region', { name: '通用设置' }).waitFor({ state: 'visible', timeout: 15_000 })
  await dialog.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '写作' }).click()
  const authorBox = dialog.getByRole('textbox', { name: '跨作品作者约定' })
  await authorBox.waitFor({ state: 'visible', timeout: 15_000 })
  await authorBox.fill('第三人称限知；少用感叹号；对白保持克制，不解释系统。')
  const savePrefs = dialog.getByRole('button', { name: '保存作者约定' })
  if (await savePrefs.isEnabled().catch(() => false)) await savePrefs.click()
  const prefsFailed = await dialog.getByRole('alert').filter({ hasText: /未能保存/ }).isVisible().catch(() => false)
  recordFeature('author-preferences', !prefsFailed, prefsFailed ? 'settings scope did not commit user-layer write' : 'saved')
  await dialog.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '知乎' }).click()
  await dialog.getByText('Access Secret', { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 })
  await dialog.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '用量' }).click()
  await dialog.getByRole('region', { name: '用量' }).waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)
  await dialog.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '模型' }).click()
  const models = dialog.getByRole('region', { name: '模型' })
  await models.waitFor({ state: 'visible', timeout: 15_000 })
  await waitFor(async () => {
    const loading = await models.getByText('正在读取…').isVisible().catch(() => false)
    return !loading
  }, 'models page loaded', 45_000)

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
  recordFeature('settings-minimax', true, 'custom MiniMax')
  await recordPhase('接口连接成功', 'MiniMax custom provider minimax-e2e')
}

async function adoptDiscoveredModels(page, scope, label) {
  const fetchButton = scope.getByRole('button', { name: '获取可用模型' })
  if (!(await fetchButton.isEnabled().catch(() => false))) return false
  await fetchButton.click()
  const picker = page.getByRole('dialog', { name: '选择要添加的模型' })
  const appeared = await picker.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true, () => false)
  if (!appeared) return false
  const ids = await picker.locator('.models-candidate-id').allTextContents()
  const wanted = ids.filter((id) => /MiniMax-M2\.7/i.test(id))
  if (!wanted.length && ids.length) await picker.getByRole('button', { name: '全选' }).click()
  await picker.getByRole('button', { name: '添加所选' }).click()
  await picker.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined)
  await recordPhase(label, (wanted.length ? wanted : ids.slice(0, 8)).join(', '))
  return true
}

async function ensureCatalogHasModel(page, card) {
  if (await adoptDiscoveredModels(page, card, 'MiniMax 模型发现')) return
  if (await card.getByLabel('模型 id 1').isVisible().catch(() => false)) return
  await card.getByRole('button', { name: /添加模型/ }).click()
  await card.getByLabel('模型 id 1').fill('MiniMax-M2.7-highspeed')
  await recordPhase('MiniMax 手工添加模型', 'MiniMax-M2.7-highspeed')
}

async function addBuiltinMiniMax(page, models) {
  const add = models.getByRole('button', { name: '添加提供方' })
  if (!(await add.isEnabled().catch(() => false))) return false
  await add.click()
  const card = models.locator('.models-add-card')
  await card.waitFor({ state: 'visible', timeout: 10_000 })
  try {
    await chooseCustomSelect(card, '提供方', (label) => /minimax/i.test(label))
  } catch {
    await card.getByRole('button', { name: '取消' }).click().catch(() => undefined)
    return false
  }
  await card.getByLabel('API 密钥').fill(apiKey)
  const customized = card.locator('summary').filter({ hasText: '自定义设置' })
  if (await customized.isVisible().catch(() => false)) {
    const expanded = await customized.evaluate((el) => el.closest('details')?.open === true).catch(() => false)
    if (!expanded) await customized.click()
  }
  const base = card.getByLabel('API 地址')
  if (await base.isVisible().catch(() => false) && !(await base.inputValue()).trim()) await base.fill(apiBase)
  const protocolTrigger = card.getByRole('button', { name: 'API 协议' })
  if (await protocolTrigger.isVisible().catch(() => false)) {
    const current = await protocolTrigger.innerText()
    if (!/openai-completions/i.test(current)) {
      await chooseCustomSelect(card, 'API 协议', (label) => /openai-completions/i.test(label) || /^openai$/i.test(label))
    }
  }
  await ensureCatalogHasModel(page, card)
  await forceProtocol(card)
  const save = card.getByRole('button', { name: '保存' })
  await waitFor(async () => save.isEnabled(), 'builtin MiniMax save enabled', 20_000)
  await save.click()
  return true
}

async function forceProtocol(scope) {
  const customized = scope.locator('summary').filter({ hasText: '自定义设置' })
  if (await customized.isVisible().catch(() => false)) {
    const expanded = await customized.evaluate((el) => el.closest('details')?.open === true).catch(() => false)
    if (!expanded) await customized.click()
  }
  const protocolTrigger = scope.getByRole('button', { name: 'API 协议' })
  await protocolTrigger.waitFor({ state: 'visible', timeout: 10_000 })
  const current = await protocolTrigger.innerText()
  if (/openai-completions/i.test(current)) return
  await chooseCustomSelect(scope, 'API 协议', (label) => /openai-completions/i.test(label) || /^openai$/i.test(label))
}

async function addCustomMiniMax(page, models) {
  await models.getByRole('button', { name: '添加自定义提供方' }).click()
  const card = models.locator('.models-add-card')
  await card.waitFor({ state: 'visible', timeout: 15_000 })
  await card.getByLabel('Provider ID').fill('minimax-e2e')
  await card.getByLabel('显示名称').fill('MiniMax')
  await card.getByLabel('API 地址').fill(apiBase)
  const protocolTrigger = card.getByRole('button', { name: 'API 协议' })
  await protocolTrigger.waitFor({ state: 'visible', timeout: 10_000 })
  const current = await protocolTrigger.innerText()
  if (!/openai-completions/i.test(current)) {
    await chooseCustomSelect(card, 'API 协议', (label) => /openai-completions/i.test(label) || /^openai$/i.test(label))
  }
  await card.getByLabel('API 密钥').fill(apiKey)
  await ensureCatalogHasModel(page, card)
  const create = card.getByRole('button', { name: '创建提供方' })
  await waitFor(async () => create.isEnabled(), 'custom MiniMax create enabled', 20_000)
  await create.click()
}

async function createProjectFromHome(page) {
  await dismissNativeOnboarding(page)
  await page.getByRole('button', { name: '新建', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '新建作品' })
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.getByLabel('作品名称').fill(book)
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await page.getByRole('navigation', { name: '稿件目录' }).waitFor({ state: 'visible', timeout: 45_000 })
  await page.locator('.tree-row', { hasText: '正文' }).first().waitFor({ state: 'visible', timeout: 20_000 })
  for (const extra of ['大纲', '人物卡', '世界书']) {
    if (await page.locator('.tree').getByText(extra, { exact: true }).count()) {
      throw new Error(`new project should not pre-seed ${extra}`)
    }
  }
  await recordPhase('新建作品', workspace)
}

async function createFolder(page, name) {
  await page.getByRole('button', { name: '新建文件夹' }).click()
  const dialog = page.getByRole('dialog', { name: '新建文件夹' })
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.getByLabel('文件夹名称').fill(name)
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await dialog.waitFor({ state: 'detached', timeout: 15_000 })
  await page.locator('.tree-row', { hasText: name }).first().waitFor({ state: 'visible', timeout: 20_000 })
}

async function hoverDirectoryRow(page, directory) {
  const row = page.locator('.tree-row').filter({ hasText: directory }).first()
  await row.waitFor({ state: 'visible', timeout: 15_000 })
  await row.hover()
}

async function createFileIn(page, directory, name) {
  await hoverDirectoryRow(page, directory)
  await page.getByRole('button', { name: `在 ${directory} 中新建文件`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建文件' })
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.getByLabel('文件名称（无扩展名时按 .md 创建）').fill(name)
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await dialog.waitFor({ state: 'detached', timeout: 15_000 })
  await page.locator('[data-testid="paper-path"]', { hasText: `${directory}/${name}.md` }).waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('[data-testid="paper-save-state"]', { hasText: '已保存' }).waitFor({ state: 'visible', timeout: 15_000 })
}

async function savePaper(page) {
  const save = page.getByRole('button', { name: '保存', exact: true })
  if (await save.isVisible().catch(() => false) && await save.isEnabled().catch(() => false)) await save.click()
  else await page.keyboard.press('Control+s')
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

async function coverWorkbench(page) {
  await page.locator('.tree').waitFor({ state: 'visible', timeout: 15_000 })
  if (!(await page.locator('.shell').count())) throw new Error('workbench shell missing')
  if (!(await page.locator('.chrome .theme-toggle').count())) throw new Error('theme toggle missing')
  if (!(await page.getByRole('button', { name: '搜索与命令' }).count())) throw new Error('command palette trigger missing')

  const themeToggle = page.locator('.chrome .theme-toggle')
  await themeToggle.click()
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'ink')
  await themeToggle.click()
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'paper')
  recordFeature('theme-toggle', true)

  await page.getByRole('button', { name: '搜索与命令' }).click()
  await page.locator('.palette-overlay').waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator('.palette-content').waitFor({ state: 'visible', timeout: 5_000 })
  await page.keyboard.press('Escape')
  await page.locator('.palette-overlay').waitFor({ state: 'detached', timeout: 5_000 })
  recordFeature('command-palette', true)

  await createFolder(page, '大纲')
  await createFolder(page, '人物卡')
  await createFolder(page, '世界书')
  recordFeature('create-folders', true, '大纲 / 人物卡 / 世界书')

  await createFileIn(page, '世界书', '港口')
  await typeIntoPaper(page, '---\ntriggers: [港口, 海关]\nenabled: true\npriority: 8\n---\n\n雾港的港口由海关记忆税闸口控制，过闸要核验可验证记忆。\n')
  recordFeature('create-worldbook-file', true, '世界书/港口.md')

  await createFileIn(page, '正文', '草稿')
  await typeIntoPaper(page, '# 草稿\n\n这是作者手写的备忘，不进入十章正文。\n')
  const bodyDirectory = page.locator('.tree-row').filter({ hasText: '正文' }).first()
  if (await bodyDirectory.getAttribute('aria-expanded') !== 'true') await bodyDirectory.click()
  const draftRow = page.locator('.tree-row').filter({ hasText: '草稿.md' }).first()
  await draftRow.waitFor({ state: 'visible', timeout: 15_000 })
  await draftRow.click({ button: 'right' })
  await page.getByRole('menu', { name: '文档操作' }).getByRole('menuitem', { name: '重命名' }).click()
  const rename = page.getByRole('dialog', { name: '重命名文件' })
  await rename.getByLabel('新名称').fill('备忘.md')
  await rename.getByRole('button', { name: '保存新名称' }).click()
  await page.locator('[data-testid="paper-path"]', { hasText: '正文/备忘.md' }).waitFor({ state: 'visible', timeout: 20_000 })
  recordFeature('rename-file', true, '正文/草稿.md → 正文/备忘.md')

  await page.getByRole('button', { name: '提交' }).click()
  const history = page.getByRole('region', { name: '提交历史' })
  await history.waitFor({ state: 'visible', timeout: 15_000 })
  await waitFor(async () => (await history.locator('.snapshot-row').count()) > 0, 'snapshot row appears', 20_000)
  recordFeature('snapshot-commit', true)

  await page.keyboard.press('Control+b')
  await page.locator('.sidebar').waitFor({ state: 'detached', timeout: 10_000 })
  await page.keyboard.press('Control+b')
  await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 10_000 })
  await page.keyboard.press('Control+\\')
  await page.locator('.shell.focus-mode').waitFor({ state: 'visible', timeout: 10_000 })
  await page.screenshot({ path: resolve(output, `${String(++shotIndex).padStart(2, '0')}-focus-mode.png`) })
  report.screenshots.push(resolve(output, `${String(shotIndex).padStart(2, '0')}-focus-mode.png`))
  await page.keyboard.press('Control+\\')
  await page.locator('.shell.focus-mode').waitFor({ state: 'detached', timeout: 10_000 })
  recordFeature('layout-toggles', true)

  if (!(await page.locator('[data-testid="paper-editor"]').count())) throw new Error('editor disappeared after workbench coverage')
  await recordPhase('工作台功能覆盖', report.features.filter((item) => item.ok).map((item) => item.name).join(', '))
}

async function dismissInitGuide(page) {
  const card = page.getByRole('article', { name: '项目初始化' })
  if (!(await card.isVisible().catch(() => false))) return
  const ignore = card.getByRole('button', { name: '忽略' })
  if (await ignore.isVisible().catch(() => false)) {
    await ignore.click()
    await recordPhase('忽略项目初始化引导')
  }
}

async function verifyChaptersInEditor(page) {
  const bodyDirectory = page.locator('.tree-row').filter({ hasText: '正文' }).first()
  if (await bodyDirectory.getAttribute('aria-expanded') !== 'true') await bodyDirectory.click()
  for (let number = 1; number <= chapterCount; number += 1) {
    const id = String(number).padStart(3, '0')
    await page.locator('.tree-row').filter({ hasText: `${id}.md` }).first().click()
    const header = page.locator('.editor-header')
    await header.locator('[data-testid="paper-path"]', { hasText: `正文/${id}.md` })
      .waitFor({ state: 'visible', timeout: 30_000 })
    await header.locator('[data-testid="paper-save-state"]', { hasText: '已保存' })
      .waitFor({ state: 'visible', timeout: 30_000 })
    const wordText = await header.locator('[data-testid="paper-wordcount"]').innerText()
    const chars = Number(/^(\d+) 字$/.exec(wordText.trim())?.[1] || 0)
    if (chars < minChapterChars) throw new Error(`editor shows ${chars} characters for 正文/${id}.md`)
    const chapter = report.chapters.find((item) => item.path === `正文/${id}.md`)
    if (chapter) chapter.uiChars = chars
  }
  await page.locator('[data-testid="paper-prev"]').click()
  await page.locator('[data-testid="paper-path"]', { hasText: `正文/${String(chapterCount - 1).padStart(3, '0')}.md` })
    .waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('[data-testid="paper-next"]').click()
  await page.locator('[data-testid="paper-path"]', { hasText: `正文/${String(chapterCount).padStart(3, '0')}.md` })
    .waitFor({ state: 'visible', timeout: 15_000 })
  recordFeature('chapter-navigation', true)
  await recordPhase('页面逐章验收', `${chapterCount}章均显示已保存且至少${minChapterChars}字`)
}

async function openAssistantWithModel(page) {
  const assistant = await ensureAssistantOpen(page)
  await dismissInitGuide(page)
  const currentModel = await assistant.locator('.model-picker, .composer-model').innerText().catch(() => '')
  if (/MiniMax-M2\.7/i.test(currentModel)) {
    report.model = currentModel.replace(/\s+/g, ' ').trim()
    await recordPhase('沿用当前对话模型', report.model)
    return
  }
  await assistant.getByRole('button', { name: '新对话' }).click()
  const picker = page.getByRole('dialog', { name: '新对话' })
  const select = picker.getByLabel('选择模型')
  await select.waitFor({ state: 'visible', timeout: 30_000 })
  const options = await select.locator('option').evaluateAll((items) => items.map((item) => ({ value: item.value, text: item.textContent || '' })))
  const chosen = options.find((item) => /MiniMax-M2\.7-highspeed/i.test(item.text))
    || options.find((item) => /MiniMax-M2\.7(?!-)/i.test(item.text))
    || options.find((item) => /MiniMax/i.test(item.text))
    || options.find((item) => /DeepSeek-V4-Pro/i.test(item.text))
    || options[0]
  if (!chosen) throw new Error(`no chat model available: ${JSON.stringify(options)}`)
  await select.selectOption(chosen.value)
  await picker.getByRole('button', { name: '开始', exact: true }).click({ force: true })
  await picker.waitFor({ state: 'hidden', timeout: 30_000 })
  await assistant.getByText(chosen.text, { exact: true }).waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined)
  const effort = assistant.getByRole('button', { name: '思考强度' })
  if (await effort.isVisible().catch(() => false)) {
    const current = await effort.innerText()
    if (!/low|Low|低|medium|Medium|中/.test(current)) {
      try {
        await chooseCustomSelect(assistant, '思考强度', (label) => /^(low|Low|低)$/.test(label.trim()) || /\blow\b/i.test(label))
      } catch {
        await chooseCustomSelect(assistant, '思考强度', (label) => /medium|Medium|中/.test(label))
      }
    }
  }
  await page.waitForTimeout(800)
  await dismissInitGuide(page)
  report.model = chosen.text
  await recordPhase('新对话模型', chosen.text)
  const ping = await sendChat(page, '请只回复一个英文单词 pong，不要使用任何工具。', '模型连通探测', 90_000)
  await recordPhase('模型连通探测', ping.slice(0, 80))
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
      return page.locator('.chat-row.assistant').last().innerText()
    }
    await delay(400)
  }
  throw new Error(`${label}: timed out without assistant reply`)
}

const planPrompts = [
  {
    path: '项目总览.md',
    label: '项目总览规划',
    prompt: `请为长篇小说《${book}》完成项目总览。类型是近未来都市悬疑，第三人称限知，主题是记忆、责任与城市共同体。核心设定：海平面上升后的浮岛城“雾港”把可验证记忆作为公共信用；维修师林简发现亡姐林澜留下的录音能绕过记忆税。只调用一次 novel_propose：若 项目总览.md 不存在则 create 创建，若已存在则 edit 完整替换。写清作品定位、核心冲突、叙事视角、十章规模、文风和明确禁区。人物姓名以本提示为准，不另造同功能替代人物。不要只在聊天里贴正文，不要提问。`,
  },
  {
    path: '世界书/设定总汇.md',
    label: '世界观规划',
    prompt: `请基于《${book}》完成世界观总设定。请读取已有的 项目总览.md。只调用一次 novel_propose：若 世界书/设定总汇.md 不存在则 create 创建，若已存在则 edit 完整替换。至少覆盖：雾港地理与阶层、记忆税的技术和法律边界、回声库、雾潮、维修行业、公共广播、不能随意突破的规则、故事时间线。设定要能支撑十章，不要魔法化，不要提问，不要只在聊天回答。`,
  },
  {
    path: '人物卡/人物索引.md',
    label: '人物卡规划',
    prompt: `请为《${book}》完成人物卡索引。读取已有的 项目总览.md 和 世界书/设定总汇.md。只调用一次 novel_propose：若 人物卡/人物索引.md 不存在则 create 创建，若已存在则 edit 完整替换。至少写林简、档案员姚梨、广播工程师周野、调查官季衡、亡姐林澜五人；每人包含外在目标、内在需求、秘密、底线、说话方式、关系变化和十章弧线。不要提问，不要只在聊天回答。`,
  },
  {
    path: '大纲/总纲.md',
    label: '十章章纲规划',
    prompt: `请为《${book}》编排完整十章章纲。读取已有的 项目总览.md、世界书/设定总汇.md、人物卡/人物索引.md。只调用一次 novel_propose：若 大纲/总纲.md 不存在则 create 创建，若已存在则 edit 完整替换。必须恰好列出第001章到第010章；每章写本章目标、主要阻力、关键行动、人物变化、揭示信息、结尾钩子，并保证因果连续、最终收束核心冲突。不要提问，不要写正文，不要只在聊天回答。`,
  },
]

function chapterPrompt(number, kind) {
  const id = String(number).padStart(3, '0')
  const path = `正文/${id}.md`
  const previous = number > 1 ? `正文/${String(number - 1).padStart(3, '0')}.md` : ''
  return `现在写《${book}》第${number}章。请先读取 项目总览.md、世界书/设定总汇.md、人物卡/人物索引.md、大纲/总纲.md${previous ? ` 和上一章 ${previous}` : ` 以及现有 ${path}`}。只调用一次 novel_propose，对 ${path} 使用 ${kind}；${kind === 'edit' ? '完整替换模板内容' : '创建新文件'}。正文先写成约2800至3200个去空白字符，第三人称限知，场景化叙事，有动作、感官、对白和心理承接，严格执行对应章纲，不能写总结说明、创作注释或“未完待续”。不要提问，不要只在聊天回答。`
}

function expansionPrompt(number, count) {
  const id = String(number).padStart(3, '0')
  const path = `正文/${id}.md`
  return `第${number}章 ${path} 当前只有约${count}个去空白字符，未达到4000字验收。请读取该文件和 大纲/总纲.md，只调用一次 novel_propose，以 edit 方式扩写。请选择文件末尾一个唯一、完整的段落作为 oldText；newText 必须保留这个段落并自然追加一段约900至1200个去空白字符的完整场景，使冲突、动作、感官或人物余波更充分，但不得改变既定结局、硬设定和下一章接口。不要完整重写全章，不要提问，不要只在聊天回答。`
}

function dialogueCorrectionPrompt() {
  return `第1章里林简的对白偏完整、像在解释设定。请读取 正文/001.md 和 人物卡/人物索引.md，只调用一次 novel_propose，对 正文/001.md 使用 edit。选一段林简的对白作为 oldText；newText 改成更短、更冲、不解释记忆税或系统，但不得改变情节和下一章接口。不要提问，不要只在聊天回答。`
}

function canonCheckPrompt() {
  return `请对照 世界书/设定总汇.md 和 人物卡/人物索引.md 审读 正文/005.md。若存在违反记忆税规则或人物底线的硬冲突，只调用一次 novel_propose，对 正文/005.md 使用 edit，只替换冲突段落。若没有硬冲突，不要改文件，在聊天里写「校验通过」和一句具体理由。不要提问。`
}

if (reset) {
  await rm(projectsRoot, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
  await rm(output, { recursive: true, force: true })
}
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
  SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-author-flow-live',
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
  page.on('pageerror', (error) => fail(`pageerror: ${sanitize(error.message)}`))
  page.on('console', (message) => { if (message.type() === 'error') fail(`console: ${sanitize(message.text())}`) })
  await page.goto(started.url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.title === 'DSH Editor', undefined, { timeout: 45_000 })
  await dismissNativeOnboarding(page)

  await page.waitForFunction(() => {
    const text = document.body.innerText || ''
    return text.includes('打开作品')
      || text.includes('空白稿纸')
      || Boolean(document.querySelector('[aria-label="稿件目录"]'))
  }, undefined, { timeout: 45_000 })
  await page.waitForTimeout(1_000)
  await shot(page, 'home')

  const projectNavigation = page.getByRole('navigation', { name: '稿件目录' })
  if (!(await projectNavigation.isVisible().catch(() => false))) {
    await configureMiniMax(page)
    const projectAlreadyExists = await exists(resolve(workspace, '正文'))
    if (!projectAlreadyExists) await createProjectFromHome(page)
    else {
      const recent = page.locator('.workspace-row').getByRole('button', { name: /雾港回声/ }).first()
      if (await recent.isVisible().catch(() => false)) await recent.click()
      else {
        await page.getByRole('button', { name: '打开作品' }).click()
        await page.getByLabel('作品文件夹路径').waitFor({ state: 'visible', timeout: 10_000 })
        await page.getByLabel('作品文件夹路径').fill(workspace)
        await page.getByRole('button', { name: '打开此目录' }).click()
      }
      await projectNavigation.waitFor({ state: 'visible', timeout: 45_000 })
      await recordPhase('恢复已有测试作品', workspace)
    }
  } else await recordPhase('恢复已打开的测试作品', workspace)

  await shot(page, 'project-open')
  await dismissNativeOnboarding(page)
  if (reset) await coverWorkbench(page)
  await openAssistantWithModel(page)
  await shot(page, 'assistant-ready')

  for (const item of planPrompts) {
    const absolute = resolve(workspace, ...item.path.split('/'))
    const present = await exists(absolute)
    const current = present ? await readFile(absolute, 'utf8') : ''
    const stillTemplate = !present || compactChars(current) < 220
    if (stillTemplate) {
      await sendAndApply(page, item.prompt, item.path, item.label)
      await shot(page, item.label)
    } else await recordPhase(`${item.label}已存在`, `${item.path} · ${compactChars(current)}字`)
  }

  for (let number = 1; number <= chapterCount; number += 1) {
    const id = String(number).padStart(3, '0')
    const relative = `正文/${id}.md`
    const absolute = resolve(workspace, '正文', `${id}.md`)
    const chapterExists = await exists(absolute)
    let count = chapterExists ? compactChars(await readFile(absolute, 'utf8')) : 0
    if (count < 700) {
      await sendAndApply(page, chapterPrompt(number, chapterExists ? 'edit' : 'create'), relative, `生成第${number}章`)
      count = compactChars(await readFile(absolute, 'utf8'))
    }
    let expansions = 0
    while (count < minChapterChars && expansions < 5) {
      expansions += 1
      await sendAndApply(page, expansionPrompt(number, count), relative, `扩写第${number}章-${expansions}`)
      count = compactChars(await readFile(absolute, 'utf8'))
    }
    report.chapters.push({ path: relative, chars: count, expansions })
    await flushReport()
    if (count < minChapterChars) throw new Error(`${relative} only has ${count} non-whitespace characters`)
    await recordPhase(`第${number}章验收`, `${count}字`)
    await shot(page, `chapter-${id}`)
    if (number === 1) {
      await sendAndApply(page, dialogueCorrectionPrompt(), relative, '对话纠正第1章对白')
      report.chapters[report.chapters.length - 1].chars = compactChars(await readFile(absolute, 'utf8'))
      await shot(page, 'chapter-001-corrected')
    }
  }

  const markdown = await listMarkdown(workspace)
  const body = markdown.filter((file) => /^正文\/\d{3}\.md$/.test(file))
  if (body.length !== chapterCount) throw new Error(`expected ${chapterCount} body chapters, found ${body.length}: ${body.join(', ')}`)
  for (const required of ['项目总览.md', '世界书/设定总汇.md', '人物卡/人物索引.md', '大纲/总纲.md']) {
    if (!markdown.includes(required)) throw new Error(`missing planning artifact: ${required}`)
  }
  const check = await sendMaybeApply(page, canonCheckPrompt(), '正文/005.md', '对话校验第5章设定')
  report.canonCheck = check
  const assistantText = sanitize((await page.locator('.chat-row.assistant').allInnerTexts().then((rows) => rows.join('\n')).catch(() => '')).slice(-2_500))
  const leaked = ['.dsh-editor/作品索引.md', '状态已更新。', '为当前工作区建立作品索引'].filter((item) => assistantText.includes(item))
  if (leaked.length) fail(`搭档栏泄露内部内容：${leaked.join('、')}`)
  await verifyChaptersInEditor(page)
  await page.getByRole('button', { name: '提交' }).click()
  await shot(page, 'complete')
  await recordPhase('完整作者流程通过', `${chapterCount}章，每章至少${minChapterChars}字；第5章校验=${check}`)
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
  features: report.features,
  chapters: report.chapters,
  failures: report.failures,
}, null, 2))
if (!report.ok) process.exitCode = 1
