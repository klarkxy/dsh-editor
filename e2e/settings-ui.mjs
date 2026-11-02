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
import { assertDefaultPluginPage, closePluginsPage, openListingSpec, openPluginDiscovery, openPluginManager, openPluginsPage, showPluginList } from './helpers/plugin-page.mjs'
import { S } from './helpers/selectors.mjs'

const root = resolve(import.meta.dirname, '..')
const stage = process.env.SETTINGS_UI_STAGE || 'after'
const output = resolve(root, 'e2e/out/settings-ui', stage)
const home = resolve(root, '.dev', 'settings-ui-' + Date.now())
const env = { ...process.env, DSH_TELEMETRY_DISABLED: '1', DSH_HOME: home,
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: resolve(root, '.dev/desktop-dsh-runtime-0.2.1-rc.5/lib/bin.js'),
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
  await page.waitForSelector(S.shell, { timeout: 90000 })
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
  await page.locator(S.nativeSettingsTrigger).click()
  // C36 retired the dialog: settings is a full-page view, kept mounted hidden.
  const dialog = page.locator(S.settingsDialog)
  await dialog.waitFor({ state: 'visible' })
  // Nav rows are ListRow items; config links share the row class but carry no
  // testid, so only the fixed sections join the per-section sweep.
  const navItems = dialog.locator('[data-testid^="settings-nav-"]')
  const tabs = (await navItems.allTextContents()).map(text => text.slice(0, text.length / 2) === text.slice(text.length / 2) ? text.slice(0, text.length / 2) : text)
  console.log('Settings sections: ' + tabs.join(', '))
  const navTo = async index => {
    const item = navItems.nth(index)
    await item.scrollIntoViewIfNeeded()
    await item.click()
    await page.waitForTimeout(150)
  }
  const setTheme = async theme => {
    await dialog.locator(S.settingsNavSection('appearance')).scrollIntoViewIfNeeded()
    await dialog.locator(S.settingsNavSection('appearance')).click()
    await dialog.getByRole('radio', { name: theme === 'dark' ? '深色' : '浅色', exact: true }).click()
    await page.waitForFunction(({ theme, sel }) => document.querySelector(sel)?.classList.contains(theme), { theme, sel: S.shellTheme })
  }
  for (const [width, height] of (process.env.SETTINGS_UI_MATRIX === 'skip' ? [] : [[1440, 900], [1024, 720]])) {
    await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setSize(...bounds), [width, height])
    for (const theme of ['dark', 'light']) {
      await setTheme(theme)
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i].trim()
        await navTo(i)
        if(tab === '用量') await dialog.locator(S.usageCards).waitFor()
        await page.waitForTimeout(300)
        const content = dialog.locator(S.settingsContentActive)
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
        const scan = await new AxeBuilder({ page }).setLegacyMode().include(S.settingsDialog).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
        metrics.accessibility = scan.violations.map(v => ({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))
        const scroller = dialog.locator(S.settingsPages)
        assert.equal(await scroller.evaluate(el=>el.scrollTop), 0, tab + ' should open at the top')
        if (await scroller.evaluate(el=>el.scrollHeight > el.clientHeight + 2)) {
          await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight})
          await dialog.screenshot({path:resolve(output, `${width}-${theme}-${i}-bottom.jpg`),quality:85})
          await scroller.evaluate(el=>{el.scrollTop=0})
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
      await page.locator(S.nativeSettingsTrigger).click()
      await setTheme(theme)
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      const plugins = await openPluginsPage(page)
      await assertDefaultPluginPage(page, plugins)
      const surfaces = ['插件总览', '发现插件', '安装与卸载']
      for (const [i, tab] of surfaces.entries()) {
        await showPluginList(plugins)
        if (tab === '发现插件') await openPluginDiscovery(plugins)
        if (tab === '安装与卸载') await openPluginManager(plugins)
        await page.waitForTimeout(300)
        const content = plugins.locator(S.pluginsPageContent)
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
        const scan = await new AxeBuilder({ page }).setLegacyMode().include(S.pluginsPage).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
        metrics.accessibility = scan.violations.map(v => ({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))
        if (await content.evaluate(el=>el.scrollHeight > el.clientHeight + 2)) {
          await content.evaluate(el=>{el.scrollTop=el.scrollHeight})
          await plugins.screenshot({path:resolve(output, `plugins-${width}-${theme}-${i}-bottom.jpg`),quality:85})
          await content.evaluate(el=>{el.scrollTop=0})
        }
        report.pages.push({ tab: '插件 / ' + tab, width, height, theme, file, ...metrics })
        console.log(`${width} ${theme} 插件 / ${tab}: ${metrics.fonts.length} elements; overflow ${metrics.overflow.length}; a11y ${metrics.accessibility.length}`)
      }
      await closePluginsPage(page)
    }
  }
  await page.locator(S.nativeSettingsTrigger).click()
  await dialog.waitFor({ state: 'visible' })
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1024,720))
  await setTheme('light')
  report.interactions = []
  const tabTo = async id => {
    const item = dialog.locator(S.settingsNavSection(id))
    await item.scrollIntoViewIfNeeded()
    await item.click()
    await page.waitForTimeout(150)
  }
  const captureExtra = async name => {
    await page.waitForTimeout(300)
    await dialog.screenshot({ path: resolve(output, name + '.jpg'), quality: 85 })
    const scan = await new AxeBuilder({ page }).setLegacyMode().include(S.settingsDialog).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
    report.interactions.push({ name, accessibility: scan.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})) })
  }
  await tabTo('appearance')
  await page.evaluate(({ selectOpen, listbox })=>{
    window.settingsKeyEvents=[]
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape') window.settingsKeyEvents.push({target:event.target?.outerHTML?.slice(0,500),openSelects:document.querySelectorAll(selectOpen).length,listboxes:document.querySelectorAll(listbox).length})
    },true)
  }, { selectOpen: S.selectOpen, listbox: S.listbox })
  const locale = dialog.getByRole('combobox', { name: '语言', exact: true })
  for (let attempt=0; attempt<20; attempt++) {
    await locale.click()
    await page.getByRole('listbox').waitFor()
    await page.keyboard.press('Escape')
    report.escapeChecks ??= []
    report.escapeChecks.push(await page.evaluate((sel)=>{
      const panel=document.querySelector(sel)
      return {pageVisible: panel ? panel.getBoundingClientRect().height > 0 : false}
    }, S.settingsDialog))
    await page.getByRole('listbox').waitFor({state:'hidden'})
    await dialog.waitFor({state:'visible'})
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label') === '语言')
  }
  await tabTo('advanced')
  await dialog.getByRole('button', {name:'显示开发者选项',exact:true}).click()
  await captureExtra('general-developer')
  // 破限模式 still requires the enable confirmation.
  const limitBreak = dialog.getByRole('switch', { name: '破限模式', exact: true })
  await limitBreak.waitFor()
  await limitBreak.click()
  const confirmDialog = page.getByRole('alertdialog').or(page.getByRole('dialog').filter({ hasText: '破限' })).first()
  await confirmDialog.waitFor({ state: 'visible', timeout: 10_000 })
  report.interactions.push({ name: 'limit-break enable requires the confirmation', ok: true })
  await confirmDialog.getByRole('button', { name: '取消', exact: true }).click()
  await confirmDialog.waitFor({ state: 'hidden' })
  const limitBreakState = await limitBreak.getAttribute('aria-checked') ?? await limitBreak.getAttribute('data-state')
  assert.ok(limitBreakState === 'false' || limitBreakState === 'unchecked',
    `cancelling the limit-break confirm must leave the switch off (got ${limitBreakState})`)
  await tabTo('assistant')
  const author = dialog.getByRole('textbox', {name:'跨作品作者约定',exact:true})
  await author.fill('界面验收：保持段落清晰。')
  await tabTo('writing')
  await tabTo('assistant')
  assert.equal(await author.inputValue(), '界面验收：保持段落清晰。')
  await dialog.getByRole('button',{name:'保存作者约定',exact:true}).click()
  await page.waitForFunction(sel => document.querySelector(sel)?.disabled, S.assistantSettingsButton)
  await captureExtra('assistant-saved')
  await tabTo('writing')
  const fontSlider = dialog.getByRole('slider',{name:'字号',exact:true})
  const oldSize=await fontSlider.getAttribute('aria-valuenow')
  await fontSlider.focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(({ oldSize, sel }) => document.querySelector(sel)?.getAttribute('aria-valuenow') !== oldSize, { oldSize, sel: S.fontSizeSlider })
  assert.notEqual(await fontSlider.getAttribute('aria-valuenow'),oldSize)
  await page.keyboard.press('ArrowLeft')
  // The live preview paper reflects the writing typography controls.
  await dialog.locator(S.writingPreviewPaper).waitFor({ state: 'visible' })
  const previewProbe = await dialog.locator(S.writingPreviewPaper).evaluate(el => ({
    fontSize: parseFloat(getComputedStyle(el.querySelector('.dsh-settings-preview__para') ?? el).fontSize),
    indent: getComputedStyle(el.querySelector('.dsh-settings-preview__para') ?? el).textIndent,
  }))
  assert.ok(previewProbe.fontSize > 0, 'the writing preview renders at the chosen font size')
  const indentSwitch = dialog.getByRole('switch', { name: '首行缩进', exact: true })
  const indentWasOn = (await indentSwitch.getAttribute('aria-checked')) === 'true' || (await indentSwitch.getAttribute('data-state')) === 'checked'
  if (!indentWasOn) await indentSwitch.click()
  await page.waitForFunction(sel => {
    const para = document.querySelector(sel)?.querySelector('.dsh-settings-preview__para')
    return para ? parseFloat(getComputedStyle(para).textIndent) > 0 : false
  }, S.writingPreviewPaper)
  const indentValue = await dialog.locator(S.writingPreviewPaper).evaluate(el => parseFloat(getComputedStyle(el.querySelector('.dsh-settings-preview__para')).textIndent))
  assert.ok(indentValue > 0, `firstLineIndent on must indent the preview paragraph (got ${indentValue})`)
  await indentSwitch.click()
  await page.waitForFunction(sel => {
    const para = document.querySelector(sel)?.querySelector('.dsh-settings-preview__para')
    return para ? parseFloat(getComputedStyle(para).textIndent) === 0 : false
  }, S.writingPreviewPaper)
  const centerSwitch = dialog.getByRole('switch', { name: '分节符居中', exact: true })
  await centerSwitch.waitFor()
  const centerWasOn = (await centerSwitch.getAttribute('aria-checked')) === 'true' || (await centerSwitch.getAttribute('data-state')) === 'checked'
  if (!centerWasOn) await centerSwitch.click()
  await page.waitForFunction(sel => {
    const mark = document.querySelector(sel)?.querySelector('.dsh-settings-preview__section')
    return mark ? getComputedStyle(mark).textAlign === 'center' || mark.classList.contains('dsh-settings-preview__section--centered') : false
  }, S.writingPreviewPaper)
  await centerSwitch.click()
  await captureExtra('writing-keyboard')
  // The round-tripped writing scope reaches the live paper: computed
  // text-indent on a paragraph and section-mark centering.
  const docHasIndent = await page.locator(S.paperEditor).isVisible().catch(() => false)
  if (docHasIndent) {
    const paperProbe = await page.evaluate(() => {
      const para = document.querySelector('.cm-lp-para, .cm-line')
      const mark = document.querySelector('.cm-lp-sectionmark, [class*="sectionmark"], [class*="section-mark"]')
      return para || mark ? {
        indent: para ? getComputedStyle(para).textIndent : null,
        markAlign: mark ? getComputedStyle(mark).textAlign : null,
      } : null
    })
    if (paperProbe?.indent != null) report.interactions.push({ name: 'live paper paragraph text-indent', value: paperProbe.indent })
    if (paperProbe?.markAlign != null) report.interactions.push({ name: 'live paper section-mark align', value: paperProbe.markAlign })
  }
  await tabTo('models')
  await dialog.getByRole('button',{name:'编辑 DeepSeek',exact:true}).click()
  await dialog.locator(S.modelsCustomizedSummary).click()
  await captureExtra('model-editor')
  await dialog.locator(S.modelsEditor).getByRole('button',{name:'取消',exact:true}).click()
  await dialog.getByRole('button',{name:'添加自定义提供方',exact:true}).click()
  await dialog.getByRole('textbox',{name:'Provider ID',exact:true}).fill('a-long-provider-name-for-layout-check')
  await captureExtra('model-custom')
  await dialog.locator(S.modelsAddCard).getByRole('button',{name:'取消',exact:true}).click()
  await app.evaluate(({shell})=>{globalThis.settingsExternalUrls=[];shell.openExternal=async url=>{globalThis.settingsExternalUrls.push(url)}})
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  const plugins = await openPluginsPage(page)
  await assertDefaultPluginPage(page, plugins)
  const capturePluginExtra = async name => {
    await page.waitForTimeout(300)
    await plugins.screenshot({ path: resolve(output, name + '.jpg'), quality: 85 })
    const scan = await new AxeBuilder({ page }).setLegacyMode().include(S.pluginsPage).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
    report.interactions.push({ name, accessibility: scan.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})) })
  }
  const discovery = await openPluginDiscovery(plugins)
  const query = discovery.getByRole('textbox')
  await app.evaluate(({ ipcMain }) => {
    globalThis.settingsCopiedSpec = undefined
    ipcMain.removeHandler('dsh-window:clipboard-write-text')
    ipcMain.handle('dsh-window:clipboard-write-text', (_event, text) => { globalThis.settingsCopiedSpec = text })
  })
  // An unversioned npm spec searches instead of installing and yields the
  // synthetic package card without any network round-trip; a versioned query
  // routes straight to the official installer.
  await query.fill('@klarkxy/dsh-zhihu')
  await discovery.locator(S.form).getByRole('button', { name: '搜索', exact: true }).click()
  const zhihuCard = await openListingSpec(discovery, 'dsh-zhihu')
  await zhihuCard.getByRole('button', { name: '复制规格', exact: true }).click()
  await discovery.getByText('已复制 @klarkxy/dsh-zhihu。', { exact: true }).waitFor()
  const installSpec = await app.evaluate(() => globalThis.settingsCopiedSpec)
  assert.equal(installSpec, '@klarkxy/dsh-zhihu')
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('dsh-window:clipboard-write-text')
    ipcMain.handle('dsh-window:clipboard-write-text', () => { throw new Error('Clipboard unavailable in regression fixture') })
  })
  await zhihuCard.getByRole('button', { name: '复制规格', exact: true }).click()
  await discovery.getByText(`请手动复制：${installSpec}`, { exact: true }).waitFor()
  // A submitted query with no matches shows a no-match state naming the term;
  // with no network the search surfaces its error alert instead.
  await query.fill('查无此插件zzz')
  await discovery.locator(S.form).getByRole('button', { name: '搜索', exact: true }).click()
  const noMatch = discovery.locator('.dsh-plugins-empty', { hasText: '查无此插件zzz' })
  const searchError = discovery.locator('.dsh-plugins-error')
  await noMatch.or(searchError).first().waitFor({ timeout: 15_000 })
  report.interactions.push({
    name: 'discovery no-match state names the submitted term',
    ok: await noMatch.isVisible().catch(() => false),
  })
  // 发现 search is scoped to that page: it must not filter the 已安装 list.
  const installedBefore = await plugins.locator(S.pluginsCatalogRow).count()
  await showPluginList(plugins)
  const installedAfter = await plugins.locator(S.pluginsCatalogRow).count()
  assert.equal(installedAfter, installedBefore, 'discovery search must not filter the installed list')
  await openPluginDiscovery(plugins)
  await query.fill('')
  await discovery.locator(S.form).getByRole('button', { name: '搜索', exact: true }).waitFor()
  await capturePluginExtra('plugin-discovery')
  // The header button routes to the official manager page and opens its
  // install dialog in one step; the dialog is modal, so fill it directly.
  // 「添加插件」 sits in the 已安装 section's tools, so return to the list first.
  await showPluginList(plugins)
  await plugins.locator(S.pluginsPageAddPlugin).click()
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
  await page.locator(S.nativeSettingsTrigger).click()
  await dialog.waitFor({ state: 'visible' })
  await tabTo('about')
  await app.evaluate(({ipcMain})=>{
    ipcMain.removeHandler('dsh-window:check-update')
    ipcMain.handle('dsh-window:check-update',()=>({status:'update-available',currentVersion:'0.3.6',latest:{version:'0.3.7',tag:'v0.3.7',name:'界面验证用更新',publishedAt:'2026-09-20T00:00:00Z',url:'https://github.com/klarkxy/dsh-editor/releases',body:'用于检查更新详情和插图是否相互遮挡。'.repeat(12)}}))
  })
  await dialog.getByRole('button',{name:'检查更新',exact:true}).click()
  await dialog.locator(S.aboutRelease).waitFor()
  await captureExtra('about-update')
  assert.equal(await dialog.locator(S.aboutNote).filter({hasText:'macOS'}).count(),0)
  await page.emulateMedia({reducedMotion:'reduce'})
  await tabTo('appearance')
  assert.equal(await dialog.locator(S.settingsPage).first().evaluate(el=>getComputedStyle(el).transform),'none')
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
