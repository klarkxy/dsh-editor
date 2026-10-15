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
import { useMemo, useRef, useState } from ${JSON.stringify(shellRequire.resolve('react').replaceAll('\\', '/'))}
import { createRoot } from ${JSON.stringify(shellRequire.resolve('react-dom/client').replaceAll('\\', '/'))}
import { ProposalCard } from ${source('packages/dsh-editor-shell/src/client/chat-proposal.tsx')}
import { createProposalBoard } from ${source('packages/dsh-editor-shell/src/model/proposal-board.ts')}
import { ChatProposalPill, ProposalBoardScope, useProposalRowBoard } from ${source('packages/dsh-editor-shell/src/client/chat-proposal-board.tsx')}
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
const batch = mode === 'batch' || mode === 'batch-conflict'
const appearance = params.get('theme') === 'dark' ? 'dark' : 'light'
const path = '正文/001.md'
const proposal = { kind: 'edit', path, oldText: '旧句。', newText: '新句。', summary: '替换一句' }
/* batch 模式：三条同一回合的编辑提案，各自维护自己的文件与版本。 */
const batchPaths = ['正文/001.md', '正文/002.md', '正文/003.md']
const batchState = Object.fromEntries(batchPaths.map(p => [p, { version: 'v0', text: '旧文 ' + p }]))
const batchProposals = batchPaths.map((p, index) => ({
  kind: 'edit', path: p,
  oldText: batchState[p].text, newText: '新文 ' + p, summary: '替换 ' + (index + 1),
}))
let version = mode === 'mismatch' ? 'v2' : 'v0'
let text = '旧句。'
let receipt = mode === 'mismatch' ? { state: 'applied', path, version: 'v1' }
  : mode === 'applied' || mode === 'undone' ? { state: mode, path, version } : null
const refreshedPaths = []
const requests = []
const applyCalls = []
window.probe = { refreshedPaths, requests, applyCalls }
const ctx = { connection: { rpc: { async call(_channel, endpoint, body) {
  requests.push(endpoint)
  if (batch) {
    const state = batchState[body.path]
    if (endpoint === 'proposal.receipt') return { ok: true, value: { receipt: null } }
    if (endpoint === 'proposal.prepare' && state) return { ok: true, value: { kind: 'edit', version: state.version, before: state.text, after: '新文 ' + body.path } }
    if (endpoint === 'file.read' && state) return { ok: true, value: { version: state.version, text: state.text } }
    if (endpoint === 'proposal.apply' && state) {
      applyCalls.push(body.path)
      if (body.expectedVersion !== state.version) throw new Error('unexpected baseline')
      if (mode === 'batch-conflict' && body.path === batchPaths[1]) {
        return { ok: false, error: { code: 'internal', message: '文件版本已变化', details: {} } }
      }
      state.version = 'v1'; state.text = '新文 ' + body.path
      return { ok: true, value: { path: body.path, version: state.version, operation: 'edit' } }
    }
    throw new Error(endpoint)
  }
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
/* batch 卡片走与 ChatRowView 相同的接线：context 拿 board/turnKey/applyAll。 */
function BoundCard({ id, proposal: cardProposal }) {
  const rowBoard = useProposalRowBoard(id)
  return <ProposalCard ctx={ctx} sessionId="fixture-session" proposal={cardProposal}
    board={rowBoard.board} boardId={id} boardTurnKey={rowBoard.turnKey}
    applyAll={rowBoard.applyAll}
    onApplied={p => refreshedPaths.push(p)} />
}
function BatchThread() {
  const scrollRef = useRef(null)
  const [board] = useState(() => createProposalBoard())
  const turnKeys = useMemo(() => new Map([['p1', 0], ['p2', 0], ['p3', 0]]), [])
  return <ProposalBoardScope board={board} turnKeys={turnKeys}>
    <div ref={scrollRef} className="chat-history" style={{ height: '240px', overflow: 'auto', position: 'relative' }}>
      <ChatProposalPill historyRef={scrollRef} />
      <BoundCard id="p1" proposal={batchProposals[0]} />
      <BoundCard id="p2" proposal={batchProposals[1]} />
      <BoundCard id="p3" proposal={batchProposals[2]} />
    </div>
  </ProposalBoardScope>
}
createRoot(document.getElementById('root')).render(
  <ShellTheme appearance={appearance}>
    <style>{shellCss}</style>
    <div className="shell"><div className="chat">
      {batch
        ? <BatchThread />
        : <ProposalCard ctx={ctx} sessionId="fixture-session" proposal={proposal} receiptId="fixture-result"
          onApplied={path => refreshedPaths.push(path)} />}
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
    // 全部应用：三条同回合编辑提案全部核对安全 → 粘性条 + 首卡都给批量入口，
    // 顺序应用走完，各自回执与版本照常；编辑提案渲染 hunk 差异而非全文。
    await page.goto(`${origin}/?mode=batch&theme=${theme}`)
    await page.getByRole('button', { name: '应用修改', exact: true }).nth(2).waitFor()
    assert.equal(await page.locator(S.proposalHunks).count(), 3)
    assert.ok(await page.locator(S.proposalHunkDel).count() >= 3)
    assert.ok(await page.locator(S.proposalHunkAdd).count() >= 3)
    assert.equal(await page.locator(`${S.proposalCard} pre`).count(), 0)
    await page.locator(S.proposalPill).waitFor()
    assert.match(await page.locator(S.proposalPill).innerText(), /3 个待处理提案/)
    assert.equal(await page.getByRole('button', { name: /全部应用 \(3\)/ }).count(), 2)
    await page.getByRole('button', { name: /全部应用 \(3\)/ }).first().click()
    await page.locator(S.proposalCardApplied).nth(2).waitFor()
    assert.deepEqual(await page.evaluate(() => window.probe.refreshedPaths), ['正文/001.md', '正文/002.md', '正文/003.md'])
    assert.deepEqual(await page.evaluate(() => window.probe.applyCalls), ['正文/001.md', '正文/002.md', '正文/003.md'])
    await page.screenshot({ path: resolve(output, `apply-all-${theme}.png`) })
    // 中途冲突：第一条应用成功，第二条版本冲突停在冲突态，第三条保持待处理不再写入。
    await page.goto(`${origin}/?mode=batch-conflict&theme=${theme}`)
    await page.getByRole('button', { name: '应用修改', exact: true }).nth(2).waitFor()
    await page.getByRole('button', { name: /全部应用 \(3\)/ }).first().click()
    await page.locator(S.proposalCardExpired).waitFor()
    assert.equal(await page.locator(S.proposalCardApplied).count(), 1)
    assert.equal(await page.locator(S.proposalCardExpired).count(), 1)
    assert.equal(await page.getByRole('button', { name: '应用修改', exact: true }).count(), 1)
    assert.deepEqual(await page.evaluate(() => window.probe.refreshedPaths), ['正文/001.md'])
    /* 第二条冲突即停：apply 只打过前两张卡，003 从未被触碰。 */
    assert.deepEqual(await page.evaluate(() => window.probe.applyCalls), ['正文/001.md', '正文/002.md'])
    await page.screenshot({ path: resolve(output, `apply-all-conflict-${theme}.png`) })
  }
  assert.deepEqual(errors, [])
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ passed: true, themes: ['light', 'dark'], scenarios: ['partial undo refresh', 'mismatched receipt restore', 'applied restore', 'undone restore', 'apply all three sequential', 'apply all stops at conflict'], pageErrors: errors }, null, 2) + '\n')
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
