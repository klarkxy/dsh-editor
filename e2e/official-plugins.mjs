import { createServer } from 'node:http'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile, readFile, appendFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { nativePluginRpc, openPluginManager, openPluginsPage, closePluginsPage } from './helpers/plugin-page.mjs'
import { toggleTheme } from './helpers/theme.mjs'
import { S } from './helpers/selectors.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtureRequire = createRequire(resolve(root, 'packages/dsh-editor-shell/package.json'))
const { Document, Packer, Paragraph } = fixtureRequire('docx')
function pdfFixture() {
  const stream = 'BT /F1 24 Tf 36 120 Td (Official Preview) Tj ET'
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 180] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, value] of objects.entries()) { offsets.push(body.length); body += `${index+1} 0 obj\n${value}\nendobj\n` }
  const start = body.length
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${start}\n%%EOF\n`
  return body
}
const packaged = process.argv.includes('--packaged')
const executable = packaged ? resolve(root,'.pack/desktop/win-unpacked/DSH Editor.exe') : resolve(root,'apps/desktop/node_modules/electron/dist/electron.exe')
const launchArgs = packaged ? [] : [resolve(root,'apps/desktop/dist/main.js')]
const runtimeRoot = packaged ? resolve(root,'.pack/desktop/win-unpacked/resources/dsh') : resolve(root,'.dev/desktop-dsh-runtime-0.2.0-rc.2')
const output = resolve(root, packaged ? 'e2e/out/official-plugins-packaged' : 'e2e/out/official-plugins')
const home = resolve(root, '.dev/official-plugins-' + Date.now())
const env = { ...process.env, DSH_TELEMETRY_DISABLED: '1', DSH_HOME: home,
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: resolve(root, '.dev/desktop-dsh-runtime-0.2.0-rc.2/lib/bin.js'),
  DSH_DESKTOP_PROFILE_TEMPLATE: packaged ? resolve(root,'.pack/desktop/win-unpacked/resources/profile-template') : resolve(root, '.dev/desktop-profile-template'),
  DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
  DSH_EDITOR_PROJECTS_ROOT: resolve(home, 'projects'),
}
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_SECRET|ELECTRON_RUN_AS_NODE/.test(key)) delete env[key]
await mkdir(output, { recursive: true })
const report = { checks: [], errors: [], home, voiceIdle: [], microphoneRequests: 0 }
function check(message) { report.checks.push(message); console.log(message) }
const voiceName = '@deepseek-ai/dsh-experimental-voice-input-bundle'
const voiceIds = ['speech-to-text', 'speech-to-text-sensevoice', 'api-speech-to-text', 'ui-voice-input']
async function speechCatalog(page) {
  const method = 'speech/catalog'
  const response = await page.request.post(new URL(`/api/${method}`, page.url()).href, {
    timeout: 15000,
    data: { type: 'client-request', rpcId: `e2e-speech-${Date.now()}`, method, payload: { args: {} } },
  })
  assert.ok(response.ok(), `${method}: HTTP ${response.status()}`)
  const body = await response.json()
  const result = body.result ?? body
  if (result && typeof result === 'object' && 'ok' in result) {
    assert.ok(result.ok, `${method}: ${JSON.stringify(result)}`)
    return result.value
  }
  return result
}
async function assertVoiceIdle(page, stage) {
  let provider
  for (let attempt = 0; attempt < 150; attempt++) {
    provider = (await speechCatalog(page)).providers.find(provider => provider.id === 'sensevoice-local')
    assert.ok(provider, `${stage}: local speech provider is registered`)
    if (provider.preparation.phase !== 'checking') break
    await page.waitForTimeout(100)
  }
  assert.equal(provider.preparation.phase, 'unprepared', `${stage}: no implicit recognition preparation`)
  const microphoneRequests = await page.evaluate(() => window.__e2eMicrophoneRequests)
  assert.equal(microphoneRequests, 0, `${stage}: no microphone request`)
  assert.equal(report.microphoneRequests, 0, `${stage}: no microphone request across client reloads`)
  const modelFiles = await readdir(resolve(home, 'speech-to-text/sensevoice/models'), { recursive: true })
    .catch(error => { if (error.code === 'ENOENT') return []; throw error })
  assert.deepEqual(modelFiles, [], `${stage}: no downloaded model files`)
  report.voiceIdle.push({ stage, provider, microphoneRequests, modelFiles })
}
async function waitForVoiceState(page, enabled) {
  let bundle, components
  for (let attempt = 0; attempt < 150; attempt++) {
    bundle = (await nativePluginRpc(page, 'listBundles')).find(bundle => bundle.name === voiceName)
    components = (await nativePluginRpc(page, 'listPlugins'))
      .filter(row => voiceIds.includes(row.entryId.split(':').at(-1)))
    if (bundle?.enabled === enabled && (enabled
      ? components.length === voiceIds.length && components.every(row => row.enabled)
      : components.every(row => !row.enabled))) return { bundle, components }
    await page.waitForTimeout(100)
  }
  assert.fail(`voice state did not settle to ${enabled}: ${JSON.stringify({ bundle, components })}`)
}
async function waitForPdfPaint(page) {
  await page.waitForFunction(sel => [...document.querySelectorAll(sel)].some(canvas => {
    if (canvas.width < 10 || canvas.height < 10) return false
    const ctx = canvas.getContext('2d'); if (!ctx) return false
    const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data
    let ink = 0
    for (let index=0; index<pixels.length; index+=4) if (pixels[index+3] > 0 && pixels[index] < 100 && pixels[index+1] < 100 && pixels[index+2] < 100 && ++ink>10) return true
    return false
  }), S.officialResourcePanelCanvas, {timeout:30000})
}
let app, page
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const request = JSON.parse(raw)
  const answer = 'Local acceptance reply.'
  const base = {id:'fixture', created:1, model:'fixture'}
  if (!request.stream) { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({...base, object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:answer},finish_reason:'stop'}]})); return }
  res.writeHead(200, {'content-type':'text/event-stream'})
  for (const [delta, finish_reason] of [[{role:'assistant',content:answer},null],[{},'stop']]) res.write('data: '+JSON.stringify({...base,object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason}]})+'\n\n')
  res.end('data: [DONE]\n\n')
})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
env.DSH_AI_TEST_KEY = 'local-fixture'
await deployProfile(home, env.DSH_DESKTOP_PROFILE_TEMPLATE, resolve(runtimeRoot,'node_modules'))
await writeFile(resolve(home,'profiles/dsh-editor/cordis.patch.yml'), [
  '\n- id: llm-deepseek', '  disabled: true', '- id: llm-pi-ai', '  config:', '    providers:', '      local-test:', '        displayName: Local acceptance', '        api: openai-completions', '        baseURL: http://127.0.0.1:'+server.address().port+'/v1', '        apiKeyEnv: DSH_AI_TEST_KEY', '        models:', '          - id: fixture', '            name: Fixture', '            contextWindow: 32768', '            maxTokens: 4096', '- id: agent-default-model', '  config:', '    provider: local-test', '    model: fixture', '',
].join('\n'))
try {
  app = await electron.launch({ executablePath: executable,
    args: launchArgs, env, timeout: 90000 })
  app.process().stderr?.on('data', chunk => { const text=String(chunk); if (/error|failed|Error/.test(text)) console.log(text) })
  report.runtime = await app.evaluate(({app}) => ({packaged:app.isPackaged,electron:process.versions.electron,chrome:process.versions.chrome}))
  page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('dialog', dialog => { void dialog.accept().catch(() => {}) })
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') report.errors.push(message.type() + ': ' + message.text()) })
  page.on('pageerror', error => report.errors.push(error.message))
  // Electron may finish its first navigation before launch returns. Install the
  // observer before reloading so the complete client startup is measured.
  await app.context().exposeBinding('__e2eObserveMicrophone', () => { report.microphoneRequests++ })
  await app.context().addInitScript(() => {
    window.__e2eMicrophoneRequests = 0
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      window.__e2eMicrophoneRequests++
      await window.__e2eObserveMicrophone()
      throw new Error('Unexpected microphone request during voice idle acceptance')
    }
  })
  await page.reload()
  await page.waitForFunction(sel => document.querySelector(sel) || document.body?.innerText.includes('Failed to load plugins') || document.body?.innerText.includes('DSH Editor 启动失败'), S.shell, { timeout: 90000 })
  if (!await page.locator(S.shell).count()) {
    await page.getByText('dsh-editor-shell', { exact: true }).first().click().catch(() => {})
    throw new Error('Shell boot failed: ' + report.errors.join('\n') + '\n' + await page.locator(S.body).innerText())
  }
  for (let i=0;i<5;i++) {
    const next=page.getByRole('button',{name:'继续',exact:true})
    if (!await next.isVisible()) break
    await next.click()
  }
  const later=page.getByRole('button',{name:'稍后配置',exact:true})
  if (await later.isVisible()) await later.click()
  check('native desktop startup')
  await assertVoiceIdle(page, 'instrumented client startup')
  check('selected voice bundle starts unprepared without model downloads or microphone requests')
  const plugins = await openPluginsPage(page)
  const inventory = await nativePluginRpc(page, 'listPlugins')
  assert.ok(Array.isArray(inventory), 'native installed plugin inventory')
  const capabilityStates = [
    ['@deepseek-ai/dsh-client-shortcuts', true],
    ['@deepseek-ai/dsh-client-ui-shortcuts', true],
    ['@deepseek-ai/dsh-client-resources', true],
    ['@deepseek-ai/dsh-client-ui-sidebar-documentpreview', true],
    ['@deepseek-ai/dsh-office-to-pdf', true],
    ['@deepseek-ai/dsh-mcp-resources', false],
  ]
  report.capabilities = []
  for (const [moduleName, enabled] of capabilityStates) {
    const rows = inventory.filter(row => row.moduleName === moduleName)
    assert.equal(rows.length, 1, moduleName + ' must ship exactly once')
    assert.equal(rows[0].enabled, enabled, moduleName + ' enabled state')
    report.capabilities.push(rows[0])
  }
  const bootModules = await page.evaluate(() => window.__DSH_BOOT__?.entries?.map(entry => entry.id))
  assert.ok(Array.isArray(bootModules), 'client boot manifest is available')
  for (const [moduleName] of capabilityStates.filter(([moduleName, enabled]) => enabled && moduleName.includes('/dsh-client-'))) {
    assert.ok(bootModules.includes(moduleName), moduleName + ' is advertised to the client module loader')
  }
  // The official manager is the install, toggle and approval engine; it lives on
  // the 安装与卸载 page, so select that page before touching its panel.
  const manager = await openPluginManager(plugins)
  await manager.locator(S.pluginPanel).getByRole('button', {name:'查看 语音输入',exact:true}).waitFor()
  check('native inventory and boot manifest enable shortcuts and document previews; MCP resources ship disabled')
  await page.screenshot({path:resolve(output,'plugins-light.png')})
  // Built-in availability, bundle selection, component activation and model
  // preparation are separate native states.
  await manager.locator(S.pluginPanel).getByRole('button', {name:'查看 语音输入',exact:true}).click()
  const voiceSwitch = plugins.getByRole('switch', {name:'启用 语音输入',exact:true})
  const voiceBundle = (await nativePluginRpc(page, 'listBundles')).find(bundle => bundle.name === voiceName)
  const voiceComponents = voiceIds
    .map(id => inventory.find(row => row.entryId.split(':').at(-1) === id))
  report.voice = { bundle: voiceBundle, components: voiceComponents, checked: await voiceSwitch.getAttribute('aria-checked') }
  assert.ok(voiceBundle, 'voice bundle is available in the native distribution')
  assert.equal(voiceBundle.enabled, true, 'voice bundle is selected by the distribution')
  assert.equal(voiceBundle.installed, false, 'runtime-provided voice bundle is not a profile dependency')
  assert.equal(await voiceSwitch.getAttribute('aria-checked'), String(voiceBundle.enabled), 'native switch reflects bundle selection')
  for (const [index, row] of voiceComponents.entries()) {
    assert.ok(row, 'voice component exists: ' + index)
    assert.equal(row.enabled, true, row.entryId + ' is active with the selected voice bundle')
  }
  assert.ok(bootModules.includes('@deepseek-ai/dsh-experimental-client-ui-voice-input'), 'voice activity is advertised to the client module loader')
  const voiceConfiguration = manager.locator(S.pluginConfig)
  await voiceConfiguration.getByRole('button', {name:'下载并准备',exact:true}).waitFor()
  assert.equal(await voiceConfiguration.getByRole('button', {name:'下载并准备',exact:true}).isEnabled(),true)
  await page.screenshot({path:resolve(output,'voice-preparation.png')})
  await assertVoiceIdle(page, 'preparation page visit')
  check('official voice preparation page does not download or record on visit')
  await voiceSwitch.click()
  await page.waitForFunction(sel => document.querySelector(sel)?.getAttribute('aria-checked') === 'false', S.switch('启用 语音输入'))
  report.voice.disabled = await waitForVoiceState(page, false)
  assert.equal(await page.evaluate(() => window.__e2eMicrophoneRequests), 0, 'disabling voice does not request microphone')
  await voiceSwitch.click()
  await page.waitForFunction(sel => document.querySelector(sel)?.getAttribute('aria-checked') === 'true', S.switch('启用 语音输入'))
  report.voice.reenabled = await waitForVoiceState(page, true)
  await voiceConfiguration.getByRole('button', {name:'下载并准备',exact:true}).waitFor()
  await assertVoiceIdle(page, 'bundle off/on')
  check('native voice bundle off/on restores active components without preparing or recording')
  await closePluginsPage(page)
  if (process.argv.includes('--staged')) { report.ok=true; throw Object.assign(new Error('staged checks complete'), { stagedComplete: true }) }
  await page.locator(S.nativeSettingsButton).click()
  await page.getByRole('tab',{name:'快捷键',exact:true}).click()
  await page.getByRole('button',{name:'编辑快捷键',exact:true}).click()
  await page.screenshot({path:resolve(output,'shortcuts.png')})
  assert((await page.locator(S.body).innerText()).includes('新建窗口'))
  check('official shortcut dialog contains Editor commands')
  await page.getByRole('button', {name:'修改命令面板快捷键', exact:true}).click()
  await page.keyboard.press('Control+Alt+K')
  await page.getByText('已修改', {exact:true}).waitFor()
  const saved = JSON.parse(await readFile(resolve(home, 'electron-user-data/keybindings.json'), 'utf8'))
  assert(JSON.stringify(saved).includes('editor.palette.open'))
  check('shortcut edit persists through desktop bridge')
  await page.getByRole('button',{name:'关闭快捷键',exact:true}).click()
  await page.keyboard.press('Escape')
  await app.evaluate(({BrowserWindow}) => { const w=BrowserWindow.getAllWindows()[0]; w.focus(); w.webContents.sendInputEvent({type:'keyDown',keyCode:'K',modifiers:['control','alt']}); w.webContents.sendInputEvent({type:'keyUp',keyCode:'K',modifiers:['control','alt']}) })
  await page.locator(S.cmdkRoot).waitFor()
  await page.keyboard.press('Escape')
  check('edited shortcut executes Editor command')
  await page.getByRole('button', { name: '新建作品' }).first().click()
  const projectDialog = page.getByRole('dialog', { name: '新建作品' })
  await projectDialog.getByLabel('作品名称').fill('official-fixture')
  await projectDialog.getByRole('button', { name: '创建', exact: true }).click()
  await page.locator(S.tree).waitFor({timeout:30000})
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('原生草稿接入检查')
  assert.equal(await page.getByRole('textbox',{name:'输入消息',exact:true}).inputValue(), '原生草稿接入检查')
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('')
  check('native draft projects into Editor composer')
  report.composer = await page.locator(S.composer).innerText()
  await page.screenshot({path:resolve(output,'workbench.png')})
  const project = resolve(home, 'projects/official-fixture')
  await writeFile(resolve(project, 'preview.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64'))
  await writeFile(resolve(project, 'preview.pdf'), pdfFixture())
  await writeFile(resolve(project, 'preview.docx'), await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Official Office Preview')] }] })))
  await writeFile(resolve(project, 'fixture.md'), '# Preview fixture\n')
  await writeFile(resolve(project, 'preview.csv'), 'name,value\nPreview,42\n')
  await page.getByRole('button',{name:'作品菜单'}).click()
  await page.getByRole('menuitem',{name:'返回作品列表'}).click()
  await page.locator(S.homeRecent).getByRole('button',{name:/official-fixture/}).first().click()
  await page.locator(S.tree).waitFor({timeout:30000})
  await page.locator(S.treePath('preview.png')).dblclick()
  await page.locator(S.officialResourcePanelVisible).waitFor()
  await page.waitForFunction(sel => [...document.querySelectorAll(sel)].some(img=>img.complete && img.naturalWidth > 0), S.officialResourcePanelImg)
  await page.screenshot({path:resolve(output,'preview-image.png')})
  check('official image preview renders local workspace resource')
  await page.locator(S.treePath('preview.csv')).dblclick()
  await page.locator(S.officialResourcePanel).getByText('CSV', {exact:true}).waitFor()
  await page.locator(S.officialResourcePanelCanvas).first().waitFor()
  await page.screenshot({path:resolve(output,'preview-spreadsheet.png')})
  check('official spreadsheet preview renders CSV cells')
  await page.locator(S.treePath('preview.pdf')).dblclick()
  await page.locator(S.officialResourcePanelCanvas).first().waitFor({timeout:30000})
  await waitForPdfPaint(page)
  await page.screenshot({path:resolve(output,'preview-pdf.png')})
  check('official PDF preview renders a page')
  await page.locator(S.treePath('preview.docx')).dblclick()
  await page.waitForFunction(({ canvas, failed }) => document.querySelector(canvas) || document.querySelector(failed), { canvas: S.officialResourcePanelCanvas, failed: S.officialResourcePanelFailed }, {timeout:75000})
  assert.equal(await page.locator(S.officialResourcePanelFailed).count(),0,await page.locator(S.officialResourcePanel).innerText())
  await waitForPdfPaint(page)
  check('official Office preview converts DOCX and renders PDF')
  report.office = await page.locator(S.officialResourcePanel).innerText()
  await page.screenshot({path:resolve(output,'preview-office.png')})

  await page.getByRole('button',{name:'收起右侧边栏',exact:true}).click()
  // Explicit close button follows the native document panel's accessible controls.
  report.panelButtons = await page.locator(S.officialResourcePanelButton).evaluateAll(nodes=>nodes.map(node=>({label:node.getAttribute('aria-label'),title:node.title,text:node.textContent})))
  await toggleTheme(page)
  await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'))
  await page.locator(S.treePath('preview.pdf')).dblclick()
  await waitForPdfPaint(page)
  await page.screenshot({path:resolve(output,'preview-dark.png')})
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(860,720))
  await page.waitForFunction(()=>innerWidth<=860)
  // 860px: the aux rail re-hosts into the right-side Drawer; the official
  // panel keeps rendering inside it (its own 收起右侧边栏 button stays).
  await page.locator(S.dshDrawer).waitFor({timeout:30000})
  await page.getByRole('button',{name:'收起右侧边栏',exact:true}).waitFor()
  assert(await page.locator(S.officialResourcePanel).evaluate(panel => {const box=panel.getBoundingClientRect(); return panel.contains(document.elementFromPoint(box.right-20,box.top+30))}))
  await page.screenshot({path:resolve(output,'preview-narrow.png')})
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,900))
  check('official panel follows Editor dark theme')
  await page.getByRole('button',{name:'收起右侧边栏',exact:true}).click()
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('local conversation fixture')
  await page.getByRole('textbox',{name:'输入消息',exact:true}).press('Enter')
  await page.getByText('Local acceptance reply.',{exact:true}).waitFor({timeout:30000})
  await page.getByRole('button',{name:'新对话',exact:true}).click()
  await page.getByRole('button',{name:'开始对话',exact:true}).click()
  await page.getByRole('button',{name:'对话操作',exact:true}).click()
  await page.getByRole('menuitem',{name:'置顶对话',exact:true}).click()
  await page.getByRole('button',{name:'对话操作',exact:true}).click()
  await page.getByRole('menuitem',{name:'取消置顶',exact:true}).waitFor()
  await page.getByRole('menuitem',{name:'归档',exact:true}).click()
  await page.locator(S.archivedConversationsSummary).click()
  await page.locator(S.archivedConversations).getByRole('button',{name:'恢复',exact:true}).click()
  await page.locator(S.archivedConversations).waitFor({state:'hidden'})
  check('native conversation pin, archive and restore')
  await page.locator(S.cmContent).fill('# Preview fixture\nSaved with upgraded desktop.')
  await page.locator(S.cmContent).press('Control+s')
  for (let attempt=0;attempt<50;attempt++) {
    if ((await readFile(resolve(project,'fixture.md'),'utf8')).includes('Saved with upgraded desktop.')) break
    await page.waitForTimeout(100)
  }
  assert((await readFile(resolve(project,'fixture.md'),'utf8')).includes('Saved with upgraded desktop.'))
  check('manuscript editing and durable save after runtime upgrade')

  await app.close(); app=undefined
  app = await electron.launch({ executablePath: executable, args: launchArgs,env,timeout:90000 })
  page=await app.firstWindow()
  await page.locator(S.shell).waitFor({timeout:90000})
  assert.equal(await page.locator(S.paletteTriggerKbd).innerText(),'Ctrl+Alt+K')
  check('custom shortcut survives desktop restart')
  report.ok=true
} catch(error) {
  if (!error.stagedComplete) { report.ok=false; report.failure=String(error?.stack || error) }
  if (page) {
    report.body=await page.locator(S.body).innerText().catch(()=> '')
    await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{})
  }
} finally {
  await app?.close().catch(()=>{})
  server.closeAllConnections(); await new Promise(done=>server.close(done))
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n')
}
console.log(JSON.stringify(report,null,2))
if (!report.ok) process.exitCode=1
