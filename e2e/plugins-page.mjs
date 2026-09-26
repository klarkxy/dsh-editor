import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const before = process.argv.includes('--before')
const stage = before ? 'before' : 'after'
const output = resolve(root, '.artifacts/plugin-page', stage)
const home = resolve(root, '.dev', 'plugin-page-' + stage + '-' + Date.now())
const env = { ...process.env, DSH_TELEMETRY_DISABLED: '1', DSH_HOME: home,
  DSH_DESKTOP_NODE_PATH: process.execPath,
  DSH_DESKTOP_CLI_PATH: resolve(root, '.dev/desktop-dsh-runtime-0.1.7-rc.2/lib/bin.js'),
  DSH_DESKTOP_PROFILE_TEMPLATE: resolve(root, '.dev/desktop-profile-template'),
  DSH_DESKTOP_USER_DATA_DIR: resolve(home, 'electron-user-data'),
  DSH_EDITOR_PROJECTS_ROOT: resolve(home, 'projects'),
}
for (const key of Object.keys(env)) if (/API_KEY|ACCESS_SECRET|ELECTRON_RUN_AS_NODE/.test(key)) delete env[key]
await mkdir(output, { recursive: true })
const report = { stage, pages: [], errors: [], checks: [] }
let app, page
const openSettings = async () => {
  await page.locator('.native-settings-control button').click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await settings.waitFor()
  return settings
}
const closeSettings = async () => {
  await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭设置', exact: true }).click()
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
  await page.waitForFunction(() => document.querySelector('.shell') || document.body?.innerText.includes('Failed to load plugins'), undefined, { timeout: 90000 })
  if (!await page.locator('.shell').count()) {
    await page.getByText('dsh-editor-shell', { exact: true }).first().click().catch(() => {})
    throw new Error('Shell boot failed: ' + report.errors.join('\n') + '\n' + await page.locator('body').innerText())
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
    await settings.getByRole('tab', { name: '通用设置', exact: true }).click()
    await settings.getByRole('button', { name: theme, exact: true }).click()
    if (before) {
      await settings.getByRole('tab', { name: '插件', exact: true }).click()
      await settings.getByTestId('plugins-settings').waitFor()
      await shot(theme + '-plugins-in-settings')
      await closeSettings()
      continue
    }
    const labels = await settings.locator('.settings-nav [role="tab"]').allTextContents()
    assert(!labels.some(label => /插件|知乎|网络搜索|记忆/.test(label)), labels.join(','))
    await shot(theme + '-settings')
    await closeSettings()
    await page.locator('.plugins-trigger').click()
    const pluginPage = page.locator('.plugins-page')
    await pluginPage.getByTestId('plugins-settings').waitFor()
    await pluginPage.getByTestId('plugins-writing-presets').waitFor()
    await shot(theme + '-manage-1440')
    const config = pluginPage.locator('.plugins-page-nav').getByRole('button', { name: '知乎资料', exact: true })
    await config.click()
    await pluginPage.getByRole('textbox', { name: 'Access Secret', exact: true }).waitFor()
    await shot(theme + '-zhihu')
    await pluginPage.locator('.plugins-page-nav').getByRole('button', { name: '网络搜索', exact: true }).click()
    await pluginPage.getByTestId('web-search-settings').waitFor()
    await shot(theme + '-web-search')
    if (theme === '浅色') {
      await pluginPage.locator('.plugins-page-nav').getByRole('button', { name: 'Agent 循环', exact: true }).click()
      const parallel = pluginPage.locator('#plugin-config-agent-loop-parallel')
      await parallel.fill('7')
      await pluginPage.getByRole('button', { name: '保存', exact: true }).click()
      await page.waitForFunction(() => [...document.querySelectorAll('.plugins-page button')].some(el => el.textContent?.trim() === '保存' && el.disabled))
      await page.reload()
      await page.locator('.plugins-trigger').waitFor({timeout:90000})
      await page.locator('.plugins-trigger').click()
      await pluginPage.locator('.plugins-page-nav').getByRole('button', { name: 'Agent 循环', exact: true }).click()
      assert.equal(await pluginPage.locator('#plugin-config-agent-loop-parallel').inputValue(), '7')
      await shot('official-config-saved-after-reload')
      report.checks.push('official Agent loop configuration saved through Host and survived full reload')
    }
    await pluginPage.locator('.plugins-page-nav').getByRole('button', { name: '已安装与市场', exact: true }).click()
    for (const width of [1024, 760, 390]) {
      await page.setViewportSize({ width, height: 900 })
      assert(await pluginPage.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `page overflow ${width}: ${JSON.stringify(await pluginPage.evaluate(el => ({client:el.clientWidth,scroll:el.scrollWidth})))}`)
      await shot(theme + '-manage-' + width)
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await pluginPage.getByRole('button', { name: '返回首页', exact: true }).click()
    await pluginPage.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.classList.contains('plugins-trigger'))
    report.checks.push(theme + ': settings isolated, plugin pages reachable, responsive, focus restored')
  }
  if (!before) {
    await page.getByRole('button', { name: '新建', exact: true }).first().click()
    const project = page.getByRole('dialog', { name: '新建作品' })
    await project.getByLabel('作品名称').fill('plugin-page-acceptance')
    await project.getByRole('button', { name: '创建', exact: true }).click()
    await page.locator('.shell.layout-shell').waitFor()
    await page.locator('.tree-empty').waitFor()
    await page.locator('.tree').click({button:'right',position:{x:20,y:80}})
    await page.getByRole('menuitem', {name:'新建文件',exact:true}).click()
    const file = page.getByRole('dialog', { name: '新建文件', exact: true })
    await file.getByLabel('文件名称（无扩展名时按 .md 创建）').fill('插件页面验收.md')
    await file.getByRole('button', { name: '创建', exact: true }).click()
    const editor = page.locator('.cm-content[contenteditable="true"]').first()
    await editor.waitFor()
    const paper = page.getByTestId('paper-editor')
    await paper.evaluate(el => {
      const view = el.__cmView
      if (!view) throw new Error('Missing actual CodeMirror view')
      view.dispatch({changes:{from:0,to:view.state.doc.length,insert:'插件页面切换应保留正文。\n'.repeat(100)},selection:{anchor:120}})
    })
    const chat = page.locator('.composer textarea')
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
    await page.locator('.plugins-trigger').click()
    await page.locator('.plugins-page').waitFor()
    assert(await page.locator('.plugin-workspace-writing').evaluate(el => el.inert))
    await page.keyboard.press('Control+k')
    await page.keyboard.press('Control+Shift+P')
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.locator('.plugins-back').click()
    assert(await editor.evaluate(el => el === globalThis.__pluginTestEditor))
    assert.equal(await chat.inputValue(), '保留的聊天草稿')
    assert.match(await editor.innerText(), /插件页面切换应保留正文/)
    const preservation = await paper.evaluate(el => ({
      scrollBefore:globalThis.__pluginTestScroll, scrollAfter:el.__cmView.scrollDOM.scrollTop,
      cursorBefore:globalThis.__pluginTestCursor, cursorAfter:el.__cmView.state.selection.main.anchor,
    }))
    report.preservation = preservation
    assert.equal(preservation.scrollAfter, preservation.scrollBefore)
    assert.equal(preservation.cursorAfter, preservation.cursorBefore)
    await shot('workspace-return')
    report.checks.push('real CodeMirror instance, manuscript, scroll, chat draft and hotkey isolation preserved')
    // Clear the synthetic unsent draft before closing the isolated test app.
    await chat.fill('')
    await editor.press('Control+s')
    await page.waitForTimeout(500)
  }
  assert.deepEqual(report.errors, [])
  report.ok = true
} catch (error) {
  report.failure = String(error)
  if (page) {
    await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
    await writeFile(resolve(output, 'failure.txt'), await page.locator('body').innerText().catch(() => ''), 'utf8')
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
