/** Desktop UI acceptance with controlled marketplace RPCs; no community code runs. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const nonce = new Date().toISOString().replace(/[:.]/g, '-')
const home = resolve(root, '.dev', `plugin-install-ui-${nonce}`)
const output = resolve(root, 'e2e/out/plugin-install', nonce)
await mkdir(output, { recursive: true })
await mkdir(resolve(home, 'electron-user-data'), { recursive: true })
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: resolve(root, '.dev/desktop-dsh-runtime/lib/bin.js'),
  DSH_DESKTOP_PROFILE_TEMPLATE: resolve(root, '.dev/desktop-profile-template'),
  DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
  DSH_EDITOR_PROJECTS_ROOT: resolve(home, 'projects') }
for (const key of ['ELECTRON_RUN_AS_NODE', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DSH_EDITOR_CUSTOM_API_KEY']) delete env[key]
const report = { ok: false, checks: [], receipts: [], errors: [], home }
const delay = ms => new Promise(done => setTimeout(done, ms))
const gate = () => { let release; const promise = new Promise(done => { release = done }); return { promise, release } }
async function until(check) {
  const end = Date.now() + 15000
  while (!await check()) { if (Date.now() > end) throw new Error('receipt timeout'); await delay(50) }
}
const listing = { spec: 'github:acme/card-plugin', owner: 'acme', repo: 'card-plugin', description: '验收插件', stars: 1,
  url: 'https://github.com/acme/card-plugin', topics: ['dsh-plugin'], updatedAt: '' }
const inspection = (verdict, name = 'fixture-plugin') => ({ ok: true, value: { verdict, name, version: '1.0.0', entries: [], hasClient: true,
  findings: [{ code: 'fixture', severity: verdict === 'blocked' ? 'error' : verdict === 'warn' ? 'warning' : 'info', message: `${name} 检查结果` }] } })
let inspectResult = inspection('ready'), inspectGate = null, installGate = null, installFails = false
let app, page, stub
let stubOrigin
const count = method => report.receipts.filter(item => item.method === method).length
function passed(name) { report.checks.push(name); console.log(`[plugin-install] ${name}`) }
try {
  app = await electron.launch({ executablePath: resolve(root, 'apps/desktop/node_modules/electron/dist/electron.exe'),
    args: [resolve(root, 'apps/desktop/dist/main.js')], env })
  // Keep the real renderer -> preload -> IPC -> policy path, intercept only OS launch.
  await app.evaluate(({ shell }) => { globalThis.__pluginExternalUrls = []; shell.openExternal = async url => { globalThis.__pluginExternalUrls.push(url) } })
  page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => report.errors.push(error.message))
  stub = createServer(async (request, response) => {
    try {
      let raw = ''
      for await (const chunk of request) raw += chunk
      const body = JSON.parse(raw)
      const method = request.url.split('/').at(-1)
      report.receipts.push({ method, payload: body.payload })
      let result
      if (method === 'marketplace.search') result = { ok: true, value: { listings: [listing] } }
      else if (method === 'marketplace.inspect') {
        result = inspectResult
        const pending = inspectGate
        if (pending) await pending.promise
      } else if (method === 'marketplace.install') {
        const pending = installGate
        if (pending) await pending.promise
        result = installFails ? { ok: false, error: { code: 'network', message: '验收安装失败', details: {} } }
          : { ok: true, value: { name: 'fixture-plugin', restartRequired: true } }
      } else throw new Error(`unexpected mutation ${method}`)
      response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
      response.end(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result }))
    } catch (error) { response.writeHead(500); response.end(String(error)) }
  })
  await new Promise(done => stub.listen(0, '127.0.0.1', done))
  stubOrigin = `http://127.0.0.1:${stub.address().port}`
  // Real HTTP avoids Electron/CDP fulfill responses losing their HTTP status.
  await page.route('**/dsh-editor-plugins/marketplace.*', route =>
    route.continue({ url: stubOrigin + new URL(route.request().url()).pathname }))
  await page.locator('.shell').waitFor({ timeout: 90000 })
  report.transport = await page.evaluate(() => ({ url: location.href.split('?')[0], transport: typeof globalThis.__DSH_TRANSPORT__, fetch: String(globalThis.fetch).slice(0, 200) }))
  page.on('response', response => { if (response.url().includes('/marketplace.')) report.receipts.push({ response: response.status(), url: response.url() }) })
  page.on('requestfailed', request => { if (request.url().includes('/marketplace.')) report.receipts.push({ failure: request.failure(), url: request.url() }) })
  for (let i = 0; i < 5; i++) {
    const next = page.getByRole('button', { name: '继续', exact: true })
    if (!await next.isVisible().catch(() => false)) break
    await next.click()
  }
  const later = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await later.isVisible().catch(() => false)) await later.click()
  await page.locator('.native-settings-control button[aria-haspopup="dialog"]').click()
  await page.locator('.settings-dialog').getByRole('tab', { name: '插件', exact: true }).click()
  await page.getByTestId('plugins-tab-market').click()
  const panel = page.getByTestId('plugins-settings')
  const dialog = page.getByRole('dialog', { name: '安装插件', exact: true })
  const confirm = () => dialog.getByRole('button', { name: '确认安装', exact: true })
  const cancel = () => dialog.getByRole('button', { name: '取消', exact: true })
  async function begin(spec, verdict = 'ready') {
    inspectResult = inspection(verdict, spec.split('/').at(-1))
    await page.getByTestId('plugins-search').fill(spec)
    await page.getByTestId('plugins-market-submit').click()
    await dialog.waitFor()
  }
  async function checked() { await until(async () => await confirm().isEnabled()) }

  assert.equal(await panel.locator('input').count(), 1)
  assert.equal(await panel.getByRole('button', { name: '检查', exact: true }).count(), 0)
  inspectGate = gate()
  await begin('acme/cancelled')
  await until(() => count('marketplace.inspect') === 1)
  assert.equal(await confirm().isEnabled(), false)
  assert.equal(count('marketplace.install'), 0)
  await cancel().click()
  await dialog.waitFor({ state: 'hidden' })
  const cancelledGate = inspectGate
  inspectGate = null
  await begin('acme/current', 'warn')
  await checked()
  cancelledGate.release()
  await delay(150)
  assert.match(await dialog.innerText(), /current/)
  assert.doesNotMatch(await dialog.innerText(), /cancelled 检查结果/)
  assert.equal(count('marketplace.install'), 0)
  await page.screenshot({ path: resolve(output, 'confirmation.png') })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  passed('automatic check, cancel, Escape and late-response isolation without installation')

  await begin('acme/blocked', 'blocked')
  await dialog.getByTestId('plugins-inspect').waitFor()
  assert.equal(await confirm().isEnabled(), false)
  await cancel().click()
  await dialog.waitFor({ state: 'hidden' })
  passed('blocked report prevents confirmation')

  inspectResult = { ok: false, error: { code: 'network', message: '验收检查失败', details: {} } }
  await page.getByTestId('plugins-search').fill('acme/retry')
  await page.getByTestId('plugins-market-submit').click()
  await dialog.getByRole('alert').waitFor()
  assert.equal(await confirm().isEnabled(), false)
  inspectResult = inspection('ready', 'retry')
  await dialog.getByRole('button', { name: /重试|重新检查/ }).click()
  await checked()
  passed('failed inspection stays in dialog and retry recovers')

  installFails = true
  await confirm().click()
  await dialog.getByText('验收安装失败', { exact: true }).waitFor()
  await checked()
  installFails = false
  installGate = gate()
  const before = count('marketplace.install')
  await confirm().evaluate(button => { button.click(); button.click() })
  await until(() => count('marketplace.install') > before)
  assert.equal(count('marketplace.install'), before + 1)
  await page.keyboard.press('Escape')
  assert.equal(await dialog.isVisible(), true)
  assert.equal(await cancel().isEnabled(), false)
  installGate.release(); installGate = null
  await dialog.waitFor({ state: 'hidden' })
  await panel.getByText(/已安装 fixture-plugin/).waitFor()
  passed('install failure is visible; confirmation installs once and success refreshes inventory')

  await page.getByTestId('plugins-tab-market').click()
  await page.getByTestId('plugins-search').fill('订阅')
  await page.getByTestId('plugins-market-submit').click()
  await until(() => count('marketplace.search') === 1)
  assert.equal(report.receipts.filter(item => item.method === 'marketplace.search').at(-1).payload.query, '订阅')
  const link = panel.getByRole('link', { name: '在 GitHub 打开', exact: true })
  await link.click()
  await until(async () => (await app.evaluate(() => globalThis.__pluginExternalUrls)).length === 1)
  assert.deepEqual(await app.evaluate(() => globalThis.__pluginExternalUrls), [listing.url])
  passed('marketplace GitHub click reaches OS browser API through real Electron IPC')
  inspectResult = inspection('warn', 'card-plugin')
  await panel.locator('article').getByRole('button', { name: '安装', exact: true }).click()
  await dialog.waitFor()
  await checked()
  assert.equal(report.receipts.filter(item => item.method === 'marketplace.inspect').at(-1).payload.spec, listing.spec)
  await cancel().click()
  await dialog.waitFor({ state: 'hidden' })
  passed('marketplace card uses its own repository for the same confirmation flow')
  for (const [input, normalized] of [
    ['https://github.com/acme/url-plugin', 'github:acme/url-plugin'],
    ['github:acme/ref-plugin#v1.0.0', 'github:acme/ref-plugin#v1.0.0'],
  ]) {
    const previous = count('marketplace.inspect')
    inspectResult = inspection('ready')
    await page.getByTestId('plugins-search').fill(input)
    assert.equal(await page.getByTestId('plugins-market-submit').innerText(), '安装')
    assert.equal(count('marketplace.inspect'), previous)
    await page.getByTestId('plugins-search').press('Enter')
    await dialog.waitFor()
    await checked()
    assert.equal(report.receipts.filter(item => item.method === 'marketplace.inspect').at(-1).payload.spec, normalized)
    await cancel().click()
    await dialog.waitFor({ state: 'hidden' })
  }
  await page.getByTestId('plugins-search').fill('订阅')
  assert.equal(await page.getByTestId('plugins-market-submit').innerText(), '搜索')
  const fieldBox = await page.getByTestId('plugins-search').boundingBox()
  const submitBox = await page.getByTestId('plugins-market-submit').boundingBox()
  assert(Math.abs(fieldBox.y - submitBox.y) < 4, 'input and submit button share one row')
  await page.screenshot({ path: resolve(output, 'market.png') })
  passed('one input handles keyword search, GitHub URL and ref via Enter without requests on typing')
  assert.deepEqual(report.errors, [])
  report.ok = true
} catch (error) {
  report.error = String(error)
  process.exitCode = 1
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
    report.visibleText = await page.locator('body').innerText().catch(() => '')
  }
} finally {
  inspectGate?.release(); installGate?.release()
  if (app) {
    const pid = app.process().pid
    const closed = await Promise.race([app.close().then(() => true, () => false), delay(10000).then(() => false)])
    if (!closed && pid) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  }
  if (stub) { stub.closeAllConnections(); await new Promise(done => stub.close(done)) }
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, visibleText: undefined, output }, null, 2))
}
