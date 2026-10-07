import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
const localRequire = createRequire(import.meta.url)
let AxeBuilder
try { ({ default: AxeBuilder } = localRequire('@axe-core/playwright')) }
catch {
  const toolkit = process.env.SETTINGS_UI_TOOLKIT || resolve(process.env.USERPROFILE || process.env.HOME, '.agents/tools/frontend/package.json')
  ;({ default: AxeBuilder } = createRequire(toolkit)('@axe-core/playwright'))
}
import { _electron as electron } from 'playwright'
import { assertDefaultPluginPage, closePluginsPage, openPluginsPage, openWebSearchSettings, openWritingPresets, showPluginList } from './helpers/plugin-page.mjs'

const root = resolve(import.meta.dirname, '..')
const stage = process.env.SETTINGS_UI_STAGE || 'after'
const output = resolve(root, 'e2e/out/settings-ui', stage)
const home = resolve(root, '.dev', 'settings-ui-' + Date.now())
const env = { ...process.env, DSH_TELEMETRY_DISABLED: '1', DSH_HOME: home,
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: resolve(root, '.dev/desktop-dsh-runtime-0.2.0-rc.2/lib/bin.js'),
  DSH_DESKTOP_PROFILE_TEMPLATE: resolve(root, '.dev/desktop-profile-template'),
  DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
  DSH_EDITOR_PROJECTS_ROOT: resolve(home, 'projects'),
}
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_SECRET|ELECTRON_RUN_AS_NODE/.test(key)) delete env[key]
await mkdir(output, { recursive: true })
let app
const report = { stage, pages: [], errors: [] }
try {
  app = await electron.launch({ executablePath: resolve(root, 'apps/desktop/node_modules/electron/dist/electron.exe'),
    args: [resolve(root, 'apps/desktop/dist/main.js')], env })
  const page = await app.firstWindow()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.waitForSelector('.shell', { timeout: 90000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  for (let i = 0; i < 5; i++) {
    const button = page.getByRole('button', { name: '继续', exact: true })
    if (!await button.waitFor({ state: 'visible', timeout: 1000 }).then(() => true, () => false)) break
    await button.click()
  }
  const later = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await later.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false)) await later.click()
  await app.evaluate(({ipcMain})=>{
    ipcMain.removeHandler('dsh-window:check-update')
    ipcMain.handle('dsh-window:check-update',()=>({status:'latest',currentVersion:'0.3.6'}))
  })
  await page.locator('.native-settings-control button[aria-haspopup="dialog"]').click()
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  await dialog.waitFor()
  const tabs = (await dialog.locator('.settings-nav [role="tab"]').allTextContents()).map(text => text.slice(0, text.length / 2) === text.slice(text.length / 2) ? text.slice(0, text.length / 2) : text)
  console.log('Settings pages: ' + tabs.join(', '))
  for (const [width, height] of (process.env.SETTINGS_UI_MATRIX === 'skip' ? [] : [[1440, 900], [1024, 720]])) {
    await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setSize(...bounds), [width, height])
    for (const theme of ['dark', 'light']) {
      await dialog.getByRole('tab', { name: '通用设置', exact: true }).click()
      await dialog.getByRole('button', { name: theme === 'dark' ? '深色' : '浅色', exact: true }).click()
      await page.waitForFunction(theme => document.querySelector('.shell-theme')?.classList.contains(theme), theme)
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i].trim()
        await dialog.locator('.settings-nav [role="tab"]').nth(i).click()
        if(tab === '用量') await dialog.locator('.usage-cards').waitFor()
        await page.waitForTimeout(300)
        const content = dialog.locator('.settings-content.is-active')
        const metrics = await content.evaluate(el => {
          const visible = node => node.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }) && node.getBoundingClientRect().width > 1 && node.getBoundingClientRect().height > 1
          const items = [...el.querySelectorAll('h1,h2,h3,h4,label,button,input,textarea,select,p,span,summary,a')].filter(visible)
          const fonts = items.filter(node => node.textContent?.trim() || node.matches('input,textarea,select')).map(node => {
            const style = getComputedStyle(node)
            return { tag: node.tagName, cls: node.className, text: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0,90), size: style.fontSize, weight: style.fontWeight, family: style.fontFamily, height: node.getBoundingClientRect().height }
          })
          const bounds = el.getBoundingClientRect()
          const overflow = items.filter(node => { const r=node.getBoundingClientRect(); return r.width>0 && (r.right > bounds.right+2 || r.left < bounds.left-2) }).map(node => ({tag:node.tagName,cls:node.className,text:node.textContent?.trim().slice(0,60)}))
          return { fonts, overflow, text: el.innerText, scrollWidth: el.scrollWidth, contentWidth: el.clientWidth }
        })
        const file = `${width}-${theme}-${i}.jpg`
        await dialog.screenshot({ path: resolve(output, file), quality: 85 })
        const scan = await new AxeBuilder({ page }).setLegacyMode().include('.settings-dialog').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
        metrics.accessibility = scan.violations.map(v => ({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))
        const scroller = dialog.locator('.settings-pages')
        assert.equal(await scroller.evaluate(el=>el.scrollTop), 0, tab + ' should open at the top')
        if (await scroller.evaluate(el=>el.scrollHeight > el.clientHeight + 2)) {
          await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight})
          await dialog.screenshot({path:resolve(output, `${width}-${theme}-${i}-bottom.jpg`),quality:85})
        }
        report.pages.push({ tab, width, height, theme, file, ...metrics })
        console.log(`${width} ${theme} ${tab}: ${metrics.fonts.length} elements; overflow ${metrics.overflow.length}; a11y ${metrics.accessibility.length}`)
      }
    }
  }
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  for (const [width, height] of (process.env.SETTINGS_UI_MATRIX === 'skip' ? [] : [[1440, 900], [1024, 720]])) {
    await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setSize(...bounds), [width, height])
    for (const theme of ['dark', 'light']) {
      await page.locator('.native-settings-control button[aria-haspopup="dialog"]').click()
      await dialog.getByRole('tab', { name: '通用设置', exact: true }).click()
      await dialog.getByRole('button', { name: theme === 'dark' ? '深色' : '浅色', exact: true }).click()
      await page.waitForFunction(theme => document.querySelector('.shell-theme')?.classList.contains(theme), theme)
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      const plugins = await openPluginsPage(page)
      await assertDefaultPluginPage(page, plugins)
      const surfaces = ['已安装', '写作模式', '发现插件', '网页搜索']
      for (const [i, tab] of surfaces.entries()) {
        await showPluginList(plugins)
        if (tab === '写作模式') await openWritingPresets(plugins)
        if (tab === '发现插件') {
          const discovery = plugins.getByTestId('plugins-settings')
          if (!await discovery.evaluate(element => element.open)) await discovery.locator(':scope > summary').click()
        }
        if (tab === '网页搜索') await openWebSearchSettings(plugins)
        await page.waitForTimeout(300)
        const content = plugins.locator('.plugins-page-content')
        const metrics = await content.evaluate(el => {
          const visible = node => node.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }) && node.getBoundingClientRect().width > 1 && node.getBoundingClientRect().height > 1
          const items = [...el.querySelectorAll('h1,h2,h3,h4,label,button,input,textarea,select,p,span,summary,a')].filter(visible)
          const fonts = items.filter(node => node.textContent?.trim() || node.matches('input,textarea,select')).map(node => {
            const style = getComputedStyle(node)
            return { tag: node.tagName, cls: node.className, text: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0,90), size: style.fontSize, weight: style.fontWeight, family: style.fontFamily, height: node.getBoundingClientRect().height }
          })
          const bounds = el.getBoundingClientRect()
          const overflow = items.filter(node => { const r=node.getBoundingClientRect(); return r.width>0 && (r.right > bounds.right+2 || r.left < bounds.left-2) }).map(node => ({tag:node.tagName,cls:node.className,text:node.textContent?.trim().slice(0,60)}))
          return { fonts, overflow, text: el.innerText, scrollWidth: el.scrollWidth, contentWidth: el.clientWidth }
        })
        const file = `plugins-${width}-${theme}-${i}.jpg`
        await plugins.screenshot({ path: resolve(output, file), quality: 85 })
        const scan = await new AxeBuilder({ page }).setLegacyMode().include('.plugins-page').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
        metrics.accessibility = scan.violations.map(v => ({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))
        if (await content.evaluate(el=>el.scrollHeight > el.clientHeight + 2)) {
          await content.evaluate(el=>{el.scrollTop=el.scrollHeight})
          await plugins.screenshot({path:resolve(output, `plugins-${width}-${theme}-${i}-bottom.jpg`),quality:85})
        }
        report.pages.push({ tab: '插件 / ' + tab, width, height, theme, file, ...metrics })
        console.log(`${width} ${theme} 插件 / ${tab}: ${metrics.fonts.length} elements; overflow ${metrics.overflow.length}; a11y ${metrics.accessibility.length}`)
      }
      await closePluginsPage(page)
    }
  }
  await page.locator('.native-settings-control button[aria-haspopup="dialog"]').click()
  await dialog.waitFor()
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1024,720))
  await dialog.getByRole('tab',{name:'通用设置',exact:true}).click()
  await dialog.getByRole('button',{name:'浅色',exact:true}).click()
  report.interactions = []
  const tabTo = async name => {
    await dialog.locator('.settings-nav').getByRole('tab', { name, exact: true }).click()
    await page.waitForTimeout(150)
  }
  const captureExtra = async name => {
    await page.waitForTimeout(300)
    await dialog.screenshot({ path: resolve(output, name + '.jpg'), quality: 85 })
    const scan = await new AxeBuilder({ page }).setLegacyMode().include('.settings-dialog').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
    report.interactions.push({ name, accessibility: scan.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})) })
  }
  await tabTo('通用设置')
  await page.evaluate(()=>{
    window.settingsKeyEvents=[]
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape') window.settingsKeyEvents.push({target:event.target?.outerHTML?.slice(0,500),openSelects:document.querySelectorAll('.select.open').length,listboxes:document.querySelectorAll('[role="listbox"]').length})
    },true)
  })
  const locale = dialog.getByRole('combobox', { name: '语言', exact: true })
  for (let attempt=0; attempt<20; attempt++) {
    await locale.click()
    await page.getByRole('listbox').waitFor()
    await page.keyboard.press('Escape')
    report.escapeChecks ??= []
    report.escapeChecks.push(await page.evaluate(()=>{
      const panel=document.querySelector('.settings-dialog')
      return {state:panel?.getAttribute('data-state'),ariaHidden:panel?.getAttribute('aria-hidden'),display:panel?getComputedStyle(panel).display:null}
    }))
    await page.getByRole('listbox').waitFor({state:'hidden'})
    await dialog.waitFor({state:'visible'})
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label') === '语言')
  }
  await dialog.getByRole('button', {name:'显示开发者选项',exact:true}).click()
  await captureExtra('general-developer')
  await tabTo('助手')
  const author = dialog.getByRole('textbox', {name:'跨作品作者约定',exact:true})
  await author.fill('界面验收：保持段落清晰。')
  await tabTo('写作')
  await tabTo('助手')
  assert.equal(await author.inputValue(), '界面验收：保持段落清晰。')
  await dialog.getByRole('button',{name:'保存作者约定',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.assistant-settings button')?.disabled)
  await captureExtra('assistant-saved')
  await tabTo('写作')
  const fontSlider = dialog.getByRole('slider',{name:'字号',exact:true})
  const oldSize=await fontSlider.getAttribute('aria-valuenow')
  await fontSlider.focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(oldSize => document.querySelector('[role="slider"][aria-label="字号"]')?.getAttribute('aria-valuenow') !== oldSize, oldSize)
  assert.notEqual(await fontSlider.getAttribute('aria-valuenow'),oldSize)
  await page.keyboard.press('ArrowLeft')
  await captureExtra('writing-keyboard')
  await tabTo('模型')
  await dialog.getByRole('button',{name:'编辑 DeepSeek',exact:true}).click()
  await dialog.locator('.models-customized summary').click()
  await captureExtra('model-editor')
  await dialog.locator('.models-editor').getByRole('button',{name:'取消',exact:true}).click()
  await dialog.getByRole('button',{name:'添加自定义提供方',exact:true}).click()
  await dialog.getByRole('textbox',{name:'Provider ID',exact:true}).fill('a-long-provider-name-for-layout-check')
  await captureExtra('model-custom')
  await dialog.locator('.models-add-card').getByRole('button',{name:'取消',exact:true}).click()
  await app.evaluate(({shell})=>{globalThis.settingsExternalUrls=[];shell.openExternal=async url=>{globalThis.settingsExternalUrls.push(url)}})
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  const plugins = await openPluginsPage(page)
  await assertDefaultPluginPage(page, plugins)
  const capturePluginExtra = async name => {
    await page.waitForTimeout(300)
    await plugins.screenshot({ path: resolve(output, name + '.jpg'), quality: 85 })
    const scan = await new AxeBuilder({ page }).setLegacyMode().include('.plugins-page').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
    report.interactions.push({ name, accessibility: scan.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})) })
  }
  await openWebSearchSettings(plugins)
  for (const details of await plugins.locator('.web-search-settings details').all()) {
    if (!await details.evaluate(el => el.open)) await details.locator(':scope > summary').click()
  }
  const feeLinks = plugins.locator('.web-search-settings a[aria-label$="费用说明"]')
  assert(await feeLinks.count() > 0)
  assert(await feeLinks.evaluateAll(nodes => nodes.every(node => node.href.startsWith('https://') && node.rel.includes('noopener'))))
  const signupLinks=plugins.locator('.web-search-settings a[aria-label$="去注册"]')
  const expectedUrls=await signupLinks.evaluateAll(nodes=>nodes.map(n=>n.href))
  for(const link of await signupLinks.all())await link.click()
  assert.ok(expectedUrls.length > 0, 'web search must expose provider signup links')
  assert.deepEqual(await app.evaluate(()=>globalThis.settingsExternalUrls),expectedUrls)
  await showPluginList(plugins)
  const discovery = plugins.getByTestId('plugins-settings')
  if (!await discovery.evaluate(element => element.open)) await discovery.locator(':scope > summary').click()
  const query = discovery.getByRole('textbox')
  await app.evaluate(({ ipcMain }) => {
    globalThis.settingsCopiedSpec = undefined
    ipcMain.removeHandler('dsh-window:clipboard-write-text')
    ipcMain.handle('dsh-window:clipboard-write-text', (_event, text) => { globalThis.settingsCopiedSpec = text })
  })
  await query.fill('npm:@klarkxy/dsh-zhihu@0.1.10')
  await discovery.locator('form').getByRole('button', { name: '复制规格', exact: true }).click()
  await discovery.getByText('已复制 @klarkxy/dsh-zhihu@0.1.10。请在官方插件页使用「添加插件」粘贴。', { exact: true }).waitFor()
  const installSpec = await app.evaluate(() => globalThis.settingsCopiedSpec)
  assert.equal(installSpec, '@klarkxy/dsh-zhihu@0.1.10')
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('dsh-window:clipboard-write-text')
    ipcMain.handle('dsh-window:clipboard-write-text', () => { throw new Error('Clipboard unavailable in regression fixture') })
  })
  await discovery.locator('form').getByRole('button', { name: '复制规格', exact: true }).click()
  await discovery.getByText(`请手动复制：${installSpec}`, { exact: true }).waitFor()
  await query.fill('')
  await discovery.locator('form').getByRole('button', { name: '搜索', exact: true }).waitFor()
  await capturePluginExtra('plugin-discovery')
  const add = plugins.locator('[data-plugin-panel]').getByRole('button', { name: '添加插件', exact: true })
  await add.click()
  const install = page.getByRole('dialog')
  await install.waitFor()
  const installInput = install.getByRole('textbox').first()
  await installInput.fill(installSpec)
  assert.equal(await installInput.inputValue(), installSpec)
  report.interactions.push({ name: 'discovery copies a native-compatible npm spec into the official install form', ok: true })
  await page.keyboard.press('Escape')
  await install.waitFor({ state: 'hidden' })
  await plugins.waitFor({ state: 'visible' })
  await capturePluginExtra('plugin-native-install-closed')
  await closePluginsPage(page)
  await page.locator('.native-settings-control button[aria-haspopup="dialog"]').click()
  await dialog.waitFor()
  await tabTo('关于')
  await app.evaluate(({ipcMain})=>{
    ipcMain.removeHandler('dsh-window:check-update')
    ipcMain.handle('dsh-window:check-update',()=>({status:'update-available',currentVersion:'0.3.6',latest:{version:'0.3.7',tag:'v0.3.7',name:'界面验证用更新',publishedAt:'2026-09-20T00:00:00Z',url:'https://github.com/klarkxy/dsh-editor/releases',body:'用于检查更新详情和插图是否相互遮挡。'.repeat(12)}}))
  })
  await dialog.getByRole('button',{name:'检查更新',exact:true}).click()
  await dialog.locator('.about-release').waitFor()
  await captureExtra('about-update')
  assert.equal(await dialog.locator('.about-page .about-note').filter({hasText:'macOS'}).count(),0)
  await page.emulateMedia({reducedMotion:'reduce'})
  await tabTo('通用设置')
  assert.equal(await dialog.locator('.settings-page').first().evaluate(el=>getComputedStyle(el).transform),'none')
  report.interactions.push({name:'settings keyboard, draft retention, save, native link dispatch, and reduced motion',ok:true})
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  // DSH permits peripheral 12px text and compact H20–28 controls. Keep the
  // 13px floor for standard controls; compact targets here must still be H24+.
  const tooSmall = f => {
    const interactive = /^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(f.tag)
    const compact = interactive && f.height >= 24 && f.height <= 28
    return parseFloat(f.size) < (interactive && !compact ? 13 : 12)
  }
  report.layoutIssues = report.pages.filter(p=>p.overflow.length || p.fonts.some(tooSmall)).map(p=>({tab:p.tab,width:p.width,theme:p.theme,overflow:p.overflow,small:p.fonts.filter(tooSmall)}))
  report.accessibilityIssues = [...report.pages,...report.interactions].filter(p=>p.accessibility?.length).map(p=>({page:p.tab||p.name,width:p.width,theme:p.theme,violations:p.accessibility}))
  report.ok = report.errors.length === 0 && report.layoutIssues.length === 0 && report.accessibilityIssues.length === 0
} catch(error) {
  report.ok = false
  report.errors.push(String(error.stack || error))
} finally {
  await writeFile(resolve(output,'report.json'), JSON.stringify(report,null,2))
  if(app) await app.close()
}
console.log(JSON.stringify({ok:report.ok, pages:report.pages.length,interactions:report.interactions?.length,layoutIssues:report.layoutIssues?.length,accessibilityIssues:report.accessibilityIssues?.length,errors:report.errors}))
process.exitCode=report.ok ? 0 : 1
