/**
 * Boots a dsh-editor instance (like visual-audit) and reports the computed
 * font on the paper-editor textarea. Exits 0 iff the resolved font-family
 * contains a serif token, otherwise exits 1 with a JSON report.
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(import.meta.dirname, '..')
const devRoot = resolve(root, '.dev')
const home = resolve(devRoot, 'font-check-home')
const workspace = resolve(devRoot, 'font-check-workspace')

for (const target of [home, workspace]) {
  if (!target.startsWith(`${devRoot}${sep}`)) {
    throw new Error(`unsafe path: ${target}`)
  }
}

resolveDshInstallation('0.1.1-rc.2')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(5_000).then(() => false),
  ])
  if (process.platform === 'win32' && child.pid && child.exitCode === null) {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('exit', () => resolve())
    })
  }
}

await rm(workspace, { recursive: true, force: true })
await rm(home, { recursive: true, force: true })
await mkdir(resolve(home, 'electron-user-data'), { recursive: true })
await mkdir(resolve(workspace, '正文'), { recursive: true })
await writeFile(resolve(workspace, '正文', '001.md'), '# 第一章 试笔\n\n雾比灯先到，把码头的广播塔切成一段一段的影子。\n')

const env = {
  ...process.env,
  DSH_TELEMETRY_DISABLED: '1',
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: cli,
  DSH_DESKTOP_PROFILE_TEMPLATE: template,
  DSH_HOME: home,
  DSH_EDITOR_PROJECTS_ROOT: resolve(devRoot, 'font-check-projects'),
  DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
  SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-font-check',
  DEEPSEEK_API_KEY: 'dsh-editor-e2e-placeholder-key',
}
delete env.DSH_EDITOR_CUSTOM_API_KEY
await deployProfile(home, template, resolve(runtime, 'node_modules'))

const child = spawn(process.execPath, [cli, '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
const ready = new Promise((resolveReady, reject) => {
  let buffer = ''
  const inspect = (chunk) => { buffer += String(chunk); const m = /https?:\/\/127\.0\.0\.1:\d+\/?/.exec(buffer); if (m) resolveReady(new URL(m[0])) }
  child.stdout.on('data', inspect); child.stderr.on('data', inspect)
  child.once('error', reject); child.once('exit', (code) => reject(new Error(`DSH exited (${code}): ${buffer.slice(-4_000)}`)))
})
const url = await Promise.race([ready, delay(60_000).then(() => Promise.reject(new Error('readiness timeout')))])
let browser
let report
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  page.setDefaultTimeout(15_000)
  await page.goto(url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.title === 'DSH Editor' && Boolean(document.querySelector('.shell')), undefined, { timeout: 45_000 })
  // dismiss onboarding (twice — the modal can re-appear after the first pass)
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < 5; i += 1) {
      const btn = page.getByRole('button', { name: '继续', exact: true })
      if (!(await btn.isVisible({ timeout: 1_000 }).catch(() => false))) break
      await btn.click(); await page.waitForTimeout(250)
    }
    const later = page.getByRole('button', { name: '稍后配置', exact: true })
    if (await later.isVisible({ timeout: 2_000 }).catch(() => false)) await later.click()
    await page.waitForTimeout(300)
  }
  await page.getByRole('button', { name: '打开作品' }).first().click()
  const pathBox = page.getByLabel('作品文件夹路径')
  await pathBox.waitFor({ state: 'visible' })
  await pathBox.fill(workspace)
  await page.getByRole('button', { name: '打开此目录' }).click()
  await page.locator('.tree').waitFor({ state: 'visible', timeout: 30_000 })
  // expand 正文 via the manuscript header (it has className tree-row)
  const manuscript = page.locator('.tree .tree-row', { has: page.getByText('正文', { exact: true }) }).first()
  if ((await manuscript.getAttribute('aria-expanded')) !== 'true') await manuscript.click()
  await page.locator('.tree .tree-row', { hasText: '001.md' }).first().click()
  await page.locator('textarea[data-testid="paper-editor"]').waitFor({ state: 'visible' })
  report = await page.evaluate(() => {
    const ta = document.querySelector('textarea[data-testid="paper-editor"]')
    if (!ta) return { error: 'no-textarea' }
    const cs = getComputedStyle(ta)
    return { fontFamily: cs.fontFamily, fontSize: cs.fontSize, lineHeight: cs.lineHeight, color: cs.color, caretColor: cs.caretColor, className: ta.className }
  })
} finally {
  if (browser) await browser.close().catch(() => undefined)
  await stop(child)
}
const hasSerif = /serif|serif\s*sc|songti|stsong|georgia/i.test(String(report?.fontFamily ?? ''))
const payload = { ok: hasSerif, report }
console.log(JSON.stringify(payload, null, 2))
if (!hasSerif) process.exitCode = 1
