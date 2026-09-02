/**
 * Slim visual audit for the DSH Editor shell after the UI refactor.
 *
 * Captures ~8 screenshots covering the new chrome and both themes:
 *   - home stage (paper, ink)
 *   - empty paper (paper, ink)
 *   - editor with typed content (paper, ink)
 *   - sidebar with all four groups expanded (paper)
 *   - theme toggle round-trip
 *
 * Never sends a paid model turn: ghost FIM is exercised in its `manual`
 * preference so the button is verified wired but the wait is bounded. The
 * script is intentionally cheap so it can run as a fast visual check
 * alongside `core-loop.mjs`.
 */
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const home = resolve(devRoot, 'visual-audit-home')
const workspace = resolve(devRoot, 'visual-audit-workspace')
const output = resolve(root, 'e2e', 'out', 'visual-audit')

for (const target of [home, workspace, output]) {
  if (!target.startsWith(`${devRoot}${sep}`) && !target.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) {
    throw new Error(`unsafe path: ${target}`)
  }
}

resolveDshInstallation('0.1.1-rc.2')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')

const report = {
  startedAt: new Date().toISOString(),
  screenshots: [],
  failures: [],
  notes: [],
  provider: 'not-called',
  assistantTurn: { skipped: true, reason: 'visual audit never calls an external model' },
}

function note(title, detail = '') {
  report.notes.push({ title, detail, at: new Date().toISOString() })
  console.log(`[visual-audit] ${title}${detail ? `: ${detail}` : ''}`)
}
function fail(message) {
  report.failures.push(message)
  console.error(`[visual-audit] ${message}`)
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(5_000).then(() => false),
  ])
  if (!exited && process.platform === 'win32' && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('error', () => resolve())
      killer.once('exit', () => resolve())
    })
  }
}

async function startDsh(env) {
  const logs = []
  const child = spawn(process.execPath, [cli, '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const ready = new Promise((resolve, reject) => {
    let buffer = ''
    const inspect = (chunk) => {
      const text = String(chunk)
      logs.push(text)
      buffer += text
      const match = /https?:\/\/127\.0\.0\.1:\d+\/?/.exec(buffer)
      if (match) resolve(new URL(match[0]))
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
  await page.waitForTimeout(220)
  await page.screenshot({ path: file })
  report.screenshots.push({ name, file: file.replace(`${root}${sep}`, ''), intent, at: new Date().toISOString() })
  note('截图', `${name} — ${intent}`)
}

await rm(workspace, { recursive: true, force: true })
await rm(home, { recursive: true, force: true })
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await mkdir(resolve(home, 'electron-user-data'), { recursive: true })
await mkdir(resolve(workspace, '正文'), { recursive: true })
await mkdir(resolve(workspace, '大纲'), { recursive: true })
await mkdir(resolve(workspace, '人物卡'), { recursive: true })
await mkdir(resolve(workspace, '世界书'), { recursive: true })
await writeFile(resolve(workspace, '正文', '001.md'), '# 第一章 试笔\n\n雾比灯先到，把码头的广播塔切成一段一段的影子。\n')
await writeFile(resolve(workspace, '大纲', '总纲.md'), '# 总纲\n\n发现录音 → 档案室对质 → 银桥现身。\n')
await writeFile(resolve(workspace, '人物卡', '林简.md'), '# 林简\n\n外门维修师。说话短。不信系统面板。\n')

const env = {
  ...process.env,
  DSH_TELEMETRY_DISABLED: '1',
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: cli,
  DSH_DESKTOP_PROFILE_TEMPLATE: template,
  DSH_HOME: home,
  DSH_EDITOR_PROJECTS_ROOT: resolve(devRoot, 'visual-audit-projects'),
  DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
  SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-visual-audit',
  DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key',
}
delete env.DSH_EDITOR_CUSTOM_API_KEY
await deployProfile(home, template, resolve(runtime, 'node_modules'))

let browser
let dshChild
try {
  const started = await startDsh(env)
  dshChild = started.child
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  page.setDefaultTimeout(15_000)
  const browserErrors = []
  page.on('pageerror', (error) => fail(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
  })

  await page.goto(started.url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell')), undefined, { timeout: 45_000 })
  await dismissNativeOnboarding(page)
  await page.waitForTimeout(400)

  // 01 — home, paper theme (default).
  await shot(page, 'home-paper', '首页 · 纸主题：新建与打开作品入口')

  // The DSH "内测声明" modal can re-appear after the first dismissal if the
  // initial pass ran before the modal had a chance to mount. Re-dismiss so
  // the backdrop stops intercepting pointer events.
  await dismissNativeOnboarding(page)
  // Open the seeded workspace via the path box.
  await page.getByRole('button', { name: '打开作品' }).first().click()
  const pathBox = page.getByLabel('作品文件夹路径')
  await pathBox.waitFor({ state: 'visible' })
  await pathBox.fill(workspace)
  await page.getByRole('button', { name: '打开此目录' }).click()
  await page.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })

  // 02 — workbench with seeded chapters; expand the four groups.
  // Tree rows carry a chevron marker span + label span, so a strict
  // ^label$ regex misses the row; use getByText scoped to the tree and
  // climb up to the row for the aria-expanded check.
  for (const label of ['大纲', '人物卡', '世界书']) {
    const row = page.locator('.tree .tree-row', { has: page.getByText(label, { exact: true }) }).first()
    if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
  }
  // 正文 is the chapter container at the workspace root level, not a
  // static group — expand it so 001.md becomes clickable.
  const manuscript = page.locator('.tree .tree-row', { has: page.getByText('正文', { exact: true }) }).first()
  if ((await manuscript.getAttribute('aria-expanded')) !== 'true') await manuscript.click()
  await page.locator('.tree .tree-row', { hasText: '001.md' }).first().click()
  await page.locator('textarea[data-testid="paper-editor"]').waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelector('textarea[data-testid="paper-editor"]')?.value?.includes('雾比灯先到'))
  await shot(page, 'workbench-paper', '工作台 · 纸主题：稿件目录、四组资料、稿纸、写入内容')

  // 03 — manual FIM attempt: editor stays usable while the FIM notice shows.
  await page.getByRole('button', { name: /^(补全|停止补全|重新补全)$/ }).click()
  await page.waitForFunction(() => {
    const notice = document.querySelector('[data-testid="paper-notice"]')?.textContent || ''
    return notice.includes('正在生成补全')
      || notice.includes('模型未返回')
      || notice.includes('补全候选')
  }, undefined, { timeout: 8_000 })
  await shot(page, 'workbench-fim-attempt', '稿纸补全触发：manual 模式下 补全 按钮可点；无模型时返回提示而不阻塞编辑')

  // 04 — sidebar expanded close-up.
  await page.locator('.sidebar').screenshot({ path: resolve(output, `${String(shotIndex + 1).padStart(2, '0')}-sidebar-expanded.png`) })
  report.screenshots.push({ name: 'sidebar-expanded', file: 'e2e/out/visual-audit/05-sidebar-expanded.png', intent: '侧栏：正文/大纲/人物卡/世界书四组展开', at: new Date().toISOString() })
  shotIndex += 1
  note('截图', 'sidebar-expanded — 侧栏：正文/大纲/人物卡/世界书四组展开')

  // 05 — ink theme round-trip on the workbench.
  await page.getByRole('button', { name: /主题（当前纸）/ }).click()
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'ink')
  await page.waitForTimeout(400)
  await shot(page, 'workbench-ink', '工作台 · 墨主题：data-theme=ink + localStorage 同步')

  // 06 — back to paper.
  await page.getByRole('button', { name: /主题（当前墨）/ }).click()
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'paper')

  // 07 — return to home and capture the ink variant.
  await page.getByRole('button', { name: '作品菜单' }).click()
  await page.getByRole('button', { name: '返回作品列表' }).click()
  await page.locator('.home-stage').waitFor({ state: 'visible' })
  // The home chrome has no theme toggle (the workbench toggle is the only
  // in-app control). Set the theme through the localStorage channel that
  // useTheme subscribes to, then reload so the new value takes effect.
  await page.evaluate(() => globalThis.localStorage.setItem('dsh-editor.theme', 'ink'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => document.title === 'DSH Editor' && document.documentElement.getAttribute('data-theme') === 'ink',
    undefined,
    { timeout: 45_000 },
  )
  await dismissNativeOnboarding(page)
  await page.waitForTimeout(300)
  await shot(page, 'home-ink', '首页 · 墨主题：与纸主题同一布局，仅 token 切换')

  if (browserErrors.length) failures.push(...browserErrors)
} catch (error) {
  if (browser) {
    const pages = browser.contexts().flatMap((context) => context.pages())
    for (const page of pages) {
      await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => undefined)
    }
  }
  fail(error instanceof Error ? error.stack || error.message : String(error))
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
  failures: report.failures,
  assistantTurn: report.assistantTurn,
}, null, 2))
if (!report.ok) process.exitCode = 1
