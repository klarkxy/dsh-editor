import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'tsdown'
import { chromium } from 'playwright'

// EditorCore syncFromDisk 浏览器 fixture：mock rpc 挂载真实编辑器，
// 断言 updated/merged、.cm-agent-change 高亮、选区映射、Ctrl+Z 回退。
const root = resolve(import.meta.dirname, '..')
const output = resolve(root, '.artifacts', 'editor-external-sync')
const shellRequire = createRequire(resolve(root, 'packages/dsh-editor-shell/package.json'))
await mkdir(output, { recursive: true })
const source = path => JSON.stringify(resolve(root, path).replaceAll('\\', '/'))
const fixture = resolve(output, 'fixture.tsx')
await writeFile(fixture, `
import { createRoot } from ${JSON.stringify(shellRequire.resolve('react-dom/client').replaceAll('\\', '/'))}
import { EditorCore, editorCoreStyles } from ${source('packages/dsh-manuscript/src/client/editor-core/index.ts')}
import { ShellTheme } from ${source('packages/dsh-editor-shell/src/client/ui/theme-root.tsx')}
import { tokenStyles } from ${source('packages/dsh-editor-shell/src/design-system/tokens.ts')}
import { collectStyles, defineStyles } from ${source('packages/dsh-editor-shell/src/design-system/layers.ts')}
import ${source('packages/dsh-editor-shell/src/client/base.styles.ts')}
import ${source('packages/dsh-editor-shell/src/client/editor.styles.ts')}
defineStyles('dsh.tokens', 'yuangao-tokens', tokenStyles)
const shellCss = collectStyles()
const params = new URLSearchParams(location.search)
const appearance = params.get('theme') === 'dark' ? 'dark' : 'light'
const V1 = '第一章的开场，先交代天气。\\n\\n第二段是安静的铺陈，没有改动。\\n\\n第三段收束本章。'
const V2 = '第一章的开场焕然一新，天气换成了夜雨。\\n\\n第二段是安静的铺陈，没有改动。\\n\\n第三段收束本章，结尾多了一笔回声。'
const disk = { version: 'v1', text: V1 }
const rpc = { async call(channel, endpoint, body) {
  if (endpoint === 'file.read') return { ok: true, value: { version: disk.version, text: disk.text } }
  if (endpoint === 'file.write') {
    disk.version = 'v' + (Number(disk.version.slice(1)) + 1)
    disk.text = body.text
    return { ok: true, value: { version: disk.version } }
  }
  throw new Error(endpoint)
} }
window.__setDisk = (text, version) => { disk.text = text; disk.version = version }
window.__disk = disk
let handle = null
window.__handle = () => handle
window.__status = []
createRoot(document.getElementById('root')).render(
  <ShellTheme appearance={appearance}>
    <style>{shellCss}</style>
    <style>{editorCoreStyles}</style>
    <div className="shell">
      <div className="editor-stack" style={{ display: 'flex', flexDirection: 'column', height: '480px', padding: '24px' }}>
        <EditorCore
          sessionId="fixture-session"
          path="正文/001.md"
          rpc={rpc}
          completionEnabled={false}
          autoSaveDelayMs={60000}
          onHandle={next => { handle = next; window.__handleReady = Boolean(next) }}
          onStatusChange={status => window.__status.push(status)}
          testIdPrefix="paper"
          paperClassName="manuscript-paper"
          slotClassName={{
            header: 'manuscript-paper-header',
            textarea: 'manuscript-paper-textarea',
            mirror: 'manuscript-paper-mirror',
            ghost: 'manuscript-paper-ghost',
            ghostTip: 'manuscript-paper-ghost-tip',
            proposal: 'manuscript-paper-proposal',
            conflict: 'manuscript-paper-conflict',
            notice: 'manuscript-paper-notice',
            footer: 'manuscript-paper-footer',
          }} />
      </div>
    </div>
  </ShellTheme>
)
window.__v1 = V1
window.__v2 = V2
`, 'utf8')
await build({
  entry: { preview: fixture }, format: ['esm'], platform: 'browser', target: 'es2022',
  outDir: output, clean: false, hash: false, dts: false, deps: { alwaysBundle: [/.*/] },
  plugins: [{
    name: 'sync-fixture-css',
    resolveId(id) { if (id.endsWith('.css')) return `\0sync-css:${id}.as-text` },
    async load(id) {
      if (!id.startsWith('\0sync-css:')) return
      const spec = id.slice('\0sync-css:'.length, -'.as-text'.length)
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
  const page = await browser.newPage({ viewport: { width: 720, height: 560 } })
  page.setDefaultTimeout(15_000)
  page.on('pageerror', error => errors.push(error.message))
  const ready = async () => {
    await page.waitForFunction(() => window.__handleReady && window.__handle().getDocument()?.text === window.__v1)
  }
  for (const theme of ['light', 'dark']) {
    // 干净缓冲区：两段更新就地应用，高亮落在改动段，选区映射保留。
    await page.goto(`${origin}/?theme=${theme}`)
    await ready()
    const cursorAt = await page.evaluate(() => window.__v1.indexOf('安静的铺陈') + 2)
    await page.evaluate((at) => window.__handle().revealRange(at, at), cursorAt)
    await page.evaluate(() => window.__setDisk(window.__v2, 'v2'))
    const result = await page.evaluate(() => window.__handle().syncFromDisk())
    assert.equal(result, 'updated')
    assert.equal(await page.evaluate(() => window.__handle().getText()), await page.evaluate(() => window.__v2))
    assert.equal(await page.evaluate(() => window.__handle().isDirty()), false)
    const marks = await page.locator('.cm-agent-change').all()
    assert.equal(marks.length, 2)
    const markedText = await page.evaluate(() => [...document.querySelectorAll('.cm-agent-change')].map(el => el.textContent).join(''))
    assert.match(markedText, /夜雨/)
    assert.match(markedText, /回声/)
    // 选区映射到第二段内的同一相对位置（前面段落变长，偏移随之平移）。
    const sel = await page.evaluate(() => window.__handle().getSelection())
    const mappedExpected = await page.evaluate(() => window.__v2.indexOf('安静的铺陈') + 2)
    assert.deepEqual(sel, { start: mappedExpected, end: mappedExpected })
    await page.locator('.editor-stack').screenshot({ path: resolve(output, `agent-highlight-${theme}.png`) })
    // Ctrl+Z 撤回搭档修改，回到 v1。
    await page.evaluate(() => document.querySelector('.cm-content').focus())
    await page.keyboard.press('Control+z')
    await page.waitForFunction(() => window.__handle().getText() === window.__v1)
    // 脏缓冲区合并：作者在第二段键入未触碰区域的文字，磁盘同时改首尾两段。
    await page.goto(`${origin}/?theme=${theme}`)
    await ready()
    const typeAt = await page.evaluate(() => window.__v1.indexOf('没有改动') + 4)
    await page.evaluate((at) => window.__handle().revealRange(at, at), typeAt)
    await page.keyboard.type('作者注')
    await page.waitForFunction(() => window.__handle().isDirty())
    await page.evaluate(() => window.__setDisk(window.__v2, 'v2'))
    const merged = await page.evaluate(() => window.__handle().syncFromDisk())
    assert.equal(merged, 'merged')
    const mergedText = await page.evaluate(() => window.__handle().getText())
    assert.match(mergedText, /作者注/)
    assert.match(mergedText, /夜雨/)
    assert.match(mergedText, /回声/)
    assert.equal(await page.evaluate(() => window.__handle().isDirty()), true)
    const mergedMarks = await page.locator('.cm-agent-change').all()
    assert.equal(mergedMarks.length, 2)
  }
  assert.deepEqual(errors, [])
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ passed: true, themes: ['light', 'dark'], scenarios: ['clean updated + highlights + selection mapped + ctrl-z revert', 'dirty merged disjoint'], pageErrors: errors }, null, 2) + '\n')
  console.log('Editor external-sync fixture: passed in light and dark themes')
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0]
  if (page) {
    await page.screenshot({ path: resolve(output, 'failure.png') })
    await writeFile(resolve(output, 'failure.txt'), JSON.stringify({ errors, body: await page.locator('body').innerText().catch(() => '') }, null, 2))
  }
  console.error('Editor external-sync fixture errors:', errors)
  throw error
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
