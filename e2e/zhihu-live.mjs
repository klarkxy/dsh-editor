/**
 * Live Zhihu key check through the product panel and /zhihu RPC.
 *
 * Uses the Access Secret from ZHIHU_ACCESS_TOKEN / ZHIHU_ACCESS_SECRET or
 * ~/.config/zhihu-search/credentials.json. Credentials are never printed.
 *
 *   $env:DSH_EDITOR_COMPOSITION = 'full'
 *   node scripts/prepare-desktop-dev.mjs
 *   node e2e/zhihu-live.mjs
 */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import { resolveDshInstallation } from '../scripts/dsh-cli.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const devRoot = resolve(root, '.dev')
const projectsRoot = resolve(devRoot, 'zhihu-live-projects')
const home = resolve(devRoot, 'zhihu-live-home')
const output = resolve(root, 'e2e', 'out', 'zhihu-live')
const searchQuery = '小说写作节奏'
const includeAsk = process.env.E2E_ZHIHU_ASK === '1'

for (const target of [projectsRoot, home]) {
  if (!target.startsWith(`${devRoot}${sep}`)) throw new Error(`unsafe test path: ${target}`)
}
if (!output.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) throw new Error(`unsafe test path: ${output}`)

const zhihuFile = join(homedir(), '.config', 'zhihu-search', 'credentials.json')
const envToken = String(process.env.ZHIHU_ACCESS_TOKEN || process.env.ZHIHU_ACCESS_SECRET || '').trim()
let fileToken = ''
try {
  const parsed = JSON.parse(await readFile(zhihuFile, 'utf8'))
  fileToken = typeof parsed.access_secret === 'string' ? parsed.access_secret.trim() : ''
} catch { /* optional */ }
const token = envToken || fileToken
if (token.length < 8) throw new Error('Zhihu Access Secret is unavailable')
const tokenSource = envToken ? 'env' : 'file'

const dsh = resolveDshInstallation('0.1.5-rc.2')
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const cli = resolve(runtime, 'lib', 'bin.js')
const report = {
  startedAt: new Date().toISOString(),
  dsh: dsh.version ?? '0.1.5-rc.2',
  tokenSource,
  tokenPresent: true,
  phases: [],
  features: [],
  failures: [],
  screenshots: [],
}

function recordPhase(name, detail = '') {
  report.phases.push({ name, detail, at: new Date().toISOString() })
  console.log(`[zhihu-live] ${name}${detail ? `: ${detail}` : ''}`)
  return flushReport()
}

function recordFeature(name, ok, detail = '') {
  report.features.push({ name, ok, detail })
  console.log(`[zhihu-live] feature ${name}: ${ok ? 'ok' : 'miss'}${detail ? ` (${detail})` : ''}`)
}

function fail(message) {
  report.failures.push(message)
  console.error(`[zhihu-live] ${message}`)
}

function sanitize(value) {
  return String(value)
    .replaceAll(token, '[redacted]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function flushReport() {
  report.ok = report.failures.length === 0
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

async function exists(target) {
  return stat(target).then(() => true, () => false)
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

function summarizeItems(value) {
  const items = Array.isArray(value?.items) ? value.items : []
  return {
    count: items.length,
    titles: items.slice(0, 5).map((item) => String(item.title || item.docName || '').slice(0, 80)),
  }
}

async function hostSession(readyUrl) {
  const response = await fetch(readyUrl, { redirect: 'manual', signal: AbortSignal.timeout(5_000) })
  if (response.status !== 303 && !response.ok) throw new Error(`host session ${response.status}`)
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  return cookies.map((item) => String(item).split(';', 1)[0]).filter(Boolean).join('; ')
}

async function callZhihu(base, cookie, method, payload) {
  const response = await fetch(`${base}/zhihu/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ type: 'client-request', rpcId: `zhihu-live-${method}`, method, payload }),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`zhihu ${method} ${response.status}: ${text.slice(0, 80)}`)
  }
  return { status: response.status, result: body.result }
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
  SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-zhihu-live',
}

if (!(await exists(template))) {
  await run(resolve(root, 'scripts', 'prepare-desktop-dev.mjs'), [], env)
}
await deployProfile(home, template, resolve(runtime, 'node_modules'))

let browser
let child
let page
try {
  const started = await startDsh(env)
  child = started.child
  const base = started.url.origin
  const cookie = await hostSession(started.url)
  await recordPhase('DSH 就绪', base)

  const search = await callZhihu(base, cookie, 'search', { query: searchQuery, count: 5 })
  if (!search.result?.ok) throw new Error(`search RPC failed: ${sanitize(JSON.stringify(search.result))}`)
  const searchSummary = summarizeItems(search.result.value)
  if (searchSummary.count < 1) throw new Error('search returned no items')
  recordFeature('rpc-search', true, `${searchSummary.count} items; ${searchSummary.titles[0] || '(untitled)'}`)
  report.rpc = { search: { status: search.status, ...searchSummary } }

  const hot = await callZhihu(base, cookie, 'hot.list', { limit: 5 })
  if (!hot.result?.ok) throw new Error(`hot.list RPC failed: ${sanitize(JSON.stringify(hot.result))}`)
  const hotSummary = summarizeItems(hot.result.value)
  if (hotSummary.count < 1) throw new Error('hot.list returned no items')
  recordFeature('rpc-hot-list', true, `${hotSummary.count} items; ${hotSummary.titles[0] || '(untitled)'}`)
  report.rpc.hot = { status: hot.status, ...hotSummary }

  if (includeAsk) {
    const ask = await callZhihu(base, cookie, 'ask', { query: '一句话说明什么是伏笔。', model: 'zhida-fast-1p5' })
    if (!ask.result?.ok) throw new Error(`ask RPC failed: ${sanitize(JSON.stringify(ask.result))}`)
    const content = String(ask.result.value?.content || ask.result.value?.answer?.content || '').trim()
    if (content.length < 4) throw new Error('ask returned empty content')
    recordFeature('rpc-ask-fast', true, `${content.slice(0, 80)}`)
    report.rpc.ask = { status: ask.status, model: 'zhida-fast-1p5', chars: content.length }
  }

  const usage = await callZhihu(base, cookie, 'usage.summary', { days: 1 })
  if (!usage.result?.ok) throw new Error(`usage.summary failed: ${sanitize(JSON.stringify(usage.result))}`)
  const today = usage.result.value?.days?.[0] || {}
  recordFeature('rpc-usage', true, `calls=${today.calls ?? 0} failures=${today.failures ?? 0}`)
  report.rpc.usage = { calls: today.calls ?? 0, failures: today.failures ?? 0, results: today.results ?? 0 }

  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  page.setDefaultTimeout(30_000)
  page.on('pageerror', (error) => fail(`pageerror: ${sanitize(error.message)}`))
  await page.goto(started.url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.title === 'DSH Editor', undefined, { timeout: 45_000 })
  await dismissNativeOnboarding(page)
  await page.getByTestId('zhihu-open').waitFor({ state: 'visible', timeout: 30_000 })
  await page.getByTestId('zhihu-open').click()
  const panel = page.getByTestId('zhihu-panel')
  await panel.waitFor({ state: 'visible', timeout: 15_000 })
  await panel.getByRole('tab', { name: '搜索', exact: true }).click()
  await page.getByTestId('zhihu-query').fill(searchQuery)
  await page.getByTestId('zhihu-search').click()
  await page.getByTestId('zhihu-results').waitFor({ state: 'visible', timeout: 30_000 })
  const searchText = await page.getByTestId('zhihu-results').innerText()
  if (!/共 \d+ 条/.test(searchText) && !/未找到相关结果/.test(searchText)) {
    throw new Error(`unexpected search UI: ${searchText.slice(0, 160)}`)
  }
  recordFeature('ui-search', true, searchText.split('\n')[0].slice(0, 80))
  await shot(page, 'zhihu-search')

  await page.getByLabel('搜索方式').selectOption('hot')
  await page.getByTestId('zhihu-search').click()
  await page.getByTestId('zhihu-results').waitFor({ state: 'visible', timeout: 30_000 })
  const hotText = await page.getByTestId('zhihu-results').innerText()
  if (!/热榜共 \d+ 条/.test(hotText) && !/未找到相关结果/.test(hotText)) {
    throw new Error(`unexpected hot UI: ${hotText.slice(0, 160)}`)
  }
  recordFeature('ui-hot-list', true, hotText.split('\n')[0].slice(0, 80))
  await shot(page, 'zhihu-hot')

  await panel.getByRole('tab', { name: '用量', exact: true }).click()
  await page.getByTestId('zhihu-usage').waitFor({ state: 'visible', timeout: 15_000 })
  const usageText = await page.getByTestId('zhihu-usage').innerText()
  recordFeature('ui-usage', !/读取失败/.test(usageText), usageText.split('\n')[0].slice(0, 80))
  await shot(page, 'zhihu-usage')
  await recordPhase('知乎真调用完成', `${report.features.filter((item) => item.ok).length}/${report.features.length} ok`)
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

console.log(JSON.stringify({
  ok: report.ok,
  tokenSource: report.tokenSource,
  features: report.features,
  failures: report.failures,
  rpc: report.rpc,
}, null, 2))
if (!report.ok) process.exitCode = 1
