import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'tsdown'
import { chromium } from 'playwright'
import { S } from './helpers/selectors.mjs'

// Production ProposalCard browser fixture with RPC fault injection. Actual
// manuscript writes and durable storage failures are covered by index.spec.ts.
const root = resolve(import.meta.dirname, '..')
const output = resolve(root, '.artifacts', 'proposal-receipts')
const shellRequire = createRequire(resolve(root, 'packages/dsh-editor-shell/package.json'))
await mkdir(output, { recursive: true })
const source = path => JSON.stringify(resolve(root, path).replaceAll('\\', '/'))
const fixture = resolve(output, 'fixture.tsx')
await writeFile(fixture, `
import { createRoot } from ${JSON.stringify(shellRequire.resolve('react-dom/client').replaceAll('\\', '/'))}
import { ProposalCard } from ${source('packages/dsh-editor-shell/src/client/chat-proposal.tsx')}
import { ShellTheme } from ${source('packages/dsh-editor-shell/src/client/ui/theme-root.tsx')}
import { tokenStyles } from ${source('packages/dsh-editor-shell/src/design-system/tokens.ts')}
import { collectStyles, defineStyles } from ${source('packages/dsh-editor-shell/src/design-system/layers.ts')}
import ${source('packages/dsh-editor-shell/src/client/base.styles.ts')}
import ${source('packages/dsh-editor-shell/src/client/editor.styles.ts')}
import ${source('packages/dsh-editor-shell/src/client/chat.styles.ts')}
import ${source('packages/dsh-editor-shell/src/client/palette.styles.ts')}
import ${source('packages/dsh-editor-shell/src/client/dialogs.styles.ts')}
import ${source('packages/dsh-editor-shell/src/client/select.styles.ts')}
import ${source('packages/dsh-editor-shell/src/client/pinned-pane.styles.ts')}
import ${source('packages/dsh-editor-shell/src/client/ui/activity.styles.ts')}
import ${source('packages/dsh-editor-shell/src/app/shell/shell.styles.ts')}
import ${source('packages/dsh-editor-shell/src/app/assistant/assistant.styles.ts')}
defineStyles('dsh.tokens', 'yuangao-tokens', tokenStyles)
const shellCss = collectStyles()
const params = new URLSearchParams(location.search)
const mode = params.get('mode') || 'partial'
const appearance = params.get('theme') === 'dark' ? 'dark' : 'light'
const path = '正文/001.md'
const proposal = { kind: 'edit', path, oldText: '旧句。', newText: '新句。', summary: '替换一句' }
let version = mode === 'mismatch' ? 'v2' : 'v0'
let text = '旧句。'
let receipt = mode === 'mismatch' ? { state: 'applied', path, version: 'v1' }
  : mode === 'applied' || mode === 'undone' ? { state: mode, path, version } : null
const refreshedPaths = []
const requests = []
window.probe = { refreshedPaths, requests }
const ctx = { connection: { rpc: { async call(_channel, endpoint, body) {
  requests.push(endpoint)
  if (endpoint === 'proposal.receipt') return { ok: true, value: { receipt } }
  if (endpoint === 'proposal.prepare') return { ok: true, value: { kind: 'edit', version, before: text, after: '新句。' } }
  if (endpoint === 'file.read') return { ok: true, value: { version, text } }
  if (endpoint === 'proposal.apply') {
    if (body.expectedVersion !== version) throw new Error('unexpected baseline')
    version = 'v1'; text = '新句。'; receipt = { state: 'applied', path, version }
    return { ok: true, value: { path, version, operation: 'edit' } }
  }
  if (endpoint === 'file.write') {
    if (body.version !== version) throw new Error('unexpected undo baseline')
    version = 'v2'; text = body.text
    return { ok: false, error: { code: 'internal', message: 'receipt storage failed',
      details: { partial: true, appliedPaths: [path], reason: 'proposal-receipt-write-failed' } } }
  }
  throw new Error(endpoint)
} } } }
createRoot(document.getElementById('root')).render(
  <ShellTheme appearance={appearance}>
    <style>{shellCss}</style>
    <div className="shell"><div className="chat">
      <ProposalCard ctx={ctx} sessionId="fixture-session" proposal={proposal} receiptId="fixture-result"
        onApplied={path => refreshedPaths.push(path)} />
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
    await page.goto(`${origin}/?theme=${theme}`)
    // §5 稍后处理：ready → deferred 卡仍带「重新核对」，点回 ready。
    await page.getByRole('button', { name: '应用修改', exact: true }).waitFor()
    await page.getByRole('button', { name: '稍后处理', exact: true }).click()
    await page.locator('.proposal-card.deferred').waitFor()
    assert.match(await page.locator('.proposal-card.deferred ' + S.proposalStatus).first().innerText(), /已留到稍后处理/)
    await page.locator(S.proposalCardSummary).click()
    await page.getByRole('button', { name: '重新核对', exact: true }).click()
    await page.getByRole('button', { name: '应用修改', exact: true }).waitFor()
    await page.getByRole('button', { name: '应用修改', exact: true }).click()
    await page.locator(S.proposalCardApplied).waitFor()
    await page.locator(S.proposalCardSummary).click()
    await page.getByRole('button', { name: '撤销此次修改', exact: true }).click()
    await page.locator(S.proposalCardExpired).waitFor()
    assert.match(await page.locator(S.proposalStatus).innerText(), /操作未能全部完成/)
    assert.match(await page.locator(S.proposalStatus).innerText(), /正文\/001.md/)
    assert.doesNotMatch(await page.locator(S.proposalStatus).innerText(), /未写入任何内容/)
    assert.deepEqual(await page.evaluate(() => window.probe.refreshedPaths), ['正文/001.md', '正文/001.md'])
    assert.equal(await page.getByRole('button', { name: '应用修改', exact: true }).count(), 0)
    await page.screenshot({ path: resolve(output, `partial-undo-${theme}.png`) })
    await page.goto(`${origin}/?mode=mismatch&theme=${theme}`)
    await page.locator(S.proposalCardExpired).waitFor()
    assert.match(await page.locator(S.proposalStatus).innerText(), /审批回执不一致/)
    assert.equal(await page.getByRole('button', { name: '应用修改', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '撤销此次修改', exact: true }).count(), 0)
    assert.deepEqual(await page.evaluate(() => window.probe.requests), ['proposal.receipt', 'file.read'])
    await page.screenshot({ path: resolve(output, `mismatched-receipt-${theme}.png`) })
    for (const mode of ['applied', 'undone']) {
      await page.goto(`${origin}/?mode=${mode}&theme=${theme}`)
      await page.locator(S.proposalCardSettled(mode)).waitFor()
      assert.equal(await page.getByRole('button', { name: '应用修改', exact: true }).count(), 0)
    }
  }
  assert.deepEqual(errors, [])
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ passed: true, themes: ['light', 'dark'], scenarios: ['partial undo refresh', 'mismatched receipt restore', 'applied restore', 'undone restore'], pageErrors: errors }, null, 2) + '\n')
  console.log('Proposal receipt browser fixture: passed in light and dark themes')
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0]
  if (page) {
    await page.screenshot({ path: resolve(output, 'failure.png') })
    await writeFile(resolve(output, 'failure.txt'), JSON.stringify({ errors, body: await page.locator(S.body).innerText() }, null, 2))
  }
  console.error('Proposal fixture errors:', errors)
  throw error
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
