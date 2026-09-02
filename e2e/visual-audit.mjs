/**
 * Live visual walkthrough of DSH Editor for screenshot review.
 * Uses a dedicated isolated DSH_HOME; never writes the daily web profile.
 * This is a visual and local-workflow audit. It never sends a paid model turn.
 */
import { spawn } from 'node:child_process'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const workspace = resolve(devRoot, 'visual-audit-workspace')
const home = resolve(devRoot, 'visual-audit-home')
const output = resolve(root, 'e2e', 'out', 'visual-audit')

for (const target of [workspace, home]) {
  if (!target.startsWith(`${devRoot}${sep}`)) throw new Error(`unsafe test path: ${target}`)
}
if (!output.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) throw new Error('unsafe output path')

resolveDshInstallation('0.1.1-rc.2')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')

const report = {
  startedAt: new Date().toISOString(),
  workspace,
  provider: 'not-called',
  screenshots: [],
  failures: [],
  notes: [],
  surfaces: {},
  assistantTurn: { skipped: true, reason: 'visual audit never calls an external model' },
}

function sanitize(value) { return String(value).replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]') }

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

async function waitShell(page, selector = '.shell') {
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

async function inspectNativeSettings(page) {
  await page.getByRole('button', { name: '设置' }).click()
  const settings = page.getByRole('dialog')
  await settings.waitFor({ state: 'visible', timeout: 45_000 })
  await settings.getByRole('button', { name: '通用设置', exact: true }).click()
  await shot(page, 'settings-general', '原生 DSH 通用设置与主题入口')
  await settings.getByRole('button', { name: '模型', exact: true }).click()
  await shot(page, 'settings-models', '原生 DSH 模型分区')
  await settings.getByRole('button', { name: '写作', exact: true }).click()
  await page.getByRole('heading', { name: '写作', exact: true }).waitFor({ state: 'visible' })
  await shot(page, 'settings-writing', '原生 DSH 设置壳中的写作分区')
  await settings.getByRole('button', { name: /关闭/ }).click()
}

async function openWorkMenu(page) {
  const details = page.locator('.workspace-menu')
  if (await details.getAttribute('open') === null) {
    await page.getByRole('button', { name: '作品菜单' }).click()
  }
  await page.locator('.workspace-menu-panel').waitFor({ state: 'visible' })
}

async function closeWorkMenu(page) {
  const details = page.locator('.workspace-menu')
  if (await details.getAttribute('open') !== null) {
    await page.getByRole('button', { name: '作品菜单' }).click()
  }
  await page.locator('.workspace-menu-panel').waitFor({ state: 'hidden' })
}

async function dismissNativeModelSetup(page) {
  const configureLater = page.getByRole('button', { name: '稍后配置', exact: true })
  const appeared = await configureLater.waitFor({ state: 'visible', timeout: 2_500 }).then(() => true, () => false)
  if (appeared) {
    await configureLater.click()
    await configureLater.waitFor({ state: 'hidden', timeout: 5_000 })
  }
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
    await waitShell(page, '.shell')
    const continueNotice = page.getByRole('button', { name: '继续', exact: true })
    let onboardingStep = 0
    for (; onboardingStep < 5 && await continueNotice.isVisible({ timeout: 1_000 }).catch(() => false); onboardingStep += 1) {
      if (onboardingStep === 0) await shot(page, 'native-onboarding-notice', 'DSH 原生内测声明')
      await continueNotice.click()
      await page.waitForTimeout(250)
    }
    const configureLater = page.getByRole('button', { name: '稍后配置', exact: true })
    if (await configureLater.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await shot(page, 'native-onboarding-model', 'DSH 原生模型引导')
      await configureLater.click()
    }
    await shot(page, 'home', '原生引导后直接进入写作首页')
    await inspectNativeSettings(page)
    await page.getByRole('button', { name: '打开作品' }).first().waitFor({ state: 'visible', timeout: 45_000 })
    await shot(page, 'home-configured', '原生模型设置读取 DSH 配置后的写作首页')

    await page.getByRole('button', { name: '打开作品' }).first().click()
    await page.getByLabel('作品文件夹路径').waitFor({ state: 'visible' })
    await shot(page, 'home-open-path', '系统目录选择器不可用时的打开作品路径框')

    await page.getByRole('button', { name: '取消' }).click()
    await page.getByRole('button', { name: '新建', exact: true }).click()
    const newProjectDialog = page.getByRole('dialog', { name: '新建作品' })
    await newProjectDialog.waitFor({ state: 'visible' })
    await shot(page, 'home-new-project', '新建作品：填写名称后保存到文档/dsh-editor')
    await newProjectDialog.getByRole('button', { name: '取消', exact: true }).click()

    await page.getByRole('button', { name: '打开作品' }).first().click()
    const pathBox = page.getByLabel('作品文件夹路径')
    await pathBox.fill(workspace)
    await page.getByRole('button', { name: '打开此目录' }).click()
    await page.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })
    await dismissNativeModelSetup(page)
    if (await page.locator('.workspace-checking').isVisible().catch(() => false)) throw new Error('作品仍在检查中，不能作为工作台打开成功')
    await waitFor(async () => (await page.locator('.tree-row').count()) > 0
      || await page.locator('.empty-paper[aria-label="空白章"]').isVisible().catch(() => false), '工作台文件行或空作品状态', 20_000)
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

    await step('themes', async () => {
      const surfaceColors = () => page.evaluate(() => {
        const shell = document.querySelector('.shell')
        const paper = document.querySelector('.paper-input')
        return {
          shell: shell ? getComputedStyle(shell).backgroundColor : '',
          paper: paper ? getComputedStyle(paper).backgroundColor : '',
          ink: paper ? getComputedStyle(paper).color : '',
        }
      })
      await page.emulateMedia({ colorScheme: 'light' })
      const light = await surfaceColors()
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.waitForTimeout(250)
      const systemDark = await surfaceColors()
      await shot(page, 'workbench-system-dark', '系统主题处于深色偏好时的工作台')
      await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', 'true'))
      await page.waitForTimeout(250)
      const forcedDark = await surfaceColors()
      await shot(page, 'workbench-dark', 'DSH 深色主题下的稿纸与三栏壳层')
      await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
      await page.emulateMedia({ colorScheme: 'light' })
      surface('themeModes', JSON.stringify(light) !== JSON.stringify(forcedDark)
        && JSON.stringify(light) !== JSON.stringify(systemDark), JSON.stringify({ light, systemDark, forcedDark }))
    })

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
      await tenth.click({ button: 'right' })
      await page.getByRole('menu', { name: '文档操作' }).waitFor({ state: 'visible' })
      await shot(page, 'file-manage', '文件右键菜单：重命名、移动、归档')
      await page.getByRole('menuitem', { name: '重命名' }).click()
      await shot(page, 'rename-file', '重命名只改名称并保留扩展名')
      await page.keyboard.press('Escape')
      await tenth.click({ button: 'right' })
      await page.getByRole('menuitem', { name: '移动到卷/部' }).click()
      await page.locator('.file-dialog').waitFor({ state: 'visible' })
      await shot(page, 'move-chapter', '移动章节：显示完整目标路径，不覆盖同名文件')
      await page.keyboard.press('Escape')
    })

    await step('workspace-manage', async () => {
      await openWorkMenu(page)
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

    await step('export-menu', async () => {
      await openWorkMenu(page)
      const markdownBtn = page.getByRole('button', { name: '导出 Markdown', exact: true })
      const txtBtn = page.getByRole('button', { name: '导出 TXT', exact: true })
      await markdownBtn.waitFor({ state: 'visible', timeout: 8_000 })
      await txtBtn.waitFor({ state: 'visible', timeout: 8_000 })
      const menu = page.locator('.workspace-menu-panel')
      const menuShot = resolve(output, `${String(shotIndex + 1).padStart(2, '0')}-export-menu-panel.png`)
      await menu.screenshot({ path: menuShot })
      surface('exportMenu', true, 'Markdown and TXT visible in work menu')
      await shot(page, 'export-menu', '作品菜单中的 Markdown 与 TXT 导出')
      await closeWorkMenu(page)
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
      note('模型调用已跳过', '视觉走查只验证搭档界面，不发送外部请求。')
      const chatText = await page.locator('.chat').innerText()
      const leaked = ['novel_propose', '.dsh-editor/作品索引.md', '状态已更新。', '为当前工作区建立作品索引']
        .filter((item) => chatText.includes(item))
      const titles = await page.getByLabel('切换对话').locator('option').allTextContents().catch(() => [])
      const titleLeak = titles.some((title) => title.includes('为当前工作区建立作品索引'))
      surface('chatLeak', leaked.length === 0 && !titleLeak, `leaked=${leaked.join('|') || 'none'} titles=${titles.join('|')}`)
      const composer = page.getByRole('textbox', { name: '输入消息' })
      if (await composer.isVisible().catch(() => false)) {
        await composer.fill('不要丢失的草稿')
        await openWorkMenu(page)
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
      const settings = page.getByRole('dialog')
      await settings.getByRole('button', { name: '模型', exact: true }).click()
      await settings.getByRole('button', { name: '写作', exact: true }).click()
      await settings.getByRole('group', { name: '自动补全' }).waitFor({ state: 'visible' })
      await shot(page, 'settings-preferences', '原生设置壳中的补全方式与作者约定')
      await settings.getByRole('button', { name: /关闭/ }).click()
      await dismissNativeModelSetup(page)
      await openWorkMenu(page)
      await page.getByRole('button', { name: '作品快照' }).click()
      await shot(page, 'snapshot', '工作台中的作品快照：说明只含已保存文本，恢复到新空文件夹')
      await page.getByRole('dialog', { name: '作品快照' }).getByRole('button', { name: '关闭' }).click()
      await page.getByRole('textbox', { name: '正文' }).waitFor({ state: 'visible' })
    })

    await step('home-recent', async () => {
      await openWorkMenu(page)
      await page.getByRole('button', { name: '返回作品列表' }).click()
      await page.locator('.home-stage').waitFor({ state: 'visible' })
      await dismissNativeModelSetup(page)
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
      await page.locator('.tree').waitFor({ state: 'visible', timeout: 20_000 })
      if (await page.locator('.workspace-checking').isVisible().catch(() => false)) throw new Error('最近作品仍在检查中，不能作为重新打开成功')
      await waitFor(async () => (await page.locator('.tree-row').count()) > 0
        || await page.locator('.empty-paper[aria-label="空白章"]').isVisible().catch(() => false), '最近作品文件行或空作品状态', 20_000)
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
  report.ok = surfaceFails.length === 0 && report.failures.length === 0
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({
    ok: report.ok,
    shots: shotIndex,
    surfaces: Object.fromEntries(Object.entries(report.surfaces).map(([name, item]) => [name, item.pass])),
    assistantTurn: report.assistantTurn,
    failures: report.failures,
  }, null, 2))
  if (!report.ok) process.exitCode = 1
}
