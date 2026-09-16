/**
 * First-party writing-preset toggle acceptance. Isolated HOME, real host:
 * settings「写作模式」disable 小说创作 removes its roster dir without restart,
 * the new-conversation picker drops it, an existing novel session keeps
 * working, and re-enabling redeploys the dir with an app-owned marker.
 *
 * Fixtures: `.dev/preset-toggle-*`. Evidence: `e2e/out/preset-toggle`.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'

const root = resolve(import.meta.dirname, '..')
const nonce = new Date().toISOString().replace(/[:.]/g, '-')
const devRoot = resolve(root, '.dev')
const home = resolve(devRoot, `preset-toggle-${nonce}`)
const projectsRoot = resolve(devRoot, `preset-toggle-${nonce}-projects`)
const output = resolve(root, 'e2e/out/preset-toggle', nonce)
const template = resolve(devRoot, 'desktop-profile-template')
const runtime = resolve(devRoot, 'desktop-dsh-runtime')
const book = 'preset-toggle-workspace'

for (const target of [home, projectsRoot]) {
  if (!target.startsWith(`${devRoot}${sep}`)) throw new Error(`unsafe test path: ${target}`)
}
if (!output.startsWith(`${resolve(root, 'e2e', 'out')}${sep}`)) throw new Error(`unsafe output path: ${output}`)

await mkdir(output, { recursive: true })
await deployProfile(home, template, resolve(runtime, 'node_modules'))
const report = { checks: [], home, ok: false }
let child, browser, page
const env = {
  ...process.env,
  DSH_HOME: home,
  DSH_TELEMETRY_DISABLED: '1',
  DSH_EDITOR_PROJECTS_ROOT: projectsRoot,
  SSH_CONNECTION: process.env.SSH_CONNECTION || 'dsh-editor-preset-toggle',
}
for (const key of ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DSH_EDITOR_CUSTOM_API_KEY']) delete env[key]

async function start() {
  child = spawn(process.execPath, [resolve(runtime, 'lib/bin.js'), '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((done, reject) => {
    let log = ''
    const timer = setTimeout(() => reject(new Error('host startup timeout')), 60000)
    const inspect = chunk => {
      log += String(chunk)
      const url = log.match(/https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/)
      if (url) { clearTimeout(timer); done(new URL(url[0])) }
    }
    child.stdout.on('data', inspect); child.stderr.on('data', inspect)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`host exited ${code}`)) })
  })
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const exited = new Promise(done => child.once('exit', done))
  child.kill('SIGTERM')
  await exited
}
async function rpc(method, payload = {}) {
  const result = await page.evaluate(async ({ method, payload }) => {
    const res = await fetch(`/dsh-editor-plugins/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }) })
    return (await res.json()).result
  }, { method, payload })
  assert.equal(result?.ok, true, JSON.stringify(result))
  return result.value
}
async function exists(target) { return stat(target).then(() => true, () => false) }
async function delay(ms) { return new Promise(done => setTimeout(done, ms)) }
async function dismissNativeOnboarding() {
  const continueNotice = page.getByRole('button', { name: '继续', exact: true })
  for (let step = 0; step < 5; step += 1) {
    if (!(await continueNotice.isVisible({ timeout: 1_000 }).catch(() => false))) break
    await continueNotice.click()
    await delay(250)
  }
  const configureLater = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await configureLater.isVisible({ timeout: 2_000 }).catch(() => false)) await configureLater.click()
}
async function ensureAssistantOpen() {
  const assistant = page.locator('aside.chat')
  if (await assistant.isVisible().catch(() => false)) return assistant
  const launcher = page.getByRole('button', { name: '打开写作搭档' })
  if (await launcher.isVisible().catch(() => false)) await launcher.click()
  else await page.getByRole('button', { name: '搭档', exact: true }).click()
  await assistant.waitFor({ state: 'visible', timeout: 30_000 })
  return assistant
}
async function openPicker() {
  const assistant = await ensureAssistantOpen()
  const neu = assistant.getByRole('button', { name: '新对话' })
  await neu.click()
  const discard = page.getByRole('button', { name: '放弃并继续', exact: true })
  if (await discard.isVisible({ timeout: 2_000 }).catch(() => false)) await discard.click()
  const picker = page.getByRole('dialog', { name: '选择对话模式' })
  await picker.waitFor({ state: 'visible', timeout: 15_000 })
  return picker
}
async function pickerLabels() {
  const picker = await openPicker()
  const labels = (await picker.getByRole('radio').allTextContents()).map(text => text.replace(/\s+/g, ' ').trim())
  await page.keyboard.press('Escape')
  await picker.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined)
  return labels
}

let lastBoundSessionId = ''
function capturePresetSelect(request) {
  try {
    const body = request.postDataJSON()
    if (!body || typeof body !== 'object') return
    if (!/agentPreset|agent-preset/i.test(String(body.method || '')) && !/agentPreset|agent-preset/i.test(request.url())) return
    const agentId = body?.payload?.args?.agentId ?? body?.args?.agentId
    if (typeof agentId === 'string' && agentId.trim()) lastBoundSessionId = agentId.trim()
  } catch { /* ignore non-JSON posts */ }
}

try {
  const url = await start()
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  page.setDefaultTimeout(20_000)
  page.on('request', capturePresetSelect)
  await page.goto(url.href)
  await page.locator('.shell').waitFor({ timeout: 45000 })
  await dismissNativeOnboarding()

  const inventory = await rpc('presets.list')
  assert.deepEqual(inventory.presets.map(item => item.id), ['dsh-editor-writing', 'dsh-editor-article', 'dsh-editor-novel', 'dsh-editor-technical'])
  assert.equal(inventory.presets[0].locked, true)
  assert(inventory.presets.every(item => item.enabled))
  report.checks.push('presets.list exposes locked core plus three enabled first-party presets')
  const coreBlocked = await page.evaluate(async () => {
    const res = await fetch('/dsh-editor-plugins/presets.setEnabled', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'presets.setEnabled', payload: { id: 'dsh-editor-writing', enabled: false } }) })
    return (await res.json()).result
  })
  assert.equal(coreBlocked?.ok, false)
  assert.equal(coreBlocked?.error?.code, 'forbidden')
  report.checks.push('core dsh-editor-writing cannot be disabled')

  await page.getByRole('button', { name: '新建', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '新建作品' })
  await dialog.getByLabel('作品名称').fill(book)
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await page.locator('.tree').waitFor({ timeout: 30000 })

  const before = await pickerLabels()
  for (const label of ['通用写作', '小说创作', '文章与自媒体', '技术文档']) {
    assert(before.some(item => item.includes(label)), `picker missing ${label}: ${JSON.stringify(before)}`)
  }
  report.checks.push('default picker lists all four writing modes')

  /* 先建一个小说会话，证明停用后它仍可打开。 */
  const picker = await openPicker()
  await picker.getByRole('radio', { name: /小说创作/ }).click()
  await picker.getByRole('button', { name: '开始对话' }).click()
  await picker.waitFor({ state: 'hidden', timeout: 20_000 })
  await page.getByRole('textbox', { name: '输入消息' }).waitFor({ state: 'visible', timeout: 15_000 })
  const novelSessionId = lastBoundSessionId
  assert(novelSessionId, 'novel session binding was not captured')

  const receipt = await rpc('presets.setEnabled', { id: 'dsh-editor-novel', enabled: false })
  assert.equal(receipt.restartRequired, false)
  assert(!(await exists(resolve(home, '.agent-presets', 'dsh-editor-novel'))), 'disabled preset dir still deployed')
  const state = JSON.parse(await readFile(resolve(home, 'dsh-plugins.json'), 'utf8'))
  assert.equal(state.presets?.['dsh-editor-novel'], false)
  for (const id of ['dsh-editor', 'dsh-editor-writing', 'dsh-editor-article', 'dsh-editor-technical']) {
    assert(await exists(resolve(home, '.agent-presets', id)), `${id} should stay deployed`)
  }
  report.checks.push('disabling 小说创作 removes the roster dir and persists state without restart')

  const after = await pickerLabels()
  assert(!after.some(item => item.includes('小说创作')), `disabled preset still in picker: ${JSON.stringify(after)}`)
  for (const label of ['通用写作', '文章与自媒体', '技术文档']) {
    assert(after.some(item => item.includes(label)), `picker lost ${label}: ${JSON.stringify(after)}`)
  }
  report.checks.push('picker drops the disabled mode without restart')

  const assistant = await ensureAssistantOpen()
  const trigger = assistant.getByRole('combobox', { name: '切换对话' })
  await trigger.click()
  const option = page.locator(`[role="option"][data-value="v:${novelSessionId}"]`)
  await option.waitFor({ state: 'visible', timeout: 10_000 })
  await option.click()
  await page.getByRole('textbox', { name: '输入消息' }).waitFor({ state: 'visible', timeout: 15_000 })
  report.checks.push('existing novel session still opens after its preset is disabled')

  await rpc('presets.setEnabled', { id: 'dsh-editor-novel', enabled: true })
  const marker = JSON.parse(await readFile(resolve(home, '.agent-presets', 'dsh-editor-novel', '.dsh-editor-owner.json'), 'utf8'))
  assert.deepEqual(marker, { app: 'dsh-editor', schema: 1 })
  const restored = await pickerLabels()
  assert(restored.some(item => item.includes('小说创作')), `re-enabled preset missing: ${JSON.stringify(restored)}`)
  report.checks.push('re-enabling redeploys the preset with an app-owned marker and restores the picker row')

  const leftovers = (await readdir(resolve(home, '.agent-presets'))).filter(name => name.includes('.stage-') || name.includes('.backup-'))
  assert.equal(leftovers.length, 0, `stage/backup leftovers: ${leftovers.join(',')}`)
  report.ok = true
} catch (error) {
  report.error = String(error)
  process.exitCode = 1
} finally {
  await browser?.close()
  await stop()
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
