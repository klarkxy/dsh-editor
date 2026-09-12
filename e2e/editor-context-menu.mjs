/** Real Electron UI; default native clipboard. --clipboard=memory explicitly injects a main-process text driver. AI responses are explicit deterministic fetch test doubles. */
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { _electron as electron } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const nonce = new Date().toISOString().replace(/[:.]/g, '-')
const runRoot = resolve(root, '.dev', `primary-menu-${nonce}`)
const output = resolve(root, 'e2e/out/editor-context-menu', nonce)
await mkdir(runRoot, { recursive: true })
await mkdir(output, { recursive: true })
if (!existsSync(resolve(root, '.dev/desktop-dsh-runtime/lib/bin.js'))) execFileSync(process.execPath, [resolve(root, 'scripts/prepare-desktop-dev.mjs')], { cwd: root, stdio: 'inherit', windowsHide: true })
const env = { ...process.env, DSH_HOME: resolve(runRoot, 'home'), DSH_DESKTOP_USER_DATA_DIR: resolve(runRoot, 'electron'), DSH_TELEMETRY_DISABLED: '1', DSH_DESKTOP_NODE_PATH: process.execPath, DSH_DESKTOP_CLI_PATH: resolve(root, '.dev/desktop-dsh-runtime/lib/bin.js'), DSH_DESKTOP_PROFILE_TEMPLATE: resolve(root, '.dev/desktop-profile-template'), DSH_EDITOR_PROJECTS_ROOT: resolve(runRoot, 'projects') }
for (const key of ['ELECTRON_RUN_AS_NODE', 'DEEPSEEK_API_KEY', 'DSH_EDITOR_CUSTOM_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) delete env[key]
const memoryClipboard = process.argv.includes('--clipboard=memory')
const report = { clipboardMode: memoryClipboard ? 'explicit in-process test driver' : 'native OS', started: new Date().toISOString(), checks: [], errors: [], output }
let app, page
const mark = (name) => { report.checks.push(name); console.log(`PASS ${name}`) }
const original = '第一行内容。\n第二行正文。\n第三行用于定位。\n'
try {
  app = await electron.launch({ executablePath: resolve(root, 'apps/desktop/node_modules/electron/dist/electron.exe'), args: [resolve(root, 'apps/desktop/dist/main.js')], env, timeout: 90000 })
  await app.evaluate(async ({ app }) => { await app.whenReady() })
  if (memoryClipboard) await app.evaluate(({ clipboard }) => {
    globalThis.__testClip = { text: '' };
    clipboard.readText = () => globalThis.__testClip.text;
    clipboard.writeText = text => { globalThis.__testClip.text = text };
    clipboard.clear = () => { globalThis.__testClip.text = '' };
  })
  if (!memoryClipboard) await app.evaluate(({ clipboard }) => { globalThis.__originalMenuClipboard = clipboard.availableFormats().map(format => [format, clipboard.readBuffer(format)]) })
  const nativeClipboardOk = await app.evaluate(({ clipboard }) => { clipboard.writeText('DSH native clipboard control'); return clipboard.readText() === 'DSH native clipboard control' })
  if (!nativeClipboardOk) { report.blocked = 'Native OS clipboard positive control failed; run on an interactive desktop, or explicitly use --clipboard=memory for driver-based coverage.'; throw new Error(report.blocked) }
  mark(memoryClipboard ? 'explicit test clipboard driver positive control' : 'native Electron clipboard positive control')
  page = await app.firstWindow()
  page.setDefaultTimeout(12000)
  page.on('dialog', dialog => { void dialog.accept().catch(() => {}) })
  page.on('pageerror', error => report.errors.push(error.message))
  // Development host has a 20s boot deadline; exercise its visible retry once on a cold start.
  await page.waitForFunction(() => !!document.querySelector('.shell') || document.body.innerText.includes('DSH Editor 启动失败'), undefined, { timeout: 90000 })
  if (!await page.locator('.shell').count()) {
    report.startupRetry = await page.locator('body').innerText()
    await page.getByRole('button', { name: '重试', exact: true }).click()
    await page.waitForFunction(() => !!document.querySelector('.shell'), undefined, { timeout: 90000 })
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await page.waitForTimeout(500)
  for (let step = 0; step < 5; step++) {
    const next = page.getByRole('button', { name: '继续', exact: true })
    if (!await next.isVisible().catch(() => false)) break
    await next.click()
  }
  const later = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await later.isVisible().catch(() => false)) await later.click()
  await page.getByRole('button', { name: '新建', exact: true }).first().click()
  const create = page.getByRole('dialog', { name: '新建作品' })
  await create.getByLabel('作品名称').fill('menu-primary')
  await create.getByRole('button', { name: '创建', exact: true }).click()
  await page.getByRole('navigation', { name: '稿件目录' }).waitFor()
  const project = resolve(runRoot, 'projects/menu-primary')
  await mkdir(resolve(project, '正文'), { recursive: true })
  await writeFile(resolve(project, '正文/001 菜单验收.md'), original, 'utf8')
  await writeFile(resolve(project, '正文/002 第二章.md'), '第二章的独立正文。\n', 'utf8')
  await mkdir(resolve(project, '世界书'), { recursive: true })
  await writeFile(resolve(project, '世界书/港口.md'), '---\ntriggers: [港口]\nenabled: true\npriority: 0\n---\n港口的世界书正文。\n', 'utf8')
  await page.reload()
  await page.locator('.shell').waitFor()
  const directory = page.locator('.tree-directory-row > .tree-row').filter({ hasText: '正文' }).first()
  await directory.waitFor()
  if (await directory.getAttribute('aria-expanded') !== 'true') await directory.click()
  await page.locator('.tree-row.tree-main').filter({ hasText: '001 菜单验收.md' }).click()
  const editor = page.getByTestId('paper-editor')
  await editor.waitFor()
  await page.waitForFunction(() => !!document.querySelector('[data-testid="paper-editor"]')?.__cmView)
  await editor.evaluate((el, value) => { const view = el.__cmView; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, selection: { anchor: 0 } }); view.focus() }, original)
  const text = () => editor.evaluate(el => el.__cmView.state.doc.toString())
  const waitText = expected => page.waitForFunction(value => document.querySelector('[data-testid=' + String.fromCharCode(34) + 'paper-editor' + String.fromCharCode(34) + ']')?.__cmView?.state.doc.toString() === value, expected)
  const select = (from, to) => editor.evaluate((el, range) => { el.__cmView.dispatch({ selection: { anchor: range[0], head: range[1] } }); el.__cmView.focus() }, [from, to])
  const right = async (pos) => { const box = await editor.evaluate((el, at) => el.__cmView.coordsAtPos(at), pos); assert(box, 'position has visible coordinates'); await page.mouse.click(box.left + 1, (box.top + box.bottom) / 2, { button: 'right' }); await page.locator('.editor-action-menu').first().waitFor({ state: 'visible' }) }
  const item = (label) => page.getByRole('menuitem', { name: label, exact: true })
  const selection = () => editor.evaluate(el => ({ from: el.__cmView.state.selection.main.from, to: el.__cmView.state.selection.main.to }))
  const waitClipboard = async expected => {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      if (await app.evaluate(({ clipboard }) => clipboard.readText()) === expected) return
      await page.waitForTimeout(30)
    }
    throw new Error('clipboard did not receive the expected test selection')
  }
  await select(0, 5)
  await right(2)
  assert.deepEqual(await selection(), { from: 0, to: 5 })
  await page.screenshot({ path: resolve(output, 'paper-right-click.png') })
  await item('复制').click()
  await waitClipboard(original.slice(0, 5))
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), original.slice(0, 5))
  assert.equal(await text(), original)
  mark('right-click inside selection preserves it; copy reaches the configured clipboard driver through IPC')
  await right(9)
  const moved = await selection()
  assert.equal(moved.from, moved.to)
  assert(moved.from >= 7 && moved.from <= 11, `outside click moved to expected line: ${moved.from}`)
  assert.equal(await item('复制').getAttribute('data-disabled'), '')
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.querySelector('[data-testid="paper-editor"]')?.__cmView?.hasFocus)
  mark('right-click outside selection moves caret; Escape restores focus')
  await select(0, 5)
  await right(2)
  await item('剪切').click()
  await waitText(original.slice(5))
  assert.equal(await text(), original.slice(5))
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), original.slice(0, 5))
  await right(0)
  await item('撤销').click()
  assert.equal(await text(), original)
  await right(1)
  await item('重做').click()
  assert.equal(await text(), original.slice(5))
  mark('cut transaction has correct independent undo and redo')
  await select(0, 0)
  await app.evaluate(({ clipboard }) => clipboard.writeText('粘贴测试\n第二段'))
  await right(0)
  await item('粘贴').click()
  await waitText('粘贴测试\n第二段' + original.slice(5))
  assert.equal(await text(), '粘贴测试\n第二段' + original.slice(5))
  await right(1)
  await item('撤销').click()
  assert.equal(await text(), original.slice(5))
  mark('menu paste uses the configured clipboard driver and one-step undo')
  await select(0, 0)
  await page.keyboard.press('Shift+F10')
  await page.locator('.editor-action-menu').first().waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  mark('Shift+F10 opens editor menu')
  await right(0)
  await page.getByTestId('editor-menu-find').click()
  await page.getByTestId('paper-search-query').waitFor()
  assert(await page.getByTestId('paper-search-query').evaluate(el => el === document.activeElement), 'find owns focus')
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  mark('find receives focus and closes with Escape')
  await right(0)
  await page.getByTestId('editor-menu-chapter-meta').click()
  const meta = page.getByRole('dialog', { name: '本章工作笔记' })
  await meta.waitFor()
  await page.screenshot({ path: resolve(output, 'chapter-dialog.png') })
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  await meta.waitFor({ state: 'detached' })
  await page.waitForTimeout(100)
  if (await editor.evaluate(el => el.__cmView.hasFocus)) mark('chapter dialog returns editor focus')
  else { report.errors.push('chapter dialog did not return editor focus'); console.log('FAIL chapter dialog did not return editor focus') }
  await select(0, 2)
  await right(1)
  await page.getByTestId('editor-menu-rewrite').click()
  const custom = page.getByRole('dialog', { name: '自定义改写' })
  await custom.waitFor()
  assert(await custom.locator('input').evaluate(el => el === document.activeElement), 'custom dialog owns focus')
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  await custom.waitFor({ state: 'detached' })
  await page.waitForTimeout(100)
  if (await editor.evaluate(el => el.__cmView.hasFocus)) mark('custom rewrite dialog returns editor focus')
  else { report.errors.push('custom rewrite dialog did not return editor focus'); console.log('FAIL custom rewrite dialog did not return editor focus') }
  await select(0, 2)
  await right(1)
  assert.equal(await page.getByTestId('editor-menu-proofread').count(), 0, 'paused proofreading is absent from the manuscript menu')
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  mark('paused proofreading has no manuscript menu action')
  const beforeEmptyPaste = await text()
  await select(0, 2)
  await app.evaluate(({ clipboard }) => clipboard.clear())
  await right(1)
  await item('粘贴').click()
  await page.waitForTimeout(150)
  assert.equal(await text(), beforeEmptyPaste, 'empty/non-text clipboard must not delete the selection')
  mark('empty clipboard paste preserves selected manuscript')
  const overflow = async () => { await page.getByTestId('paper-editor-menu-trigger').click(); await page.locator('.editor-action-menu').first().waitFor() }
  const command = async name => { await overflow(); await page.getByTestId(`editor-menu-${name}`).click() }
  const rewrite = async () => { await overflow(); await page.getByTestId('editor-menu-rewrite').click() }
  const reset = async value => { await editor.evaluate((el, value) => { const v = el.__cmView; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, selection: { anchor: 0 } }); v.focus() }, value); await waitText(value) }
  const save = async () => { await command('save'); await page.waitForFunction(() => document.querySelector('[data-testid="paper-save-state"]')?.textContent === '已保存') }
  const waitFor = async (check, label) => { const end = Date.now() + 12000; while (Date.now() < end) { if (await check()) return; await page.waitForTimeout(50) } throw new Error(`Timed out: ${label}`) }
  const goChapter = async name => { await page.locator('.tree-row.tree-main').filter({ hasText: name }).click(); await page.getByTestId('paper-path').filter({ hasText: name }).waitFor() }

  await overflow()
  await page.keyboard.press('ArrowDown')
  assert(await page.evaluate(() => !!document.activeElement?.closest('[role="menu"]')), 'arrow keys move menu focus')
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  await waitFor(() => editor.evaluate(el => el.__cmView.hasFocus), 'focus after overflow Escape')
  await page.keyboard.press('ContextMenu')
  await page.locator('.editor-action-menu').first().waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  // Synthetic key events cover the IME guards; this is not a real OS IME session.
  await waitFor(() => editor.evaluate(el => el.__cmView.hasFocus), 'focus before composition')
  await editor.locator('.cm-content').dispatchEvent('keydown', { key: 'F10', shiftKey: true, isComposing: true })
  assert.equal(await page.locator('.editor-action-menu').count(), 0)
  await editor.locator('.cm-content').dispatchEvent('keydown', { key: 'ContextMenu', keyCode: 229 })
  assert.equal(await page.locator('.editor-action-menu').count(), 0)
  mark('menu key, arrow navigation, and synthetic composition guard')

  await overflow()
  assert.equal(await page.getByTestId('editor-menu-typewriter').count(), 0)
  assert.equal(await page.getByTestId('editor-menu-focus').count(), 0)
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  await reset(original)
  await command('replace')
  await page.getByTestId('paper-search-query').fill('第二行')
  await page.getByTestId('paper-search-replace').fill('替换行')
  await page.getByRole('button', { name: '全部替换', exact: true }).click()
  await waitText(original.replace('第二行', '替换行'))
  await page.getByTestId('paper-search-close').click()
  await command('undo')
  await waitText(original)
  await save()
  mark('view settings absent from menu; replace and undo; menu save reaches disk')
  assert.equal(await readFile(resolve(project, '正文/001 菜单验收.md'), 'utf8'), original)


  const calls = []; report.rpc = calls
  let heldFim, holdFim = false
  await page.exposeFunction('__menuRecordRpc', record => {
    calls.push(record)
    if (record.kind === 'fim' && holdFim) {
      heldFim = { abort: async () => {} }
      return true
    }
    return false
  })
  // Electron's intercepted HTTP responses report status 0 in this environment.
  // Inject explicit deterministic Responses at fetch while retaining the production RPC caller.
  await page.evaluate(() => {
    const realFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
      const match = /\/manuscript\/(fim|patch)\.complete$/.exec(url.pathname)
      if (!match) return realFetch(input, init)
      const request = JSON.parse(init.body)
      const held = await globalThis.__menuRecordRpc({ kind: match[1], request })
      if (held) await new Promise((resolve, reject) => {
        if (init.signal?.aborted) reject(new DOMException('Aborted', 'AbortError'))
        else init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
      return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { text: match[1] === 'fim' ? '补全建议文字。' : '改写后的选段。' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })
  await select(0, 2)
  await overflow()
  assert.equal(await page.getByTestId('editor-menu-complete').getAttribute('data-disabled'), '')
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  assert.equal(calls.length, 0)
  await select(0, 0)
  await command('complete')
  await page.getByRole('button', { name: '接受补全', exact: true }).waitFor()
  assert.equal(await text(), original, 'completion previews without writing')
  await page.getByRole('button', { name: '接受补全', exact: true }).click()
  await waitText('补全建议文字。' + original)
  await command('undo')
  await waitText(original)
  await select(0, 3)
  await rewrite()
  await page.getByRole('dialog', { name: '自定义改写' }).getByLabel('输入改写要求').fill('缩短并保留信息')
  await page.getByRole('dialog', { name: '自定义改写' }).getByRole('button', { name: '改写', exact: true }).click()
  const proposal = page.locator('[aria-label="选段修改建议"]')
  await proposal.waitFor()
  assert.equal(await text(), original)
  await proposal.getByRole('button', { name: '放弃', exact: true }).click()
  assert.equal(await text(), original)
  await select(0, 3)
  await rewrite()
  const customRequest = page.getByRole('dialog', { name: '自定义改写' })
  await customRequest.getByLabel('输入改写要求').fill('缩短并保留信息')
  await customRequest.getByRole('button', { name: '改写', exact: true }).click()
  await proposal.waitFor()
  await page.screenshot({ path: resolve(output, 'rewrite-preview.png') })
  await proposal.getByRole('button', { name: '应用修改', exact: true }).click()
  await waitText('改写后的选段。' + original.slice(3))
  await command('undo')
  await waitText(original)
  mark('completion and custom rewrite preview, apply, discard and undo through stubbed RPC')

  await select(0, 2)
  await rewrite()
  await customRequest.getByLabel('输入改写要求').fill('过期提交')
  const beforeExpired = calls.length
  await editor.evaluate(el => el.__cmView.dispatch({ changes: { from: 0, insert: '新' } }))
  await customRequest.getByRole('button', { name: '改写', exact: true }).click()
  await customRequest.waitFor({ state: 'detached' })
  assert.equal(calls.length, beforeExpired)
  assert.equal(await text(), '新' + original)
  mark('custom rewrite rejects a changed document snapshot before RPC')

  holdFim = true
  await select(0, 0)
  await command('complete')
  await waitFor(() => !!heldFim, 'held completion')
  await page.getByRole('button', { name: '停止补全', exact: true }).waitFor()
  await overflow()
  assert.equal(await page.getByTestId('editor-menu-complete').getAttribute('data-disabled'), '')
  assert.equal(await page.getByTestId('editor-menu-paste').getAttribute('data-disabled'), null)
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '停止补全', exact: true }).click()
  await heldFim.abort().catch(() => {})
  holdFim = false
  await page.getByRole('button', { name: '停止补全', exact: true }).waitFor({ state: 'detached' })
  assert.equal(await page.getByRole('button', { name: '接受补全', exact: true }).count(), 0)
  mark('busy menu blocks duplicate generation, permits local edits; stop leaves no stale suggestion')

  // Failed writes are injected at Electron clipboard, retaining production trust checks.
  await app.evaluate(({ clipboard }) => { globalThis.__menuWrite = clipboard.writeText; clipboard.writeText = () => { throw new Error('test clipboard denied') } })
  await select(0, 2)
  const beforeDenied = await text()
  await command('cut')
  await waitFor(async () => (await page.getByTestId('paper-notice').innerText()).includes('剪贴板'), 'failed copy notice')
  assert.equal(await text(), beforeDenied)
  await app.evaluate(({ clipboard }) => { clipboard.writeText = globalThis.__menuWrite })
  mark('failed native-driver write preserves manuscript and surfaces a notice')

  // Delayed reads exercise renderer snapshot validation. This one test replaces
  // the read handler intentionally; sender trust is covered above and in unit tests.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('dsh-window:clipboard-read-text')
    ipcMain.handle('dsh-window:clipboard-read-text', () => new Promise(resolve => { globalThis.__releaseMenuRead = resolve }))
  })
  await select(0, 0)
  await command('paste')
  await waitFor(() => app.evaluate(() => !!globalThis.__releaseMenuRead), 'delayed clipboard read')
  await editor.evaluate(el => el.__cmView.dispatch({ changes: { from: 0, insert: '编辑' } }))
  const edited = await text()
  await app.evaluate(() => { globalThis.__releaseMenuRead('不该粘贴'); globalThis.__releaseMenuRead = null })
  await page.waitForTimeout(150)
  assert.equal(await text(), edited)
  await save()
  await command('paste')
  await waitFor(() => app.evaluate(() => !!globalThis.__releaseMenuRead), 'second delayed read')
  await goChapter('002 第二章.md')
  await waitText('第二章的独立正文。\n')
  await app.evaluate(() => { globalThis.__releaseMenuRead('不该跨章粘贴'); globalThis.__releaseMenuRead = null })
  await page.waitForTimeout(150)
  assert.equal(await text(), '第二章的独立正文。\n')
  await overflow()
  assert.equal(await page.getByTestId('editor-menu-undo').getAttribute('data-disabled'), '')
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  mark('delayed paste cancels after editing or chapter switch; undo cannot import the previous chapter')
  await app.evaluate(({ ipcMain, clipboard }) => { ipcMain.removeHandler('dsh-window:clipboard-read-text'); ipcMain.handle('dsh-window:clipboard-read-text', () => clipboard.readText()) })

  await page.evaluate(() => {
    const realFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
      if (url.pathname.endsWith('/manuscript/file.read') && JSON.parse(init.body).payload.path === '正文/001 菜单验收.md') {
        await new Promise(resolve => { globalThis.__releaseFileRead = resolve })
      }
      return realFetch(input, init)
    }
  })
  await goChapter('001 菜单验收.md')
  await waitFor(() => page.evaluate(() => !!globalThis.__releaseFileRead), 'delayed file read')
  const duringLoad = await text()
  await editor.evaluate(el => el.__cmView.dispatch({ changes: { from: 0, insert: '不该修改旧稿' } }))
  assert.equal(await text(), duringLoad)
  assert.equal(await editor.locator('.cm-content').getAttribute('contenteditable'), 'false')
  await page.getByTestId('paper-editor-menu-trigger').click()
  for (const name of ['undo', 'cut', 'copy', 'paste', 'select-all', 'save', 'find', 'complete', 'rewrite']) assert.equal(await page.getByTestId(`editor-menu-${name}`).getAttribute('data-disabled'), '', `loading disables ${name}`)
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  await page.evaluate(() => { globalThis.__releaseFileRead(); globalThis.__releaseFileRead = null })
  await waitText(edited)
  await overflow()
  assert.equal(await page.getByTestId('editor-menu-undo').getAttribute('data-disabled'), '')
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  mark('delayed file load blocks editing and stale commands; new load resets history')

  const header = '---\ntriggers: [港口]\nenabled: true\npriority: 0\n---\n'
  const worldBody = '港口的世界书正文，，仍然完整。\n'
  await mkdir(resolve(project, '世界书'), { recursive: true })
  await writeFile(resolve(project, '世界书/港口.md'), header + worldBody, 'utf8')
  const worldDir = page.locator('.tree-directory-row > .tree-row').filter({ hasText: '世界书' }).first()
  await worldDir.waitFor()
  if (await worldDir.getAttribute('aria-expanded') !== 'true') await worldDir.click()
  await goChapter('港口.md')
  await waitText(worldBody)
  await command('select-all')
  await command('copy')
  await waitClipboard(worldBody)
  await command('cut')
  await waitText('')
  await save()
  assert.equal(await readFile(resolve(project, '世界书/港口.md'), 'utf8'), header)
  await command('undo')
  await waitText(worldBody)
  await save()
  assert.equal(await readFile(resolve(project, '世界书/港口.md'), 'utf8'), header + worldBody)
  mark('worldbook copy/cut/save/undo preserve frontmatter exactly')

  await page.locator('.theme-toggle').click()
  await overflow()
  const menuBounds = await page.locator('.editor-action-menu').first().boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert(menuBounds.x >= 0 && menuBounds.y >= 0 && menuBounds.x + menuBounds.width <= viewport.width && menuBounds.y + menuBounds.height <= viewport.height)
  await page.screenshot({ path: resolve(output, 'ink-menu.png') })
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  const paperBox = await editor.boundingBox()
  await page.mouse.click(paperBox.x + paperBox.width - 3, paperBox.y + paperBox.height - 3, { button: 'right' })
  await page.locator('.editor-action-menu').first().waitFor()
  const edge = await page.locator('.editor-action-menu').first().boundingBox()
  assert(edge.x >= 0 && edge.y >= 0 && edge.x + edge.width <= viewport.width && edge.y + edge.height <= viewport.height)
  await page.screenshot({ path: resolve(output, 'edge-menu.png') })
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  assert.equal(await page.getByTestId('paper-fim').count(), 0)
  assert.equal(await page.locator('.rewrite-presets').count(), 0)
  assert.equal(await page.locator('.paper-experience-toggles').count(), 0)
  await page.screenshot({ path: resolve(output, 'idle-ink.png') })
  mark('ink theme, edge collision positioning and removed idle controls')
  // Feed the shell a disabled-capability response without relying on plugin-management UI.
  await page.addInitScript(() => {
    const realFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
      if (/\/manuscript\/(fim|patch)\.complete$/.test(url.pathname)) {
        await globalThis.__menuRecordRpc({ kind: 'unexpected-disabled-request' })
        throw new Error('test blocked an unexpected generation request while disabled')
      }
      const response = await realFetch(input, init)
      if (!url.pathname.endsWith('/dsh-editor-shell/capabilities.get')) return response
      const body = await response.json()
      body.result.value.features.completion = false
      globalThis.__menuDisabledCaps = true
      return new Response(JSON.stringify(body), { status: response.status, headers: response.headers })
    }
  })
  await page.reload()
  await page.locator('.shell').waitFor()
  await waitFor(() => page.evaluate(() => globalThis.__menuDisabledCaps === true), 'disabled capability fixture')
  await waitText(edited)
  const beforeDisabled = calls.length
  await select(0, 0)
  await overflow()
  assert.equal(await page.getByTestId('editor-menu-complete').getAttribute('data-disabled'), '')
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  await select(0, 2)
  await overflow()
  assert.equal(await page.getByTestId('editor-menu-rewrite').getAttribute('data-disabled'), '')
  await page.keyboard.press('Escape')
  await page.locator('.editor-action-menu').first().waitFor({ state: 'detached' })
  await page.keyboard.press('Control+Space')
  await page.waitForTimeout(200)
  assert.equal(calls.length, beforeDisabled)
  mark('disabled capability fixture disables both menu entries and sends zero generation requests')
  await command('chapter-meta')
  const chapterForm = page.getByRole('dialog', { name: '本章工作笔记' })
  await chapterForm.getByLabel('章纲节拍').fill('抵达港口')
  await chapterForm.getByLabel('此刻', { exact: true }).fill('等待靠岸')
  await chapterForm.getByRole('button', { name: '写入', exact: true }).click()
  await chapterForm.waitFor({ state: 'detached' })
  assert.equal(await text(), edited)
  await save()
  const chapterWithMeta = await readFile(resolve(project, '正文/001 菜单验收.md'), 'utf8')
  assert(chapterWithMeta.startsWith('---\n'))
  assert(chapterWithMeta.includes('抵达港口') && chapterWithMeta.includes('等待靠岸') && chapterWithMeta.endsWith(edited))
  mark('chapter metadata dialog writes through draft/save while preserving visible manuscript')
  report.rpcCount = calls.length

  report.ok = report.errors.length === 0
} catch (error) {
  report.ok = false
  report.failure = error.stack ?? String(error)
  console.error(report.failure)
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
    await writeFile(resolve(output, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => ''), 'utf8')
  }
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
  if (app) {
    await app.evaluate(({ clipboard }) => { const old = globalThis.__originalMenuClipboard; if (old) { clipboard.clear(); for (const [format, buffer] of old) clipboard.writeBuffer(format, buffer) } }).catch(() => {})
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy() }).catch(() => {})
    await app.close().catch(() => {})
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log(`Report: ${resolve(output, 'report.json')}`)
}
if (!report.ok) process.exitCode = report.blocked ? 2 : 1
