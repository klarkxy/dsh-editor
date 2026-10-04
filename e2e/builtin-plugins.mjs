/** Real DSH shell acceptance in an isolated home; inference uses a local deterministic provider. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { deployProfile } from '../apps/desktop/dist/profile.js'

const root = resolve(import.meta.dirname, '..')
const stage = process.env.BUILTIN_PLUGINS_STAGE || 'after'
const runId = stage + '-' + Date.now()
const home = resolve(root, '.dev', 'builtin-plugins-' + runId)
const output = resolve(root, 'e2e/out/builtin-plugins', runId)
const runtimeVersion = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).devDependencies['@deepseek-ai/dsh']
const runtime = resolve(root, '.dev', 'desktop-dsh-runtime-' + runtimeVersion)
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
if(stage !== 'before') {
  await writeFile(resolve(home,'dsh-plugins.json'),JSON.stringify({schema:1,overrides:{'model-center':false,'editor-overview-panel':false},presets:{'dsh-editor-article':false},installed:[]}))
  await writeFile(resolve(home,'cordis.patch.yml'),'# managed-by: dsh-editor-plugins\n- id: editor-overview-panel\n  disabled: true\n- id: model-center\n  disabled: true\n')
}
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
async function openPlugins(target = page) {
  await target.getByRole('button', { name: '插件', exact: true }).click()
  const plugins = target.locator('section.plugins-page[aria-label="插件管理"]')
  await plugins.getByTestId('plugins-settings').waitFor()
  await plugins.locator('.dsh-plugins-card').first().waitFor()
  return plugins
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
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(url); await page.locator('.shell').waitFor({timeout:60000})
  for(let n=0;n<5;n++){const next=page.getByRole('button',{name:'继续',exact:true});if(!await next.isVisible())break;await next.click()}
  const later=page.getByRole('button',{name:'稍后配置',exact:true});if(await later.isVisible())await later.click()
  const rpc=async(channel,method,payload={})=>{
    const res=await page.request.post(new URL(channel+'/'+method,url).href,{data:{type:'client-request',rpcId:Math.random().toString(36),method,payload}})
    assert.ok(res.ok(),method+': HTTP '+res.status());const result=(await res.json()).result
    assert.ok(result?.ok,method+': '+JSON.stringify(result));return result.value
  }
  const inventory=await rpc('/dsh-editor-plugins','inventory.list')
  await writeFile(resolve(output,'inventory.json'),JSON.stringify(inventory,null,2))
  report.checks.push('isolated real host starts with production plugin catalogue')
  if(stage !== 'before') {
    const all=[...inventory.core,...inventory.optional,...inventory.community]
    const id=card=>card.entryId.replace(/^include:/,'')
    const find=key=>all.find(card=>id(card)===key)
    const prepared=JSON.parse(await readFile(resolve(home,'profiles/dsh-editor/dsh-editor-catalog.json'),'utf8'))
    for(const [key,row] of Object.entries(prepared.entries)) {
      if(!row.builtin)continue
      assert.ok(find(key),'missing builtin '+key);assert.equal(find(key).builtin,true,key)
    }
    for(const key of ['manuscript','manuscript-assist','editor-shell','editor-workbench','editor-plugins','editor-cards','editor-memory-panel','model-center','ui-shortcuts','mcp-resources','ui-sidebar-documentpreview'])assert.equal(find(key)?.builtin,true,key)
    assert.equal(find('model-center').locked,true);assert.equal(find('model-center').enabled,true)
    for(const key of ['editor-cards','editor-memory-panel'])assert.equal(find(key).enabled,false,key)
    assert.ok(find('current-title').builtin !== true)
    const saved=JSON.parse(await readFile(resolve(home,'dsh-plugins.json'),'utf8'))
    assert.equal(saved.overrides['model-center'],undefined)
    assert.equal(saved.overrides['editor-overview-panel'],false);assert.equal(saved.presets['dsh-editor-article'],false)
    assert.ok((await rpc('/dsh-model-center','status')).enabled)
    report.checks.push('complete trusted builtin catalogue, default-off panels, and essential model service recovered from legacy managed off while preserving other preferences')
    const request=async(method,payload)=>{
      const res=await page.request.post(new URL('/dsh-editor-plugins/'+method,url).href,{data:{type:'client-request',rpcId:Math.random().toString(36),method,payload}})
      assert.ok(res.ok());return (await res.json()).result
    }
    for(const key of ['model-center','editor-novel-kernel','editor-workbench-tools','proofread']) {
      const card=find(key);assert.equal(card.locked,true,key)
      const result=await request('entry.setEnabled',{entryId:card.entryId,enabled:!card.enabled});assert.equal(result.ok,false,key)
    }
    report.checks.push('essential and session-controlled builtin entries reject unsafe global toggles')
    let policyStatus=await rpc('/dsh-ai-services','status');const {revision,...policy}=policyStatus.policy
    const tierModels={normal:'fixture',weak:'fixture-new',strong:'fixture-legacy',fantasy:'fixture-new'}
    const roles=Object.fromEntries(Object.entries(tierModels).map(([role,model])=>[role,{provider:'local-test',model,reasoningEffort:'off'}]))
    let current=await rpc('/dsh-ai-services','update',{expectedRevision:revision,policy:{...policy,roles}})
    for(const [role,model] of Object.entries(tierModels)) {
      const {revision,...data}=current
      current=await rpc('/dsh-ai-services','update',{expectedRevision:revision,policy:{...data,purposes:{...data.purposes,'manuscript.completion':{kind:'role',role}}}})
      const resolved=await rpc('/dsh-ai-services','resolve',{purpose:'manuscript.completion'})
      assert.equal(resolved.model,model,role);assert.equal(resolved.reasoningEffort,'off',role)
    }
    report.checks.push('configured Quick Thinking and Fantasy routes really resolve through essential service, preserving explicit reasoning off')
    const completion=find('manuscript-assist')
    await rpc('/dsh-editor-plugins','entry.setEnabled',{entryId:completion.entryId,enabled:false})
    const caps=await rpc('/dsh-editor-shell','capabilities.get')
    assert.equal(caps.features.completion,false);assert.equal(caps.features.assistant,true)
    await rpc('/dsh-editor-plugins','entry.setEnabled',{entryId:completion.entryId,enabled:true})
    assert.equal((await rpc('/dsh-editor-shell','capabilities.get')).features.completion,true)
    assert.deepEqual((await rpc('/dsh-ai-services','status')).policy,current)
    report.checks.push('disabling and reenabling writing assistance uses real lifecycle without breaking assistant or resetting policy')
    for(const key of ['editor-cards','editor-memory-panel']) {
      await rpc('/dsh-editor-plugins','entry.setEnabled',{entryId:find(key).entryId,enabled:true})
      const active=await rpc('/dsh-editor-plugins','inventory.list')
      const card=[...active.core,...active.optional].find(card=>id(card)===key)
      assert.equal(card.enabled,true);assert.equal(card.fiberPhase,'active')
    }
    report.checks.push('previously omitted builtin panels load through real switches')
    child.kill();await new Promise(done=>child.once('exit',done))
    url=await startHost();await page.goto(url);await page.locator('.shell').waitFor({timeout:60000})
    assert.deepEqual((await rpc('/dsh-ai-services','status')).policy,current)
    const restarted=await rpc('/dsh-editor-plugins','inventory.list')
    const restartedRows=[...restarted.core,...restarted.optional]
    for(const key of ['model-center','editor-cards','editor-memory-panel'])assert.equal(restartedRows.find(card=>id(card)===key)?.enabled,true,key)
    assert.equal(restartedRows.find(card=>id(card)==='editor-overview-panel')?.enabled,false)
    report.checks.push('real process restart retains builtin switches, unrelated off state, and central model policy')
  }

  for(const theme of ['浅色','深色']) {
    const dialog=await openSettings(); await dialog.getByRole('tab',{name:'通用设置',exact:true}).click()
    await dialog.getByRole('button',{name:theme,exact:true}).click()
    await page.waitForFunction(expected=>document.querySelector('.shell-theme')?.classList.contains(expected),theme==='深色'?'dark':'light')
    await dialog.getByRole('tab',{name:'模型',exact:true}).click()
    if(stage !== 'before') {
      const native=dialog.getByTestId('editor-model-settings');await native.waitFor()
      assert.equal(await dialog.getByTestId('model-center').count(),0,'legacy replacement must not own Editor settings')
      for(const name of ['对话模型','补全模型','改写模型'])assert.equal(await dialog.getByRole('combobox',{name,exact:true}).count(),1,name)
      assert.equal(await native.locator('[data-tier]').count(),4)
      await dialog.getByRole('heading',{name:'供应商',exact:true}).first().waitFor()
      if(theme === '浅色') {
        const oldLimits=(await rpc('/dsh-ai-services','status')).policy.limits
        await native.getByRole('spinbutton',{name:'并发数',exact:true}).fill('3')
        const save=native.getByRole('button',{name:'保存',exact:true});await save.click()
        await page.waitForFunction(()=>document.querySelector('[aria-label="并发数"]').value==='3'&&!document.querySelector('[aria-label="并发数"]').disabled)
        assert.deepEqual((await rpc('/dsh-ai-services','status')).policy.limits,{...oldLimits,concurrency:3})
        assert.equal(await save.isDisabled(),true)
        report.checks.push('native runtime controls save through real central-policy CAS without changing other bounds')
        await native.getByRole('combobox',{name:'对话模型',exact:true}).scrollIntoViewIfNeeded()
      }

      report.checks.push(theme+': permanent Editor-owned model controls and all four tiers, without legacy replacement')
    }
    await page.waitForTimeout(500);await screenshot(theme+'-models-1440')
    await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'})
    const plugins=await openPlugins()
    if(stage !== 'before') {
      await plugins.getByRole('heading',{name:'内置插件',exact:true}).waitFor()
      for(const label of ['预装插件','已安装插件'])assert.equal(await plugins.getByRole('heading',{name:label,exact:true}).count(),1,label)
      const pluginModels=plugins.locator('.plugins-page-nav').getByRole('button',{name:'插件模型',exact:true});await pluginModels.click()
      await plugins.getByTestId('plugin-model-settings').waitFor()
      for(const name of ['对话模型','补全模型','改写模型'])assert.equal(await plugins.getByRole('combobox',{name,exact:true}).count(),0,name)
      assert.equal(await plugins.locator('[data-tier]').count(),0)
      await screenshot(theme+'-plugin-models-1440')
      await plugins.locator('.plugins-page-nav').getByRole('button',{name:'已安装与市场',exact:true}).click()
      report.checks.push(theme+': unified builtin inventory and plugin-only model configuration without duplicate builtin controls')
    }
    for(const width of [1440,1024,760,390]) {
      await page.setViewportSize({width,height:1000});await screenshot(theme+'-plugins-'+width)
      assert(await plugins.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'plugins overflow '+width)
    }
    await page.setViewportSize({width:1440,height:1000})
    await plugins.getByRole('button',{name:/返回首页|返回写作/}).click();await plugins.waitFor({state:'detached'})
  }
  assert.equal(report.errors.length,0,report.errors.join('\n'));report.ok=true
} catch(error) {
  report.failure=String(error);process.exitCode=1
  if(page){await screenshot('failure').catch(()=>{});await writeFile(resolve(output,'failure-dom.txt'),await page.locator('body').innerText()).catch(()=>{})}
} finally {
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2))
  await writeFile(resolve(output,'host.log'),logs.join('').replace(/\?token=[A-Za-z0-9._~-]+/g,'?token=<redacted>'))
  await stop();console.log(JSON.stringify({ok:report.ok,checks:report.checks,output,failure:report.failure}))
}
