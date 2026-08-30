/**
 * Live visual walkthrough of DSH Editor for screenshot review.
 * Uses a dedicated isolated DSH_HOME; never writes the daily web profile.
 * MiniMax credentials follow author-flow-live: env then ~/.mmx/config.json.
 * The key is never printed.
 */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const workspace = resolve(devRoot, 'visual-audit-workspace')
const home = resolve(devRoot, 'visual-audit-home')
const output = resolve(root, 'e2e', 'out', 'visual-audit')
const sendTimeout = Number(process.env.E2E_VISUAL_AUDIT_SEND_TIMEOUT_MS || 300_000)

for (const target of [workspace, home]) {
  if (!target.startsWith(`${devRoot}${sep}`)) throw new Error(`unsafe test path: ${target}`)
}
if (!output.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) throw new Error('unsafe output path')

const mmxPath = process.env.MMX_CONFIG_PATH || join(homedir(), '.mmx', 'config.json')
const mmx = JSON.parse(await readFile(mmxPath, 'utf8'))
const apiKey = String(process.env.MINIMAX_API_KEY || mmx.api_key || '').trim()
if (!apiKey) throw new Error('MiniMax API key is unavailable')
const configuredBase = String(process.env.MINIMAX_BASE_URL || mmx.base_url || (mmx.region === 'cn' ? 'https://api.minimaxi.com' : 'https://api.minimax.io'))
const apiBase = `${configuredBase.replace(/\/+$/, '')}/v1`

resolveDshInstallation('0.1.1-rc.2')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')

const report = {
  startedAt: new Date().toISOString(),
  workspace,
  provider: 'minimax-custom',
  screenshots: [],
  failures: [],
  notes: [],
  surfaces: {},
  minimaxTurn: { ok: false, model: '', ms: 0 },
}

function sanitize(value) {
  return String(value).replaceAll(apiKey, '[redacted]').replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
}

function surface(name, pass, detail) {
  report.surfaces[name] = { pass, detail: sanitize(detail), at: new Date().toISOString() }
  if (!pass) fail(`surface ${name}: ${detail}`)
  else note(`surface ${name}`, detail)
}

function note(title, detail = '') {
  report.notes.push({ title, detail, at: new Date().toISOString() })
  console.log(`[visual-audit] ${title}${detail ? `: ${detail}` : ''}`)
}

function fail(message) {
  report.failures.push(message)
  console.error(`[visual-audit] ${message}`)
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function run(script, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, env, stdio: 'inherit', windowsHide: true })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`preparation exited ${code}`)))
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

async function waitFor(check, label, timeout = 12_000) {
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

let shotIndex = 0
async function shot(page, name, intent) {
  shotIndex += 1
  const file = resolve(output, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await page.waitForTimeout(280)
  await page.screenshot({ path: file })
  report.screenshots.push({ name, file, intent, at: new Date().toISOString() })
  note('截图', `${name} — ${intent}`)
  return file
}

async function waitShell(page, selector = '.shell, .settings-shell') {
  await page.waitForFunction((sel) => document.title === 'DSH Editor' && Boolean(document.querySelector(sel)), selector, { timeout: 45_000 })
  await page.waitForTimeout(700)
}

async function seedWorkspace() {
  await mkdir(resolve(workspace, '正文'), { recursive: true })
  await mkdir(resolve(workspace, '大纲'), { recursive: true })
  await mkdir(resolve(workspace, '人物卡'), { recursive: true })
  await mkdir(resolve(workspace, '世界书'), { recursive: true })
  await writeFile(resolve(workspace, '项目总览.md'), `# 雾港回声

近未来都市悬疑。第三人称限知。海平面上升后的浮岛城把可验证记忆当作公共信用。
维修师林简发现亡姐留下的录音能绕过记忆税。
`)
  await writeFile(resolve(workspace, '正文', '001.md'), `# 第一章 潮声

林简把工具袋搁在码头栏杆上。雾比灯更先到，把浮岛城的广播塔切成一段一段的影子。
他本来只想修好一盏公共灯。灯座里却夹着一枚旧录音芯片，标签是亡姐的字。
`)
  await writeFile(resolve(workspace, '正文', '002.md'), `# 第二章 月下银桥

月下银桥只出现一次。姚梨把档案柜的钥匙转了一圈，说：“你听到的不是记忆，是税单的背面。”
`)
  await writeFile(resolve(workspace, '正文', '010.md'), `# 第十章 回声库

广播停了。林简把芯片按进回声库的旧接口，城市第一次承认那些被征税的夜晚。
`)
  await writeFile(resolve(workspace, '大纲', '总纲.md'), `# 总纲

十章：发现录音 → 档案室对质 → 银桥现身 → 调查官介入 → 回声库公开。
`)
  await writeFile(resolve(workspace, '人物卡', '人物索引.md'), `# 人物索引

- 林简：维修师，外在目标是修好城市，内在需求是把姐姐的记忆留下。
- 姚梨：档案员，知道记忆税的边界。
`)
  await writeFile(resolve(workspace, '人物卡', '林简.md'), `# 林简

外门维修师。说话短。不信系统面板，只信手里的工具。
`)
  await writeFile(resolve(workspace, '世界书', '设定总汇.md'), `# 设定总汇

雾港是一座浮岛城。记忆税按可验证时长征收。回声库保存被征税前的原始录音。
`)
}

const dshBaseEnv = { ...process.env }
delete dshBaseEnv.DEEPSEEK_API_KEY
delete dshBaseEnv.DSH_EDITOR_CUSTOM_API_KEY

await rm(workspace, { recursive: true, force: true })
await rm(home, { recursive: true, force: true })
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await mkdir(resolve(home, 'electron-user-data'), { recursive: true })
await seedWorkspace()

const prepEnv = {
  ...dshBaseEnv,
  DSH_TELEMETRY_DISABLED: '1',
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: cli,
  DSH_DESKTOP_PROFILE_TEMPLATE: template,
}
await run(resolve(root, 'scripts', 'prepare-desktop-dev.mjs'), [], prepEnv)

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
  note('接口连接成功', '自定义接口 MiniMax')
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
      await input.fill('按已给出的设定继续，不要改文件。')
    }
    await question.getByRole('button', { name: '提交全部回答' }).click()
    return true
  }
  return false
}

async function sendMiniMaxTurn(page) {
  const assistant = page.getByRole('complementary', { name: '写作助手' }).or(page.locator('.chat'))
  await assistant.waitFor({ state: 'visible', timeout: 20_000 })
  const launcher = page.getByRole('button', { name: '打开写作搭档' })
  if (await launcher.isVisible().catch(() => false)) await launcher.click()
  await page.getByRole('button', { name: '新对话' }).click()
  const picker = page.getByRole('dialog', { name: '新对话' })
  const select = picker.getByLabel('选择模型')
  await select.waitFor({ state: 'visible', timeout: 30_000 })
  await shot(page, 'new-conversation', '新对话先选 MiniMax 模型再开始')
  const options = await select.locator('option').evaluateAll((items) => items.map((item) => ({ value: item.value, text: item.textContent || '' })))
  const chosen = options.find((item) => /MiniMax-M2\.7-highspeed/i.test(item.text))
    || options.find((item) => /MiniMax-M2\.7(?!-)/i.test(item.text))
    || options.find((item) => /MiniMax-M3/i.test(item.text))
    || options.find((item) => /MiniMax/i.test(item.text))
  if (!chosen) {
    report.minimaxTurn = { ok: false, model: '', ms: 0, error: `MiniMax model not found: ${JSON.stringify(options)}` }
    fail('MiniMax 模型未出现在新对话列表')
    await picker.getByRole('button', { name: '关闭' }).click().catch(() => undefined)
    return
  }
  await select.selectOption(chosen.value)
  await picker.getByRole('button', { name: '开始', exact: true }).click()
  await picker.waitFor({ state: 'detached', timeout: 30_000 })
  report.minimaxTurn.model = chosen.text
  const composer = page.getByRole('textbox', { name: '输入消息' })
  await composer.waitFor({ state: 'visible', timeout: 20_000 })
  await composer.fill('请用一句话说明林简是谁。不要调用工具，不要改任何文件，不要提问。')
  const send = page.getByRole('button', { name: '发送', exact: true })
  await waitFor(async () => await send.isEnabled().catch(() => false), 'send enabled', 20_000)
  const startedAt = Date.now()
  await send.click()
  const deadline = Date.now() + sendTimeout
  while (Date.now() < deadline) {
    await answerPending(page)
    const stopVisible = await page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)
    const assistantRows = await page.locator('.chat-row.assistant, .chat-history .assistant').count()
    if (!stopVisible && assistantRows > 0 && Date.now() - startedAt > 1_500) {
      await page.waitForTimeout(800)
      const stillStop = await page.getByRole('button', { name: /停止/ }).isVisible().catch(() => false)
      if (!stillStop) {
        report.minimaxTurn.ok = true
        report.minimaxTurn.ms = Date.now() - startedAt
        note('MiniMax 对话结束', `${report.minimaxTurn.ms}ms`)
        return
      }
    }
    await delay(400)
  }
  report.minimaxTurn.ok = false
  report.minimaxTurn.ms = Date.now() - startedAt
  fail(`MiniMax 对话超时 ${report.minimaxTurn.ms}ms`)
}

let browser
try {
  browser = await chromium.launch({ headless: true })
  await deployProfile(home, template, resolve(runtime, 'node_modules'))
  const started = await startDsh({
    ...dshBaseEnv,
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
    SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-visual-audit',
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  page.setDefaultTimeout(20_000)
  page.on('pageerror', (error) => fail(`pageerror: ${sanitize(error.message)}`))
  const step = async (label, fn) => {
    try {
      await fn()
    } catch (error) {
      fail(`${label}: ${error instanceof Error ? error.message : String(error)}`)
      await shot(page, `${label}-failed`, `${label} 失败现场`).catch(() => undefined)
      await page.keyboard.press('Escape').catch(() => undefined)
      await page.locator('.file-dialog-overlay, .import-overlay').waitFor({ state: 'detached', timeout: 1_500 }).catch(() => undefined)
    }
  }
  try {
    await page.goto(started.url.href, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.title === 'DSH Editor', undefined, { timeout: 45_000 })
    await waitShell(page, '.settings-shell .settings-view, .shell')
    await page.getByRole('heading', { name: '接口' }).waitFor({ state: 'visible' })
    await shot(page, 'first-run-settings', '首次启动强制进入接口设置，尚无返回写作区')
    await page.getByLabel('自定义接口').check()
    await page.waitForTimeout(200)
    await shot(page, 'first-run-custom', '首次启动选择自定义接口，应出现接口地址和 API Key')
    await configureMiniMax(page)
    await page.getByRole('button', { name: '打开作品' }).first().waitFor({ state: 'visible', timeout: 45_000 })
    await shot(page, 'home', 'MiniMax 连接后的首页：开始写、打开作品、新建')

    await page.getByRole('button', { name: '打开作品' }).first().click()
    await page.getByLabel('作品文件夹路径').waitFor({ state: 'visible' })
    await shot(page, 'home-open-path', '打开作品路径框：可输入路径或选择文件夹')

    await page.getByRole('button', { name: '取消' }).click()
    await page.getByRole('button', { name: '新建', exact: true }).click()
    await page.getByRole('button', { name: '在此新建' }).waitFor({ state: 'visible' })
    await shot(page, 'home-new-path', '新建作品路径框：按钮文案应改为在此新建')
    await page.getByRole('button', { name: '取消' }).click()

    await page.getByRole('button', { name: '打开作品' }).first().click()
    const pathBox = page.getByLabel('作品文件夹路径')
    await pathBox.fill(workspace)
    await page.getByRole('button', { name: '打开此目录' }).click()
    await page.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })
    await shot(page, 'workbench-opened', '打开已有作品后的工作台：文件树 + 空白稿纸或正文')

    const emptyPaper = page.getByRole('region', { name: '空白章' }).or(page.locator('.empty-paper'))
    if (await emptyPaper.first().isVisible().catch(() => false)) {
      await shot(page, 'empty-paper', '尚未打开文档时的空白页引导')
    }

    for (const folder of ['正文', '大纲', '人物卡', '世界书']) {
      const row = page.locator('.tree-row').filter({ hasText: folder }).first()
      if (await row.isVisible().catch(() => false) && (await row.getAttribute('aria-expanded')) !== 'true') {
        await row.click()
      }
    }
    await shot(page, 'tree-expanded', '稿件目录展开：正文、大纲、人物卡、世界书应同时可见')
    const treeState = await page.locator('.tree').evaluate((node) => {
      const rows = [...node.querySelectorAll('.tree-row')].map((row) => ({
        text: (row.textContent || '').replace(/\s+/g, ' ').trim(),
        depth: Number(row.getAttribute('data-tree-depth') || '0'),
      }))
      const overview = rows.find((row) => row.text.includes('项目总览'))
      const body = rows.find((row) => row.text === '正文' || row.text.endsWith(' 正文') || /^[›⌄·]?\s*正文$/.test(row.text) || row.text.includes('正文') && row.depth === 0 && !row.text.includes('.md'))
      const bodyRoot = rows.find((row) => row.text.includes('正文') && row.depth === 0)
      return { rows, overview, bodyRoot }
    })
    const overviewOk = Boolean(treeState.overview && treeState.overview.depth === 0)
    surface('overviewRoot', overviewOk, JSON.stringify({ overview: treeState.overview, bodyRoot: treeState.bodyRoot, rows: treeState.rows }))
    const indexText = await page.locator('.index-status').innerText().catch(() => '')
    const archiveBox = await page.locator('.archive-panel').boundingBox().catch(() => null)
    const indexBox = await page.locator('.index-status').boundingBox().catch(() => null)
    const treeBox = await page.locator('.tree').boundingBox().catch(() => null)
    const indexBelowTree = Boolean(indexBox && treeBox && indexBox.y >= treeBox.y + treeBox.height - 4)
    const notQueuedJargon = !indexText.includes('索引已排队')
    const notInArchive = !(archiveBox && indexBox && indexBox.y > archiveBox.y && indexBox.y < archiveBox.y + archiveBox.height)
    surface('indexStatus', notQueuedJargon && notInArchive && (!indexBox || indexBelowTree), `text=${indexText || '(none)'} belowTree=${indexBelowTree} notInArchive=${notInArchive}`)

    await page.locator('.tree-row').filter({ hasText: '001.md' }).first().click()
    await page.getByRole('textbox', { name: '正文' }).waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="正文"]')?.value.includes('潮声'))
    await shot(page, 'editor-chapter', '打开第一章：路径、字数、保存状态、补全/修改选段应清楚')

    await page.locator('.project-actions > summary').click()
    await shot(page, 'new-materials', '新建资料展开：卷/部、大纲、人物、设定')

    await page.getByRole('button', { name: '新建章节', exact: true }).click()
    const createChapter = page.getByRole('dialog', { name: '新建章节' })
    await createChapter.waitFor({ state: 'visible' })
    const chapterDest = ((await createChapter.locator('small').innerText().catch(() => '')) || '').trim()
    await shot(page, 'create-chapter', '应用内新建章节对话框，不弹系统输入框')
    await createChapter.getByRole('button', { name: '关闭' }).click()

    const destinations = { chapter: chapterDest }
    for (const [kind, name, heading] of [['outline', '大纲', '新建大纲'], ['character', '人物', '新建人物']]) {
      await page.locator('.project-actions').getByRole('button', { name }).click()
      const dialog = page.getByRole('dialog', { name: heading })
      await dialog.waitFor({ state: 'visible' })
      destinations[kind] = ((await dialog.locator('small').innerText().catch(() => '')) || '').trim()
      await dialog.getByRole('button', { name: '关闭' }).click()
      await dialog.waitFor({ state: 'detached' })
    }

    await page.locator('.project-actions').getByRole('button', { name: '设定' }).click()
    const createWorldbook = page.getByRole('dialog', { name: '新建设定' })
    await createWorldbook.waitFor({ state: 'visible' })
    destinations.world = ((await createWorldbook.locator('small').innerText().catch(() => '')) || '').trim()
    const destOk = destinations.world.includes('世界书')
      && !destinations.world.includes('保存到 正文')
      && destinations.chapter.includes('正文')
      && destinations.outline.includes('大纲')
      && destinations.character.includes('人物卡')
    surface('createDestination', destOk, JSON.stringify(destinations))
    await shot(page, 'create-worldbook', '新建设定对话框：名称、保存位置、创建')
    await createWorldbook.getByLabel('设定名称').fill('港口规则')
    await createWorldbook.getByRole('button', { name: '创建', exact: true }).click()
    await page.getByRole('region', { name: '世界书触发设置' }).waitFor({ state: 'visible' })
    const worldbookNav = await page.locator('.chapter-navigation').count()
    const worldbookPaper = await page.getByRole('textbox', { name: '正文' }).inputValue().catch(() => '')
    const worldbookOk = worldbookNav === 0 && !worldbookPaper.includes('triggers:') && !worldbookPaper.includes('priority:') && worldbookPaper.includes('# 港口规则')
    surface('worldbookPaper', worldbookOk, `nav=${worldbookNav} paper=${worldbookPaper.slice(0, 80)}`)
    await shot(page, 'worldbook-settings', '设定打开后稿纸上方出现触发词、启用和优先级')

    await page.locator('.project-actions').getByRole('button', { name: '卷/部' }).click()
    const createGroup = page.getByRole('dialog', { name: '新建卷/部' })
    await createGroup.getByLabel('卷或部名称').fill('第二卷')
    await shot(page, 'create-volume', '新建卷/部：说明不会移动现有章节')
    await createGroup.getByRole('button', { name: '创建', exact: true }).click()
    await waitFor(async () => exists(resolve(workspace, '正文', '第二卷')), 'volume created')
    const bodyRow = page.locator('.tree-row').filter({ hasText: '正文' }).first()
    if ((await bodyRow.getAttribute('aria-expanded')) !== 'true') await bodyRow.click()
    await shot(page, 'volume-structure', '正文下出现新建卷/部，卷内可再加章节')

    await page.locator('.tree-row').filter({ hasText: '001.md' }).first().click()
    const editor = page.getByRole('textbox', { name: '正文' })
    await editor.waitFor({ state: 'visible' })
    await editor.fill('# 本地未保存版本\n\n不要误删。潮声还在。\n')
    await writeFile(resolve(workspace, '正文', '001.md'), '# 磁盘外部版本\n\n保留。\n')
    const sawConflict = await page.waitForFunction(
      () => document.querySelector('.editor-header')?.textContent?.includes('版本冲突'),
      undefined,
      { timeout: 8_000 },
    ).then(() => true, () => false)
    if (sawConflict) {
      await shot(page, 'version-conflict', '外部修改冲突：重新载入 / 另存冲突副本，不应静默覆盖')
      await page.getByRole('button', { name: '重新载入磁盘版本' }).click()
      await page.getByRole('alertdialog', { name: '放弃本地草稿？' }).waitFor({ state: 'visible' })
      await shot(page, 'discard-draft', '放弃本地草稿确认：取消应保留草稿')
      await page.getByRole('alertdialog', { name: '放弃本地草稿？' }).getByRole('button', { name: '取消' }).click()
      await shot(page, 'conflict-after-cancel', '取消放弃后冲突仍在，草稿仍可见')
    } else {
      await shot(page, 'dirty-unsaved', '外部冲突未出现时的未保存草稿状态')
      await page.getByRole('button', { name: '保存' }).click().catch(() => undefined)
      await page.waitForTimeout(500)
    }

    await step('file-manage', async () => {
      const tenth = page.locator('.tree-row').filter({ hasText: '010.md' }).first()
      if (!(await tenth.isVisible())) {
        if ((await bodyRow.getAttribute('aria-expanded')) !== 'true') await bodyRow.click()
      }
      await tenth.hover()
      await page.getByRole('button', { name: '管理 010.md' }).click({ timeout: 5_000 })
      await page.locator('.file-dialog').waitFor({ state: 'visible' })
      await shot(page, 'file-manage', '文件管理菜单：重命名、移动、归档')
      await page.locator('.file-dialog-actions > button').filter({ hasText: '重命名' }).click()
      await shot(page, 'rename-file', '重命名只改名称并保留扩展名')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: '管理 010.md' }).click()
      const moveDialog = page.locator('.file-dialog')
      await moveDialog.locator('.file-dialog-actions > button').filter({ hasText: '移动到卷/部' }).click()
      await shot(page, 'move-chapter', '移动章节：显示完整目标路径，不覆盖同名文件')
      await page.keyboard.press('Escape')
    })

    await step('workspace-manage', async () => {
      await page.getByRole('button', { name: '管理当前作品' }).click()
      await page.locator('.workspace-dialog').waitFor({ state: 'visible' })
      await shot(page, 'workspace-manage', '作品管理：只改显示名，并说明不移动文件夹')
      await page.getByRole('button', { name: '关闭作品管理' }).click()
      await page.locator('.workspace-dialog').waitFor({ state: 'detached' })
    })

    await step('shortcuts', async () => {
      await page.getByRole('button', { name: '键盘快捷键' }).click()
      await page.getByRole('dialog', { name: '键盘快捷键' }).waitFor({ state: 'visible' })
      await shot(page, 'shortcuts', '快捷键表：文件栏、搭档、专注、设置应可读')
      await page.keyboard.press('Escape')
    })

    await step('snapshot', async () => {
      await page.getByRole('button', { name: '作品快照' }).click()
      await page.getByRole('dialog', { name: '作品快照' }).waitFor({ state: 'visible', timeout: 20_000 })
      await shot(page, 'snapshot', '作品快照：说明只含已保存文本，恢复到新空文件夹')
      await page.getByRole('button', { name: '取消' }).click()
    })

    await step('export-menu', async () => {
      await page.locator('.export-menu > summary').click()
      const markdownBtn = page.getByRole('button', { name: 'Markdown', exact: true })
      const txtBtn = page.getByRole('button', { name: 'TXT', exact: true })
      await markdownBtn.waitFor({ state: 'visible', timeout: 8_000 })
      await txtBtn.waitFor({ state: 'visible', timeout: 8_000 })
      const menu = page.locator('.export-menu')
      const menuShot = resolve(output, `${String(shotIndex + 1).padStart(2, '0')}-export-menu-panel.png`)
      await menu.screenshot({ path: menuShot })
      surface('exportMenu', true, 'Markdown and TXT visible in export-menu')
      await shot(page, 'export-menu', '导出菜单：Markdown 与 TXT')
      await page.keyboard.press('Escape').catch(() => undefined)
    })

    await step('files-hidden', async () => {
      await page.keyboard.press('Control+b')
      await page.locator('.sidebar').waitFor({ state: 'detached' })
      await shot(page, 'files-hidden', '隐藏文件栏后中央稿纸应更宽，顶栏文件按钮可恢复')
      await page.keyboard.press('Control+b')
      await page.locator('.sidebar').waitFor({ state: 'visible' })
    })

    await step('assistant', async () => {
      await page.keyboard.press('Control+j')
      await page.locator('.chat').waitFor({ state: 'visible' })
      await page.waitForTimeout(600)
      await shot(page, 'assistant-open', '三栏布局：文件、稿纸、写作搭档')
      await sendMiniMaxTurn(page)
      await shot(page, 'assistant-after-send', 'MiniMax 实机回复后的搭档栏')
      const chatText = await page.locator('.chat').innerText()
      const leaked = ['novel_propose', '.dsh-editor/作品索引.md', '状态已更新。', '为当前工作区建立作品索引']
        .filter((item) => chatText.includes(item))
      const titles = await page.getByLabel('切换对话').locator('option').allTextContents().catch(() => [])
      const titleLeak = titles.some((title) => title.includes('为当前工作区建立作品索引'))
      surface('chatLeak', leaked.length === 0 && !titleLeak && report.minimaxTurn.ok, `leaked=${leaked.join('|') || 'none'} titles=${titles.join('|')} turn=${report.minimaxTurn.ok}`)
      const composer = page.getByRole('textbox', { name: '输入消息' })
      if (await composer.isVisible().catch(() => false)) {
        await composer.fill('不要丢失的草稿')
        await page.getByRole('button', { name: '返回作品列表' }).click()
        const discard = page.getByRole('alertdialog', { name: '放弃未发送的消息？' })
        if (await discard.isVisible().catch(() => false)) {
          await shot(page, 'discard-unsent', '未发送消息离开确认：取消应保留草稿')
          await discard.getByRole('button', { name: '取消' }).click()
        }
        await composer.fill('')
      }
    })

    await step('focus-mode', async () => {
      await page.keyboard.press('Control+Backslash')
      await page.locator('.shell.focus-mode').waitFor({ state: 'visible' })
      await shot(page, 'focus-mode', '专注模式：只保留居中稿纸，隐藏两侧栏')
      await page.keyboard.press('Control+Backslash')
      await page.locator('.sidebar').waitFor({ state: 'visible' })
      const chat = page.locator('.chat')
      if (await chat.isVisible().catch(() => false)) {
        await page.keyboard.press('Control+j')
        await chat.waitFor({ state: 'hidden' })
      }
    })

    await step('search', async () => {
      const search = page.getByRole('search')
      await search.getByLabel('搜索作品文字').fill('月下银桥')
      await search.getByRole('button', { name: '开始搜索' }).click()
      await page.locator('.search-results button').first().waitFor({ state: 'visible', timeout: 15_000 })
      await shot(page, 'search-results', '全文搜索结果应显示文件、片段，点击可定位')
      await page.locator('.search-results button').first().click()
      await page.waitForTimeout(400)
      await shot(page, 'search-jump', '点击搜索结果后打开对应章节并选中命中文字')
    })

    await step('archive', async () => {
      await page.locator('.archive-panel > summary').click()
      await shot(page, 'archive-empty', '已归档空状态：说明还没有归档文档')
    })

    await step('settings', async () => {
      await page.getByRole('button', { name: '设置' }).click()
      await page.getByRole('heading', { name: '接口' }).waitFor({ state: 'visible' })
      await shot(page, 'settings-from-workbench', '写作区进入设置：应有返回写作区，以及补全方式和作者约定')
      await page.getByLabel('停顿后提示').check()
      await page.getByLabel('跨作品作者约定').fill('第三人称限知；对白保持克制；少用感叹号。')
      await page.waitForTimeout(250)
      await shot(page, 'settings-preferences', '补全方式与跨作品作者约定填写后的设置页')
      await page.getByRole('button', { name: '返回写作区' }).click()
      await page.getByRole('textbox', { name: '正文' }).or(page.locator('.empty-paper')).first().waitFor({ state: 'visible' })
    })

    await step('home-recent', async () => {
      await page.getByRole('button', { name: '返回作品列表' }).click()
      await page.locator('.home-stage').waitFor({ state: 'visible' })
      await shot(page, 'home-recent', '返回首页后最近作品出现在左侧')
      const recentManage = page.getByRole('button', { name: /管理作品/ }).first()
      await recentManage.click()
      await page.locator('.workspace-dialog').waitFor({ state: 'visible' })
      await page.getByRole('button', { name: '从最近移除' }).click()
      await shot(page, 'home-remove-confirm', '首页从最近移除：再次说明不删正文、对话和日志')
      await page.getByRole('button', { name: '返回' }).click()
      await page.getByRole('button', { name: '关闭作品管理' }).click()
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.waitForTimeout(350)
      await shot(page, 'home-1280', '最小桌面宽度 1280 下的首页')
      await page.locator('.workspace-row .tree-row').first().click()
      await page.locator('.tree, .editor, .empty-paper').first().waitFor({ state: 'visible', timeout: 20_000 })
      await shot(page, 'workbench-1280', '最小桌面宽度 1280 下的工作台')
    })
  } catch (error) {
    fail(error instanceof Error ? error.stack || error.message : String(error))
    await shot(page, 'crashed', '走查中断现场').catch(() => undefined)
  } finally {
    await page.close().catch(() => undefined)
    await stop(started.child)
  }
} finally {
  if (browser) await browser.close().catch(() => undefined)
  report.finishedAt = new Date().toISOString()
  const surfaceFails = Object.entries(report.surfaces).filter(([, item]) => item && item.pass === false).map(([name]) => name)
  report.ok = surfaceFails.length === 0 && report.minimaxTurn.ok
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({
    ok: report.ok,
    shots: shotIndex,
    surfaces: Object.fromEntries(Object.entries(report.surfaces).map(([name, item]) => [name, item.pass])),
    minimaxTurn: { ok: report.minimaxTurn.ok, model: report.minimaxTurn.model, ms: report.minimaxTurn.ms },
    failures: report.failures,
  }, null, 2))
  if (!report.ok) process.exitCode = 1
}
