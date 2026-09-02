import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const workspace = resolve(devRoot, 'workbench-e2e-workspace')
const projectsRoot = resolve(devRoot, 'workbench-e2e-projects')
const newWorkspace = resolve(projectsRoot, 'workbench-e2e-new-workspace')
const openEmptyWorkspace = resolve(devRoot, 'workbench-e2e-open-empty-workspace')
const movedWorkspace = resolve(devRoot, 'workbench-e2e-workspace-moved')
const invalidRelocationWorkspace = resolve(devRoot, 'workbench-e2e-invalid-relocation')
const home = resolve(devRoot, 'workbench-e2e-home')
const output = resolve(root, '.pack', 'workbench-e2e')
if (![workspace, projectsRoot, newWorkspace, openEmptyWorkspace, movedWorkspace, invalidRelocationWorkspace, home].every((target) => target.startsWith(`${devRoot}${sep}`))) throw new Error('unsafe e2e path')

resolveDshInstallation('0.1.1-rc.2')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')

function run(script, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, env, stdio: 'inherit', windowsHide: true })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`preparation exited ${code}`)))
  })
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
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
      killer.on('error', () => resolvePromise())
      killer.on('exit', () => resolvePromise())
    })
  }
}

async function start(env) {
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
      const text = String(chunk)
      logs.push(text)
      buffer += text
      const match = /https?:\/\/127\.0\.0\.1:\d+\/?/.exec(buffer)
      if (match) resolvePromise(new URL(match[0]))
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`DSH exited before readiness (${code}): ${logs.join('')}`)))
  })
  const url = await Promise.race([
    ready,
    delay(45_000).then(() => { throw new Error(`DSH readiness timed out: ${logs.join('')}`) }),
  ])
  return { child, url }
}

async function exists(target) {
  return stat(target).then(() => true, () => false)
}

async function waitFor(check, label, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`timed out: ${label}`)
}

async function apiItemCount(page, method) {
  return await page.evaluate(async (rpcMethod) => {
    const rpcId = crypto.randomUUID()
    const response = await fetch(`/api/${rpcMethod}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: rpcMethod, payload: {} }),
    })
    const envelope = await response.json()
    if (!envelope?.result?.ok || !Array.isArray(envelope.result.value?.items)) throw new Error(`${rpcMethod} failed`)
    return envelope.result.value.items.length
  }, method)
}

async function dismissNativeOnboarding(page) {
  const continueNotice = page.getByRole('button', { name: '继续', exact: true })
  for (let step = 0; step < 5 && await continueNotice.isVisible({ timeout: 1_000 }).catch(() => false); step += 1) {
    await continueNotice.click()
    await page.waitForTimeout(250)
  }
  const configureLater = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await configureLater.isVisible({ timeout: 2_000 }).catch(() => false)) await configureLater.click()
}

await rm(workspace, { recursive: true, force: true })
await rm(projectsRoot, { recursive: true, force: true })
await rm(openEmptyWorkspace, { recursive: true, force: true })
await rm(movedWorkspace, { recursive: true, force: true })
await rm(invalidRelocationWorkspace, { recursive: true, force: true })
await rm(home, { recursive: true, force: true })
await rm(output, { recursive: true, force: true })
await mkdir(resolve(workspace, '正文'), { recursive: true })
await mkdir(resolve(workspace, '人物卡'), { recursive: true })
await mkdir(resolve(workspace, '世界书'), { recursive: true })
await mkdir(resolve(home, 'electron-user-data'), { recursive: true })
await mkdir(openEmptyWorkspace, { recursive: true })
await mkdir(invalidRelocationWorkspace, { recursive: true })
await mkdir(output, { recursive: true })
await writeFile(resolve(workspace, '正文', '001.md'), '# 第一章\n\n开场。\n')
await writeFile(resolve(workspace, '正文', '002.md'), '# 第二章\n\n主角走过月下银桥。\n')
await writeFile(resolve(workspace, '正文', '003.txt'), '第三章\n\n纯文本章节。\n')
await writeFile(resolve(workspace, '正文', '010.md'), '# 第十章\n\n收束。\n')
await writeFile(resolve(workspace, '人物卡', '主角.md'), '# 主角\n\n无名。\n')

const env = {
  ...process.env,
  DSH_TELEMETRY_DISABLED: '1',
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: cli,
  DSH_DESKTOP_PROFILE_TEMPLATE: template,
  DSH_HOME: home,
  DSH_EDITOR_PROJECTS_ROOT: projectsRoot,
  DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
  SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-workbench-e2e',
  DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key',
}
delete env.DSH_EDITOR_CUSTOM_API_KEY
await run(resolve(root, 'scripts', 'prepare-desktop-dev.mjs'), [], env)
await deployProfile(home, template, resolve(runtime, 'node_modules'))

const failures = []
let browser
let child
let window
try {
  const started = await start(env)
  child = started.child
  browser = await chromium.launch({ headless: true })
  window = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const browserErrors = []
  window.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
  window.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })
  await window.goto(started.url.href)
  await window.waitForFunction(() => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell')), undefined, { timeout: 45_000 })
  await dismissNativeOnboarding(window)
  const bootEntries = await window.evaluate(() => globalThis.__DSH_BOOT__?.entries?.map((entry) => entry.id) ?? [])
  if (bootEntries.filter((entry) => entry === 'dsh-editor-shell').length !== 1) failures.push('shell client entry must load exactly once')
  for (const id of ['dsh-editor-workbench', 'dsh-editor-novel-kernel']) {
    if (bootEntries.includes(id)) failures.push(`host-only plugin leaked into browser boot entries: ${id}`)
  }

  await window.getByRole('button', { name: '新建', exact: true }).click()
  const newNameBox = window.getByLabel('作品名称')
  await newNameBox.waitFor({ state: 'visible' })
  await newNameBox.fill('workbench-e2e-new-workspace')
  await window.getByRole('button', { name: '创建', exact: true }).click()
  await window.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })
  await waitFor(async () => await exists(resolve(newWorkspace, '正文')), 'new workspace manuscript directory')
  if (await exists(resolve(newWorkspace, '正文', '001.md'))) failures.push('新建作品不应预写首章')
  if (await exists(resolve(newWorkspace, '项目总览.md'))) failures.push('新建作品不应预写项目总览')
  await window.getByRole('button', { name: '新建一章' }).click()
  const firstChapterDialog = window.getByRole('dialog', { name: '新建章节' })
  await firstChapterDialog.getByLabel('章节标题').fill('第一章')
  await firstChapterDialog.getByRole('button', { name: '创建', exact: true }).click()
  await waitFor(async () => await exists(resolve(newWorkspace, '正文', '001.md')), 'author-created first chapter')
  await window.locator('.tree-row', { hasText: '正文' }).first().click()
  await window.locator('.tree-row', { hasText: '001.md' }).first().waitFor({ state: 'visible' })
  if (!(await window.locator('.tree-row', { hasText: '001.md' }).count())) failures.push('手动新建章节后未显示首章')

  await window.getByRole('button', { name: '作品菜单' }).click()
  await window.getByRole('button', { name: '返回作品列表' }).click()
  await window.locator('.home-stage').waitFor({ state: 'visible' })
  const newRecent = window.locator('.workspace-row .tree-row', { hasText: 'workbench-e2e-new-workspace' })
  await newRecent.click()
  await window.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })
  await window.locator('.tree-row', { hasText: '正文' }).first().click()
  await window.locator('.tree-row', { hasText: '001.md' }).first().waitFor({ state: 'visible' })
  if (!(await window.locator('.tree-row', { hasText: '001.md' }).count())) failures.push('最近作品重开后未显示首章')
  await window.getByRole('button', { name: '作品菜单' }).click()
  await window.getByRole('button', { name: '返回作品列表' }).click()
  await window.locator('.home-stage').waitFor({ state: 'visible' })

  const sessionsBeforeIntentChecks = await apiItemCount(window, 'session.list')
  const workspacesBeforeIntentChecks = await apiItemCount(window, 'workspace.list')
  await window.getByRole('button', { name: '打开作品' }).first().click()
  const emptyPathBox = window.getByLabel('作品文件夹路径')
  await emptyPathBox.waitFor({ state: 'visible' })
  await emptyPathBox.fill(openEmptyWorkspace)
  await window.getByRole('button', { name: '打开此目录' }).click()
  await window.getByRole('button', { name: '在这里新建', exact: true }).waitFor({ state: 'visible' })
  if (await exists(resolve(openEmptyWorkspace, '正文'))) failures.push('打开空目录时错误初始化了新作品')
  await window.getByRole('button', { name: '取消', exact: true }).click()
  await window.locator('.home-stage').waitFor({ state: 'visible' })
  await waitFor(async () => await apiItemCount(window, 'workspace.list') === workspacesBeforeIntentChecks, '空目录打开取消后的作品登记清理')
  if (await apiItemCount(window, 'session.list') !== sessionsBeforeIntentChecks) failures.push('打开空目录在用户确认前错误创建了会话')

  await window.getByRole('button', { name: '新建', exact: true }).click()
  const duplicateNameBox = window.getByLabel('作品名称')
  await duplicateNameBox.waitFor({ state: 'visible' })
  await duplicateNameBox.fill('workbench-e2e-new-workspace')
  await window.getByRole('button', { name: '创建', exact: true }).click()
  await window.getByText('同名文件或目录已经存在。').waitFor({ state: 'visible' })
  await window.getByRole('dialog', { name: '新建作品' }).getByRole('button', { name: '取消', exact: true }).click()
  await window.locator('.home-stage').waitFor({ state: 'visible' })
  if (await apiItemCount(window, 'workspace.list') !== workspacesBeforeIntentChecks) failures.push('同名新建失败后错误新增了作品入口')
  if (await apiItemCount(window, 'session.list') !== sessionsBeforeIntentChecks) failures.push('同名新建失败后错误创建了会话')

  await window.getByRole('button', { name: '打开作品' }).first().click()
  const pathBox = window.getByLabel('作品文件夹路径')
  await pathBox.waitFor({ state: 'visible' })
  await window.getByRole('button', { name: '选择文件夹' }).waitFor({ state: 'visible' })
  await pathBox.fill(workspace)
  await window.getByRole('button', { name: '打开此目录' }).click()
  await window.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })
  await window.locator('.chrome').screenshot({ path: resolve(output, 'chrome-actions.png') })
  if (!(await window.getByRole('button', { name: '设置', exact: true }).count())) failures.push('原生 DSH 设置入口不可用')
  if (!(await window.getByRole('button', { name: '作品菜单' }).count())) failures.push('作品菜单入口不可用')
  if (!(await window.locator('.workspace-chrome .project-switcher, .workspace-chrome .workspace-menu').count() === 2)) failures.push('作品名与作品菜单没有放在同一组控件里')
  if (await window.locator('.project-switcher select').count()) failures.push('作品切换仍使用系统下拉')

  await window.locator('.tree-row', { hasText: '正文' }).first().click()
  await window.locator('.tree-row', { hasText: '001.md' }).first().click()
  await window.getByLabel('设置 001 状态').selectOption('revising')
  await waitFor(async () => {
    try {
      const stored = JSON.parse(await readFile(resolve(workspace, '.dsh-editor', 'chapter-status.json'), 'utf8'))
      return stored.version === 1 && stored.statuses?.['正文/001.md'] === 'revising'
    } catch {
      return false
    }
  }, 'chapter status sidecar')

  await window.getByRole('button', { name: '作品菜单' }).click()
  if (!(await window.getByRole('button', { name: '导出 Markdown', exact: true }).isVisible())) failures.push('作品菜单没有显示 Markdown 导出')
  if (!(await window.getByRole('button', { name: '导出 TXT', exact: true }).isVisible())) failures.push('作品菜单没有显示 TXT 导出')
  await window.getByRole('button', { name: '导出 Markdown', exact: true }).click()
  const exportPreview = window.getByRole('dialog', { name: '导出前检查' })
  await exportPreview.waitFor({ state: 'visible' })
  const previewText = await exportPreview.textContent()
  if (!previewText?.includes('4') || !previewText.includes('正文/003.txt')) failures.push('导出预检没有展示混合章节、顺序或统计')
  const downloadPromise = window.waitForEvent('download')
  await exportPreview.getByRole('button', { name: '确认导出' }).click()
  const download = await downloadPromise
  const downloadedExport = resolve(output, 'preview-export.md')
  await download.saveAs(downloadedExport)
  const downloadedText = await readFile(downloadedExport, 'utf8')
  if (!downloadedText.includes('纯文本章节') || !downloadedText.includes('月下银桥')) failures.push('导出下载与预检章节不一致')

  await window.locator('.tree-row', { hasText: '人物卡' }).first().click()
  await window.locator('.tree-row', { hasText: '主角.md' }).first().click()
  await window.getByRole('button', { name: '查找正文引用' }).click()
  const referenceSearch = window.getByRole('search')
  await referenceSearch.getByLabel('搜索作品文字').waitFor({ state: 'visible' })
  await window.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '搜索作品文字')
  if (await referenceSearch.getByLabel('搜索作品文字').inputValue() !== '主角') failures.push('人物引用没有用标题预填查询')
  if (await referenceSearch.getByLabel('搜索范围').inputValue() !== 'manuscript') failures.push('人物引用没有限制到正文')
  const referenceHit = window.locator('.search-results button', { hasText: '正文/002.md' }).first()
  await referenceHit.waitFor({ state: 'visible' })
  await referenceHit.click()
  await window.waitForFunction(() => document.querySelector('textarea[aria-label="正文"]')?.value.includes('月下银桥'))

  await window.locator('.project-actions > summary').click()
  await window.locator('.project-actions').getByRole('button', { name: '设定' }).click()
  const createWorldbook = window.getByRole('dialog', { name: '新建设定' })
  if (!(await createWorldbook.getByText('保存到 世界书', { exact: true }).isVisible())) failures.push('新建设定没有显示世界书目标目录')
  await createWorldbook.getByLabel('设定名称').fill('港口规则')
  await createWorldbook.getByRole('button', { name: '创建', exact: true }).click()
  const worldbookPath = resolve(workspace, '世界书', '港口规则.md')
  await waitFor(async () => await exists(worldbookPath), 'worldbook template')
  const worldbookTemplate = await readFile(worldbookPath, 'utf8')
  if (!worldbookTemplate.includes('triggers: ["港口规则"]\nenabled: true\npriority: 0')) failures.push('新建设定没有生成可触发的世界书元数据')
  const worldbookSettings = window.getByRole('region', { name: '世界书触发设置' })
  await worldbookSettings.waitFor({ state: 'visible' })
  if (await window.locator('.chapter-navigation').count()) failures.push('世界书错误显示了章节导航')
  const worldbookPaper = window.getByRole('textbox', { name: '正文' })
  const worldbookPaperText = await worldbookPaper.inputValue()
  if (worldbookPaperText.includes('triggers:') || worldbookPaperText.includes('priority:')) failures.push('世界书稿纸泄露了触发配置 YAML')
  if (!worldbookPaperText.includes('# 港口规则')) failures.push('世界书稿纸没有显示设定正文')
  await worldbookSettings.getByLabel('世界书触发词').fill('港口\n海关')
  await worldbookSettings.getByLabel('世界书优先级').fill('8')
  await worldbookSettings.getByRole('button', { name: '应用设置' }).click()
  await waitFor(async () => {
    const content = await readFile(worldbookPath, 'utf8')
    return content.includes('triggers: ["港口", "海关"]\nenabled: true\npriority: 8') && content.includes('# 港口规则')
  }, 'saved worldbook settings')
  await window.screenshot({ path: resolve(output, 'worldbook-settings.png'), fullPage: true })

  await window.locator('.project-actions').getByRole('button', { name: '卷/部' }).click()
  const createGroup = window.getByRole('dialog', { name: '新建卷/部' })
  await createGroup.getByLabel('卷或部名称').fill('第一卷')
  await createGroup.getByRole('button', { name: '创建', exact: true }).click()
  await waitFor(async () => await exists(resolve(workspace, '正文', '第一卷')), 'manuscript group')
  await window.locator('.tree-row', { hasText: '正文' }).first().click()
  await window.getByRole('button', { name: '在 第一卷 中新建章节' }).click()
  const createNestedChapter = window.getByRole('dialog', { name: '新建章节' })
  await createNestedChapter.getByLabel('章节标题').fill('卷内开场')
  await createNestedChapter.getByRole('button', { name: '创建', exact: true }).click()
  const nestedChapterPath = resolve(workspace, '正文', '第一卷', '001.md')
  await waitFor(async () => await exists(nestedChapterPath), 'chapter inside manuscript group')
  if (!(await readFile(nestedChapterPath, 'utf8')).startsWith('# 卷内开场')) failures.push('卷内章节模板或路径不正确')
  await window.locator('.tree-row', { hasText: '正文' }).first().click()
  await window.locator('.tree-row', { hasText: '第一卷' }).first().click()
  await window.locator('.tree-row', { hasText: '001.md' }).first().waitFor({ state: 'visible' })
  await window.screenshot({ path: resolve(output, 'volume-structure.png'), fullPage: true })
  const volumeRow = window.locator('.tree-row[data-tree-depth="1"]', { hasText: '第一卷' }).first()
  if (!(await window.locator('.tree-row[data-tree-depth="2"]', { hasText: '001.md' }).isVisible())) failures.push('展开卷后没有显示卷内章节')
  await volumeRow.click()
  if (await window.locator('.tree-row[data-tree-depth="2"]', { hasText: '001.md' }).count()) failures.push('折叠卷后仍显示卷内章节')
  if (!(await window.locator('.tree-row[data-tree-depth="1"]', { hasText: '001.md' }).isVisible())) failures.push('折叠卷后正文根章节被错误归入卷内')
  await volumeRow.click()

  const rootChapter = window.locator('.tree-row', { hasText: '001.md' }).last()
  if (!(await rootChapter.isVisible())) await window.locator('.tree-row', { hasText: '正文' }).first().click()
  await rootChapter.click()
  await window.getByRole('textbox', { name: '正文' }).waitFor({ state: 'visible' })
  await window.waitForFunction(() => document.querySelector('.chapter-navigation')?.textContent?.includes('1 / 5'))
  const completeButton = window.getByRole('button', { name: '补全', exact: true })
  const patchButton = window.getByRole('button', { name: '修改选段', exact: true })
  await completeButton.waitFor({ state: 'visible' })
  await window.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent === '补全')
    return button instanceof HTMLButtonElement && !button.disabled
  })
  if (await patchButton.isEnabled()) failures.push('没有选中文字时修改选段入口仍可点击')

  const editor = window.getByRole('textbox', { name: '正文' })
  await window.waitForFunction(() => document.querySelector('textarea[aria-label="正文"]')?.value.includes('开场。'))
  await writeFile(resolve(workspace, '正文', '001.md'), '# 磁盘外部版本\n\n保留。\n')
  await editor.fill('# 本地未保存版本\n\n不要误删。\n')
  await window.waitForFunction(() => document.querySelector('.editor-header')?.textContent?.includes('版本冲突'))
  await window.getByRole('button', { name: '重新载入磁盘版本' }).click()
  let discardDialog = window.getByRole('alertdialog', { name: '放弃本地草稿？' })
  await discardDialog.getByRole('button', { name: '取消' }).click()
  if (!(await editor.inputValue()).includes('不要误删')) failures.push('取消重新载入后本地草稿丢失')
  await window.getByRole('button', { name: '重新载入磁盘版本' }).click()
  discardDialog = window.getByRole('alertdialog', { name: '放弃本地草稿？' })
  await discardDialog.getByRole('button', { name: '放弃并重新载入' }).click()
  await window.waitForFunction(() => document.querySelector('textarea[aria-label="正文"]')?.value.includes('磁盘外部版本'))

  const tenthChapterRow = window.locator('.tree-row', { hasText: '010.md' }).first()
  await tenthChapterRow.click()
  await window.waitForFunction(() => document.querySelector('textarea[aria-label="正文"]')?.value.includes('收束'))
  if (!(await tenthChapterRow.isVisible())) await window.locator('.tree-row', { hasText: '正文' }).first().click()
  await tenthChapterRow.click({ button: 'right' })
  await window.getByRole('menuitem', { name: '移动到卷/部' }).click()
  const moveDialog = window.locator('.file-dialog')
  await moveDialog.waitFor({ state: 'visible' })
  await moveDialog.getByLabel('目标卷或部').selectOption({ label: '第一卷' })
  if (!(await moveDialog.textContent())?.includes('正文/第一卷/010.md')) failures.push('移动确认没有显示目标路径')
  await window.screenshot({ path: resolve(output, 'move-chapter.png'), fullPage: true })
  await moveDialog.getByRole('button', { name: '确认移动' }).click()
  const movedTenthPath = resolve(workspace, '正文', '第一卷', '010.md')
  await waitFor(async () => await exists(movedTenthPath), 'moved chapter target')
  if (await exists(resolve(workspace, '正文', '010.md'))) failures.push('移动章节后原路径仍存在')
  if (!(await readFile(movedTenthPath, 'utf8')).includes('收束')) failures.push('移动章节后内容不一致')
  await window.waitForFunction(() => document.querySelector('.editor-header')?.textContent?.includes('正文/第一卷/010.md'))
  if (!(await editor.inputValue()).includes('收束')) failures.push('移动当前章节后编辑器内容丢失')
  await window.locator('.tree-row', { hasText: '正文' }).first().click()
  await window.locator('.tree-row', { hasText: '001.md' }).first().click()
  await window.waitForFunction(() => document.querySelector('textarea[aria-label="正文"]')?.value.includes('磁盘外部版本'))

  const workspaceSwitcher = window.getByLabel('切换作品')
  const selectedWorkspaceTitle = async () => (await workspaceSwitcher.textContent())?.trim() || 'workbench-e2e-workspace'
  const originalWorkspaceTitle = await selectedWorkspaceTitle()
  await window.getByRole('button', { name: '作品菜单' }).click()
  await window.getByRole('button', { name: '管理当前作品' }).click()
  let workspaceDialog = window.locator('.workspace-dialog')
  await workspaceDialog.getByLabel('作品显示名').fill('验收作品')
  await workspaceDialog.getByRole('button', { name: '保存显示名' }).click()
  await workspaceDialog.waitFor({ state: 'detached' })
  await waitFor(async () => await selectedWorkspaceTitle() === '验收作品', 'renamed workspace switcher label')
  await window.getByRole('button', { name: '作品菜单' }).click()
  await window.getByRole('button', { name: '管理当前作品' }).click()
  workspaceDialog = window.locator('.workspace-dialog')
  await workspaceDialog.getByLabel('作品显示名').fill(originalWorkspaceTitle)
  await workspaceDialog.getByRole('button', { name: '保存显示名' }).click()
  await workspaceDialog.waitFor({ state: 'detached' })
  await waitFor(async () => await selectedWorkspaceTitle() === originalWorkspaceTitle, 'restored workspace switcher label')

  await window.keyboard.press('Control+b')
  await window.locator('.sidebar').waitFor({ state: 'detached' })
  await window.keyboard.press('Control+b')
  await window.locator('.sidebar').waitFor({ state: 'visible' })

  await window.keyboard.press('Control+k')
  await window.keyboard.press('Control+s')
  const shortcutDialog = window.getByRole('dialog', { name: '键盘快捷键' })
  await shortcutDialog.waitFor({ state: 'visible' })
  if (!(await shortcutDialog.textContent())?.includes('Ctrl+B')) failures.push('快捷键表缺少文件栏快捷键')
  await window.screenshot({ path: resolve(output, 'shortcuts.png'), fullPage: true })
  await window.keyboard.press('Escape')
  await shortcutDialog.waitFor({ state: 'detached' })

  const leftResizer = window.locator('.panel-resizer.left')
  const sidebarBefore = Number(await leftResizer.getAttribute('aria-valuenow'))
  await leftResizer.press('ArrowRight')
  const sidebarAfter = Number(await leftResizer.getAttribute('aria-valuenow'))
  if (!(sidebarAfter > sidebarBefore)) failures.push('文件栏键盘调宽没有生效')
  await window.waitForFunction((expected) => localStorage.getItem('dsh-editor.layout.sidebar-width') === String(expected), sidebarAfter)
  const storedSidebarWidth = await window.evaluate(() => localStorage.getItem('dsh-editor.layout.sidebar-width'))
  if (storedSidebarWidth !== String(sidebarAfter)) failures.push('文件栏宽度没有保存为界面偏好')

  await window.keyboard.press('Control+j')
  await window.locator('.chat').waitFor({ state: 'visible' })
  const conversationSelect = window.getByLabel('切换对话')
  await conversationSelect.waitFor({ state: 'visible' })
  if (await conversationSelect.locator('option').count() < 1) failures.push('对话切换器没有显示当前对话')
  const chatText = await window.locator('.chat-history').innerText()
  for (const leaked of ['为当前工作区建立作品索引', 'novel_propose', '.dsh-editor/作品索引.md', '状态已更新。']) {
    if (chatText.includes(leaked)) failures.push(`搭档栏泄露内部索引内容：${leaked}`)
  }
  const promptFailureCards = await window.getByText('写作助手未能完成这次请求，请重试。', { exact: true }).count()
  if (promptFailureCards > 1) failures.push('搭档栏重复显示请求失败卡片')
  const conversationTitles = await conversationSelect.locator('option').allTextContents()
  if (conversationTitles.some((title) => title.includes('为当前工作区建立作品索引'))) failures.push('对话标题泄露内部索引任务')
  await window.getByRole('button', { name: '重命名对话' }).click()
  const renameConversation = window.getByRole('dialog', { name: '重命名对话' })
  await renameConversation.getByLabel('对话名称').fill('工作台验收对话')
  await renameConversation.getByRole('button', { name: '保存名称' }).click()
  await window.waitForFunction(() => document.querySelector('select[aria-label="切换对话"] option:checked')?.textContent === '工作台验收对话')
  await window.waitForFunction(() => {
    const chat = document.querySelector('.chat')
    return chat && Number.parseFloat(getComputedStyle(chat).opacity || '1') >= 0.99
  })
  const composer = window.getByRole('textbox', { name: '输入消息' })
  await composer.fill('不要丢失的草稿')
  const currentConversationId = await conversationSelect.inputValue()
  await window.getByRole('button', { name: '作品菜单' }).click()
  await window.getByRole('button', { name: '返回作品列表' }).click()
  let discardMessage = window.getByRole('alertdialog', { name: '放弃未发送的消息？' })
  await discardMessage.getByRole('button', { name: '取消' }).click()
  if (await composer.inputValue() !== '不要丢失的草稿') failures.push('取消返回作品列表后未发送草稿丢失')
  await window.getByRole('button', { name: '新对话' }).click()
  const conversationSetup = window.getByRole('dialog', { name: '新对话' })
  await conversationSetup.getByLabel('选择模型').waitFor({ state: 'visible' })
  await conversationSetup.getByRole('button', { name: '开始' }).click()
  discardMessage = window.getByRole('alertdialog', { name: '放弃未发送的消息？' })
  await discardMessage.getByRole('button', { name: '取消' }).click()
  if (await composer.inputValue() !== '不要丢失的草稿') failures.push('取消新对话切换后未发送草稿丢失')
  if (await conversationSelect.inputValue() !== currentConversationId) failures.push('取消新对话切换后当前对话发生变化')
  await conversationSetup.getByRole('button', { name: '关闭' }).click()
  await window.keyboard.press('Control+j')
  await window.locator('.chat').waitFor({ state: 'hidden' })
  await window.keyboard.press('Control+j')
  await window.locator('.chat').waitFor({ state: 'visible' })
  if (await composer.inputValue() !== '不要丢失的草稿') failures.push('收起并重新打开搭档后草稿丢失')
  await composer.fill('')
  await window.waitForFunction(() => {
    const chat = document.querySelector('.chat')
    return chat && chat.getAnimations().every((animation) => animation.playState === 'finished')
  })
  if (!(await conversationSelect.isVisible()) || !(await window.getByRole('button', { name: '重命名对话' }).isVisible())) failures.push('对话管理控件没有真实显示')
  const chatHeaderOverflows = await window.locator('.chat-header').evaluate((node) => node.scrollWidth > node.clientWidth + 1)
  if (chatHeaderOverflows) failures.push('搭档栏顶部控件发生横向溢出')
  await window.screenshot({ path: resolve(output, 'conversation-lifecycle.png'), fullPage: true })
  if (await window.locator('.panel-resizer').count() !== 2) failures.push('三栏模式没有提供两个调宽分隔条')
  const chatPosition = await window.locator('.chat').evaluate((node) => getComputedStyle(node).position)
  if (chatPosition === 'fixed') failures.push('写作搭档仍是浮动抽屉，没有进入第三栏')
  const chatBox = await window.locator('.chat').boundingBox()
  const editorWithChatBox = await window.locator('.editor').boundingBox()
  if (!chatBox || chatBox.x < 0 || chatBox.x + chatBox.width > 1441 || chatBox.width < 300) failures.push(`写作搭档没有完整进入可视区域：${JSON.stringify(chatBox)}`)
  if (!editorWithChatBox || editorWithChatBox.width < 520) failures.push(`打开写作搭档后正文区域过窄：${JSON.stringify(editorWithChatBox)}`)

  await window.keyboard.press('Control+Backslash')
  await window.locator('.shell.focus-mode').waitFor({ state: 'visible' })
  if (await window.locator('.sidebar,.chat:not([hidden]),.panel-resizer').count()) failures.push('专注模式没有隐藏两侧栏与调宽条')
  await window.keyboard.press('Control+Backslash')
  await window.locator('.sidebar').waitFor({ state: 'visible' })
  await window.locator('.chat').waitFor({ state: 'visible' })
  await window.keyboard.press('Control+l')
  await window.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '输入消息')
  await window.keyboard.press('Control+j')
  await window.locator('.chat').waitFor({ state: 'hidden' })
  await window.screenshot({ path: resolve(output, 'editor-ai-controls.png'), fullPage: true })

  await window.getByRole('button', { name: '作品菜单' }).click()
  await window.getByRole('button', { name: '作品快照' }).click()
  const snapshotLibrary = window.getByRole('dialog', { name: '作品快照' })
  await snapshotLibrary.waitFor({ state: 'visible' })
  if ((await snapshotLibrary.getByRole('button', { name: '创建快照' }).getAttribute('title')) !== '备份已保存的作品；恢复时生成新副本，不会覆盖当前作品') {
    failures.push('作品快照没有说明备份用途')
  }
  await window.screenshot({ path: resolve(output, 'snapshot-library.png'), fullPage: true })
  await snapshotLibrary.getByRole('button', { name: '关闭' }).click()

  await window.getByRole('button', { name: '设置' }).click()
  const nativeSettings = window.getByRole('dialog')
  await nativeSettings.waitFor({ state: 'visible' })
  await nativeSettings.getByRole('button', { name: '模型', exact: true }).click()
  await nativeSettings.getByRole('button', { name: '写作', exact: true }).click()
  const completionSettings = nativeSettings.getByRole('group', { name: '自动补全' })
  await completionSettings.waitFor({ state: 'visible' })
  const pauseCompletion = completionSettings.getByLabel('停顿后提示')
  await pauseCompletion.click()
  await waitFor(() => pauseCompletion.isChecked(), '停顿后提示保存')
  const authorPreferences = nativeSettings.getByLabel('跨作品作者约定')
  await authorPreferences.fill('第三人称限知；对白保持克制；少用感叹号。')
  const saveAuthorPreferences = nativeSettings.getByRole('button', { name: '保存作者约定' })
  await saveAuthorPreferences.click()
  await waitFor(async () => (await readFile(resolve(home, 'settings.yaml'), 'utf8').catch(() => '')).includes('第三人称限知；对白保持克制；少用感叹号。'), '作者约定保存完成')
  await window.screenshot({ path: resolve(output, 'completion-settings.png'), fullPage: true })
  const manualCompletion = completionSettings.getByLabel('仅手动')
  await manualCompletion.click()
  await waitFor(() => manualCompletion.isChecked(), '仅手动保存')
  await nativeSettings.getByRole('button', { name: /关闭/ }).click()
  await window.getByRole('textbox', { name: '正文' }).waitFor({ state: 'visible' })
  await waitFor(async () => {
    const settings = await readFile(resolve(home, 'settings.yaml'), 'utf8').catch(() => '')
    return settings.includes('dsh-editor-writing')
      && /completion:\s*manual/.test(settings)
      && settings.includes('第三人称限知；对白保持克制；少用感叹号。')
  }, '原生 DSH 写作设置持久化')

  await window.getByTitle('下一章').click()
  await window.waitForFunction(() => document.querySelector('.chapter-navigation')?.textContent?.includes('2 / 5'))
  await window.waitForFunction(() => {
    const editor = document.querySelector('textarea[aria-label="正文"]')
    return editor instanceof HTMLTextAreaElement && editor.value.includes('月下银桥')
  })
  const openedSecond = await window.getByRole('textbox', { name: '正文' }).inputValue()
  if (!openedSecond.includes('月下银桥')) failures.push('完整章节导航没有按 Markdown/TXT 混合路径自然排序')

  const search = window.getByRole('search')
  await search.getByLabel('搜索作品文字').fill('月下银桥')
  await search.getByRole('button', { name: '开始搜索' }).click()
  const hit = window.locator('.search-results button').first()
  await hit.waitFor({ state: 'visible' })
  await hit.click()
  await window.waitForFunction(() => {
    const input = document.querySelector('textarea[aria-label="正文"]')
    return input instanceof HTMLTextAreaElement && input.value.slice(input.selectionStart, input.selectionEnd) === '月下银桥'
  })
  const selection = await window.getByRole('textbox', { name: '正文' }).evaluate((node) => {
    const input = /** @type {HTMLTextAreaElement} */ (node)
    return input.value.slice(input.selectionStart, input.selectionEnd)
  })
  if (selection !== '月下银桥') failures.push(`搜索定位错误：${selection}`)
  await window.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent === '修改选段')
    return button instanceof HTMLButtonElement && !button.disabled
  })

  const secondChapterRow = window.locator('.tree-row', { hasText: '002.md' }).first()
  if (!(await secondChapterRow.isVisible())) {
    await window.locator('.tree-row', { hasText: '正文' }).first().click()
  }
  await secondChapterRow.click({ button: 'right' })
  await window.getByRole('menuitem', { name: '重命名' }).click()
  const dialog = window.locator('.file-dialog')
  await dialog.waitFor({ state: 'visible' })
  await dialog.getByLabel('新名称').fill('第二章.md')
  await dialog.getByRole('button', { name: '保存新名称' }).click()
  await waitFor(async () => await exists(resolve(workspace, '正文', '第二章.md')), 'renamed file')
  if (await exists(resolve(workspace, '正文', '002.md'))) failures.push('重命名后旧路径仍存在')
  await window.waitForFunction(() => !document.querySelector('.search-results'))

  const renamedChapterRow = window.locator('.tree-row', { hasText: '第二章.md' }).first()
  if (!(await renamedChapterRow.isVisible())) {
    await window.locator('.tree-row', { hasText: '正文' }).first().click()
  }
  await renamedChapterRow.click({ button: 'right' })
  await window.getByRole('menuitem', { name: '归档' }).click()
  if (await window.locator('.file-dialog').isVisible().catch(() => false)) failures.push('归档不应弹出确认框')
  await waitFor(async () => !(await exists(resolve(workspace, '正文', '第二章.md'))), 'archived source removal')

  await window.locator('.archive-panel > summary').click()
  const restore = window.locator('.archive-list article').filter({ hasText: '第二章.md' }).getByRole('button', { name: '恢复' })
  await restore.waitFor({ state: 'visible' })
  await restore.click()
  await waitFor(async () => await exists(resolve(workspace, '正文', '第二章.md')), 'restored file')
  const restored = await readFile(resolve(workspace, '正文', '第二章.md'), 'utf8')
  if (!restored.includes('月下银桥')) failures.push('恢复后的文件内容不一致')
  await window.waitForFunction(() => {
    const header = document.querySelector('.editor-header')
    const editor = document.querySelector('textarea[aria-label="正文"]')
    return header?.textContent?.includes('正文/第二章.md')
      && editor instanceof HTMLTextAreaElement
      && editor.value.includes('月下银桥')
  })

  const archiveRoots = await readdir(resolve(workspace, '.dsh-editor', 'archive'))
  if (!archiveRoots.length) failures.push('归档审计记录缺失')
  const centralPaneWidth = await window.locator('.layout-shell > .editor, .layout-shell > .empty-paper').first().evaluate((node) => node.getBoundingClientRect().width)
  if (centralPaneWidth < 700) failures.push(`中央写作区没有占满可用空间：${centralPaneWidth}px`)
  await window.screenshot({ path: resolve(output, 'workbench.png'), fullPage: true })

  await window.getByRole('button', { name: '作品菜单' }).click()
  await window.getByRole('button', { name: '返回作品列表' }).click()
  await window.locator('.home-stage').waitFor({ state: 'visible' })
  await rename(workspace, movedWorkspace)
  const originalRecentRow = window.locator('.workspace-row').filter({ has: window.getByText(originalWorkspaceTitle, { exact: true }) })
  await originalRecentRow.locator('.tree-row').click()
  const relocateAction = window.getByRole('button', { name: '重新定位', exact: true })
  await relocateAction.waitFor({ state: 'visible' })
  if (await window.locator('.tree').isVisible().catch(() => false)) failures.push('失效最近路径错误进入了工作台')
  await relocateAction.click()
  const relocationPath = window.getByLabel('作品文件夹路径')
  await relocationPath.waitFor({ state: 'visible' })
  await relocationPath.fill(invalidRelocationWorkspace)
  await window.getByRole('button', { name: '打开此目录' }).click()
  await relocateAction.waitFor({ state: 'visible' })
  if (await window.locator('.tree').isVisible().catch(() => false)) failures.push('空目录被错误接受为移动后的作品')
  if (!(await originalRecentRow.count())) failures.push('重新定位失败后旧最近入口丢失')
  if (await window.getByText('workbench-e2e-invalid-relocation', { exact: true }).count()) failures.push('重新定位失败后残留了无关目录入口')

  await relocateAction.click()
  await relocationPath.waitFor({ state: 'visible' })
  await relocationPath.fill(movedWorkspace)
  await window.getByRole('button', { name: '打开此目录' }).click()
  await window.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })
  const relocatedFirstChapter = window.locator('.tree-row', { hasText: '001.md' }).first()
  if (!(await relocatedFirstChapter.isVisible())) await window.locator('.tree-row', { hasText: '正文' }).first().click()
  await relocatedFirstChapter.click()
  const relocatedEditor = window.getByRole('textbox', { name: '正文' })
  await relocatedEditor.waitFor({ state: 'visible' })
  await window.waitForFunction(() => document.querySelector('.editor-header')?.textContent?.includes('正文/001.md')
    && Boolean(document.querySelector('textarea[aria-label="正文"]')?.value))
  await relocatedEditor.fill('# 第一章\n\n重新定位后仍可编辑并保存。\n')
  await waitFor(async () => (await readFile(resolve(movedWorkspace, '正文', '001.md'), 'utf8')).includes('重新定位后仍可编辑并保存'), 'relocated workspace save')
  await window.getByRole('button', { name: '作品菜单' }).click()
  await window.getByRole('button', { name: '返回作品列表' }).click()
  await window.locator('.home-stage').waitFor({ state: 'visible' })
  if (await originalRecentRow.count()) failures.push('重新定位成功后旧最近入口仍存在')

  const movedTitle = 'workbench-e2e-workspace-moved'
  const recentManage = window.getByRole('button', { name: `管理作品 ${movedTitle}` })
  await recentManage.click()
  const recentDialog = window.locator('.workspace-dialog')
  await recentDialog.getByRole('button', { name: '从最近移除' }).click()
  await recentDialog.getByRole('button', { name: '确认从最近移除' }).click()
  await recentManage.waitFor({ state: 'detached' })
  if (!(await exists(movedWorkspace))) failures.push('从最近移除误删了磁盘作品目录')
  await window.screenshot({ path: resolve(output, 'home-after-remove.png'), fullPage: true })
  if (browserErrors.length) failures.push(...browserErrors)
} catch (error) {
  if (window) await window.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => undefined)
  failures.push(error instanceof Error ? error.stack || error.message : String(error))
} finally {
  if (window) await window.close().catch(() => undefined)
  if (browser) await browser.close().catch(() => undefined)
  await stop(child)
}

const report = { ok: failures.length === 0, workspace, failures }
await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exitCode = 1
