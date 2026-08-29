import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const workspace = resolve(devRoot, 'workbench-e2e-workspace')
const home = resolve(devRoot, 'workbench-e2e-home')
const output = resolve(root, '.pack', 'workbench-e2e')
if (!workspace.startsWith(`${devRoot}${sep}`) || !home.startsWith(`${devRoot}${sep}`)) throw new Error('unsafe e2e path')

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

await rm(workspace, { recursive: true, force: true })
await rm(home, { recursive: true, force: true })
await rm(output, { recursive: true, force: true })
await mkdir(resolve(workspace, '正文'), { recursive: true })
await mkdir(resolve(workspace, '人物卡'), { recursive: true })
await mkdir(resolve(home, 'electron-user-data'), { recursive: true })
await mkdir(output, { recursive: true })
await writeFile(resolve(workspace, '正文', '001.md'), '# 第一章\n\n开场。\n')
await writeFile(resolve(workspace, '正文', '002.md'), '# 第二章\n\n月下银桥只出现一次。\n')
await writeFile(resolve(workspace, '正文', '010.md'), '# 第十章\n\n收束。\n')
await writeFile(resolve(workspace, '人物卡', '主角.md'), '# 主角\n\n无名。\n')

const env = {
  ...process.env,
  DSH_TELEMETRY_DISABLED: '1',
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: cli,
  DSH_DESKTOP_PROFILE_TEMPLATE: template,
  DSH_HOME: home,
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

  await window.getByRole('button', { name: '打开作品' }).first().click()
  const pathBox = window.getByLabel('作品文件夹路径')
  await pathBox.waitFor({ state: 'visible' })
  await pathBox.fill(workspace)
  await window.getByRole('button', { name: '打开此目录' }).click()
  await window.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })
  await window.locator('.tree-row', { hasText: '正文' }).first().click()
  await window.locator('.tree-row', { hasText: '001.md' }).first().click()
  await window.getByRole('textbox', { name: '正文' }).waitFor({ state: 'visible' })
  await window.waitForFunction(() => document.querySelector('.chapter-navigation')?.textContent?.includes('1 / 3'))

  await window.getByTitle('下一章').click()
  await window.waitForFunction(() => document.querySelector('.chapter-navigation')?.textContent?.includes('2 / 3'))
  await window.waitForFunction(() => {
    const editor = document.querySelector('textarea[aria-label="正文"]')
    return editor instanceof HTMLTextAreaElement && editor.value.includes('月下银桥')
  })
  const openedSecond = await window.getByRole('textbox', { name: '正文' }).inputValue()
  if (!openedSecond.includes('月下银桥')) failures.push('完整章节导航没有按 001/002/010 自然排序')

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

  await window.getByRole('button', { name: '管理 002.md' }).click()
  const dialog = window.locator('.file-dialog')
  await dialog.waitFor({ state: 'visible' })
  await dialog.locator('.file-dialog-actions > button').filter({ hasText: '重命名' }).click()
  await dialog.getByLabel('新名称').fill('第二章.md')
  await dialog.getByRole('button', { name: '保存新名称' }).click()
  await waitFor(async () => await exists(resolve(workspace, '正文', '第二章.md')), 'renamed file')
  if (await exists(resolve(workspace, '正文', '002.md'))) failures.push('重命名后旧路径仍存在')
  await window.waitForFunction(() => !document.querySelector('.search-results'))

  await window.locator('.tree-row', { hasText: '正文' }).first().click()
  await window.getByRole('button', { name: '管理 第二章.md' }).click()
  const archiveDialog = window.locator('.file-dialog')
  await archiveDialog.waitFor({ state: 'visible' })
  await archiveDialog.locator('.file-dialog-actions > button').filter({ hasText: '归档' }).click()
  await archiveDialog.getByRole('button', { name: '确认归档' }).click()
  await waitFor(async () => !(await exists(resolve(workspace, '正文', '第二章.md'))), 'archived source removal')

  await window.locator('.archive-panel > summary').click()
  const restore = window.locator('.archive-list article').filter({ hasText: '第二章.md' }).getByRole('button', { name: '恢复' })
  await restore.waitFor({ state: 'visible' })
  await restore.click()
  await waitFor(async () => await exists(resolve(workspace, '正文', '第二章.md')), 'restored file')
  const restored = await readFile(resolve(workspace, '正文', '第二章.md'), 'utf8')
  if (!restored.includes('月下银桥')) failures.push('恢复后的文件内容不一致')

  const archiveRoots = await readdir(resolve(workspace, '.dsh-editor', 'archive'))
  if (!archiveRoots.length) failures.push('归档审计记录缺失')
  await window.screenshot({ path: resolve(output, 'workbench.png'), fullPage: true })
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
