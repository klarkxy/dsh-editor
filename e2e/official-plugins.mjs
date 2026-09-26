import { createServer } from 'node:http'
import { deployProfile } from '../apps/desktop/dist/profile.js'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile, readFile, appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright'

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
const runtimeRoot = packaged ? resolve(root,'.pack/desktop/win-unpacked/resources/dsh') : resolve(root,'.dev/desktop-dsh-runtime-0.1.7-rc.2')
const output = resolve(root, packaged ? 'e2e/out/official-plugins-packaged' : 'e2e/out/official-plugins')
const home = resolve(root, '.dev/official-plugins-' + Date.now())
const env = { ...process.env, DSH_TELEMETRY_DISABLED: '1', DSH_HOME: home,
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: resolve(root, '.dev/desktop-dsh-runtime-0.1.7-rc.2/lib/bin.js'),
  DSH_DESKTOP_PROFILE_TEMPLATE: packaged ? resolve(root,'.pack/desktop/win-unpacked/resources/profile-template') : resolve(root, '.dev/desktop-profile-template'),
  DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
  DSH_EDITOR_PROJECTS_ROOT: resolve(home, 'projects'),
}
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_SECRET|ELECTRON_RUN_AS_NODE/.test(key)) delete env[key]
await mkdir(output, { recursive: true })
const report = { checks: [], errors: [], home }
function check(message) { report.checks.push(message); console.log(message) }
async function waitForPdfPaint(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('.official-resource-panel canvas')].some(canvas => {
    if (canvas.width < 10 || canvas.height < 10) return false
    const ctx = canvas.getContext('2d'); if (!ctx) return false
    const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data
    let ink = 0
    for (let index=0; index<pixels.length; index+=4) if (pixels[index+3] > 0 && pixels[index] < 100 && pixels[index+1] < 100 && pixels[index+2] < 100 && ++ink>10) return true
    return false
  }), undefined, {timeout:30000})
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
  await page.waitForFunction(() => document.querySelector('.shell') || document.body?.innerText.includes('Failed to load plugins') || document.body?.innerText.includes('DSH Editor 启动失败'), undefined, { timeout: 90000 })
  if (!await page.locator('.shell').count()) {
    await page.getByText('dsh-editor-shell', { exact: true }).first().click().catch(() => {})
    throw new Error('Shell boot failed: ' + report.errors.join('\n') + '\n' + await page.locator('body').innerText())
  }
  for (let i=0;i<5;i++) {
    const next=page.getByRole('button',{name:'继续',exact:true})
    if (!await next.isVisible()) break
    await next.click()
  }
  const later=page.getByRole('button',{name:'稍后配置',exact:true})
  if (await later.isVisible()) await later.click()
  check('native desktop startup')
  await page.locator('.plugins-trigger').click()
  await page.getByTestId('plugins-settings').waitFor()
  for (const name of ['快捷键','资料预览','MCP 资源','语音输入']) {
    await page.getByRole('switch', {name,exact:true}).waitFor()
  }
  check('official plugins available in existing manager')
  await page.screenshot({path:resolve(output,'plugins-light.png')})
  await page.locator('.plugins-page-nav button').filter({hasText:'@deepseek-ai/dsh-experimental-voice-input-bundle'}).first().click()
  await page.getByTestId('plugin-configuration-page').waitFor()
  assert.equal(await page.getByTestId('plugin-configuration-error').count(),0)
  await page.screenshot({path:resolve(output,'voice-preparation.png')})
  check('official voice preparation page without model download')
  await page.locator('.plugins-back').click()
  if (process.argv.includes('--staged')) { report.ok=true; throw Object.assign(new Error('staged checks complete'), { stagedComplete: true }) }
  await page.locator('.native-settings-control button').click()
  await page.getByRole('tab',{name:'快捷键',exact:true}).click()
  await page.getByRole('button',{name:'编辑快捷键',exact:true}).click()
  await page.screenshot({path:resolve(output,'shortcuts.png')})
  assert((await page.locator('body').innerText()).includes('新建窗口'))
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
  await page.locator('[cmdk-root]').waitFor()
  await page.keyboard.press('Escape')
  check('edited shortcut executes Editor command')
  await page.getByRole('button', { name: '新建', exact: true }).first().click()
  const projectDialog = page.getByRole('dialog', { name: '新建作品' })
  await projectDialog.getByLabel('作品名称').fill('official-fixture')
  await projectDialog.getByRole('button', { name: '创建', exact: true }).click()
  await page.locator('.tree').waitFor({timeout:30000})
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('原生草稿接入检查')
  assert.equal(await page.getByRole('textbox',{name:'输入消息',exact:true}).inputValue(), '原生草稿接入检查')
  await page.getByRole('textbox',{name:'输入消息',exact:true}).fill('')
  check('native draft projects into Editor composer')
  report.composer = await page.locator('.composer').innerText()
  await page.screenshot({path:resolve(output,'workbench.png')})
  const project = resolve(home, 'projects/official-fixture')
  await writeFile(resolve(project, 'preview.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64'))
  await writeFile(resolve(project, 'preview.pdf'), pdfFixture())
  await writeFile(resolve(project, 'preview.docx'), await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Official Office Preview')] }] })))
  await writeFile(resolve(project, 'fixture.md'), '# Preview fixture\n')
  await writeFile(resolve(project, 'preview.csv'), 'name,value\nPreview,42\n')
  await page.getByRole('button',{name:'作品菜单'}).click()
  await page.getByRole('menuitem',{name:'返回作品列表'}).click()
  await page.locator('.home-recent').getByRole('button',{name:/official-fixture/}).first().click()
  await page.locator('.tree').waitFor({timeout:30000})
  await page.locator('[data-tree-path="preview.png"]').dblclick()
  await page.locator('.official-resource-panel:not([hidden])').waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('.official-resource-panel img')].some(img=>img.complete && img.naturalWidth > 0))
  await page.screenshot({path:resolve(output,'preview-image.png')})
  check('official image preview renders local workspace resource')
  await page.locator('[data-tree-path="preview.csv"]').dblclick()
  await page.locator('.official-resource-panel').getByText('CSV', {exact:true}).waitFor()
  await page.locator('.official-resource-panel canvas').first().waitFor()
  await page.screenshot({path:resolve(output,'preview-spreadsheet.png')})
  check('official spreadsheet preview renders CSV cells')
  await page.locator('[data-tree-path="preview.pdf"]').dblclick()
  await page.locator('.official-resource-panel canvas').first().waitFor({timeout:30000})
  await waitForPdfPaint(page)
  await page.screenshot({path:resolve(output,'preview-pdf.png')})
  check('official PDF preview renders a page')
  await page.locator('[data-tree-path="preview.docx"]').dblclick()
  await page.waitForFunction(() => document.querySelector('.official-resource-panel canvas') || document.querySelector('.official-resource-panel [data-textpreview-failed]'), undefined, {timeout:75000})
  assert.equal(await page.locator('.official-resource-panel [data-textpreview-failed]').count(),0,await page.locator('.official-resource-panel').innerText())
  await waitForPdfPaint(page)
  check('official Office preview converts DOCX and renders PDF')
  report.office = await page.locator('.official-resource-panel').innerText()
  await page.screenshot({path:resolve(output,'preview-office.png')})

  await page.getByRole('button',{name:'收起右侧边栏',exact:true}).click()
  // Explicit close button follows the native document panel's accessible controls.
  report.panelButtons = await page.locator('.official-resource-panel button').evaluateAll(nodes=>nodes.map(node=>({label:node.getAttribute('aria-label'),title:node.title,text:node.textContent})))
  await page.locator('.theme-toggle').click()
  await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'))
  await page.locator('[data-tree-path="preview.pdf"]').dblclick()
  await waitForPdfPaint(page)
  await page.screenshot({path:resolve(output,'preview-dark.png')})
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(860,720))
  await page.waitForFunction(()=>innerWidth<=860)
  await page.getByRole('button',{name:'收起右侧边栏',exact:true}).waitFor()
  await page.waitForFunction(() => !document.querySelector('.shell.assistant-overlay'))
  assert(await page.locator('.official-resource-panel').evaluate(panel => {const box=panel.getBoundingClientRect(); return panel.contains(document.elementFromPoint(box.right-20,box.top+30))}))
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
  await page.locator('.archived-conversations summary').click()
  await page.locator('.archived-conversations').getByRole('button',{name:'恢复',exact:true}).click()
  await page.locator('.archived-conversations').waitFor({state:'hidden'})
  check('native conversation pin, archive and restore')
  await page.locator('.cm-content').fill('# Preview fixture\nSaved with upgraded desktop.')
  await page.locator('.cm-content').press('Control+s')
  for (let attempt=0;attempt<50;attempt++) {
    if ((await readFile(resolve(project,'fixture.md'),'utf8')).includes('Saved with upgraded desktop.')) break
    await page.waitForTimeout(100)
  }
  assert((await readFile(resolve(project,'fixture.md'),'utf8')).includes('Saved with upgraded desktop.'))
  check('manuscript editing and durable save after runtime upgrade')

  await app.close(); app=undefined
  app = await electron.launch({ executablePath: executable, args: launchArgs,env,timeout:90000 })
  page=await app.firstWindow()
  await page.locator('.shell').waitFor({timeout:90000})
  assert.equal(await page.locator('.palette-trigger-kbd').innerText(),'Ctrl+Alt+K')
  check('custom shortcut survives desktop restart')
  report.ok=true
} catch(error) {
  if (!error.stagedComplete) { report.ok=false; report.failure=String(error?.stack || error) }
  if (page) {
    report.body=await page.locator('body').innerText().catch(()=> '')
    await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{})
  }
} finally {
  await app?.close().catch(()=>{})
  server.closeAllConnections(); await new Promise(done=>server.close(done))
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n')
}
console.log(JSON.stringify(report,null,2))
if (!report.ok) process.exitCode=1
