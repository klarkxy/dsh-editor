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
const home = resolve(root, '.dev', 'writing-models-' + runId)
const output = resolve(root, 'e2e/out/writing-models', runId)
const runtime = resolve(root, '.dev/desktop-dsh-runtime-0.2.0-rc.2')
const featureIds = ['web-search-manager']
const optionalIds = ['current-title', 'mood', 'recap', 'zhihu', 'zhihu-tools']
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
  report.calls.push({ tools: (request.tools ?? []).map(tool => tool.function?.name ?? tool.name), kind, model: request.model, effort: request.reasoning_effort, input: input.slice(-4000), hasMood: input.includes('@klarkxy/dsh-mood') || input.includes('优化章节表达'), hasMemory: input.includes('调整语言时保留已有剧情'), hasLesson: input.includes('保留剧情') })
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
if(process.env.RETIREMENT_LEGACY_FIXTURE==='1'){
  await mkdir(resolve(home,'storages'),{recursive:true});
  const policy={revision:4,roles:{normal:{provider:'local-test',model:'fixture'}},purposes:{chat:{kind:'model',provider:'local-test',model:'fixture-new'},'manuscript.completion':{kind:'model',provider:'local-test',model:'fixture-new'},'manuscript.rewrite':{kind:'model',provider:'local-test',model:'fixture-legacy'}},limits:{concurrency:1,timeoutMs:60000,maxInputChars:32000,maxOutputTokens:2048,maxAttempts:1},imports:[]};
  await writeFile(resolve(home,'storages/dsh_editor_ai_services.json'),JSON.stringify({unit:{name:'dsh_editor_ai_services',version:1},global:null,tables:{policy:{current:policy},receipts:{current:{items:[]}}}}));
  await writeFile(resolve(home,'dsh-plugins.json'),JSON.stringify({schema:1,overrides:{fusion:true,memory:true,'model-center':false,'self-improvement':true,zhihu:true},presets:{},installed:[]}));
  await writeFile(resolve(home,'cordis.patch.yml'),'# managed-by: dsh-editor-plugins\n- id: fusion\n  disabled: false\n- id: memory\n  disabled: false\n- id: model-center\n  disabled: true\n- id: self-improvement\n  disabled: false\n- id: zhihu\n  disabled: false\n');
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
  server.closeAllConnections()
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
  const native=async(method,payload)=>{
    const res=await page.request.post(new URL('/pluginManager/'+method,url).href,{data:{type:'client-request',rpcId:Math.random().toString(36),method,payload}})
    assert.ok(res.ok(),method+': HTTP '+res.status())
    const body=await res.json()
    const result=body.result ?? body
    if(result && typeof result==='object' && 'ok' in result){
      assert.ok(result.ok,method+': '+JSON.stringify(result));return result.value
    }
    return result
  }

  const retired=['ai-services','model-center','memory','self-improvement','fusion'];
  const plugins=await native('listPlugins',[]);
  const bundles=await native('listBundles',[]);
  const find=id=>plugins.find(row=>String(row.entryId).replace(/^include:/,'')===id || row.patchId===id);
  const findBundle=name=>bundles.find(row=>row.name===name || row.name.endsWith('/'+name) || row.name.endsWith(name));
  for(const id of [...retired,...optionalIds])assert.equal(find(id),undefined,'retired plugin '+id);
  for(const id of featureIds)assert.equal(find(id)?.enabled ?? findBundle(id)?.enabled,true,id);
  for(const id of ['editor-cards','editor-memory-panel','mcp-resources'])assert.equal(find(id)?.enabled ?? findBundle(id)?.enabled ?? findBundle('dsh-'+id)?.enabled,false,id);
  assert.equal(report.calls.length,0,'opening host should not infer');
  if(process.env.RETIREMENT_LEGACY_FIXTURE==='1'){
    const legacy=JSON.parse(await readFile(resolve(home,'storages/dsh_editor_ai_services.json'),'utf8'));assert.ok(legacy.tables.policy.current.imports.includes('editor-native-writing-v1'));assert.deepEqual(legacy.tables.receipts.current,{items:[]});assert.match(await readFile(patch,'utf8'),/writingModelsImported:\s*true/);await readFile(resolve(home,'cordis.patch.yml.before-plugin-retirement'),'utf8');await readFile(resolve(home,'cordis.patch.yml.before-preinstall-trim'),'utf8');const pluginState=JSON.parse(await readFile(resolve(home,'dsh-plugins.json'),'utf8'));assert.equal(pluginState.overrides.zhihu,undefined);
    report.checks.push('real legacy domain migrated into native settings with durable fence, historical receipts and retired managed override backups preserved');
  }
  report.checks.push('real host includes web search and private author panels, without specialized or retired plugins or startup inference');
  const requestResult=async(channel,method,payload={})=>{
    const response=await page.request.post(new URL(channel+'/'+method,url).href,{data:{type:'client-request',rpcId:Math.random().toString(36),method,payload}});
    return response.ok()?(await response.json()).result:undefined;
  };
  for(const id of ['editor-novel-kernel','editor-workbench-tools','proofread']){
    const row=find(id);assert.ok(row?.readOnlyReason,id);
    const result=await page.request.post(new URL('/pluginManager/setPluginEnabled',url).href,{data:{type:'client-request',rpcId:Math.random().toString(36),method:'setPluginEnabled',payload:[row.entryId,!row.enabled]}});
    const body=await result.json();
    const value=body.result?.value ?? body.result ?? body;
    assert.equal(value?.changed,false,id);
    assert.equal(value?.error?.code,'management-required',id);
  }
  const plugins=await openPlugins();
  for(const id of [...retired,...optionalIds])assert.equal(await plugins.locator('[data-testid="plugins-card-include:'+id+'"], [data-testid="plugins-card-'+id+'"]').count(),0,id);
  await screenshot('00-plugin-inventory');
  await plugins.getByRole('button',{name:/返回首页|返回写作/}).click();await plugins.waitFor({state:'detached'});
  let dialog=await openSettings();await dialog.getByRole('tab',{name:'模型',exact:true}).click();
  const select=dialog.getByRole('combobox',{name:'补全模型',exact:true});await select.filter({hasText:process.env.RETIREMENT_LEGACY_FIXTURE==='1'?'New':'Legacy'}).waitFor();
  await select.click();await page.getByRole('option',{name:'Local acceptance · New',exact:true}).click();await select.filter({hasText:'New'}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="补全模型"]').disabled);
  const effort=dialog.getByRole('combobox',{name:'补全模型 · 思考强度',exact:true});
  await effort.click();await page.getByRole('option',{name:'关',exact:true}).click();await effort.filter({hasText:'关'}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="补全模型 · 思考强度"]').disabled);
  for(const name of ['对话模型','补全模型','改写模型'])assert.equal(await dialog.getByRole('combobox',{name,exact:true}).count(),1);
  const chatSelection=dialog.getByRole('combobox',{name:'对话模型',exact:true});
  await chatSelection.click();await page.getByRole('option',{name:'Local acceptance · New',exact:true}).click();await chatSelection.filter({hasText:'New'}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="对话模型"]').disabled);
  await screenshot('01-native-models-light');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  await page.getByRole('button',{name:'新建',exact:true}).first().click();
  const project=page.getByRole('dialog',{name:'新建作品',exact:true});await project.getByLabel('作品名称').fill('原生写作模型验收');await project.getByRole('button',{name:'创建',exact:true}).click();await project.waitFor({state:'detached'});
  await page.getByRole('button',{name:'写第一篇',exact:true}).click();
  const create=page.getByRole('dialog',{name:'新建文件',exact:true});await create.getByLabel('文件名称（无扩展名时按 .md 创建）').fill('001');await create.getByRole('button',{name:'创建',exact:true}).click();
  const editor=page.getByTestId('paper-editor').locator('.cm-content');await editor.click();await page.keyboard.insertText('夜雨落在窗沿。她把旧信放回抽屉。');await page.keyboard.press('Control+s');await page.getByTestId('paper-save-state').filter({hasText:'已保存'}).waitFor();
  const sessionId=requests.map(row=>row?.payload?.sessionId).filter(Boolean).at(-1);assert.ok(sessionId);
  const payload={sessionId,path:'正文/001.md',prefix:'夜雨落在窗沿。',suffix:'',selectedText:'她把旧信放回抽屉。'};
  const launcher=page.getByRole('button',{name:'打开写作搭档'});if(await launcher.isVisible().catch(()=>false))await launcher.click();
  const composer=page.getByRole('textbox',{name:'输入消息'});await composer.fill('请简短回复已收到。');await composer.press('Enter');await waitForCall('chat');
  assert.equal(report.calls.find(row=>row.kind==='chat').model,'fixture-new');
  await page.getByRole('button',{name:'发送',exact:true}).waitFor();
  report.checks.push('a fresh conversation applies saved chatModel through native selection and sends actual chat inference');
  const before=await editor.innerText();
  const fim=await rpc('/manuscript','fim.complete',payload);const rewrite=await rpc('/manuscript','patch.complete',payload);
  assert.equal(fim.text,'雨'.repeat(240));assert.equal(rewrite.text,'她将旧信收进抽屉，轻轻合上。');assert.equal(await editor.innerText(),before);
  assert.equal(report.calls.find(row=>row.kind==='completion').model,'fixture-new');assert.equal(report.calls.find(row=>row.kind==='rewrite').model,'fixture-legacy');
  // This adapter maps native off to no wire reasoning parameter.
  assert.equal(report.calls.find(row=>row.kind==='completion').effort,undefined);
  assert.match(await readFile(patch,'utf8'), /reasoningEffort:\s*off/);
  const usage=await rpc('/manuscript','usage.summary',{days:1});assert.ok(usage.days.some(day=>day.byModel['local-test/fixture-legacy']?.outputTokens>0));assert.ok(usage.log.some(row=>row.model==='local-test/fixture-legacy'));
  report.checks.push('saved models and explicit reasoning off drive real native completion/rewrite, retain usage and do not modify author text');
  const assist=find('manuscript-assist');
  assert.ok(assist, 'manuscript-assist present')
  await native('setPluginEnabled',[assist.entryId,false]);
  const disabled=await requestResult('/manuscript','fim.complete',payload);assert.equal(disabled.ok,false);
  await native('setPluginEnabled',[assist.entryId,true]);
  assert.equal((await rpc('/manuscript','fim.complete',payload)).text,'雨'.repeat(240));
  report.checks.push('writing assist disabled/enabled without a model-center service and author text retained');
  dialog=await openSettings();await dialog.getByRole('tab',{name:'模型',exact:true}).click();
  for(const name of ['补全模型','改写模型']){const picker=dialog.getByRole('combobox',{name,exact:true});await picker.click();await page.getByRole('option',{name:'跟随当前对话',exact:true}).click();await picker.filter({hasText:'跟随当前对话'}).waitFor();await page.waitForFunction(name=>!document.querySelector('[aria-label="'+name+'"]').disabled,name);}
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  const liveModel=page.locator('aside.chat').getByRole('combobox',{name:'选择模型',exact:true});await liveModel.click();await page.getByRole('option',{name:'Local acceptance · Legacy',exact:true}).click();await liveModel.filter({hasText:'Legacy'}).waitFor();
  const fallbackAt=report.calls.length;assert.equal((await rpc('/manuscript','fim.complete',payload)).text,'雨'.repeat(240));assert.equal((await rpc('/manuscript','patch.complete',payload)).text,'她将旧信收进抽屉，轻轻合上。');
  assert.equal(report.calls.slice(fallbackAt).find(row=>row.kind==='completion').model,'fixture-legacy');assert.equal(report.calls.slice(fallbackAt).find(row=>row.kind==='rewrite').model,'fixture-legacy');assert.equal(await editor.innerText(),before);
  report.checks.push('follow-current routes use the live pending session choice before another chat turn commits it, without writing author text');
  dialog=await openSettings();await dialog.getByRole('tab',{name:'模型',exact:true}).click();const restored=dialog.getByRole('combobox',{name:'补全模型',exact:true});await restored.click();await page.getByRole('option',{name:'Local acceptance · New',exact:true}).click();await restored.filter({hasText:'New'}).waitFor();await page.waitForFunction(()=>!document.querySelector('[aria-label="补全模型"]').disabled);await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  await page.screenshot({path:resolve(output,'02-writing.png'),fullPage:true});
  const settingText=await readFile(patch,'utf8');assert.ok(settingText.includes('fixture-new'));
  child.kill();await new Promise(done=>child.once('exit',done));url=await startHost();await page.goto(url);await page.locator('.shell').waitFor({timeout:60000});
  dialog=await openSettings();await dialog.getByRole('tab',{name:'模型',exact:true}).click();await dialog.getByRole('combobox',{name:'补全模型',exact:true}).filter({hasText:'New'}).waitFor();
  report.checks.push('real host restart preserves the native writing model selection');
  if(process.env.E2E_OPTIONAL_INSTALL === '1') {
    await page.keyboard.press('Escape');
    const versions = { 'current-title': '0.1.7', mood: '0.1.6', recap: '0.1.7', zhihu: '0.1.10' };
    const installReceipts = [];
    for(const [id,version] of Object.entries(versions)) {
      const spec = 'npm:@klarkxy/dsh-' + id + '@' + version;
      const inspected = await native('inspect', [spec]);
      assert.notEqual(inspected.status,'refused',JSON.stringify(inspected));
      let result;
      if(id === 'zhihu') {
        const marketplace = await openPlugins();
        await marketplace.locator('[data-plugin-panel]').waitFor();
        await screenshot('03-npm-install-confirm');await page.setViewportSize({width:760,height:1000});assert.ok(await marketplace.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await screenshot('03-npm-install-confirm-760');await page.setViewportSize({width:1440,height:1000});
        result = await native('installBundle', [spec, { requestId: 'e2e-' + id }]);
        await marketplace.getByRole('button',{name:/返回首页|返回写作/}).click();
        report.checks.push('npm input and official manager install Zhihu through the native plugin page');
      } else {
        result = await native('installBundle', [spec, { requestId: 'e2e-' + id }]);
      }
      assert.equal(result.changed,true,JSON.stringify(result));
      assert.equal(result.application,'restart-required');
      installReceipts.push({name:'@klarkxy/dsh-'+id,version,spec});
    }
    report.installReceipts = installReceipts;
    report.checks.push('all four optional public plugins inspected and installed from exact npm artifacts through the real Editor RPC');
    const restart = async () => {
      await page.goto('about:blank');child.kill();await new Promise(done=>child.once('exit',done));
      await deployProfile(home,resolve(root,'.dev/desktop-profile-template'),resolve(runtime,'node_modules'));
      url=await startHost();await page.goto(url);await page.locator('.shell').waitFor({timeout:60000});
    };
    await restart();
    const installedPlugins = await native('listPlugins',[]);
    const installedBundles = await native('listBundles',[]);
    for(const id of Object.keys(versions)) {
      const name = '@klarkxy/dsh-' + id;
      const bundle = installedBundles.find(row => row.name === name);
      assert.equal(bundle?.enabled, true, id);
      assert.equal(bundle?.installed, true, id);
      assert.ok(installedPlugins.some(row => String(row.moduleName || '').includes(name) || String(row.entryId).includes(id)), id);
    }
    const installedPage = await openPlugins();await screenshot('03-optional-plugins-installed');
    assert.equal(await installedPage.locator('.plugins-page-nav').getByRole('button',{name:/^(知乎资料|知乎)$/}).count(),1);
    await installedPage.getByRole('button',{name:/返回首页|返回写作/}).click();
    await page.locator('button.theme-toggle:visible').first().click();await page.locator('.shell-theme.dark').waitFor({timeout:10000});
    const darkPlugins=await openPlugins();await darkPlugins.locator('[data-plugin-panel]').waitFor();
    await page.setViewportSize({width:760,height:1000});assert.ok(await darkPlugins.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await screenshot('03-market-dark-760');await page.setViewportSize({width:1440,height:1000});await darkPlugins.getByRole('button',{name:/返回首页|返回写作/}).click();
    const toolCallAt=report.calls.length;
    await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('请只回复工具已就绪，不要调用工具。');await page.getByRole('textbox',{name:'输入消息',exact:true}).press('Enter');await waitForCall('chat',toolCallAt);
    const actualTools=report.calls.slice(toolCallAt).find(call=>call.kind==='chat' && call.tools?.length)?.tools ?? [];
    for(const tool of ['zhihu_search','zhihu_question_recommendations','zhihu_quota','mood_requirements'])assert.ok(actualTools.some(name=>name===tool || name.endsWith('.'+tool)),tool+': '+JSON.stringify(actualTools));
    await delay(1000);report.checks.push('real native chat advertises optional Zhihu and Mood tools after installation; native plugin page remains usable at 760px');
    const storages = new Map();
    for(const file of ['dsh_editor_mood.json','dsh_editor_recap.json','dsh_editor_current_title.json','dsh_editor_zhihu.json']) {
      try { storages.set(file,await readFile(resolve(home,'storages',file),'utf8')); } catch(error) { if(error.code!=='ENOENT')throw error; }
    }
    report.checks.push('restart restores independently installed plugins as native bundles and exposes their configuration');
    for(const id of Object.keys(versions))await native('removeBundle',['@klarkxy/dsh-'+id]);
    await restart();
    const cleanBundles = await native('listBundles',[]);
    for(const id of Object.keys(versions))assert.equal(cleanBundles.some(row=>row.name==='@klarkxy/dsh-'+id),false,id);
    for(const [file,contents] of storages)assert.equal(await readFile(resolve(home,'storages',file),'utf8'),contents,file);
    await screenshot('04-after-optional-uninstall');
    report.checks.push('all four optional plugins uninstall and remain absent after restart while existing storage records survive');
  }
  assert.equal(report.errors.length,0,report.errors.join('\n'));report.ok=true;
} catch(error) {
  report.failure=String(error);process.exitCode=1
  if(page){await screenshot('failure').catch(()=>{});await writeFile(resolve(output,'failure-dom.txt'),await page.locator('body').innerText()).catch(()=>{})}
} finally {
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2))
  await writeFile(resolve(output,'host.log'),logs.join('').replace(/\?token=[A-Za-z0-9._~-]+/g,'?token=<redacted>'))
  await stop();console.log(JSON.stringify({ok:report.ok,checks:report.checks,output,failure:report.failure}))
}
