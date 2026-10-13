import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { assertCatalogIconsRendered, assertConfigNavLinksReachable, assertDefaultPluginPage, openPluginManager, openWebSearchSettings, openWritingPresets, showPluginList } from './helpers/plugin-page.mjs'
import { toggleTheme } from './helpers/theme.mjs'
import { S } from './helpers/selectors.mjs'

const root = resolve(import.meta.dirname, '..')
const stage = process.env.PLUGINS_UI_STAGE || 'current'
const output = resolve(root, '.artifacts/plugin-page', stage)
const home = resolve(root, '.dev', 'plugin-page-' + stage + '-' + Date.now())
const env = { ...process.env, DSH_TELEMETRY_DISABLED: '1', DSH_HOME: home,
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: resolve(root, '.dev/desktop-dsh-runtime-0.2.0-rc.2/lib/bin.js'),
  DSH_DESKTOP_PROFILE_TEMPLATE: resolve(root, '.dev/desktop-profile-template'),
  DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
  DSH_EDITOR_PROJECTS_ROOT: resolve(home, 'projects'),
}
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_SECRET|ELECTRON_RUN_AS_NODE/.test(key)) delete env[key]
await mkdir(output, { recursive: true })
const report = { stage, pages: [], errors: [], checks: [] }
let app, page
const openSettings = async () => {
  await page.locator(S.nativeSettingsButton).click()
  const settings = page.locator(S.settingsDialog)
  await settings.waitFor({ state: 'visible' })
  return settings
}
const closeSettings = async () => {
  await page.locator(S.settingsDialog).locator(S.settingsBack).click()
  await page.locator(S.settingsDialog).waitFor({ state: 'hidden' })
}
const shot = async name => {
  await page.screenshot({ path: resolve(output, name + '.png') })
  report.pages.push({ name, viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })) })
}
try {
  app = await electron.launch({ executablePath: process.env.DSH_TEST_ELECTRON || resolve(root, 'apps/desktop/node_modules/electron/dist/electron.exe'),
    args: [resolve(root, 'apps/desktop/dist/main.js')], env, timeout: 90000 })
  app.process().stderr?.on('data', chunk => { const text=String(chunk); if (/error|failed|Error/.test(text)) console.log(text) })
  page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('dialog', dialog => { void dialog.accept().catch(() => {}) })
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()) })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.waitForFunction(sel => document.querySelector(sel) || document.body?.innerText.includes('Failed to load plugins'), S.shell, { timeout: 90000 })
  if (!await page.locator(S.shell).count()) {
    await page.getByText('dsh-editor-shell', { exact: true }).first().click().catch(() => {})
    throw new Error('Shell boot failed: ' + report.errors.join('\n') + '\n' + await page.locator(S.body).innerText())
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  for (let i = 0; i < 5; i++) {
    const button = page.getByRole('button', { name: '继续', exact: true })
    if (!await button.waitFor({ state: 'visible', timeout: 800 }).then(() => true, () => false)) break
    await button.click()
  }
  const later = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await later.isVisible()) await later.click()
  for (const theme of ['浅色', '深色']) {
    const settings = await openSettings()
    await settings.locator(S.settingsNavSection('appearance')).click()
    await settings.getByRole('radio', { name: theme, exact: true }).click()
    /* 固定导航是规格分区集合；插件配置链接另列在「插件配置」分组里。 */
    const navIds = await settings.locator('[data-testid^="settings-nav-"]').evaluateAll(nodes =>
      nodes.map(node => node.getAttribute('data-testid')))
    assert.deepEqual(navIds, [
      'settings-nav-writing', 'settings-nav-models', 'settings-nav-assistant',
      'settings-nav-appearance', 'settings-nav-shortcuts',
      'settings-nav-plugins-installed', 'settings-nav-plugins-discovery', 'settings-nav-plugins-manager',
      'settings-nav-usage', 'settings-nav-about', 'settings-nav-advanced',
    ], navIds.join(','))
    await shot(theme + '-settings')
    await closeSettings()
    await page.locator(S.pluginsTrigger).click()
    const pluginPage = page.locator(S.pluginsPage)
    await assertDefaultPluginPage(page, pluginPage)
    await assertCatalogIconsRendered(pluginPage)
    await openWritingPresets(pluginPage)
    await shot(theme + '-overview-1440')
    await openWebSearchSettings(pluginPage)
    await shot(theme + '-web-search')
    if (theme === '浅色') {
      const nativePanel = await openPluginManager(pluginPage)
      const loop = nativePanel.getByText('Agent 循环', { exact: true }).first()
      await loop.click()
      const parallel = pluginPage.locator(S.pluginConfigAgentLoopParallel)
      await parallel.fill('7')
      await pluginPage.getByRole('button', { name: '保存', exact: true }).click()
      await page.waitForFunction(sel => [...document.querySelectorAll(sel)].some(el => el.textContent?.trim() === '保存' && el.disabled), S.pluginsPageButton)
      await page.reload()
      await page.locator(S.pluginsTrigger).waitFor({timeout:90000})
      await page.locator(S.pluginsTrigger).click()
      const reloadedPanel = await openPluginManager(pluginPage)
      await reloadedPanel.getByText('Agent 循环', { exact: true }).first().click()
      assert.equal(await pluginPage.locator(S.pluginConfigAgentLoopParallel).inputValue(), '7')
      await shot('official-config-saved-after-reload')
      report.checks.push('official Agent loop configuration saved through Host and survived full reload')
    }
    await showPluginList(pluginPage)
    for (const width of [1024, 760, 390]) {
      await page.setViewportSize({ width, height: 900 })
      assert(await pluginPage.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `page overflow ${width}: ${JSON.stringify(await pluginPage.evaluate(el => ({client:el.clientWidth,scroll:el.scrollWidth})))}`)
      /* Measure the links, not the nav's scroll metrics: the inner scroller hid
         two configuration entries while the nav itself reported no overflow. */
      const nav = await assertConfigNavLinksReachable(pluginPage)
      await assertCatalogIconsRendered(pluginPage)
      if (width === 390) report.configNav = nav
      await shot(theme + '-overview-' + width)
    }
    report.checks.push(theme + ': every configuration nav entry stays reachable and every catalog icon renders at 1024/760/390')
    await page.setViewportSize({ width: 1440, height: 900 })
    await pluginPage.getByRole('button', { name: '返回首页', exact: true }).click()
    await pluginPage.waitFor({ state: 'hidden' })
    await page.waitForFunction(cls => document.activeElement?.classList.contains(cls), S.pluginsTriggerClass)
    report.checks.push(theme + ': settings isolated, plugin pages reachable, responsive, focus restored')
  }
  {
    await page.getByRole('button', { name: '新建作品' }).first().click()
    const project = page.getByRole('dialog', { name: '新建作品' })
    await project.getByLabel('作品名称').fill('plugin-page-acceptance')
    await project.getByRole('button', { name: '创建', exact: true }).click()
    await page.locator(S.shellLayout).waitFor()
    // Narrow layouts may leave the file sidebar collapsed after returning to desktop width.
    if (!await page.locator(S.tree).isVisible()) await page.getByRole('button', { name: '文件', exact: true }).click()
    await page.locator(S.treeEmpty).waitFor()
    await page.locator(S.tree).click({button:'right',position:{x:20,y:80}})
    await page.getByRole('menuitem', {name:'新建文档',exact:true}).click()
    const file = page.getByRole('dialog', { name: '新建文件', exact: true })
    await file.getByLabel('文件名称（无扩展名时按 .md 创建）').fill('插件页面验收.md')
    await file.getByRole('button', { name: '创建', exact: true }).click()
    const editor = page.locator(S.cmContentEditable).first()
    await editor.waitFor()
    const paper = page.locator(S.paperEditor)
    const writingSettings = await openSettings()
    await writingSettings.locator(S.settingsNavSection('writing')).click()
    for (const name of ['字号', '行距']) {
      const slider = writingSettings.getByRole('slider', {name,exact:true})
      await slider.focus()
      for (let i = 0; i < 2; i++) {
        const previous = await slider.getAttribute('aria-valuenow')
        await page.keyboard.press('ArrowRight')
        await page.waitForFunction(({name,previous,sel}) => [...document.querySelectorAll(sel)].some(el => el.getAttribute('aria-label') === name && el.getAttribute('aria-valuenow') !== previous), {name,previous,sel:S.sliderAny})
      }
    }
    for (const [name, option] of [['字体','无衬线'], ['稿纸宽度','窄栏']]) {
      await writingSettings.getByRole('radio', {name:option,exact:true}).click()
    }
    const paragraphFocus = writingSettings.getByRole('switch', {name:'聚焦当前段落',exact:true})
    if (await paragraphFocus.getAttribute('aria-checked') !== 'true') await paragraphFocus.click()
    await page.waitForFunction(sel => document.querySelector(sel)?.getAttribute('aria-checked') === 'true', S.switch('聚焦当前段落'))
    /* 新增的稿纸开关也走同一写契约：打开后预览与编辑器变量即时变化。 */
    const firstLineIndent = writingSettings.getByRole('switch', {name:'首行缩进',exact:true})
    if (await firstLineIndent.getAttribute('aria-checked') !== 'true') await firstLineIndent.click()
    await page.waitForFunction(sel => document.querySelector(sel)?.getAttribute('aria-checked') === 'true', S.switch('首行缩进'))
    await closeSettings()
    await page.waitForFunction(sel => {
      const paper = document.querySelector(sel)
      if (!paper) return false
      const style = getComputedStyle(paper)
      return style.getPropertyValue('--paper-font-size').trim() === '19px'
        && style.getPropertyValue('--paper-line-height').trim() === '2.1'
        && style.getPropertyValue('--paper-max-width').trim() === '60ch'
        && style.getPropertyValue('--paper-font-family').includes('sans-serif')
    }, S.paperEditor)
    const typography = await paper.evaluate(el => {
      const style = getComputedStyle(el)
      return Object.fromEntries(['--paper-font-size','--paper-line-height','--paper-font-family','--paper-max-width'].map(name => [name, style.getPropertyValue(name).trim()]))
    })
    assert.equal(typography['--paper-font-size'], '19px')
    assert.equal(typography['--paper-line-height'], '2.1')
    assert.equal(typography['--paper-max-width'], '60ch')
    assert.match(typography['--paper-font-family'], /sans-serif/)
    await paper.evaluate(el => {
      const view = el.__cmView
      if (!view) throw new Error('Missing actual CodeMirror view')
      view.dispatch({changes:{from:0,to:view.state.doc.length,insert:'# 长文阅读验收\n\n' + '插件页面切换应保留正文。这里是阅读中的普通段落，包含 **重点** 和 `代码`。\n\n'.repeat(100)},selection:{anchor:120}})
    })
    const chat = page.locator(S.composerTextarea)
    await chat.fill('保留的聊天草稿')
    await paper.evaluate(async el => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const view=el.__cmView
      view.scrollDOM.scrollTop=240
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      globalThis.__pluginTestEditor=view.contentDOM
      globalThis.__pluginTestScroll=view.scrollDOM.scrollTop
      globalThis.__pluginTestCursor=view.state.selection.main.anchor
    })
    for (const label of [/主题（当前深色）/, /主题（当前浅色）/]) {
      // 4.1: theme switching moved off the topbar into a palette command.
      await toggleTheme(page)
      await page.waitForFunction(label => document.documentElement.getAttribute('data-theme') === label, label.source.includes('浅色') ? 'dark' : 'light')
      assert(await editor.evaluate(el => el === globalThis.__pluginTestEditor))
      assert.deepEqual(await paper.evaluate(el => {
        const style = getComputedStyle(el)
        return Object.fromEntries(['--paper-font-size','--paper-line-height','--paper-font-family','--paper-max-width'].map(name => [name, style.getPropertyValue(name).trim()]))
      }), typography)
      assert.equal(await paper.evaluate(el => el.__cmView.state.selection.main.anchor), 120)
      const theme = label.source.includes('浅色') ? 'dark' : 'light'
      await page.waitForFunction(({theme,sel}) => document.documentElement.getAttribute('data-theme') === theme && document.querySelector(sel)?.classList.contains(theme), {theme,sel:S.shellTheme})
      await page.waitForTimeout(350)
      for (const focus of ['reading','typing']) {
        if (focus === 'typing') await editor.focus()
        else await chat.focus()
        await page.waitForTimeout(100)
        const readability = await paper.evaluate((el, sel) => {
          const view = el.__cmView
          const line = [...view.contentDOM.querySelectorAll(sel)].find(node => node.textContent.trim())
          if (!line) throw new Error('Focus paragraph scenario has no inactive visible paragraph')
          const style = getComputedStyle(line)
          let surface = el
          while (surface && getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') surface = surface.parentElement
          const rgb = value => value.match(/[\d.]+/g).slice(0,3).map(Number)
          const luminance = channels => channels.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum,value,index) => sum + value * [.2126,.7152,.0722][index],0)
          const background = rgb(getComputedStyle(surface).backgroundColor)
          const foreground = rgb(style.color)
          const alpha = Number(style.opacity)
          const foregroundLight = luminance(foreground.map((value,index) => alpha * value + (1-alpha) * background[index]))
          const backgroundLight = luminance(background)
          return {theme:document.documentElement.getAttribute('data-theme'),focused:view.hasFocus,opacity:alpha,color:style.color,background:getComputedStyle(surface).backgroundColor,contrast:(Math.max(foregroundLight,backgroundLight)+.05)/(Math.min(foregroundLight,backgroundLight)+.05)}
        }, S.cmPaperDim)
        report.readability ??= []
        report.readability.push({expectedTheme:theme,focus,...readability})
        await shot(theme + '-focus-' + focus)
        assert.equal(readability.focused,focus === 'typing')
        assert.equal(readability.theme,theme)
        assert.equal(readability.opacity,1)
        assert(readability.contrast >= 4.5, `${theme}/${focus} contrast ${readability.contrast}`)
      }
    }
    await paper.evaluate(el => { globalThis.__pluginTestScroll = el.__cmView.scrollDOM.scrollTop })
    await page.locator(S.pluginsTrigger).click()
    await page.locator(S.pluginsPage).waitFor()
    assert(await page.locator(S.pluginWorkspaceWriting).evaluate(el => el.inert))
    await page.keyboard.press('Control+k')
    await page.keyboard.press('Control+Shift+P')
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.locator(S.pluginsBack).click()
    assert(await editor.evaluate(el => el === globalThis.__pluginTestEditor))
    assert.equal(await chat.inputValue(), '保留的聊天草稿')
    assert.match(await editor.innerText(), /插件页面切换应保留正文/)
    const preservation = await paper.evaluate(el => ({
      scrollBefore:globalThis.__pluginTestScroll, scrollAfter:el.__cmView.scrollDOM.scrollTop,
      cursorBefore:globalThis.__pluginTestCursor, cursorAfter:el.__cmView.state.selection.main.anchor,
    }))
    report.preservation = preservation
    report.typography = typography
    assert.equal(preservation.scrollAfter, preservation.scrollBefore)
    assert.equal(preservation.cursorAfter, preservation.cursorBefore)
    await shot('workspace-return')
    report.checks.push('real CodeMirror instance, manuscript, scroll, chat draft and hotkey isolation preserved')
    const openCommand = async label => {
      await page.locator(S.paletteTrigger).click()
      const palette = page.getByRole('dialog', {name:'搜索与命令',exact:true})
      await palette.locator(S.paletteInput).fill(label)
      await palette.locator(S.paletteItem).filter({has:page.getByText(label,{exact:true})}).first().click()
      await palette.waitFor({state:'hidden'})
    }
    for (const theme of ['light','dark']) {
      if (!await page.locator(S.shellTheme).evaluate((el,theme) => el.classList.contains(theme), theme)) {
        await toggleTheme(page)
        await page.waitForFunction(({theme,sel}) => document.querySelector(sel)?.classList.contains(theme), {theme,sel:S.shellTheme})
      }
      await page.waitForTimeout(350)
      // The overview is a floating card; the proofread panel is a flat sidebar
      // section by design (校对与记忆面板成为侧栏区段).
      for (const [command, selector, close, radius] of [
        ['文档概览',S.overviewPanelSurface,'关闭概览','20px'],
        ['校对当前文档',S.proofreadPanelSurface,'关闭文稿校对','0px'],
      ]) {
        await openCommand(command)
        const panel = page.locator(selector)
        await panel.waitFor()
        await page.waitForTimeout(350)
        assert.equal(await panel.evaluate(el => getComputedStyle(el).borderTopLeftRadius), radius)
        await shot(theme + '-' + selector.slice(1))
        await panel.getByRole('button',{name:close,exact:true}).click()
        await panel.waitFor({state:'hidden'})
      }
    }
    report.checks.push('real overview and proofread panels opened and closed in both themes')
    // The sidebar renders no 文档概览 / 校对当前文档 buttons: both commands stay
    // reachable through the palette (verified above) and their registered
    // shortcuts, with the editor focused so the keydown reaches the workspace.
    for (const theme of ['light', 'dark']) {
      if (!await page.locator(S.shellTheme).evaluate((el, value) => el.classList.contains(value), theme)) {
        await toggleTheme(page)
        await page.waitForFunction(({value,sel}) => document.querySelector(sel)?.classList.contains(value), {value:theme,sel:S.shellTheme})
      }
      assert.equal(await page.locator(S.sideDocumentTools).count(), 0, theme + ': no sidebar document tool buttons')
      await editor.focus()
      for (const [shortcut, selector, close] of [
        ['Control+Shift+O', S.overviewPanelSurface, '关闭概览'],
        ['Control+Shift+L', S.proofreadPanelSurface, '关闭文稿校对'],
      ]) {
        await page.keyboard.press(shortcut)
        const panel = page.locator(selector)
        await panel.waitFor()
        await shot(theme + '-sidebar-' + selector.slice(1))
        await panel.getByRole('button', { name: close, exact: true }).click()
        await panel.waitFor({ state: 'hidden' })
      }
    }
    report.checks.push('sidebar document tool buttons removed; overview and proofread panels open via Ctrl+Shift+O / Ctrl+Shift+L in both themes')
    report.panelScope = 'Desktop composition intentionally disables editor-cards and editor-memory-panel; their styles and native/Radix states are verified by independent component fixtures.'
    // Clear the synthetic unsent draft before closing the isolated test app.
    // 4.1: the composer lives in the aux rail's partner tab and may be adopted
    // into a hidden pane host here; skip clearing when it is not interactable.
    if (await chat.isVisible()) await chat.fill('')
    await editor.press('Control+s')
    await page.waitForTimeout(500)
  }
  assert.deepEqual(report.errors, [])
  report.ok = true
} catch (error) {
  report.failure = String(error)
  if (page) {
    await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
    await writeFile(resolve(output, 'failure.txt'), await page.locator(S.body).innerText().catch(() => ''), 'utf8')
  }
  throw error
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  if (app) {
    const close = app.close()
    await Promise.race([close, new Promise((_, reject) => { const timer=setTimeout(() => reject(new Error('Test app did not close within 30 seconds')),30000); timer.unref() })])
  }
}
console.log('Plugin page desktop acceptance passed: ' + stage)
