/** Real DSH shell acceptance in an isolated home; inference uses a local deterministic provider. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'

const root = resolve(import.meta.dirname, '..')
const runId = String(Date.now())
const home = resolve(root, '.dev', 'writing-shortcuts-' + runId)
const output = resolve(root, 'e2e/out/writing-shortcuts', runId)
const runtime = resolve(root, '.dev/desktop-dsh-runtime-0.1.7-rc.2')
const report = { ok: false, checks: [], calls: [], errors: [], home, output }
await mkdir(output, { recursive: true })
const delay = ms => new Promise(done => setTimeout(done, ms))
let browser, child, page
const logs = []
const server = createServer(async (req, res) => {
  if (req.url?.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'fixture', object: 'model', owned_by: 'local-test' }] }))
    return
  }
  let raw = ''
  for await (const chunk of req) raw += chunk
  let request
  try { request = JSON.parse(raw) } catch { res.writeHead(400); res.end(); return }
  const messages = request.messages ?? []
  const system = messages.filter(m => m.role === 'system' || m.role === 'developer').map(m => typeof m.content === 'string' ? m.content : (m.content ?? []).map(block => block.text ?? '').join('\n')).join('\n')
  const input = messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : (m.content ?? []).map(block => block.text ?? '').join('\n')).join('\n')
  let kind = 'chat'
  let answer = '已收到。测试回复已完成。'
  if (system.includes('文稿行内补全引擎')) { kind = 'completion'; answer = '雨'.repeat(300) }
  else if (system.includes('你是小说编辑')) { kind = 'rewrite'; answer = '她将旧信收进抽屉，轻轻合上。' }
  report.calls.push({ kind, model: request.model, effort: request.reasoning_effort, at: Date.now(), input: input.slice(-4000),  })
  const completion = { id: 'local-' + report.calls.length, object: 'chat.completion', created: Math.floor(Date.now()/1000), model: 'fixture', choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }], usage: { prompt_tokens: 32, completion_tokens: 16, total_tokens: 48 } }
  if (!request.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(completion)); return }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const event = (delta, finish_reason = null, usage) => ({ id: completion.id, object: 'chat.completion.chunk', created: completion.created, model: 'fixture', choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })
  res.write('data: ' + JSON.stringify(event({ role: 'assistant', content: answer })) + '\n\n')
  res.write('data: ' + JSON.stringify(event({}, 'stop', completion.usage)) + '\n\n')
  res.end('data: [DONE]\n\n')
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const providerPort = server.address().port
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_EDITOR_PROJECTS_ROOT: resolve(home, 'projects'), SSH_CONNECTION: 'dsh-ai-plugins-acceptance' }
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_SECRET|ELECTRON_RUN_AS_NODE/.test(key)) delete env[key]
env.DSH_AI_TEST_KEY = 'local-fixture'
console.log('Preparing isolated profile')
await deployProfile(home, resolve(root, '.dev/desktop-profile-template'), resolve(runtime, 'node_modules'))
const patch = resolve(home, 'profiles/dsh-editor/cordis.patch.yml')
if ((await readFile(patch, 'utf8')).trim() === '[]') await writeFile(patch, '')
await appendFile(patch, [
  '\n- id: llm-deepseek', '  disabled: true',
  '- id: llm-pi-ai', '  config:', '    providers:', '      local-test:', '        displayName: Local acceptance',
  '        api: openai-completions', '        baseURL: http://127.0.0.1:' + providerPort + '/v1',
  '        apiKeyEnv: DSH_AI_TEST_KEY', '        models:', '          - id: fixture', '            name: Fixture',
  '            contextWindow: 32768', '            maxTokens: 4096', '            reasoningEfforts:', '              off: null', '              low: low', '              high: high', '          - id: fixture-legacy', '            name: Legacy', '            contextWindow: 32768', '            maxTokens: 4096', '            reasoningEfforts:', '              off: null', '              low: low', '              high: high', '          - id: fixture-new', '            name: New', '            contextWindow: 32768', '            maxTokens: 4096', '            reasoningEfforts:', '              off: null', '              low: low', '              high: high',
  '- id: agent-default-model', '  config:', '    provider: local-test', '    model: fixture', '',
].join('\n'))

async function stop() {
  await browser?.close().catch(() => {})
  if (child && child.exitCode === null) {
    child.kill()
    await Promise.race([new Promise(done => child.once('exit', done)), delay(3000)])
    if (child.exitCode === null && process.platform === 'win32') {
      await new Promise(done => { const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.once('exit', done); killer.once('error', done) })
    }
  }
  await new Promise(done => server.close(done))
}

async function screenshot(name) { await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true }) }
async function openSettings(target = page) {
  await target.locator('.native-settings-control button[aria-haspopup="dialog"]').click()
  const dialog = target.getByRole('dialog', { name: '设置', exact: true })
  await dialog.waitFor()
  return dialog
}
await writeFile(resolve(home, 'settings.yaml'), 'ui-theme:\n  preference: light\ndsh-editor-writing:\n  completionModel:\n    provider: local-test\n    model: fixture-legacy\n  rewriteModel:\n    provider: local-test\n    model: fixture-legacy\n')
async function startHost() {
  child = spawn(process.execPath, [resolve(runtime, 'lib/bin.js'), '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((done, reject) => {
    let all = ''; const timer = setTimeout(() => reject(new Error('Host startup timeout')), 120000)
    const inspect = chunk => { const text=String(chunk); logs.push(text); all+=text; const match=/https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/.exec(all); if(match){clearTimeout(timer);done(match[0])} }
    child.stdout.on('data',inspect); child.stderr.on('data',inspect)
    child.once('error',reject); child.once('exit',code=>{clearTimeout(timer);reject(new Error('host exit '+code))})
  })
}
try {
  console.log('Starting isolated host')
  const url = await startHost()
  console.log('Checking settings and keyboard interaction')
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1024, height: 800 }, locale: 'zh-CN' })
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(url); await page.locator('.shell').waitFor({ timeout: 60000 })
  for (let n = 0; n < 5; n++) {
    const next = page.getByRole('button', { name: '继续', exact: true })
    if (!await next.isVisible()) break
    await next.click()
  }
  const later = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await later.isVisible()) await later.click()
  let dialog = await openSettings()
  const writing = () => dialog.getByRole('tab', { name: '写作', exact: true }).click()
  await writing()
  await dialog.getByRole('radio', { name: '停顿后提示', exact: true }).click()
  const delaySelect = () => dialog.getByRole('combobox', { name: '停顿时间', exact: true })
  assert.match(await delaySelect().innerText(), /1.5/)
  await delaySelect().click(); await page.getByRole('option', { name: '2 秒', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="停顿时间"][role="combobox"]')?.textContent?.includes('2 秒'))
  await screenshot('writing-settings')
  await dialog.getByRole('button', { name: '查看全部快捷键', exact: true }).click()
  assert.equal(await dialog.getByRole('tab', { name: '快捷键', exact: true }).getAttribute('aria-selected'), 'true')
  assert.match(await dialog.locator('.settings-content.is-active').innerText(), /Ctrl\+Enter/)
  assert.match(await dialog.locator('.settings-content.is-active').innerText(), /Ctrl\+Shift\+O/)
  await screenshot('shortcuts')
  assert.equal(await dialog.locator('.settings-pages').evaluate(el => el.scrollWidth > el.clientWidth + 1), false)
  await page.keyboard.press('Control+k')
  assert.equal(await page.locator('.palette-content').count(), 0, 'palette must not open over settings')
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' })
  await page.reload(); await page.locator('.shell').waitFor()
  dialog = await openSettings(); await writing()
  assert.match(await delaySelect().innerText(), /2 秒/)
  report.checks.push('delay defaults to 1.5 s, saves 2 s, survives reload, links to plugin-aware help without overflow')
  await dialog.getByRole('radio', { name: '仅手动', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-label="停顿时间"][role="combobox"]'))
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '新建', exact: true }).first().click()
  const project = page.getByRole('dialog', { name: '新建作品', exact: true })
  await project.getByLabel('作品名称').fill('补全快捷键验收')
  await project.getByRole('button', { name: '创建', exact: true }).click(); await project.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '写第一篇', exact: true }).click()
  const create = page.getByRole('dialog', { name: '新建文件', exact: true })
  await create.getByLabel('文件名称（无扩展名时按 .md 创建）').fill('001')
  await create.getByRole('button', { name: '创建', exact: true }).click(); await create.waitFor({ state: 'detached' })
  const editor = page.getByTestId('paper-editor').locator('.cm-content')
  const text = () => page.getByTestId('paper-editor').evaluate(el => el.__cmView.state.doc.toString())
  const calls = () => report.calls.filter(call => call.kind === 'completion')
  await editor.click(); await page.keyboard.insertText('夜雨落在窗沿。她把旧信放回抽屉。')
  await page.waitForTimeout(2300); assert.equal(calls().length, 0, 'manual mode never auto-runs')
  const before = await text()
  await page.keyboard.press('Control+Enter'); await page.locator('.cm-ghost').waitFor()
  assert.equal(await text(), before, 'generating does not change manuscript')
  await page.keyboard.press('Escape'); await page.locator('.cm-ghost').waitFor({ state: 'detached' })
  assert.equal(await text(), before, 'dismiss preserves manuscript')
  await page.keyboard.press('Control+Enter'); await page.locator('.cm-ghost').waitFor()
  await page.keyboard.press('Tab'); await page.locator('.cm-ghost').waitFor({ state: 'detached' })
  assert.equal(await text(), before + '雨'.repeat(240))
  await page.keyboard.press('Control+z'); assert.equal(await text(), before)
  report.checks.push('manual Ctrl+Enter, Escape dismissal, Tab acceptance and undo preserve author control')
  dialog = await openSettings(); await writing()
  await dialog.getByRole('radio', { name: '停顿后提示', exact: true }).click()
  assert.match(await delaySelect().innerText(), /2 秒/)
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' })
  await editor.click(); await page.keyboard.press('Control+End')
  const count = calls().length; const began = Date.now()
  await page.keyboard.insertText('窗外起了风。')
  await page.waitForTimeout(900); assert.equal(calls().length, count, 'configured 2-second pause must not fire early')
  await page.locator('.cm-ghost').waitFor()
  assert.ok(calls()[count].at - began >= 1900, 'configured delay reaches editor')
  report.checks.push('automatic completion observes configured 2-second delay')
  await page.keyboard.press('Escape')
  const beforeSearch = calls().length
  await page.keyboard.press('Control+f'); await page.keyboard.press('Control+Enter')
  await page.waitForTimeout(150); assert.equal(calls().length, beforeSearch)
  await page.keyboard.press('Escape')
  await editor.click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.insertText('待删除行')
  await page.keyboard.press('Control+Shift+k')
  assert.equal((await text()).includes('待删除行'), false, 'delete-line shortcut must not be stolen by palette')
  assert.equal(await page.locator('.palette-content').count(), 0)
  await page.keyboard.press('Control+k'); await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.palette-content').waitFor({ state: 'detached' })
  await editor.dispatchEvent('keydown', { key: 'k', ctrlKey: true, isComposing: true, keyCode: 229, bubbles: true })
  assert.equal(await page.locator('.palette-content').count(), 0)
  report.checks.push('find field, IME and Ctrl+Shift+K do not trigger unrelated commands')
  assert.equal(report.errors.length, 0, report.errors.join('\n')); report.ok = true
} catch (error) {
  report.failure = error.stack || String(error); process.exitCode = 1
  if (page) { await screenshot('failure').catch(() => {}); await writeFile(resolve(output, 'failure-dom.txt'), await page.locator('body').innerText()).catch(() => {}) }
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  await writeFile(resolve(output, 'host.log'), logs.join('').replace(/\?token=[A-Za-z0-9._~-]+/g, '?token=<redacted>'))
  await stop(); console.log(JSON.stringify({ ok: report.ok, checks: report.checks, output, failure: report.failure }))
}
