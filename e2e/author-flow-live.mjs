/**
 * Credentialed author-flow E2E. It starts from zero by default; set
 * E2E_AUTHOR_FLOW_RESUME=1 only when diagnosing an interrupted run.
 *
 * Product files are created only through the visible DSH Editor UI:
 * homepage project creation, Chat proposals, and the proposal card's Apply
 * button. The harness only reads project files afterwards for acceptance checks.
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
  phases: [],
  chapters: [],
  failures: [],
  screenshots: [],
}

function recordPhase(name, detail = '') {
  report.phases.push({ name, detail, at: new Date().toISOString() })
  console.log(`[author-flow] ${name}${detail ? `: ${detail}` : ''}`)
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
  return { child, url }
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
  return false
}

async function waitForProposal(page, previousCount, previousAssistantCount, label, expectedPath) {
  const cards = page.getByRole('article', { name: '文件修改建议' })
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
    const promptError = page.locator('.chat-history .warning').filter({ hasText: /未能完成|中断/ }).last()
    if (await promptError.isVisible().catch(() => false)) {
      throw new Error(`${label}: ${await promptError.innerText()}`)
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
          const launcher = page.getByRole('button', { name: '打开写作搭档' })
          await launcher.waitFor({ state: 'visible', timeout: 30_000 })
          await launcher.click()
          await page.getByRole('complementary', { name: '写作助手' }).waitFor({ state: 'visible', timeout: 30_000 })
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
    const card = await waitForProposal(page, before, assistantBefore, label, expectedPath)
    const cardText = await card.innerText()
    if (!cardText.includes(expectedPath)) throw new Error(`${label}: proposed unexpected path: ${cardText.slice(0, 300)}`)
    await shot(page, `${label}-proposal`)
    if (!(await card.getByText('已应用到作品', { exact: true }).isVisible().catch(() => false))) {
      await card.getByRole('button', { name: '应用', exact: true }).click()
      await card.getByText('已应用到作品', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
    }
    recordPhase(label, expectedPath)
  } catch (error) {
    if (attempt < 1 && String(error).includes('stale-proposal')) {
      recordPhase(`${label} 旧建议失效，重试`)
      await delay(800)
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
      recordPhase(label, `applied ${expectedPath}`)
      return 'applied'
    }
    const assistantCount = await page.locator('.chat-row.assistant').count()
    const stopVisible = await page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)
    if (assistantCount > assistantBefore && !stopVisible) {
      if (!completedAt) completedAt = Date.now()
      if (Date.now() - completedAt > 6_000) {
        await shot(page, `${label}-chat`)
        recordPhase(label, 'chat-only, no file proposal')
        return 'chat-only'
      }
    } else completedAt = 0
    await delay(500)
  }
  throw new Error(`${label}: timed out without proposal or finished turn`)
}

async function configureMiniMax(page) {
  await page.getByRole('heading', { name: '接口' }).waitFor({ state: 'visible', timeout: 45_000 })
  await page.getByLabel('自定义接口').check()
  await page.getByText('接口地址', { exact: true }).locator('..').locator('input').fill(apiBase)
  await page.getByText('API Key', { exact: true }).locator('..').locator('input').fill(apiKey)
  await page.getByRole('button', { name: '连接', exact: true }).click()
  await page.waitForFunction(() => {
    const text = document.body.innerText || ''
    return text.includes('连接成功') || text.includes('开始写。')
  }, undefined, { timeout: 90_000 })
  recordPhase('接口连接成功', apiBase)
}

async function createProjectFromHome(page) {
  await page.getByRole('button', { name: '新建', exact: true }).click()
  const nameBox = page.getByLabel('作品名称')
  await nameBox.waitFor({ state: 'visible', timeout: 10_000 })
  await nameBox.fill(book)
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await page.getByRole('navigation', { name: '稿件目录' }).waitFor({ state: 'visible', timeout: 45_000 })
  for (const name of ['正文', '大纲', '人物卡', '世界书']) {
    await page.locator('.tree-row', { hasText: name }).first().waitFor({ state: 'visible', timeout: 20_000 })
  }
  recordPhase('新建作品', workspace)
}

async function verifyChaptersInEditor(page) {
  const bodyDirectory = page.locator('.tree-row').filter({ hasText: '正文' }).first()
  if (await bodyDirectory.getAttribute('aria-expanded') !== 'true') await bodyDirectory.click()
  for (let number = 1; number <= 10; number += 1) {
    const id = String(number).padStart(3, '0')
    await page.locator('.tree-row').filter({ hasText: `${id}.md` }).first().click()
    const header = page.locator('.editor-header')
    await header.getByText(`正文/${id}.md`, { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
    await header.getByText(/\d+ 字 · 已保存/).waitFor({ state: 'visible', timeout: 30_000 })
    const status = await header.locator('span').last().innerText()
    const chars = Number(/^(\d+) 字 · 已保存$/.exec(status)?.[1] || 0)
    if (chars < minChapterChars) throw new Error(`editor shows ${chars} characters for 正文/${id}.md`)
    const chapter = report.chapters.find((item) => item.path === `正文/${id}.md`)
    if (chapter) chapter.uiChars = chars
  }
  recordPhase('页面逐章验收', `10章均显示已保存且至少${minChapterChars}字`)
}

async function openAssistantWithMiniMax(page) {
  const launcher = page.getByRole('button', { name: '打开写作搭档' })
  if (await launcher.isVisible().catch(() => false)) await launcher.click()
  const assistant = page.getByRole('complementary', { name: '写作助手' })
  await assistant.waitFor({ state: 'visible', timeout: 20_000 })
  await assistant.getByRole('button', { name: '新对话' }).click()
  const picker = page.getByRole('dialog', { name: '新对话' })
  const select = picker.getByLabel('选择模型')
  await select.waitFor({ state: 'visible', timeout: 30_000 })
  const options = await select.locator('option').evaluateAll((items) => items.map((item) => ({ value: item.value, text: item.textContent || '' })))
  const chosen = options.find((item) => /MiniMax-M2\.7-highspeed/i.test(item.text))
    || options.find((item) => /MiniMax-M2\.7(?!-)/i.test(item.text))
    || options.find((item) => /MiniMax/i.test(item.text))
  if (!chosen) throw new Error(`MiniMax model not found: ${JSON.stringify(options)}`)
  await select.selectOption(chosen.value)
  await picker.getByRole('button', { name: '开始', exact: true }).click()
  await picker.waitFor({ state: 'detached', timeout: 30_000 })
  await assistant.getByText(chosen.text, { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(1_500)
  recordPhase('新对话模型', chosen.text)
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
delete env.DEEPSEEK_API_KEY
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

  await page.waitForFunction(() => {
    const text = document.body.innerText || ''
    return text.includes('接口') || text.includes('开始写。') || Boolean(document.querySelector('[aria-label="稿件目录"]'))
  }, undefined, { timeout: 45_000 })
  await page.waitForTimeout(1_500)
  const needsSetup = await page.getByRole('heading', { name: '接口' }).isVisible().catch(() => false)
  if (needsSetup) await configureMiniMax(page)
  const projectNavigation = page.getByRole('navigation', { name: '稿件目录' })
  if (await projectNavigation.isVisible().catch(() => false)) recordPhase('恢复已打开的测试作品', workspace)
  else {
    await page.getByRole('heading', { name: '开始写。' }).waitFor({ state: 'visible', timeout: 45_000 })
    await shot(page, 'home')
    const projectAlreadyExists = await exists(resolve(workspace, '项目总览.md'))
    if (!projectAlreadyExists) await createProjectFromHome(page)
    else {
      const recent = page.locator('.workspace-row').getByRole('button', { name: /author-flow-live-workspace|雾港回声/ }).first()
      if (await recent.isVisible().catch(() => false)) await recent.click()
      else {
        await page.getByRole('button', { name: '打开作品' }).click()
        await page.getByLabel('作品文件夹路径').fill(workspace)
        await page.getByRole('button', { name: '打开此目录' }).click()
      }
      await projectNavigation.waitFor({ state: 'visible', timeout: 45_000 })
      recordPhase('恢复已有测试作品', workspace)
    }
  }
  await shot(page, 'project-open')
  await openAssistantWithMiniMax(page)
  await shot(page, 'assistant-ready')

  for (const item of planPrompts) {
    const absolute = resolve(workspace, ...item.path.split('/'))
    const present = await exists(absolute)
    const current = present ? await readFile(absolute, 'utf8') : ''
    const stillTemplate = !present || compactChars(current) < 220
    if (stillTemplate) {
      await sendAndApply(page, item.prompt, item.path, item.label)
      await shot(page, item.label)
    } else recordPhase(`${item.label}已存在`, `${item.path} · ${compactChars(current)}字`)
  }

  for (let number = 1; number <= 10; number += 1) {
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
    if (count < minChapterChars) throw new Error(`${relative} only has ${count} non-whitespace characters`)
    recordPhase(`第${number}章验收`, `${count}字`)
    await shot(page, `chapter-${id}`)
    if (number === 1) {
      await sendAndApply(page, dialogueCorrectionPrompt(), relative, '对话纠正第1章对白')
      report.chapters[report.chapters.length - 1].chars = compactChars(await readFile(absolute, 'utf8'))
      await shot(page, 'chapter-001-corrected')
    }
  }

  const markdown = await listMarkdown(workspace)
  const body = markdown.filter((file) => /^正文\/\d{3}\.md$/.test(file))
  if (body.length !== 10) throw new Error(`expected 10 body chapters, found ${body.length}: ${body.join(', ')}`)
  for (const required of ['项目总览.md', '世界书/设定总汇.md', '人物卡/人物索引.md', '大纲/总纲.md']) {
    if (!markdown.includes(required)) throw new Error(`missing planning artifact: ${required}`)
  }
  const check = await sendMaybeApply(page, canonCheckPrompt(), '正文/005.md', '对话校验第5章设定')
  report.canonCheck = check
  const chatTail = sanitize((await page.locator('.chat-history').innerText().catch(() => '')).slice(-2_500))
  const leaked = ['novel_propose', '.dsh-editor/作品索引.md', '状态已更新。', '为当前工作区建立作品索引'].filter((item) => chatTail.includes(item))
  if (leaked.length) fail(`搭档栏泄露内部内容：${leaked.join('、')}`)
  await verifyChaptersInEditor(page)
  await shot(page, 'complete')
  recordPhase('完整作者流程通过', `10章，每章至少${minChapterChars}字；第5章校验=${check}`)
} catch (error) {
  fail(sanitize(error instanceof Error ? error.stack || error.message : String(error)))
  if (page) {
    await shot(page, 'failure').catch(() => undefined)
    await writeFile(resolve(output, 'failure.html'), sanitize(await page.content().catch(() => '')), 'utf8')
  }
} finally {
  if (browser) await browser.close().catch(() => undefined)
  await stop(child)
  report.finishedAt = new Date().toISOString()
  report.ok = report.failures.length === 0
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

console.log(JSON.stringify({ ok: report.ok, phases: report.phases.length, chapters: report.chapters, failures: report.failures }, null, 2))
if (!report.ok) process.exitCode = 1
