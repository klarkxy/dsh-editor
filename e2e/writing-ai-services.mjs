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
const home = resolve(root, '.dev', 'writing-ai-' + runId)
const output = resolve(root, 'e2e/out/writing-ai', runId)
const runtime = resolve(root, '.dev/desktop-dsh-runtime-0.1.7-rc.2')
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
  const system = messages.filter(m => m.role === 'system' || m.role === 'developer').map(m => typeof m.content === 'string' ? m.content : (m.content ?? []).map(block => block.text ?? '').join('\n')).join('\n')
  const input = messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : (m.content ?? []).map(block => block.text ?? '').join('\n')).join('\n')
  let kind = 'chat'
  let answer = '已收到。测试回复已完成。'
  if (system.includes('文稿行内补全引擎')) { kind = 'completion'; answer = '雨'.repeat(300) }
  else if (system.includes('你是小说编辑')) { kind = 'rewrite'; answer = '她将旧信收进抽屉，轻轻合上。' }
  else if (system.includes('Name the current task')) { kind = 'title'; answer = JSON.stringify({ type: 'discuss', summary: '插件验收' }) }
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
  report.calls.push({ kind, model: request.model, effort: request.reasoning_effort, input: input.slice(-4000), hasMood: input.includes('@klarkxy/dsh-mood') || input.includes('优化章节表达'), hasMemory: input.includes('调整语言时保留已有剧情'), hasLesson: input.includes('保留剧情') })
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
await mkdir(home, { recursive: true })
await writeFile(resolve(home, 'settings.yaml'), 'ui-theme:\n  preference: light\ndsh-editor-writing:\n  completionModel:\n    provider: local-test\n    model: fixture-legacy\n  rewriteModel:\n    provider: local-test\n    model: fixture-legacy\n')
await deployProfile(home, resolve(root, '.dev/desktop-profile-template'), resolve(runtime, 'node_modules'))
const patch = resolve(home, 'profiles/dsh-editor/cordis.patch.yml')
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

async function waitForChecked(locator, checked) {
  const end = Date.now() + 30000
  while (Date.now() < end) {
    if (await locator.getAttribute('aria-checked') === String(checked)) return
    await delay(100)
  }
  throw new Error('Switch did not become ' + checked + ': ' + await locator.getAttribute('data-testid'))
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
async function startHost() {
  child = spawn(process.execPath, [resolve(runtime, 'lib/bin.js'), '--profile', 'dsh-editor', '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((done, reject) => {
    let all = ''; const timer = setTimeout(() => reject(new Error('Host startup timeout')), 60000)
    const inspect = chunk => { const text=String(chunk); logs.push(text); all+=text; const match=/https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=[A-Za-z0-9._~-]+)?/.exec(all); if(match){clearTimeout(timer);done(match[0])} }
    child.stdout.on('data',inspect); child.stderr.on('data',inspect)
    child.once('error',reject); child.once('exit',code=>{clearTimeout(timer);reject(new Error('host exit '+code))})
  })
}
try {
  let url = await startHost()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  page = await context.newPage(); page.setDefaultTimeout(20000)
  const requests=[]
  page.on('request',req=>{if(req.method()==='POST'){try{requests.push(req.postDataJSON())}catch{}}})
  page.on('pageerror',error=>report.errors.push(error.message))
  await page.goto(url); await page.locator('.shell').waitFor({timeout:60000})
  for(let n=0;n<5;n++){const next=page.getByRole('button',{name:'继续',exact:true});if(!await next.isVisible())break;await next.click()}
  const later=page.getByRole('button',{name:'稍后配置',exact:true});if(await later.isVisible())await later.click()
  const rpc=async(channel,method,payload={})=>{
    const res=await page.request.post(new URL(channel+'/'+method,url).href,{data:{type:'client-request',rpcId:Math.random().toString(36),method,payload}})
    assert.ok(res.ok(),method+': HTTP '+res.status());const result=(await res.json()).result
    assert.ok(result?.ok,method+': '+JSON.stringify(result));return result.value
  }
  let status=await rpc('/dsh-ai-services','status')
  assert.equal(status.policy.purposes['manuscript.completion'].model,'fixture-legacy')
  assert.equal(status.policy.purposes['manuscript.rewrite'].model,'fixture-legacy')
  assert.ok(status.purposes.some(row=>row.id==='manuscript.completion'))
  assert.equal(report.calls.length,0)
  report.checks.push('legacy writing models imported once without inference')
  let dialog=await openSettings()
  await dialog.getByRole('tab',{name:'插件',exact:true}).click()
  let modelCenterToggle=dialog.locator('[role="switch"][data-testid$="-model-center"]')
  if(await modelCenterToggle.getAttribute('aria-checked')==='true'){
    await modelCenterToggle.click();await waitForChecked(modelCenterToggle,false)
    await page.reload();await page.locator('.shell').waitFor();dialog=await openSettings()
  }
  await dialog.getByRole('tab',{name:'模型',exact:true}).click()
  const select=dialog.getByRole('combobox',{name:'补全模型',exact:true})
  await select.click();await page.getByRole('option',{name:'Local acceptance · New',exact:true}).click()
  await page.waitForTimeout(300)
  status=await rpc('/dsh-ai-services','status')
  assert.equal(status.policy.purposes['manuscript.completion'].model,'fixture-new')
  const effort = dialog.getByRole('combobox', { name: '补全模型 · 思考强度', exact: true })
  await effort.click(); await page.getByRole('option', { name: '高', exact: true }).click()
  await page.waitForTimeout(200)
  await effort.click(); await page.getByRole('option', { name: '关', exact: true }).click()
  await page.waitForTimeout(200)
  status = await rpc('/dsh-ai-services', 'status')
  assert.equal(status.policy.purposes['manuscript.completion'].reasoningEffort, 'off')
  report.checks.push('explicit reasoning off is preserved separately from model default')
  await screenshot('01-unified-writing-settings')
  report.checks.push('original settings writes central policy while Model Center disabled')
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'})
  await page.getByRole('button',{name:'新建',exact:true}).first().click()
  const project=page.getByRole('dialog',{name:'新建作品',exact:true})
  await project.getByLabel('作品名称').fill('写作统一服务验收');await project.getByRole('button',{name:'创建',exact:true}).click();await project.waitFor({state:'detached'})
  await page.getByRole('button',{name:'写第一篇',exact:true}).click()
  const create=page.getByRole('dialog',{name:'新建文件',exact:true});await create.getByLabel('文件名称（无扩展名时按 .md 创建）').fill('001');await create.getByRole('button',{name:'创建',exact:true}).click()
  const editor=page.getByTestId('paper-editor').locator('.cm-content');await editor.click();await page.keyboard.insertText('夜雨落在窗沿。她把旧信放回抽屉。');await page.keyboard.press('Control+s');await page.getByTestId('paper-save-state').filter({hasText:'已保存'}).waitFor()
  const sessionId=requests.map(x=>x?.payload?.sessionId).filter(Boolean).at(-1);assert.ok(sessionId)
  const payload={sessionId,path:'正文/001.md',prefix:'夜雨落在窗沿。',suffix:'',selectedText:'她把旧信放回抽屉。'}
  const before=await editor.innerText()
  const fim=await rpc('/manuscript','fim.complete',payload)
  const rewrite=await rpc('/manuscript','patch.complete',payload)
  assert.equal(fim.text,'雨'.repeat(240));assert.equal(rewrite.text,'她将旧信收进抽屉，轻轻合上。')
  assert.equal(await editor.innerText(),before)
  assert.equal(report.calls.find(x=>x.kind==='completion').model,'fixture-new')
  assert.equal(report.calls.find(x=>x.kind==='rewrite').model,'fixture-legacy')
  const receipts=await rpc('/dsh-ai-services','usage')
  assert.ok(receipts.some(x=>x.purpose==='manuscript.completion'&&x.status==='success'))
  assert.ok(receipts.some(x=>x.purpose==='manuscript.rewrite'&&x.status==='success'))
  report.checks.push('both real host requests use central routes, record usage and leave text unchanged until author acceptance')
  // Default tiers are declared by the plugin even when explicit legacy routes exist.
  status = await rpc('/dsh-ai-services', 'status')
  assert.deepEqual(status.purposes.find(row => row.id === 'manuscript.completion').defaultTarget, { kind: 'role', role: 'weak' })
  assert.deepEqual(status.purposes.find(row => row.id === 'manuscript.rewrite').defaultTarget, { kind: 'role', role: 'normal' })
  const { revision: beforeFallbackRevision, ...beforeFallbackPolicy } = status.policy
  let fallbackPolicy = await rpc('/dsh-ai-services', 'update', { expectedRevision: beforeFallbackRevision, policy: {
    ...beforeFallbackPolicy,
    roles: { normal: { provider: 'local-test', model: 'fixture' }, weak: { provider: 'local-test', model: 'fixture-new' }, strong: { provider: 'local-test', model: 'fixture-new' }, fantasy: { provider: 'local-test', model: 'fixture-new' } },
  } })
  for (const role of ['weak', 'normal', 'strong', 'fantasy']) {
    const { revision, ...data } = fallbackPolicy
    fallbackPolicy = await rpc('/dsh-ai-services', 'update', { expectedRevision: revision, policy: {
      ...data, purposes: { ...data.purposes, 'manuscript.completion': { kind: 'role', role } },
    } })
    const resolved = await rpc('/dsh-ai-services', 'resolve', { purpose: 'manuscript.completion' })
    assert.equal(resolved.model, 'fixture')
    await rpc('/manuscript', 'fim.complete', { ...payload, prefix: '无管理器默认档位。' })
    assert.equal(report.calls.filter(call => call.kind === 'completion').at(-1).model, 'fixture')
  }
  // A standalone host with no saved Chat binding reads agentDefaultModel lazily.
  const { revision: fallbackRevision, ...fallbackData } = fallbackPolicy
  delete fallbackData.roles.normal
  fallbackPolicy = await rpc('/dsh-ai-services', 'update', { expectedRevision: fallbackRevision, policy: fallbackData })
  assert.equal((await rpc('/dsh-ai-services', 'resolve', { purpose: 'manuscript.completion' })).model, 'fixture')
  await rpc('/manuscript', 'fim.complete', { ...payload, prefix: '未配置对话档时使用宿主默认模型。' })
  assert.equal(report.calls.filter(call => call.kind === 'completion').at(-1).model, 'fixture')
  await rpc('/dsh-ai-services', 'update', { expectedRevision: fallbackPolicy.revision, policy: beforeFallbackPolicy })
  report.checks.push('all four tiers use default Chat without Model Center, including host default fallback with no Chat binding')
  dialog=await openSettings();await dialog.getByRole('tab',{name:'插件',exact:true}).click()
  modelCenterToggle=dialog.locator('[role="switch"][data-testid$="-model-center"]');await modelCenterToggle.click();await waitForChecked(modelCenterToggle,true)
  await page.reload();await page.locator('.shell').waitFor();dialog=await openSettings();await dialog.getByRole('tab',{name:'模型',exact:true}).click()
  const center=dialog.getByTestId('model-center');await center.waitFor();await center.getByRole('tab',{name:'模型配置',exact:true}).click()
  await center.getByText('正文补全',{exact:true}).waitFor();await center.getByText('选区改写',{exact:true}).waitFor()
  await screenshot('02-model-center-writing-purposes')
  report.checks.push('Model Center lists both live writing purposes')
  assert.equal(await center.locator('[data-tier]').count(), 4)
  const routeKey = model => 'local-test' + String.fromCharCode(31) + model
  await center.getByRole('combobox', { name: '快速 模型', exact: true }).selectOption(routeKey('fixture-legacy'))
  await center.getByRole('combobox', { name: '快速 思考强度', exact: true }).selectOption('low')
  await center.getByRole('combobox', { name: '思考 模型', exact: true }).selectOption(routeKey('fixture-new'))
  await center.getByRole('combobox', { name: '思考 思考强度', exact: true }).selectOption('high')
  await center.getByRole('combobox', { name: '幻想 模型', exact: true }).selectOption(routeKey('fixture-new'))
  await center.getByRole('combobox', { name: '幻想 思考强度', exact: true }).selectOption('high')
  await center.getByRole('combobox', { name: '正文补全 使用模型', exact: true }).selectOption('role:fantasy')
  await center.getByRole('combobox', { name: '新对话 使用模型', exact: true }).selectOption('role:weak')
  const save = async () => {
    await center.locator('.model-center-savebar button').click()
    await center.getByText('已保存。', { exact: true }).waitFor()
    assert.equal(await center.locator('.model-center-savebar button').isDisabled(), true)
  }
  await save()
  assert.equal((await rpc('/dsh-ai-services','resolve',{purpose:'chat',sessionId})).reasoningEffort,'low')
  let route=await rpc('/dsh-ai-services','resolve',{purpose:'manuscript.completion',sessionId})
  assert.equal(route.model,'fixture-new');assert.equal(route.reasoningEffort,'high')
  await rpc('/manuscript','fim.complete',{...payload,prefix:'档位第一次调用。'})
  assert.equal(report.calls.filter(call=>call.kind==='completion').at(-1).model,'fixture-new')
  assert.equal(report.calls.filter(call=>call.kind==='completion').at(-1).effort,'high')
  await center.getByRole('combobox', { name: '幻想 模型', exact: true }).selectOption(routeKey('fixture-legacy'))
  await center.getByRole('combobox', { name: '幻想 思考强度', exact: true }).selectOption('low')
  await save()
  await rpc('/manuscript','fim.complete',{...payload,prefix:'档位第二次调用。'})
  assert.equal(report.calls.filter(call=>call.kind==='completion').at(-1).model,'fixture-legacy')
  assert.equal(report.calls.filter(call=>call.kind==='completion').at(-1).effort,'low')
  route=await rpc('/dsh-ai-services','resolve',{purpose:'manuscript.rewrite',sessionId})
  assert.equal(route.model,'fixture-legacy');assert.equal(route.reasoningEffort,undefined)
  report.checks.push('four tiers save model and effort; referenced capabilities follow tier changes in real local-provider requests; explicit overrides stay unchanged')
  await center.getByRole('combobox', { name: '正文补全 使用模型', exact: true }).selectOption('custom')
  await center.getByRole('combobox', { name: '正文补全 模型', exact: true }).selectOption(routeKey('fixture-new'))
  await center.getByRole('combobox', { name: '正文补全 思考强度', exact: true }).selectOption('high')
  await save()
  route=await rpc('/dsh-ai-services','resolve',{purpose:'manuscript.completion',sessionId})
  assert.equal(route.target.kind,'model');assert.equal(route.model,'fixture-new');assert.equal(route.reasoningEffort,'high')
  await center.getByRole('combobox', { name: '正文补全 使用模型', exact: true }).selectOption('role:fantasy')
  await save()
  await center.locator('[data-tier="weak"]').scrollIntoViewIfNeeded()
  await screenshot('03-four-model-tiers')
  await center.locator('[data-purpose="manuscript.completion"]').scrollIntoViewIfNeeded()
  await screenshot('04-capability-defaults')
  report.checks.push('capability switches between tier and explicit model plus effort through the visible UI')
  await page.setViewportSize({ width: 900, height: 820 })
  await center.locator('.model-center-tier-section').scrollIntoViewIfNeeded()
  assert.ok(await center.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'model settings must not overflow horizontally')
  await screenshot('05-narrow-model-settings')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await dialog.getByRole('tab', { name: '通用设置', exact: true }).click()
  await dialog.getByRole('button', { name: '深色', exact: true }).click()
  await page.locator('html[data-theme="dark"]').waitFor()
  await dialog.getByRole('tab', { name: '模型', exact: true }).click()
  await center.locator('.model-center-tier-section').scrollIntoViewIfNeeded()
  await screenshot('06-dark-model-settings')
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'})
  await page.getByRole('combobox', {name:'选择模型',exact:true}).filter({hasText:'Fixture'}).waitFor()
  await page.locator('.chat-header-actions button[aria-label="新对话"]').click()
  const presetDialog=page.getByRole('dialog',{name:'选择对话模式',exact:true})
  await presetDialog.getByRole('button',{name:'开始对话',exact:true}).click()
  await presetDialog.waitFor({state:'detached'})
  await page.getByRole('combobox',{name:'选择模型',exact:true}).filter({hasText:'Legacy'}).waitFor()
  await page.getByRole('combobox',{name:'思考强度',exact:true}).filter({hasText:'低'}).waitFor()
  report.checks.push('narrow and dark settings render; tier updates preserve the existing session picker and a new conversation inherits Quick model and low reasoning')


  status=await rpc('/dsh-ai-services','status');const {revision,...policy}=status.policy
  delete policy.purposes['manuscript.completion']
  await rpc('/dsh-ai-services','update',{expectedRevision:revision,policy})
  child.kill();await new Promise(done=>child.once('exit',done))
  url=await startHost();await page.goto(url);await page.locator('.shell').waitFor({timeout:60000})
  status=await rpc('/dsh-ai-services','status')
  assert.equal(status.policy.purposes['manuscript.completion'],undefined)
  assert.equal(status.policy.purposes['manuscript.rewrite'].model,'fixture-legacy')
  assert.equal(status.policy.roles.fantasy.reasoningEffort,'low')
  assert.equal(status.policy.roles.fantasy.model,'fixture-legacy')
  assert.equal(status.policy.purposes.chat.role,'weak')
  report.checks.push('real process restart preserves policy and does not reimport deleted legacy route')
  assert.equal(report.errors.length,0,report.errors.join('\n'));report.ok=true
} catch(error) {
  report.failure=String(error);process.exitCode=1
  if(page){await screenshot('failure').catch(()=>{});await writeFile(resolve(output,'failure-dom.txt'),await page.locator('body').innerText()).catch(()=>{})}
} finally {
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2))
  await writeFile(resolve(output,'host.log'),logs.join('').replace(/\?token=[A-Za-z0-9._~-]+/g,'?token=<redacted>'))
  await stop();console.log(JSON.stringify({ok:report.ok,checks:report.checks,output,failure:report.failure}))
}
