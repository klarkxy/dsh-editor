import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'tsdown'
import { chromium } from 'playwright'
import { S } from './helpers/selectors.mjs'

// writing_change 写入回执卡浏览器 fixture：状态加载、撤销成功、撤销被拒可见
// 文案、错误可见文本、light + dark 截图。
const root = resolve(import.meta.dirname, '..')
const output = resolve(root, '.artifacts', 'writing-change-receipts')
const shellRequire = createRequire(resolve(root, 'packages/dsh-editor-shell/package.json'))
await mkdir(output, { recursive: true })
const source = path => JSON.stringify(resolve(root, path).replaceAll('\\', '/'))
const fixture = resolve(output, 'fixture.tsx')
await writeFile(fixture, `
import { createRoot } from ${JSON.stringify(shellRequire.resolve('react-dom/client').replaceAll('\\', '/'))}
import { WritingChangeCard } from ${source('packages/dsh-editor-shell/src/client/chat-writing-change.tsx')}
import { ShellTheme } from ${source('packages/dsh-editor-shell/src/client/ui/theme-root.tsx')}
import { tokenStyles } from ${source('packages/dsh-editor-shell/src/design-system/tokens.ts')}
import { collectStyles, defineStyles } from ${source('packages/dsh-editor-shell/src/design-system/layers.ts')}
import ${source('packages/dsh-editor-shell/src/client/base.styles.ts')}
import ${source('packages/dsh-editor-shell/src/client/chat.styles.ts')}
import ${source('packages/dsh-editor-shell/src/client/ui/activity.styles.ts')}
import ${source('packages/dsh-editor-shell/src/app/shell/shell.styles.ts')}
defineStyles('dsh.tokens', 'yuangao-tokens', tokenStyles)
const shellCss = collectStyles()
const params = new URLSearchParams(location.search)
const mode = params.get('mode') || 'applied'
const appearance = params.get('theme') === 'dark' ? 'dark' : 'light'
const path = '正文/001.md'
const baseReceipt = {
  marker: 'dsh-editor.writing-change', version: 1, id: 'a'.repeat(32),
  kind: 'edit', summary: '替换了一句',
  status: mode === 'undone' ? 'undone' : 'applied',
  paths: [path], count: 1,
}
const record = {
  receipt: baseReceipt,
  files: [{ path, before: '旧句。', after: '新句。' }],
  edits: [{ oldText: '旧句。', newText: '新句。', afterStart: 0, afterEnd: 3 }],
}
const appliedPaths = []
const moved = []
const located = []
const requests = []
window.probe = { appliedPaths, moved, located, requests }
const ctx = { connection: { rpc: { async call(_channel, endpoint, body) {
  requests.push(endpoint)
  if (endpoint === 'writing.change.get') {
    if (mode === 'get-error') return { ok: false, error: { code: 'internal', message: '记录读取失败', details: {} } }
    return { ok: true, value: { ...record, receipt: { ...baseReceipt } } }
  }
  if (endpoint === 'writing.change.undo') {
    if (mode === 'undo-refused') {
      return { ok: false, error: { code: 'internal', message: '《正文/001.md》已被改动，无法撤销。', details: {} } }
    }
    baseReceipt.status = 'undone'
    baseReceipt.message = '已撤销该写入。'
    return { ok: true, value: { ...baseReceipt } }
  }
  throw new Error(endpoint)
} } } }
const messageCardContext = {
  sessionId: 'fixture-session', locale: 'zh',
  onApplied: p => appliedPaths.push(p),
  onMoved: (from, to) => moved.push([from, to]),
  onLocate: (p, excerpt, start) => located.push([p, excerpt, start]),
  refresh: () => {},
  note: () => {},
}
createRoot(document.getElementById('root')).render(
  <ShellTheme appearance={appearance}>
    <style>{shellCss}</style>
    <div className="shell"><div className="chat" style={{ gridRow: '2', alignSelf: 'start', width: '380px', margin: '0 auto', padding: '12px' }}>
      <WritingChangeCard ctx={ctx} sessionId="fixture-session" receipt={{ ...baseReceipt }}
        live={mode === 'live'} messageCardContext={messageCardContext} />
    </div></div>
  </ShellTheme>
)
`, 'utf8')
await build({
  entry: { preview: fixture }, format: ['esm'], platform: 'browser', target: 'es2022',
  outDir: output, clean: false, hash: false, dts: false, deps: { alwaysBundle: [/.*/] },
  plugins: [{
    name: 'receipt-fixture-css',
    resolveId(id) { if (id.endsWith('.css')) return `\0receipt-css:${id}.as-text` },
    async load(id) {
      if (!id.startsWith('\0receipt-css:')) return
      const spec = id.slice('\0receipt-css:'.length, -'.as-text'.length)
      return `export default ${JSON.stringify(await readFile(shellRequire.resolve(spec), 'utf8'))}`
    },
  }],
})
const server = createServer(async (request, response) => {
  if (new URL(request.url, 'http://localhost').pathname === '/preview.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' })
    response.end(await readFile(resolve(output, 'preview.js')))
  } else {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><div id="root"></div><script type="module" src="/preview.js"></script></html>')
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
const errors = []
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  page.setDefaultTimeout(10_000)
  page.on('pageerror', error => errors.push(error.message))
  for (const theme of ['light', 'dark']) {
    // 状态加载：挂载即读 writing.change.get，applied 卡显示徽标 + 定位/撤销按钮。
    await page.goto(`${origin}/?mode=applied&theme=${theme}`)
    await page.locator(S.changeCard).waitFor()
    assert.equal(await page.getByRole('button', { name: '定位', exact: true }).count(), 1)
    assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).count(), 1)
    assert.deepEqual(await page.evaluate(() => window.probe.requests), ['writing.change.get'])
    assert.match(await page.locator(S.changeCard).innerText(), /已写入/)
    // 定位：调用 onLocate 带上目标路径与第一处新文本。
    await page.getByRole('button', { name: '定位', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.probe.located), [['正文/001.md', '新句。', 0]])
    // 查看改动：disclosure 展开渲染 diff。
    await page.locator(S.changeDiffSummary).click()
    assert.ok(await page.locator(S.changeHunks).count() >= 1)
    // 撤销成功：状态翻转为已撤销，消息可见，路径刷新。
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await page.locator(S.changeCardUndone).waitFor()
    assert.match(await page.locator(S.changeCardUndone).innerText(), /已撤销/)
    assert.match(await page.locator(S.changeCardUndone).innerText(), /已撤销该写入。/)
    assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).count(), 0)
    await page.locator(S.changeCard).screenshot({ path: resolve(output, `undone-${theme}.png`) })
    // applied 展开「查看改动」后的元素截图。
    await page.goto(`${origin}/?mode=applied&theme=${theme}`)
    await page.locator(S.changeCard).waitFor()
    await page.locator(S.changeDiffSummary).click()
    await page.locator(S.changeHunks).waitFor()
    await page.locator(S.changeCard).screenshot({ path: resolve(output, `applied-expanded-${theme}.png`) })
    // 撤销被拒：错误以可见文本呈现，卡保持 applied。
    await page.goto(`${origin}/?mode=undo-refused&theme=${theme}`)
    await page.locator(S.changeCard).waitFor()
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await page.locator(S.changeCard).getByText(/已被改动，无法撤销。/).waitFor()
    assert.equal(await page.locator(S.changeCardUndone).count(), 0)
    await page.locator(S.changeCard).screenshot({ path: resolve(output, `undo-refused-${theme}.png`) })
    // get 失败：卡片仍渲染回执，撤销按钮仍可用（错误不靠颜色隐藏）。
    await page.goto(`${origin}/?mode=get-error&theme=${theme}`)
    await page.locator(S.changeCard).waitFor()
    assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).count(), 1)
    // 已撤销状态加载：历史重载后显示 undone。
    await page.goto(`${origin}/?mode=undone&theme=${theme}`)
    await page.locator(S.changeCardUndone).waitFor()
    assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).count(), 0)
    // live 回执触发无导航刷新回调；历史行不触发。
    await page.goto(`${origin}/?mode=live&theme=${theme}`)
    await page.locator(S.changeCard).waitFor()
    await page.waitForFunction(() => window.probe.appliedPaths.length === 1)
    assert.deepEqual(await page.evaluate(() => window.probe.appliedPaths), ['正文/001.md'])
    await page.locator(S.changeCard).screenshot({ path: resolve(output, `applied-${theme}.png`) })
  }
  assert.deepEqual(errors, [])
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ passed: true, themes: ['light', 'dark'], scenarios: ['status load', 'locate', 'diff disclosure', 'undo success', 'undo refused visible text', 'get error still renders', 'undone restore', 'live refresh callback'], pageErrors: errors }, null, 2) + '\n')
  console.log('Writing-change receipt browser fixture: passed in light and dark themes')
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0]
  if (page) {
    await page.screenshot({ path: resolve(output, 'failure.png') })
    await writeFile(resolve(output, 'failure.txt'), JSON.stringify({ errors, body: await page.locator(S.body).innerText() }, null, 2))
  }
  console.error('Writing-change fixture errors:', errors)
  throw error
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
