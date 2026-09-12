/** Real Electron UI acceptance for desktop decluttering/settings. Usage responses alone are synthetic. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { usageFixture } from './usage-fixture.mjs'
const root = resolve(import.meta.dirname, '..')
const nonce = new Date().toISOString().replace(/[:.]/g, '-')
const run = resolve(root, '.dev', `desktop-polish-${nonce}`)
const output = resolve(root, 'e2e/out/desktop-polish', nonce)
await mkdir(output, { recursive: true })
const env = { ...process.env, DSH_HOME: resolve(run, 'home'), DSH_DESKTOP_USER_DATA_DIR: resolve(run, 'electron'), DSH_TELEMETRY_DISABLED: '1', DSH_DESKTOP_NODE_PATH: process.execPath, DSH_DESKTOP_CLI_PATH: resolve(root, '.dev/desktop-dsh-runtime/lib/bin.js'), DSH_DESKTOP_PROFILE_TEMPLATE: resolve(root, '.dev/desktop-profile-template'), DSH_EDITOR_PROJECTS_ROOT: resolve(run, 'projects') }
for (const key of ['ELECTRON_RUN_AS_NODE', 'DEEPSEEK_API_KEY', 'DSH_EDITOR_CUSTOM_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'MINIMAX_API_KEY']) delete env[key]
const report = { started: new Date().toISOString(), method: 'Real Electron and filesystem; deterministic usage-summary response fixture only', checks: [], errors: [], shots: [], metrics: {}, output }
let app, page, usageKind = 'mixed'
const mark = name => { report.checks.push(name); console.log('PASS ' + name) }
const shot = async name => { await page.screenshot({ path: resolve(output, name + '.png') }); report.shots.push(name + '.png') }
const openSettings = async tab => {
  if (!await page.locator('.settings-dialog').isVisible().catch(() => false)) await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.locator('.settings-nav').getByRole('tab', { name: tab, exact: true }).click()
  await page.waitForTimeout(250)
}
const closeSettings = async () => { await page.getByRole('button', { name: '关闭设置', exact: true }).click(); await page.locator('.settings-dialog').waitFor({ state: 'hidden' }) }
const noDesktopTools = async () => {
  assert.equal(await page.getByTestId('proofread-open').count(), 0)
  assert.equal(await page.getByTestId('zhihu-open').count(), 0)
  assert(!/校对|知乎资料/.test(await page.locator('.chrome').innerText()))
}
const within = async locator => locator.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 })
try {
  app = await electron.launch({ executablePath: resolve(root, 'apps/desktop/node_modules/electron/dist/electron.exe'), args: [resolve(root, 'apps/desktop/dist/main.js')], env, timeout: 90000 })
  page = await app.firstWindow(); page.setDefaultTimeout(20000)
  page.on('pageerror', error => report.errors.push(error.message))
  // Electron protocol interception reports HTTP 0; supply deterministic Responses at fetch,
  // keeping the real production RPC client and all non-usage traffic unchanged.
  await page.exposeFunction('__desktopPolishUsage', () => usageFixture(usageKind))
  const installUsageFixture = () => {
    if(globalThis.__desktopPolishUsageInstalled)return
    globalThis.__desktopPolishUsageInstalled=true
    const realFetch=globalThis.fetch
    globalThis.fetch=async(input,init)=>{
      const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href)
      if(!url.pathname.endsWith('/manuscript/usage.summary'))return realFetch(input,init)
      const request=JSON.parse(init.body)
      const value=await globalThis.__desktopPolishUsage()
      return new Response(JSON.stringify({type:'server-response',rpcId:request.rpcId,result:{ok:true,value}}),{status:200,headers:{'content-type':'application/json'}})
    }
  }
  await page.addInitScript(installUsageFixture)
  await page.evaluate(installUsageFixture)
  await page.waitForFunction(() => !!document.querySelector('.shell') || document.body.innerText.includes('DSH Editor 启动失败'), undefined, { timeout: 90000 })
  if (!await page.locator('.shell').count()) { report.startupRetry = await page.locator('body').innerText(); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.locator('.shell').waitFor({ timeout: 90000 }) }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  for (let i = 0; i < 5; i++) { const b = page.getByRole('button', { name: '继续', exact: true }); if (!await b.isVisible().catch(() => false)) break; await b.click() }
  const later = page.getByRole('button', { name: '稍后配置', exact: true }); if (await later.isVisible().catch(() => false)) await later.click()
  await noDesktopTools(); await shot('01-home'); mark('home has no proofreading or Zhihu launchers')
  await page.getByRole('button', { name: '新建', exact: true }).first().click()
  const create = page.getByRole('dialog', { name: '新建作品' })
  await create.getByLabel('作品名称').fill('一部名字比较长的写作验收作品')
  await create.getByRole('button', { name: '创建', exact: true }).click()
  await page.locator('.tree').waitFor({ timeout: 45000 })
  const project = resolve(run, 'projects/一部名字比较长的写作验收作品')
  const original = '# 雾港\n\n雾比灯先到。林简把船票收回口袋，沿着没有亮灯的栈桥往前走。\n\n广播念到她的名字时，她停了下来。\n'
  await mkdir(resolve(project, '正文'), { recursive: true })
  await writeFile(resolve(project, '正文/001 验收.md'), original)
  await writeFile(resolve(project, 'AGENTS.md'), '# 隔离测试辅助文件\n不应显示，但必须保留。\n')
  await page.evaluate(() => localStorage.setItem('dsh-editor.tree.show-aux-files', '1'))
  await page.reload(); await page.locator('.tree').waitFor({ timeout: 45000 })
  const dir = page.locator('.tree-directory-row > .tree-row').filter({ hasText: '正文' }).first()
  if (await dir.getAttribute('aria-expanded') !== 'true') await dir.click()
  await page.locator('.tree-row.tree-main').filter({ hasText: '001 验收.md' }).click()
  await page.getByTestId('paper-editor').waitFor()
  await noDesktopTools()
  assert.equal(await page.locator('.tree-row').filter({ hasText: 'AGENTS.md' }).count(), 0)
  assert.equal(await page.getByRole('button', { name: /辅助文件/ }).count(), 0)
  assert((await readFile(resolve(project, 'AGENTS.md'), 'utf8')).includes('必须保留'))
  mark('old auxiliary preference cannot reveal files; auxiliary file remains on disk')
  await page.locator('.side-search').fill('隔离测试辅助文件'); await page.locator('.side-search').press('Enter')
  await page.locator('.search-panel').getByText('未找到匹配内容。', {exact:true}).waitFor()
  assert.equal(await page.locator('.search-results').filter({hasText:'AGENTS.md'}).count(),0,'author search must not reveal auxiliary files')
  assert(await page.locator('.search-panel').getByRole('button',{name:'全部替换…',exact:true}).isDisabled(),'hidden auxiliary hits cannot enter replace-all')
  await page.reload();await page.getByTestId('paper-editor').waitFor({timeout:45000})
  await page.getByTestId('paper-editor-menu-trigger').click()
  assert.equal(await page.getByTestId('editor-menu-proofread').count(), 0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Shift+L')
  assert.equal(await page.getByRole('region', { name: '校对', exact: true }).count(), 0)
  mark('proofreading menu and desktop panel shortcut are paused')
  const input = page.getByTestId('paper-editor').locator('.cm-content')
  await input.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('实际编辑保存验证。')
  await page.getByTestId('paper-save-state').filter({ hasText: '已保存' }).waitFor()
  assert((await readFile(resolve(project, '正文/001 验收.md'), 'utf8')).includes('实际编辑保存验证。'))
  mark('ordinary editing still autosaves to the real file')
  await shot('02-work-light')

  // Remaining visual/scroll/chart checks are kept on the same native page.
  for (const size of [[1440,900],[1280,720]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), size)
    await page.waitForTimeout(300)
    const buttons = await page.locator('.chrome button').evaluateAll(es => es.filter(el => el.getBoundingClientRect().width > 0).map(el => ({ text: el.textContent, rect: el.getBoundingClientRect().toJSON() })))
    for (let i=0;i<buttons.length;i++) for(let j=i+1;j<buttons.length;j++) {
      const a=buttons[i].rect,b=buttons[j].rect
      if (!(Math.min(a.right,b.right)-Math.max(a.left,b.left)<=1 || Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<=1)) report.errors.push('topbar buttons overlap: '+buttons[i].text+' / '+buttons[j].text)
    }
    report.metrics['topbar-'+size[0]] = buttons
  }
  if(!report.errors.some(e=>e.startsWith('topbar buttons overlap')))mark('long work title does not overlap topbar controls at both window sizes')
  await openSettings('写作')
  const panel = page.locator('.settings-pages')
  const before = await panel.evaluate(el => ({ top: el.scrollTop, height: el.clientHeight, scroll: el.scrollHeight }))
  const b = await panel.boundingBox(); await page.mouse.move(b.x+b.width/2, b.y+150); await page.mouse.wheel(0,1800); await page.waitForTimeout(350)
  const after = await panel.evaluate(el => ({ top: el.scrollTop, height: el.clientHeight, scroll: el.scrollHeight }))
  assert(after.top>before.top, 'writing tab must really scroll with the wheel')
  const rangeBorder=await page.locator('.paper-typography input[type=range]').first().evaluate(el=>getComputedStyle(el).borderTopWidth)
  assert.equal(rangeBorder,'0px','range input must not inherit text-box border')
  const savePrefs = page.getByRole('button',{name:'保存作者约定',exact:true})
  assert(await within(savePrefs), 'last settings control is clipped')
  await shot('03-writing-bottom')
  await page.getByRole('textbox',{name:'跨作品作者约定',exact:true}).fill('保持第三人称限知，允许留白。')
  await savePrefs.click()
  report.metrics.writingScroll={before,after}
  mark('writing settings scroll to reachable final field and save action')
  await closeSettings()
  await openSettings('写作')
  await panel.focus(); await page.keyboard.press('End'); await page.waitForTimeout(250)
  assert((await panel.evaluate(el=>el.scrollTop))>0,'keyboard must scroll writing tab')
  assert.equal(await page.getByRole('textbox',{name:'跨作品作者约定',exact:true}).inputValue(),'保持第三人称限知，允许留白。')
  mark('writing settings support keyboard scrolling and persist author preferences')
  await closeSettings()

  await openSettings('知乎资料')
  await page.getByTestId('zhihu-settings-embed').waitFor()
  assert.equal(await page.getByTestId('zhihu-settings-embed').getByRole('tablist').evaluate(el=>getComputedStyle(el).flexDirection),'row','Zhihu tabs must stay horizontal')
  assert.equal(await page.locator('.settings-nav [role=tablist]').evaluate(el=>getComputedStyle(el).flexDirection),'column','settings navigation stays vertical')
  assert.equal(await page.getByRole('dialog').count(), 1, 'Zhihu must be embedded, not another modal')
  await page.getByTestId('zhihu-settings').getByText('Access Secret', { exact: false }).first().waitFor()
  const secretInput = page.getByTestId('zhihu-settings').locator('input')
  if (await secretInput.count()) assert.equal(await secretInput.first().getAttribute('type'), 'password')
  await shot('04-zhihu-settings'); await closeSettings()
  mark('Zhihu configuration is embedded inside settings with a masked credential field')

  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') { await page.locator('.theme-toggle').click(); await page.waitForTimeout(250) }
    await shot('05-work-' + theme)
    for (const kind of ['empty', 'single', 'mixed']) {
      usageKind = kind
      await openSettings('用量')
      if (kind === 'empty') {
        await page.locator('.usage-empty').waitFor()
        assert.equal(await page.locator('.usage-chart-plot svg').count(), 0, 'empty usage must not draw invented activity')
      } else {
        const chart = page.locator('.usage-chart-plot')
        await chart.locator('svg').waitFor()
        await page.waitForTimeout(500)
        assert(await within(chart), 'usage chart is clipped by the settings viewport')
        assert.equal(await page.locator('.usage-chart-bar').count(), 0, 'old full-height background bars are gone')
        const svgText = await chart.locator('svg').textContent()
        assert(svgText.includes('0') && /09|\//.test(svgText), 'chart needs readable scale and dates')
        assert(!/NaN|undefined/.test(svgText), 'chart labels contain invalid values')
        const date = usageFixture(kind).days.at(-1).date.slice(5).replace('-', '/')
        const tick = chart.locator('svg text').filter({ hasText: date }).last()
        const dateBox = await tick.boundingBox(), chartBox = await chart.boundingBox()
        await page.mouse.move(dateBox.x + dateBox.width / 2, chartBox.y + chartBox.height / 2)
        await page.waitForTimeout(350)
        const tooltipText = await page.locator('body').innerText()
        assert(tooltipText.includes('51,064'), 'tooltip should expose the exact MiniMax total')
        if(kind === 'mixed') assert(tooltipText.includes('77,064'), 'tooltip should expose exact combined daily total')
        await shot('06-usage-' + theme + '-' + kind)
        await page.locator('.usage-chart-table > summary').click()
        const table = page.locator('.usage-chart-table table')
        const tableText = await table.innerText()
        assert(tableText.includes('51,064'))
        if(kind === 'mixed') assert(tableText.includes('77,064') && tableText.includes('26,000'))
        const overflow = await page.locator('.settings-pages').evaluate(el => el.scrollWidth - el.clientWidth)
        if(overflow>1)report.errors.push('long model table creates horizontal overflow in settings: '+overflow)
        await page.locator('.usage-chart-table > summary').click()
        await page.locator('.settings-nav').getByRole('tab', { name: '写作', exact: true }).click()
        await page.locator('.settings-nav').getByRole('tab', { name: '用量', exact: true }).click()
        await chart.locator('svg').waitFor()
        assert.equal(await chart.locator('svg').count(), 1, 'tab switching must not duplicate chart instances')
        const beforeResize = await chart.boundingBox()
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
        await page.waitForTimeout(350)
        const afterResize = await chart.boundingBox()
        assert(await within(chart))
        const svgWidth = Number(await chart.locator('svg').getAttribute('width'))
        assert(Math.abs(svgWidth - afterResize.width) < 4, 'chart renderer did not resize with the container')
        report.metrics['chart-' + theme + '-' + kind] = { beforeResize, afterResize, svgWidth }
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 720))
        await page.waitForTimeout(250)
      }
      await closeSettings()
    }
  }
  mark('ECharts handles empty/single/multiple-model data, exact totals, themes, resize and tab switching')

  usageKind = 'markup'
  await openSettings('用量')
  const chart = page.locator('.usage-chart-plot'); await chart.locator('svg').waitFor(); await page.waitForTimeout(400)
  const date=usageFixture('markup').days.at(-1).date.slice(5).replace('-', '/')
  const tick=await chart.locator('svg text').filter({hasText:date}).last().boundingBox(), cb=await chart.boundingBox()
  await page.mouse.move(tick.x+tick.width/2,cb.y+cb.height/2);await page.waitForTimeout(250)
  if(await page.getByTestId('chart-injected-model').count())report.errors.push('model labels are interpreted as HTML')
  await closeSettings();if(!report.errors.includes('model labels are interpreted as HTML'))mark('chart treats provider model labels as plain text')

  await page.getByRole('button',{name:'版本',exact:true}).click()
  await page.getByRole('menuitem',{name:'保存版本',exact:true}).click()
  await page.locator('.side-status').filter({hasText:'已保存版本'}).waitFor()
  assert.equal(await page.locator('.snapshot-panel').count(),0,'saving a version should not unexpectedly open history')
  await page.getByRole('button',{name:'版本',exact:true}).click()
  await page.getByRole('menuitem',{name:'历史版本',exact:true}).click()
  await page.locator('.snapshot-row').first().waitFor()
  await shot('07-sidebar-version-history')
  mark('compact version menu still saves snapshots and opens history')
  report.ok = report.errors.length === 0

} catch(error) {
  report.ok=false; report.failure=error.stack??String(error); console.error(report.failure)
  if(page&&!page.isClosed()){await shot('failure').catch(()=>{});await writeFile(resolve(output,'failure-dom.txt'),await page.locator('body').innerText().catch(()=>''))}
} finally {
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2))
  if(app){await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.destroy()}).catch(()=>{});await app.close().catch(()=>{})}
  console.log('Report: '+resolve(output,'report.json'))
}
if(!report.ok)process.exitCode=1
