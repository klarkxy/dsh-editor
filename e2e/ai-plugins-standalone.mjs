/** Independent npm-tarball acceptance on the native web profile, without Editor packages. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile, mkdtemp, copyFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const stamp = String(Date.now())
const recordTitle = '独立安装记忆 ' + stamp
const home = process.env.AI_STANDALONE_HOME ? resolve(process.env.AI_STANDALONE_HOME) : resolve(root, '.dev', 'ai-standalone-' + stamp)
assert.ok(relative(resolve(root, '.dev'), home) && !relative(resolve(root, '.dev'), home).startsWith('..'), 'isolated home must be under .dev')
const output = resolve(root, 'e2e/out/ai-standalone', stamp)
const workspace = resolve(home, 'workspace')
await mkdir(workspace, { recursive: true })
const cli = resolve(root, '.dev/desktop-dsh-runtime-0.1.7-rc.2/lib/bin.js')
const staging = await mkdtemp(resolve(tmpdir(), 'dsh-ai-pack-'))
const ids = ['current-title', 'mood', 'recap', 'memory', 'self-improvement', 'model-center']
const report = { ok: false, home, output, checks: [], errors: [], calls: 0 }
await mkdir(output, { recursive: true })
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_AI_TEST_KEY: 'local-fixture', SSH_CONNECTION: 'ai-standalone-acceptance' }
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_SECRET|ELECTRON_RUN_AS_NODE/.test(key)) delete env[key]
let browser, page, child, logs = []
const delay = ms => new Promise(done => setTimeout(done, ms))
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw || '{}')
  report.calls++
  const system = (body.messages ?? []).filter(m => m.role === 'system').map(m => String(m.content)).join(' ')
  const answer = system.includes('Name the current task') ? JSON.stringify({ type: 'discuss', summary: '独立插件' }) : '独立宿主测试回复。'
  const common = { id: 'local-' + report.calls, created: 1, model: 'fixture' }
  const usage = { prompt_tokens: 12, completion_tokens: 12, total_tokens: 24 }
  if (!body.stream) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ...common, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }], usage }))
  } else {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const delta of [{ role: 'assistant', content: answer }, {}]) res.write('data: ' + JSON.stringify({ ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: delta.content ? null : 'stop' }], ...(!delta.content ? { usage } : {}) }) + '\n\n')
    res.end('data: [DONE]\n\n')
  }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
async function stopHost() {
  await page?.close().catch(() => {})
  if (child?.exitCode === null) {
    child.kill()
    await Promise.race([new Promise(done => child.once('exit', done)), delay(2000)])
    if (child.exitCode === null && process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  }
  child?.stdout?.destroy(); child?.stderr?.destroy()
}
function command(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 })
  if (result.status !== 0) throw new Error('DSH command failed: ' + args.join(' ') + '\n' + result.stderr + '\n' + result.stdout)
  return result.stdout
}
async function boot(label) {
  logs = []
  child = spawn(process.execPath, [cli, '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const ready = new Promise((done, reject) => {
    const inspect = chunk => { logs.push(String(chunk)); const match = /https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/.exec(logs.join('')); if (match) done(match[0]) }
    child.stdout.on('data', inspect); child.stderr.on('data', inspect)
    child.once('error', reject); child.once('exit', code => reject(new Error('Host exited ' + code)))
  })
  let timer
  const url = await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Host startup timeout')), 60000) })]).finally(() => clearTimeout(timer))
  page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, locale: 'zh-CN' })
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '设置', exact: true }).waitFor()
  await page.getByRole('button', { name: '继续', exact: true }).waitFor({ timeout: 5000 }).catch(() => {})
  for (let i = 0; i < 5; i++) {
    const next = page.getByRole('button', { name: '继续', exact: true })
    if (!await next.isVisible() || !await next.isEnabled()) break
    await next.click(); await delay(500)
  }
  const later = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await later.isVisible()) await later.click()
  await page.screenshot({ path: resolve(output, label + '.png'), fullPage: true })
}
async function settings() {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  await dialog.waitFor(); return dialog
}
try {
  if (!process.env.AI_STANDALONE_HOME) {
    for (const id of ['ai-services', ...ids]) {
      console.log('install:' + id)
      const packageManifest = JSON.parse(await readFile(resolve(root, 'packages', 'dsh-' + id, 'package.json'), 'utf8'))
      const archiveName = packageManifest.name.replace(/^@/, '').replaceAll('/', '-') + '-' + packageManifest.version + '.tgz'
      const archive = resolve(root, '.pack', archiveName)
      const staged = resolve(staging, archiveName)
      await copyFile(archive, staged)
      command(['plugin', '--profile', 'web', 'add', 'file:' + staged.replaceAll('\\', '/')])
      {
        // Unpublished workspace dependency: resolve this candidate from its exact archive.
        const localManifest = resolve(home, 'profiles/web/package.json')
        const value = JSON.parse(await readFile(localManifest, 'utf8'))
        value.pnpm = { ...value.pnpm, overrides: { ...value.pnpm?.overrides, ['@klarkxy/dsh-' + id]: 'file:' + staged.replaceAll('\\', '/') } }
        await writeFile(localManifest, JSON.stringify(value, null, 2) + '\n')
      }
    }
    report.checks.push('seven current tarballs installed through native plugin CLI in a fresh home')
  }
  const profileFile = resolve(home, 'profiles/web/package.json')
  const manifest = JSON.parse(await readFile(profileFile, 'utf8'))
  assert.ok(!Object.keys(manifest.dependencies).some(name => name.startsWith('dsh-editor')))
  report.checks.push('native web profile has no private Editor dependency')
  const patch = resolve(home, 'profiles/web/cordis.patch.yml')
  const model = [
    '- id: llm-deepseek', '  disabled: true', '- id: llm-pi-ai', '  config:', '    providers:', '      local-test:',
    '        displayName: Local acceptance', '        api: openai-completions', '        baseURL: http://127.0.0.1:' + server.address().port + '/v1',
    '        apiKeyEnv: DSH_AI_TEST_KEY', '        models:', '          - id: fixture', '            name: Fixture',
    '            contextWindow: 32768', '            maxTokens: 4096', '- id: agent-default-model', '  config:', '    provider: local-test', '    model: fixture',
  ].join('\n')
  await writeFile(patch, model + '\n')
  browser = await chromium.launch({ headless: true })
  await boot('00-default-on')
  let entries = await page.evaluate(() => globalThis.__DSH_BOOT__?.entries?.map(row => row.id) ?? [])
  for (const id of ids) assert.ok(entries.includes('@klarkxy/dsh-' + id))
  assert.equal(report.calls, 0)
  report.checks.push('all six independently installed features start enabled without inference before a task')
  let dialog = await settings()
  for (const label of ['记忆', '模型中心']) {
    await dialog.getByRole('button', { name: label, exact: true }).click()
    await page.screenshot({ path: resolve(output, label + '.png'), fullPage: true })
  }
  for (const label of ['当前标题', '需求澄清', '回顾', '自我改进']) {
    assert.equal(await dialog.getByRole('button', { name: label, exact: true }).count(), 0, label + ' must not keep a settings entry')
  }
  const center = dialog.getByTestId('model-center')
  await center.getByRole('tab', { name: '模型配置', exact: true }).click()
  await center.getByRole('combobox', { name: '对话 模型', exact: true }).selectOption({ label: 'Local acceptance / Fixture' })
  await center.getByRole('button', { name: '保存', exact: true }).click()
  await center.getByText('已保存。', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  const composer = page.locator('textarea:not([disabled]),[contenteditable="true"]').first()
  const choose = page.getByRole('button', { name: '选择工作区', exact: true })
  if (!await composer.isVisible()) {
    await choose.click()
    const picker = page.getByRole('dialog', { name: '选择工作区目录', exact: true })
    await picker.getByRole('button', { name: '编辑路径', exact: true }).click()
    const pathInput = picker.getByRole('textbox', { name: '编辑路径', exact: true })
    await pathInput.fill(workspace)
    await pathInput.press('Enter')
    await pathInput.waitFor({ state: 'detached' })
    await picker.getByRole('button', { name: '打开', exact: true }).click()
    await picker.waitFor({ state: 'detached' })
  }
  await composer.fill('解释什么是光合作用')
  await composer.press('Enter')
  await page.getByText('独立宿主测试回复。', { exact: true }).first().waitFor()
  await page.getByText(/独立插件/).first().waitFor()
  report.checks.push('current title owns the native title provider in the standalone host')
  dialog = await settings()
  await dialog.getByRole('button', { name: '记忆', exact: true }).click()
  const memory = dialog.getByTestId('memory-chat')
  await memory.locator('summary').click()
  await memory.getByLabel('标题', { exact: true }).fill(recordTitle)
  await memory.getByLabel('内容', { exact: true }).fill('保留作者原有剧情。')
  await memory.getByRole('button', { name: '添加', exact: true }).click()
  await memory.locator('.dsh-memory-list').getByText(recordTitle, { exact: true }).waitFor()
  report.checks.push('native settings supplies selected session for record management and role configuration')
  await page.screenshot({ path: resolve(output, '02-native-memory.png'), fullPage: true })
  await stopHost()
  await boot('03-restarted')
  await page.getByText(/独立插件|解释什么是光合作用/).first().click()
  dialog = await settings()
  await dialog.getByRole('button', { name: '记忆', exact: true }).click()
  const restored = dialog.getByTestId('memory-chat')
  await restored.locator('summary').click()
  await restored.locator('.dsh-memory-list').getByText(recordTitle, { exact: true }).waitFor()
  report.checks.push('accepted memory survives native host restart')
  assert.equal(report.errors.length, 0, report.errors.join('\n'))
  report.ok = true
} catch (error) {
  report.failure = String(error)
  if (page) {
    await writeFile(resolve(output, 'failure-dom.txt'), await page.locator('body').innerText()).catch(() => {})
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {})
  }
  process.exitCode = 1
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  await writeFile(resolve(output, 'host.log'), logs.join('').replace(/\?token=[A-Za-z0-9._~-]+/g, '?token=<redacted>'))
  await stopHost(); await browser?.close().catch(() => {})
  server.closeAllConnections()
  await new Promise(done => server.close(done))
  console.log(JSON.stringify(report))
}
