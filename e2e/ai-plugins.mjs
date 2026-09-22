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
const home = resolve(root, '.dev', 'ai-plugins-' + runId)
const output = resolve(root, 'e2e/out/ai-plugins', runId)
const runtime = resolve(root, '.dev/desktop-dsh-runtime')
const featureIds = ['current-title', 'mood', 'recap', 'memory', 'self-improvement', 'model-center']
const report = { ok: false, mode: process.env.AI_PLUGINS_E2E_MODE || 'enabled', checks: [], calls: [], errors: [], home, output }
await mkdir(output, { recursive: true })
const delay = ms => new Promise(done => setTimeout(done, ms))
let browser, child, page
const logs = []
report.console = []
report.httpFailures = []
report.toggles = []
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
  const system = messages.filter(m => m.role === 'system').map(m => String(m.content)).join('\n')
  const input = messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : (m.content ?? []).map(block => block.text ?? '').join('\n')).join('\n')
  let kind = 'chat'
  let answer = '已收到。测试回复已完成。'
  if (system.includes('Name the current task')) { kind = 'title'; answer = JSON.stringify({ type: 'discuss', summary: '插件验收' }) }
  else if (system.includes('确认写作任务需求')) { kind = 'mood'; answer = JSON.stringify({ goal: '优化章节表达', deliverables: ['修订建议'], inScope: ['表达'], outOfScope: ['剧情'], constraints: ['保留人物与事件'], acceptance: ['表达更清晰'], assumptions: [], questions: ['仅调整表达，还是也允许修改剧情？'] }) }
  else if (system.includes('Consolidate the supplied memory')) {
    kind = 'dream'
    const data = JSON.parse(input)
    const rows = (data.records ?? []).filter(record => record.status === 'active')
    answer = JSON.stringify({ proposals: rows.length ? [{
      title: '语言修订约定', content: '调整语言时保留已有剧情和人物动机。', kind: 'preference',
      sourceIds: rows.map(record => record.id), exceptions: [],
    }] : [] })
  }
  else if (system.includes('Extract at most one durable lesson')) { kind = 'lesson'; answer = JSON.stringify({ title: '保留剧情', content: '调整语言时保留已有剧情。', tags: ['writing'], exceptions: [] }) }
  else if (system.includes('根据给定事实写一段简短回顾')) { kind = 'recap'; answer = '已确认当前任务范围；下一步检查结果。' }
  report.calls.push({ kind, model: request.model, input: input.slice(-4000), hasMood: input.includes('@klarkxy/dsh-mood') || input.includes('优化章节表达'), hasMemory: input.includes('调整语言时保留已有剧情'), hasLesson: input.includes('保留剧情') })
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
await deployProfile(home, resolve(root, '.dev/desktop-profile-template'), resolve(runtime, 'node_modules'))
const patch = resolve(home, 'profiles/dsh-editor/cordis.patch.yml')
await appendFile(patch, [
  '\n- id: llm-deepseek', '  disabled: true',
  '- id: llm-pi-ai', '  config:', '    providers:', '      local-test:', '        displayName: Local acceptance',
  '        api: openai-completions', '        baseURL: http://127.0.0.1:' + providerPort + '/v1',
  '        apiKeyEnv: DSH_AI_TEST_KEY', '        models:', '          - id: fixture', '            name: Fixture',
  '            contextWindow: 32768', '            maxTokens: 4096',
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

async function waitForChecked(locator, checked) {
  const end = Date.now() + 30000
  while (Date.now() < end) {
    if (await locator.getAttribute('aria-checked') === String(checked)) return
    await delay(100)
  }
  throw new Error('Switch did not become ' + checked + ': ' + await locator.getAttribute('data-testid'))
}
async function setChecked(locator, checked) {
  if (await locator.getAttribute('aria-checked') === String(checked)) return
  await locator.click()
  await waitForChecked(locator, checked)
}
async function waitForCall(kind, after = 0) {
  const end = Date.now() + 30000
  while (Date.now() < end) {
    if (report.calls.slice(after).some(call => call.kind === kind)) return
    await delay(100)
  }
  throw new Error('No expected inference: ' + kind)
}
async function screenshot(name) { await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true }) }
async function openSettings(target = page) {
  await target.locator('.native-settings-control button[aria-haspopup="dialog"]').click()
  const dialog = target.getByRole('dialog', { name: '设置', exact: true })
  await dialog.waitFor()
  return dialog
}
try {
  child = spawn(process.execPath, [resolve(runtime, 'lib/bin.js'), '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const ready = new Promise((done, reject) => {
    let all = ''
    const inspect = chunk => { const text = String(chunk); logs.push(text); all += text; const match = /https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/.exec(all); if (match) done(match[0]) }
    child.stdout.on('data', inspect); child.stderr.on('data', inspect)
    child.once('error', reject); child.once('exit', code => reject(new Error('Host exited before ready: ' + code)))
  })
  let readyTimer
  const url = await Promise.race([ready, new Promise((_, reject) => { readyTimer = setTimeout(() => reject(new Error('Host startup timeout')), 60000) })]).finally(() => clearTimeout(readyTimer))
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  page = await context.newPage()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('console', msg => { if (['error','warning'].includes(msg.type())) report.console.push(msg.text()) })
  page.on('response', async response => {
    const pathname = new URL(response.url()).pathname
    if (response.status() >= 400) report.httpFailures.push({ url: pathname, status: response.status() })
    if (pathname === '/dsh-editor-plugins/entries.setEnabled') report.toggles.push(await response.json().catch(() => ({ error: 'body unavailable' })))
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.locator('.shell').waitFor({ timeout: 60000 })
  for (let step = 0; step < 5; step++) {
    const next = page.getByRole('button', { name: '继续', exact: true })
    if (!await next.isVisible()) break
    await next.click()
  }
  const later = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await later.isVisible()) await later.click()
  await screenshot('00-default-home')
  let dialog = await openSettings()
  await dialog.getByRole('tab', { name: '插件', exact: true }).click()
  await dialog.getByTestId('plugins-settings').waitFor()
  await dialog.locator('[role="switch"][data-testid$="-current-title"]').waitFor({ state: 'attached' })
  const initial = await dialog.locator('[role="switch"][data-testid]').evaluateAll(nodes => nodes.map(node => ({ id: node.getAttribute('data-testid'), checked: node.getAttribute('aria-checked'), disabled: node.hasAttribute('disabled') })))
  for (const id of featureIds) {
    const item = initial.find(item => item.id.endsWith('-' + id))
    assert.ok(item, 'Missing preinstalled feature switch: ' + id)
    assert.equal(item.checked, 'true', id + ' must start enabled')
  }
  const boot = await page.evaluate(() => globalThis.__DSH_BOOT__?.entries?.map(entry => entry.id) ?? [])
  for (const id of featureIds) assert.ok(boot.includes('@klarkxy/dsh-' + id), 'Enabled client missing: ' + id)
  assert.equal(report.calls.length, 0, 'Loading enabled feature surfaces without a task must not infer')
  report.checks.push('six independent features start enabled; loading their surfaces does not infer')
  await dialog.locator('[role="switch"][data-testid$="-model-center"]').scrollIntoViewIfNeeded()
  await screenshot('01-default-plugins')
  await dialog.getByRole('tab', { name: '模型', exact: true }).click()
  const defaultCenter = dialog.getByTestId('model-center')
  await defaultCenter.waitFor()
  await screenshot('02-default-model-center')
  report.checks.push('default Model Center reuses the native provider view without inference')
  if (report.mode !== 'disabled') {
    const center = dialog.getByTestId('model-center')
    assert.equal(await center.getByRole('tab', { name: '模型配置', exact: true }).getAttribute('aria-selected'), 'true')
    const commonModels = center.locator('fieldset[aria-label="常用功能"]')
    await commonModels.getByText('对话模型', { exact: true }).waitFor()
    await commonModels.getByText('正文补全', { exact: true }).waitFor()
    await commonModels.getByText('选区改写', { exact: true }).waitFor()
    assert.equal(await center.locator('details.model-center-secondary').getAttribute('open'), null, 'Other feature models must start collapsed')
    assert.equal(await center.locator('details.model-center-advanced').getAttribute('open'), null, 'Advanced model settings must start collapsed')
    const policyPanel = center.getByRole('tabpanel', { name: '模型配置', exact: true })
    assert.equal(await policyPanel.getByText('限额与超时', { exact: true }).count(), 0)
    await center.getByRole('tab', { name: '运行设置', exact: true }).click()
    const runtimePanel = center.getByRole('tabpanel', { name: '运行设置', exact: true })
    await runtimePanel.locator('fieldset[aria-label="限额与超时"]').waitFor()
    await runtimePanel.getByLabel('并发', { exact: true }).waitFor()
    await runtimePanel.getByLabel('超时（毫秒）', { exact: true }).waitFor()
    await runtimePanel.getByLabel('输入字符上限', { exact: true }).waitFor()
    await runtimePanel.getByLabel('输出 token 上限', { exact: true }).waitFor()
    await runtimePanel.getByLabel('失败重试次数', { exact: true }).waitFor()
    await screenshot('03-model-center-runtime')
    await center.getByRole('tab', { name: '供应商', exact: true }).click()
    const providerPanel = center.getByRole('tabpanel', { name: '供应商', exact: true })
    assert.equal(await providerPanel.getByText('对话模型', { exact: true }).count(), 0)
    assert.equal(await providerPanel.getByText('正文补全', { exact: true }).count(), 0)
    assert.equal(await providerPanel.getByText('选区改写', { exact: true }).count(), 0)
    await screenshot('03-model-center-providers')
    await center.getByRole('tab', { name: '模型配置', exact: true }).click()
    await center.getByText('高级设置', { exact: true }).click()
    const normal = center.getByRole('combobox', { name: '默认模型 会话模型', exact: true })
    await normal.selectOption({ label: 'Local acceptance / Fixture' })
    await center.getByRole('button', { name: '保存', exact: true }).click()
    await center.getByText('已保存。', { exact: true }).waitFor()
    await screenshot('04-model-center-policy')
    report.checks.push('model configuration opens first, groups chat/completion/rewrite, keeps runtime limits and providers separate, and saves the default preset')
    await dialog.getByRole('tab', { name: '插件', exact: true }).click()
    const modelToggle = dialog.locator('[role="switch"][data-testid$="-model-center"]')
    await setChecked(modelToggle, false)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.shell').waitFor()
    dialog = await openSettings()
    await dialog.getByRole('tab', { name: '模型', exact: true }).click()
    await center.waitFor({ state: 'detached' })
    assert.equal(report.calls.length, 0, 'Model settings must not infer')
    report.checks.push('disabling model center restores native settings without inference')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: '新建', exact: true }).first().click()
    const project = page.getByRole('dialog', { name: '新建作品', exact: true })
    await project.getByLabel('作品名称').fill('插件验收')
    await project.getByRole('button', { name: '创建', exact: true }).click()
    await project.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: '写第一篇', exact: true }).click()
    const createFile = page.getByRole('dialog', { name: '新建文件', exact: true })
    await createFile.getByLabel('文件名称（无扩展名时按 .md 创建）').fill('001')
    await createFile.getByRole('button', { name: '创建', exact: true }).click()
    const manuscript = page.getByTestId('paper-editor').locator('.cm-content')
    await manuscript.click()
    await page.keyboard.insertText('夜雨落在窗沿。她把旧信放回抽屉。')
    await page.keyboard.press('Control+s')
    await page.getByTestId('paper-save-state').filter({ hasText: '已保存' }).waitFor()
    const launcher = page.getByRole('button', { name: '打开写作搭档', exact: true })
    if (await launcher.isVisible()) await launcher.click()
    await page.locator('aside.chat').waitFor()
    dialog = await openSettings()
    await dialog.getByRole('tab', { name: '插件', exact: true }).click()
    for (const id of ['current-title', 'memory', 'self-improvement', 'recap', 'mood']) {
      report.stage = 'ensure-enabled:' + id
      console.log(report.stage)
      const toggle = dialog.locator('[role="switch"][data-testid$="-' + id + '"]')
      await setChecked(toggle, true)
    }
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.shell').waitFor()
    const resumeProject = page.locator('.home-recent').getByRole('button', { name: /插件验收/ }).first()
    await Promise.race([page.getByTestId('paper-editor').waitFor(), resumeProject.waitFor()])
    if (await resumeProject.isVisible()) await resumeProject.click()
    await page.getByTestId('paper-editor').waitFor()
    if (await launcher.isVisible()) await launcher.click()
    const composer = page.getByRole('textbox', { name: '输入消息', exact: true })
    assert.equal(await page.getByTestId('memory-chat').count(), 0, 'Memory management must not render in chat')
    assert.equal(await page.getByTestId('self-improvement-chat').count(), 0, 'Self-improvement management must not render in chat')
    assert.equal(await page.locator('.dsh-recap-card').count(), 0, 'Recap controls must not render in chat')
    await screenshot('05-chat-background-features-hidden')
    report.checks.push('background Memory, self-improvement and recap expose no chat UI')
    await composer.fill('解释什么是光合作用')
    await composer.press('Enter')
    await page.getByText('已收到。测试回复已完成。', { exact: true }).first().waitFor()
    await waitForCall('title')
    dialog = await openSettings()
    await dialog.getByRole('tab', { name: '当前标题', exact: true }).click()
    const titlePanel = dialog.getByTestId('current-title-settings')
    await titlePanel.getByText(/插件验收/).waitFor()
    await titlePanel.getByRole('radio', { name: 'English', exact: true }).click()
    await titlePanel.getByText('已保存。', { exact: true }).waitFor()
    assert.equal(await titlePanel.getByRole('radio', { name: 'English', exact: true }).isChecked(), true)
    await titlePanel.getByRole('button', { name: '重新生成', exact: true }).click()
    await screenshot('05-current-title')
    report.checks.push('current title native ownership, generation, locale save and explicit refresh')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    dialog = await openSettings()
    await dialog.getByRole('tab', { name: '记忆', exact: true }).click()
    const memorySettings = dialog.getByTestId('memory-settings')
    await memorySettings.getByLabel('空闲间隔（分钟）', { exact: true }).fill('17')
    const other = await page.context().newPage()
    await other.goto(page.url(), { waitUntil: 'domcontentloaded' })
    await other.locator('.shell').waitFor()
    const otherDialog = await openSettings(other)
    await otherDialog.getByRole('tab', { name: '记忆', exact: true }).click()
    const otherSettings = otherDialog.getByTestId('memory-settings')
    await otherSettings.getByRole('switch', { name: '关闭记忆注入', exact: true }).click()
    await otherSettings.getByText('已保存。', { exact: true }).waitFor()
    await page.bringToFront()
    await delay(300)
    await memorySettings.getByRole('button', { name: '保存', exact: true }).click()
    await memorySettings.getByRole('alert').filter({ hasText: '记忆设置已更新' }).waitFor()
    await memorySettings.getByRole('switch', { name: '启用记忆注入', exact: true }).click()
    await memorySettings.getByText('已保存。', { exact: true }).waitFor()
    await other.close()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    report.checks.push('two browser views preserve Memory settings revision conflicts without re-enabling another view\'s choice')
    dialog = await openSettings()
    await dialog.getByRole('tab', { name: '记忆', exact: true }).click()
    const memory = dialog.getByTestId('memory-chat')
    await memory.waitFor()
    await memory.locator('summary').click()
    await memory.getByLabel('标题', { exact: true }).fill('表达调整范围')
    await memory.getByLabel('内容', { exact: true }).fill('调整语言时保留已有剧情。')
    await memory.getByRole('button', { name: '添加', exact: true }).click()
    const record = memory.locator('.dsh-memory-list > li').filter({ hasText: '表达调整范围' })
    await record.waitFor()
    await record.getByRole('button', { name: '撤销', exact: true }).waitFor()
    await record.getByRole('button', { name: '编辑', exact: true }).click()
    await memory.locator('.dsh-memory-list textarea').fill('调整语言时保留已有剧情和人物动机。')
    await memory.locator('.dsh-memory-list').getByRole('button', { name: '保存', exact: true }).click()
    await record.getByText('调整语言时保留已有剧情和人物动机。', { exact: true }).waitFor()
    await memory.getByRole('button', { name: '预览', exact: true }).click()
    await memory.getByRole('button', { name: '应用', exact: true }).waitFor()
    await screenshot('06-memory-dream')
    await memory.getByRole('button', { name: '应用', exact: true }).click()
    const derived = memory.locator('.dsh-memory-list > li').filter({ hasText: '语言修订约定' })
    await derived.getByRole('button', { name: '采纳', exact: true }).click()
    await derived.getByRole('button', { name: '撤销', exact: true }).waitFor()
    await memory.getByRole('button', { name: '预览', exact: true }).click()
    await memory.getByRole('button', { name: '取消', exact: true }).click()
    await derived.getByRole('button', { name: '删除', exact: true }).click()
    await derived.waitFor({ state: 'detached' })
    await record.getByRole('button', { name: '删除', exact: true }).click()
    await record.waitFor({ state: 'detached' })
    report.checks.push('memory add, review, edit, Dream preview/cancel and deletion')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    await composer.fill('不对，以后调整语言时保留已有剧情。')
    await composer.press('Enter')
    await page.getByText('已收到。测试回复已完成。', { exact: true }).nth(1).waitFor()
    dialog = await openSettings()
    await dialog.getByRole('tab', { name: '自我改进', exact: true }).click()
    const learning = dialog.getByTestId('self-improvement-settings')
    await learning.waitFor()
    await learning.getByRole('button', { name: '从本会话摘录', exact: true }).click()
    const lesson = learning.locator('[data-status="candidate"]').first()
    await lesson.waitFor()
    await lesson.getByRole('button', { name: '接受（当前项目）', exact: true }).click()
    await learning.getByRole('tab', { name: '技能草稿', exact: true }).click()
    await learning.getByRole('checkbox').first().check()
    await learning.getByRole('button', { name: '预览技能 Markdown', exact: true }).click()
    await learning.locator('.si-preview').filter({ hasText: '保留剧情' }).waitFor()
    await learning.getByRole('button', { name: '接受草稿', exact: true }).click()
    const downloadEvent = page.waitForEvent('download')
    await learning.getByRole('button', { name: '下载 Markdown', exact: true }).click()
    const download = await downloadEvent
    await download.saveAs(resolve(output, 'exported-skill.md'))
    const markdown = await readFile(resolve(output, 'exported-skill.md'), 'utf8')
    assert.match(markdown, /^---\r?\nname:/)
    assert.match(markdown, /description:/)
    await learning.getByRole('button', { name: '撤回导出记录', exact: true }).click()
    await learning.getByRole('button', { name: '撤回技能', exact: true }).click()
    await screenshot('07-lesson-skill')
    report.checks.push('real correction to lesson review, skill preview/accept/download/revoke')
    await dialog.getByRole('tab', { name: '回顾', exact: true }).click()
    await dialog.getByRole('button', { name: '生成回顾', exact: true }).click()
    await waitForCall('recap')
    await screenshot('08-recap')
    report.checks.push('manual recap remains available in settings and generated through actual host')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })

    const beforeMood = report.calls.length
    const replyCount = await page.getByText('已收到。测试回复已完成。', { exact: true }).count()
    await composer.fill('帮我改一下这一章，优化一下。')
    await composer.press('Enter')
    const answer = page.getByPlaceholder('自定义回答…', { exact: true })
    await answer.waitFor()
    assert.ok(report.calls.slice(beforeMood).some(call => call.kind === 'mood'))
    assert.ok(!report.calls.slice(beforeMood).some(call => call.kind === 'chat'), 'Mood must hold main turn until answered')
    await answer.fill('仅调整表达，保留所有剧情和人物动机。')
    await page.getByRole('button', { name: '提交全部回答', exact: true }).click()
    await page.getByText('已收到。测试回复已完成。', { exact: true }).nth(replyCount).waitFor()
    await page.getByText('目标：优化章节表达', { exact: true }).first().waitFor()
    assert.equal(report.calls.slice(beforeMood).filter(call => call.kind === 'chat').length, 1, 'Resume intercepted turn exactly once')
    await screenshot('09-mood-confirmed')
    report.checks.push('Mood native question holds main turn, records answer and resumes once; contract updates automatically')

    dialog = await openSettings()
    await dialog.getByRole('tab', { name: '插件', exact: true }).click()
    for (const id of ['mood', 'recap', 'self-improvement', 'memory', 'current-title']) {
      const toggle = dialog.locator('[role="switch"][data-testid$="-' + id + '"]')
      await toggle.click()
      await waitForChecked(toggle, false)
    }
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.shell').waitFor()
    const reopen = page.locator('.home-recent').getByRole('button', { name: /插件验收/ }).first()
    await Promise.race([page.getByTestId('paper-editor').waitFor(), reopen.waitFor()])
    if (await reopen.isVisible()) await reopen.click()
    if (await launcher.isVisible()) await launcher.click()
    const afterDisable = report.calls.length
    await composer.fill('解释什么是重力')
    await composer.press('Enter')
    await page.getByText('已收到。测试回复已完成。', { exact: true }).nth(replyCount + 1).waitFor()
    assert.ok(report.calls.slice(afterDisable).every(call => call.kind === 'chat'), 'Disabled features must not infer')
    const disabledBoot = await page.evaluate(() => globalThis.__DSH_BOOT__?.entries?.map(entry => entry.id) ?? [])
    for (const id of featureIds) assert.ok(!disabledBoot.includes('@klarkxy/dsh-' + id))
    await screenshot('10-disabled-restored')
    report.checks.push('all six disabled again: native chat remains usable and no auxiliary inference')

  }
  assert.equal(report.errors.length, 0, report.errors.join('\n'))
  report.ok = true
} catch (error) {
  report.failure = String(error)
  if (page) {
    report.switches = await page.locator('[role="switch"][data-testid]').evaluateAll(nodes => nodes.map(node => ({id:node.getAttribute('data-testid'), checked:node.getAttribute('aria-checked'), disabled:node.hasAttribute('disabled')})))
    report.clientEntries = await page.evaluate(() => globalThis.__DSH_BOOT__?.entries?.map(entry => ({id:entry.id, name:entry.name, disabled:entry.disabled})) ?? [])
    report.clientStyles = await page.locator('style[data-plugin]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-plugin')))
    await screenshot('failure').catch(() => {})
    await writeFile(resolve(output, 'failure-dom.txt'), await page.locator('body').innerText()).catch(() => {})
  }
  console.error(report.failure)
  process.exitCode = 1
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  await writeFile(resolve(output, 'host.log'), logs.join('').replace(/\?token=[A-Za-z0-9._~-]+/g, '?token=<redacted>'))
  await stop()
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, output, failure: report.failure }))
}
