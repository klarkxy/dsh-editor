import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'e2e', 'out', 'web-search-settings')
const BRAVE_REF = 'DSH_EDITOR_WEB_BRAVE_API_KEY'

const INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>web-search-settings</title>
  <style>
    html, body { margin: 0; background: #111; color: #eee; font: 15px/1.5 sans-serif; }
    #root { max-width: 760px; margin: 24px auto; padding: 0 16px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { NetworkSearchSettings, apply } from '/packages/dsh-web-search-manager/src/client.tsx'

    function makeClient() {
      return {
        connection: {
          rpc: {
            call(_channel, endpoint, payload) {
              return window.rpc({ kind: 'manager', endpoint, payload: payload ?? {} })
            },
          },
        },
        remote: {
          credentials: {
            describe(refs) { return window.rpc({ kind: 'credentials.describe', refs }) },
            set(ref, value) { return window.rpc({ kind: 'credentials.set', ref, value }) },
            unset(ref) { return window.rpc({ kind: 'credentials.unset', ref }) },
          },
        },
        slots: { inject() { return () => {} }, register() { return () => {} } },
      }
    }

    apply({ ...makeClient(), effect(run) { run() } })
    let root
    window.mountSettings = () => {
      const el = document.getElementById('root')
      if (root) root.unmount()
      root = createRoot(el)
      root.render(React.createElement(NetworkSearchSettings, { client: makeClient() }))
    }
    window.mountSettings()
  </script>
</body>
</html>
`

function viteAlias(file) {
  return file.replaceAll('\\', '/')
}

function headerToken(headers) {
  if (!headers) return undefined
  if (typeof headers.get === 'function') {
    return headers.get('x-subscription-token') ?? headers.get('X-Subscription-Token') ?? undefined
  }
  if (Array.isArray(headers)) {
    const hit = headers.find(([key]) => String(key).toLowerCase() === 'x-subscription-token')
    return hit?.[1]
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'x-subscription-token') return value
  }
}

function failResult(error) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'WEB_REQUEST_FAILED'
  const message = error instanceof Error ? error.message : '网络设置操作失败，请刷新后重试。'
  return { ok: false, error: { code, message, details: {} } }
}

function createHost({ WebSearchManager, BraveSearchProvider, defaultSettings }) {
  const state = {
    manager: null,
    keys: new Map(),
    writable: new Map(),
    failNextSet: false,
    setLog: [],
    events: [],
    braveRequests: [],
    wrappers: [],
  }

  function snapshot() {
    return {
      status: state.manager ? state.manager.status() : null,
      setLog: state.setLog.map((row) => ({ ...row })),
      events: state.events.map((row) => ({ ...row })),
      braveRequests: state.braveRequests.map((row) => ({ ...row })),
      keys: Object.fromEntries(state.keys),
      failNextSet: state.failNextSet,
    }
  }

  async function reset(options = {}) {
    if (state.manager) await state.manager.dispose()
    state.keys = new Map(Object.entries(options.keys ?? {}))
    state.writable = new Map(Object.entries(options.writable ?? {}))
    state.failNextSet = Boolean(options.failNextSet)
    state.setLog = []
    state.events = []
    state.braveRequests = []
    state.wrappers = []
    const initial = { ...defaultSettings(), ...(options.settings ?? {}) }
    if (Array.isArray(options.settings?.searchOrder)) initial.searchOrder = [...options.settings.searchOrder]
    const wrappers = state.wrappers
    const registry = {
      registerSearchProvider(wrapper) {
        wrappers.push(wrapper)
        return () => {
          const index = wrappers.indexOf(wrapper)
          if (index >= 0) wrappers.splice(index, 1)
        }
      },
      registerFetchProvider() {
        return () => {}
      },
    }
    state.manager = new WebSearchManager({
      web: registry,
      initial,
      resolveCredential: async (ref) => state.keys.get(ref),
      save: async () => {},
    })
    state.manager.registerSearchProvider({
      id: 'ddg',
      label: 'DuckDuckGo',
      billing: 'none',
      description: '无需注册。默认后端。',
    }, () => ({
      id: 'ddg',
      available: () => true,
      async search() {
        return { sources: [{ url: 'https://example.com/ddg', title: 'DDG', snippet: 'mock' }], truncated: false }
      },
    }))
    state.manager.registerSearchProvider({
      id: 'brave',
      label: 'Brave',
      description: 'Brave Search API。',
      defaultBaseURL: 'https://api.search.brave.com',
      credentialRef: BRAVE_REF,
      billing: 'request',
      signupUrl: 'https://api.search.brave.com',
    }, (options) => new BraveSearchProvider({
      apiKey: options.apiKey ?? '',
      baseURL: options.baseURL,
      fetch: async (url, init) => {
        const token = headerToken(init?.headers)
        const record = { url: String(url), token }
        state.braveRequests.push(record)
        state.events.push({ type: 'request', token, url: String(url) })
        return Response.json({
          web: { results: [{ title: 'Mock', url: 'https://example.com/mock', description: 'fixture' }] },
        })
      },
    }))
    if (options.catalog) {
      for (const [id, label] of [
        ['zhihu-global', '知乎全网搜索'], ['bocha', '博查'], ['deepseek-official', 'DeepSeek 搜索'],
        ['exa', 'Exa'], ['firecrawl', 'Firecrawl'], ['serper', 'Serper'], ['tavily', 'Tavily'],
      ]) {
        state.manager.registerSearchProvider({
          id, label, description: 'Provider fixture', billing: 'request',
          credentialRef: 'FIXTURE_' + id.replaceAll('-', '_').toUpperCase(), credentialShared: id === 'zhihu-global' || id === 'deepseek-official',
        }, options => ({ id, available: () => Boolean(options.apiKey),
          async search() { throw new Error('Catalog rendering must not call providers') },
        }))
      }
    }
    await state.manager.refresh()
    return snapshot()
  }

  async function rpc(request) {
    try {
      const kind = request?.kind
      if (kind === 'fixture.reset') return await reset(request.payload ?? {})
      if (kind === 'fixture.snapshot') return snapshot()
      if (kind === 'fixture.failNextSet') {
        state.failNextSet = true
        return { ok: true, value: true }
      }
      if (kind === 'fixture.setWritable') {
        state.writable.set(request.ref, request.writable)
        return { ok: true, value: true }
      }
      if (kind === 'credentials.describe') {
        const refs = request.refs ?? []
        return {
          ok: true,
          value: Object.fromEntries(refs.map((ref) => [ref, {
            configured: Boolean(state.keys.get(ref)?.trim()),
            writable: state.writable.get(ref) !== false,
          }])),
        }
      }
      if (kind === 'credentials.set') {
        const { ref, value } = request
        if (state.failNextSet) {
          state.failNextSet = false
          return failResult({ code: 'WEB_CREDENTIAL_WRITE_FAILED', message: '无法保存凭据。' })
        }
        if (state.writable.get(ref) === false) {
          return failResult({ code: 'WEB_CREDENTIAL_READONLY', message: '凭据只读。' })
        }
        state.keys.set(ref, value)
        state.setLog.push({ ref, value })
        state.events.push({ type: 'set', ref, value })
        return { ok: true, value: null }
      }
      if (kind === 'credentials.unset') {
        state.keys.delete(request.ref)
        state.setLog.push({ ref: request.ref, value: null, unset: true })
        state.events.push({ type: 'unset', ref: request.ref })
        return { ok: true, value: null }
      }
      const endpoint = request.endpoint ?? kind
      if (endpoint === 'status') return { ok: true, value: await state.manager.refresh() }
      if (endpoint === 'update') {
        const next = await state.manager.update(request.payload.settings, request.payload.expectedRevision)
        return { ok: true, value: next }
      }
      if (endpoint === 'test') {
        const wrapper = state.wrappers.find((item) => item.available())
        if (!wrapper) return failResult({ code: 'WEB_DISABLED', message: '网络搜索未启用或设置已改变。' })
        const result = await wrapper.search({ query: 'test' })
        return { ok: true, value: { sources: result.sources.length } }
      }
      return failResult({ code: 'WEB_INVALID_REQUEST', message: '未知操作。' })
    } catch (error) {
      return failResult(error)
    }
  }

  return { reset, rpc, snapshot, state }
}

async function settle(page) {
  await page.waitForFunction(() => {
    const limits = document.querySelector('fieldset.web-search-limits')
    return Boolean(limits) && !limits.disabled
  }, { timeout: 20_000 })
}

async function waitReady(page) {
  await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="web-search-settings"]')), { timeout: 30_000 })
  await settle(page)
}

async function remount(page) {
  await page.evaluate(() => window.mountSettings())
  await waitReady(page)
}

async function shot(page, name) {
  await page.screenshot({ path: resolve(output, name), fullPage: true })
}

const results = []

async function test(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`ok  ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: String(error?.stack || error) })
    console.error(`fail ${name}`)
    console.error(error)
  }
}

let browser
let page
let vite
let httpServer
let host

try {
  await mkdir(output, { recursive: true })

  const rootRequire = createRequire(resolve(root, 'package.json'))
  const vitestRequire = createRequire(rootRequire.resolve('vitest/package.json'))
  const { createServer } = await import(pathToFileURL(vitestRequire.resolve('vite')).href)
  const shellRequire = createRequire(resolve(root, 'packages/dsh-editor-shell/package.json'))
  const react = viteAlias(shellRequire.resolve('react'))
  const reactJsx = viteAlias(shellRequire.resolve('react/jsx-runtime'))
  const reactJsxDev = viteAlias(shellRequire.resolve('react/jsx-dev-runtime'))
  const reactDom = viteAlias(shellRequire.resolve('react-dom'))
  const reactDomClient = viteAlias(shellRequire.resolve('react-dom/client'))

  vite = await createServer({
    configFile: false,
    root,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
    resolve: {
      alias: {
        'react-dom/client': reactDomClient,
        'react-dom': reactDom,
        'react/jsx-dev-runtime': reactJsxDev,
        'react/jsx-runtime': reactJsx,
        react,
      },
    },
    optimizeDeps: {
      include: ['react', 'react-dom/client', 'react/jsx-runtime'],
      entries: ['packages/dsh-web-search-manager/src/client.tsx'],
    },
    plugins: [{
      name: 'web-search-settings-html',
      configureServer(server) {
        return () => {
          server.middlewares.use(async (req, res, next) => {
            const url = req.url?.split('?')[0]
            if (req.method !== 'GET' && req.method !== 'HEAD') return next()
            if (url !== '/' && url !== '/index.html') return next()
            try {
              const html = await server.transformIndexHtml('/index.html', INDEX_HTML)
              res.setHeader('Content-Type', 'text/html; charset=utf-8')
              res.end(html)
            } catch (error) {
              next(error)
            }
          })
        }
      },
    }],
  })

  const [{ WebSearchManager }, { BraveSearchProvider }, contracts] = await Promise.all([
    vite.ssrLoadModule('/packages/dsh-web-search-manager/src/manager.ts'),
    vite.ssrLoadModule('/packages/dsh-web-search-manager/src/rest-search.ts'),
    vite.ssrLoadModule('/packages/dsh-web-search-manager/src/contracts.ts'),
  ])
  host = createHost({ WebSearchManager, BraveSearchProvider, defaultSettings: contracts.defaultSettings })
  await host.reset()

  httpServer = createHttpServer((req, res) => {
    vite.middlewares(req, res, () => {
      res.statusCode = 404
      res.end('not found')
    })
  })
  await new Promise((resolveListen, rejectListen) => {
    httpServer.listen(0, '127.0.0.1', resolveListen)
    httpServer.once('error', rejectListen)
  })
  const { port } = httpServer.address()
  const origin = `http://127.0.0.1:${port}`

  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 960, height: 1400 }, locale: 'zh-CN' })
  const dialogs = []
  page.on('dialog', async (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() })
    await dialog.accept()
  })
  await page.exposeFunction('rpc', (request) => host.rpc(request))
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await waitReady(page)
  await shot(page, '00-mounted.png')

  await test('mount real NetworkSearchSettings', async () => {
    const mounted = await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="web-search-settings"]')))
    assert.ok(mounted)
  })

  await test('request limits tab preserves drafts and saves across tab switches', async () => {
    const providers = page.getByRole('tab', { name: '搜索服务', exact: true })
    const limits = page.getByRole('tab', { name: '请求限制', exact: true })
    assert.equal(await providers.getAttribute('aria-selected'), 'true')
    assert.equal(await page.getByRole('spinbutton').count(), 0)
    await providers.focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await limits.getAttribute('aria-selected'), 'true')
    assert.equal(await limits.evaluate(el => document.activeElement === el), true)
    assert.equal(await page.getByTestId('web-search-tool').isVisible(), false)
    assert.equal(await page.getByRole('spinbutton').count(), 4)
    await page.getByLabel('每条查询的结果上限').fill('8')
    await page.getByLabel('请求超时（毫秒）').fill('45000')
    await providers.click()
    await limits.click()
    assert.equal(await page.getByLabel('每条查询的结果上限').inputValue(), '8')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await settle(page)
    assert.equal(host.snapshot().status.settings.maxResults, 8)
    assert.equal(host.snapshot().status.settings.timeoutMs, 45000)
    await page.setViewportSize({ width: 760, height: 900 })
    await shot(page, 'request-limits-dark.png')
    await page.evaluate(() => { document.body.style.background = '#fff'; document.body.style.color = '#222' })
    await shot(page, 'request-limits-light.png')
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await shot(page, 'request-limits-narrow.png')
    await limits.focus()
    await page.keyboard.press('Home')
    assert.equal(await providers.getAttribute('aria-selected'), 'true')
    await page.keyboard.press('End')
    assert.equal(await limits.getAttribute('aria-selected'), 'true')
    await page.keyboard.press('ArrowLeft')
    assert.equal(await providers.getAttribute('aria-selected'), 'true')
    await page.evaluate(() => { document.body.style.background = ''; document.body.style.color = '' })
    await page.setViewportSize({ width: 960, height: 1400 })
    await host.reset()
    await remount(page)
  })

  await test('signup link uses desktop bridge for click and keyboard', async () => {
    await page.evaluate(() => {
      window.openedSignupUrls = []
      window.dshWindow = { openExternal(url) { window.openedSignupUrls.push(url) } }
    })
    try {
      const link = page.getByRole('link', { name: 'Brave 去注册' })
      const beforePages = page.context().pages().length
      await link.click()
      await link.focus()
      await page.keyboard.press('Enter')
      assert.deepEqual(await page.evaluate(() => window.openedSignupUrls), [
        'https://api.search.brave.com', 'https://api.search.brave.com',
      ])
      assert.equal(page.context().pages().length, beforePages)
      assert.equal(page.url(), origin + '/')
    } finally {
      await page.evaluate(() => { delete window.dshWindow })
    }
  })

  await test('signup link opens a browser tab without the desktop bridge', async () => {
    await page.context().route('https://api.search.brave.com/**', route => route.fulfill({
      contentType: 'text/html', body: '<title>Signup fixture</title>',
    }))
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('link', { name: 'Brave 去注册' }).click(),
    ])
    try {
      await popup.waitForLoadState('domcontentloaded')
      assert.equal(popup.url(), 'https://api.search.brave.com/')
      assert.equal(await popup.evaluate(() => window.opener), null)
      assert.equal(page.url(), origin + '/')
    } finally {
      await popup.close()
      await page.context().unroute('https://api.search.brave.com/**')
    }
  })

  await test('compact styled settings retain visible keyboard focus across themes', async () => {
    assert.equal(await page.locator('style[data-dsh-web-search]').count(), 1)
    assert.equal(await page.getByText('未开启', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '提高 DuckDuckGo 优先级' }).count(), 0)
    await page.getByRole('switch', { name: '关闭联网搜索' }).focus()
    assert.notEqual(await page.getByRole('switch', { name: '关闭联网搜索' }).evaluate(el => getComputedStyle(el).outlineStyle), 'none')
    await page.setViewportSize({ width: 760, height: 900 })
    await shot(page, 'compact-dark.png')
    await page.evaluate(() => {
      document.body.style.background = '#fff'
      document.body.style.color = '#222'
    })
    await shot(page, 'compact-light.png')
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await shot(page, 'compact-narrow.png')
    await page.evaluate(() => {
      document.body.style.background = ''
      document.body.style.color = ''
    })
    await page.setViewportSize({ width: 960, height: 1400 })
  })

  await test('initial DDG -> enable Brave -> move up -> save key1 -> test uses key1', async () => {
    await host.reset()
    await remount(page)
    await page.waitForFunction(() => {
      const tool = document.querySelector('[data-testid="web-search-tool"]')
      const ddg = document.querySelector('[data-testid="web-search-rank-ddg"] .web-search-rank-index')
      return tool?.getAttribute('data-on') === 'true' && ddg?.textContent?.trim() === '1'
    })
    await page.getByRole('switch', { name: '开启 Brave' }).click()
    await settle(page)
    await page.getByRole('button', { name: '拖动排序 Brave' }).waitFor()
    await page.getByRole('button', { name: '拖动排序 Brave' }).dragTo(page.getByTestId('web-search-rank-ddg'))
    await settle(page)
    await page.waitForFunction(() => (
      document.querySelector('.web-search-rank > li')?.getAttribute('data-testid') === 'web-search-rank-brave'
    ))
    assert.deepEqual(host.snapshot().status.settings.searchOrder, ['brave', 'ddg'])
    const keyBox = page.locator('[data-testid="web-search-rank-brave"] input[type="password"]')
    await keyBox.fill('synthetic-key-1')
    await page.getByRole('button', { name: '保存' }).click()
    await settle(page)
    const afterSave = host.snapshot()
    assert.ok(
      afterSave.setLog.some((row) => row.ref === BRAVE_REF && row.value === 'synthetic-key-1'),
      `set did not receive synthetic-key-1: ${JSON.stringify(afterSave.setLog)}`,
    )
    await page.getByRole('button', { name: '测试连接（可能计费）' }).click()
    await settle(page)
    await page.waitForFunction(() => {
      const note = [...document.querySelectorAll('[role="status"]')].find((node) => node.textContent.includes('连接正常'))
      return Boolean(note)
    })
    const afterTest = host.snapshot()
    assert.ok(
      afterTest.braveRequests.some((row) => row.token === 'synthetic-key-1'),
      `Brave adapter did not receive key1: ${JSON.stringify(afterTest.braveRequests)}`,
    )
    await shot(page, '01-key1-test.png')
  })

  await test('dragging down persists and keyboard sorting keeps focus', async () => {
    await page.getByRole('button', { name: '拖动排序 Brave' }).dragTo(page.getByTestId('web-search-rank-ddg'))
    await settle(page)
    assert.deepEqual(host.snapshot().status.settings.searchOrder, ['ddg', 'brave'])
    await remount(page)
    assert.equal(await page.locator('.web-search-rank > li').first().getAttribute('data-testid'), 'web-search-rank-ddg')
    await page.getByRole('button', { name: '拖动排序 Brave' }).focus()
    await page.keyboard.press('ArrowUp')
    await settle(page)
    assert.deepEqual(host.snapshot().status.settings.searchOrder, ['brave', 'ddg'])
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '拖动排序 Brave')
    const revision = host.snapshot().status.settings.revision
    await page.keyboard.press('ArrowUp')
    assert.equal(host.snapshot().status.settings.revision, revision)
    assert.equal(await page.getByRole('button', { name: '上移', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '下移', exact: true }).count(), 0)
    await shot(page, 'drag-sorting.png')
  })

  await test('cancelling a drag clears feedback without saving', async () => {
    const revision = host.snapshot().status.settings.revision
    const source = await page.getByRole('button', { name: '拖动排序 Brave' }).boundingBox()
    const target = await page.getByTestId('web-search-rank-ddg').boundingBox()
    assert.ok(source && target)
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
    await page.mouse.down()
    await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2, { steps: 3 })
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 6 })
    await page.waitForFunction(() => Boolean(document.querySelector('[data-dragging]')))
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await page.waitForFunction(() => !document.querySelector('[data-dragging], [data-drop]'))
    assert.equal(host.snapshot().status.settings.revision, revision)
    assert.deepEqual(host.snapshot().status.settings.searchOrder, ['brave', 'ddg'])
  })

  await test('typing key2 then test saves key2 before the request', async () => {
    await host.reset({
      keys: { [BRAVE_REF]: 'synthetic-key-1' },
      settings: { searchEnabled: true, searchOrder: ['brave', 'ddg'], searchProvider: 'brave' },
    })
    await remount(page)
    const before = host.state.events.length
    await page.locator('[data-testid="web-search-rank-brave"] input[type="password"]').fill('synthetic-key-2')
    await page.getByRole('button', { name: '测试连接（可能计费）' }).click()
    await settle(page)
    const after = host.state.events.slice(before)
    const setAt = after.findIndex((row) => row.type === 'set' && row.value === 'synthetic-key-2')
    const requestAt = after.findIndex((row) => row.type === 'request' && row.token === 'synthetic-key-2')
    assert.ok(setAt >= 0, `test did not save key2 first: ${JSON.stringify(after)}`)
    assert.ok(requestAt >= 0, `Brave request did not use key2: ${JSON.stringify(after)}`)
    assert.ok(setAt < requestAt, `key2 must be saved before the request: ${JSON.stringify(after)}`)
  })

  await test('empty save does not overwrite', async () => {
    await host.reset({
      keys: { [BRAVE_REF]: 'synthetic-key-1' },
      settings: { searchEnabled: true, searchOrder: ['brave', 'ddg'], searchProvider: 'brave' },
    })
    await remount(page)
    const before = host.state.setLog.length
    await page.locator('[data-testid="web-search-rank-brave"] input[type="password"]').fill('')
    await page.getByRole('button', { name: '保存' }).click()
    await settle(page)
    const snap = host.snapshot()
    assert.equal(snap.setLog.length, before)
    assert.equal(snap.keys[BRAVE_REF], 'synthetic-key-1')
  })

  await test('failed set on test alerts and does not search', async () => {
    await host.reset({
      keys: { [BRAVE_REF]: 'synthetic-key-1' },
      settings: { searchEnabled: true, searchOrder: ['brave', 'ddg'], searchProvider: 'brave' },
    })
    await remount(page)
    const requests = host.state.braveRequests.length
    host.state.failNextSet = true
    dialogs.length = 0
    await page.locator('[data-testid="web-search-rank-brave"] input[type="password"]').fill('synthetic-key-3')
    await page.getByRole('button', { name: '测试连接（可能计费）' }).click()
    await settle(page)
    await page.waitForFunction(() => {
      const alert = document.querySelector('[role="alert"]')
      const success = [...document.querySelectorAll('[role="status"]')].some((node) => node.textContent.includes('连接正常'))
      return Boolean(alert?.textContent?.trim()) && !success
    })
    const snap = host.snapshot()
    assert.equal(snap.braveRequests.length, requests)
    assert.equal(snap.keys[BRAVE_REF], 'synthetic-key-1')
    const success = await page.evaluate(() => [...document.querySelectorAll('[role="status"]')].some((node) => node.textContent.includes('连接正常')))
    assert.equal(success, false)
  })

  await test('read-only key input is disabled', async () => {
    await host.reset({
      keys: { [BRAVE_REF]: 'synthetic-key-1' },
      writable: { [BRAVE_REF]: false },
      settings: { searchEnabled: true, searchOrder: ['brave', 'ddg'], searchProvider: 'brave' },
    })
    await remount(page)
    await page.waitForFunction(() => {
      const input = document.querySelector('[data-testid="web-search-rank-brave"] input[type="password"]')
      return Boolean(input) && input.disabled
    })
  })

  await test('saving a key while master switch is off still updates the key', async () => {
    await host.reset({
      keys: { [BRAVE_REF]: 'synthetic-key-1' },
      settings: { searchEnabled: true, searchOrder: ['brave', 'ddg'], searchProvider: 'brave' },
    })
    await remount(page)
    await page.getByRole('switch', { name: '关闭联网搜索' }).click()
    await settle(page)
    await page.waitForFunction(() => document.querySelector('[data-testid="web-search-tool"]')?.getAttribute('data-on') === 'false')
    await page.locator('[data-testid="web-search-rank-brave"] input[type="password"]').fill('synthetic-key-off')
    await page.getByRole('button', { name: '保存' }).click()
    await settle(page)
    const snap = host.snapshot()
    assert.equal(snap.status.searchActive, false)
    assert.equal(snap.keys[BRAVE_REF], 'synthetic-key-off')
    assert.ok(snap.setLog.some((row) => row.value === 'synthetic-key-off'))
  })

  await test('closing every backend remounts with empty order and disabled master switch', async () => {
    await host.reset({
      keys: { [BRAVE_REF]: 'synthetic-key-1' },
      settings: { searchEnabled: true, searchOrder: ['brave', 'ddg'], searchProvider: 'brave' },
    })
    await remount(page)
    for (let step = 0; step < 8; step += 1) {
      const open = page.locator('ol.web-search-rank button[role="switch"][aria-checked="true"]').first()
      if (await open.count() === 0) break
      await open.click()
      await settle(page)
    }
    await remount(page)
    const snap = host.snapshot()
    assert.deepEqual(snap.status.settings.searchOrder, [])
    await page.waitForFunction(() => {
      const sw = document.querySelector('[data-testid="web-search-tool"] header button[role="switch"]')
      return Boolean(sw) && sw.disabled && sw.getAttribute('aria-checked') === 'false'
    })
  })

  await test('unconfigured Brave can be chosen after all off, then enabled and searched', async () => {
    await host.reset({
      settings: { searchEnabled: false, fetchEnabled: false, searchProvider: '', searchOrder: [] },
    })
    await remount(page)
    await page.getByRole('switch', { name: '开启 Brave' }).click()
    await settle(page)
    const keyBox = page.locator('[data-testid="web-search-rank-brave"] input[type="password"]')
    await page.waitForFunction(() => {
      const input = document.querySelector('[data-testid="web-search-rank-brave"] input[type="password"]')
      return Boolean(input) && !input.disabled
    })
    await keyBox.fill('synthetic-key-new')
    await page.getByRole('button', { name: '保存' }).click()
    await settle(page)
    assert.equal(host.snapshot().keys[BRAVE_REF], 'synthetic-key-new')
    const master = page.getByRole('switch', { name: '启用联网搜索' })
    if (await master.isEnabled()) {
      await master.click()
      await settle(page)
    }
    await page.waitForFunction(() => document.querySelector('[data-testid="web-search-tool"]')?.getAttribute('data-on') === 'true')
    await page.getByRole('button', { name: '测试连接（可能计费）' }).click()
    await settle(page)
    const snap = host.snapshot()
    assert.ok(snap.braveRequests.some((row) => row.token === 'synthetic-key-new'), JSON.stringify(snap.braveRequests))
    await shot(page, '02-brave-enabled.png')
  })
  await test('all provider introductions and prices remain readable when disabled', async () => {
    await host.reset({ catalog: true })
    await remount(page)
    const rows = page.locator('.web-search-rank > li')
    assert.equal(await rows.count(), 9)
    for (const row of await rows.all()) {
      const info = row.locator('.web-search-provider-info')
      assert.equal(await info.isVisible(), true)
      assert.equal(await info.locator('p').count(), 2)
      assert.ok((await info.innerText()).length > 25)
      const link = info.getByRole('link')
      assert.match(await link.getAttribute('href'), /^https:\/\//)
      assert.equal(await link.getAttribute('target'), '_blank')
      assert.match(await link.getAttribute('rel'), /noopener/)
    }
    assert.match(await page.getByTestId('web-search-rank-zhihu-global').innerText(), /5,000 次\/天/)
    assert.match(await page.getByTestId('web-search-rank-tavily').innerText(), /1,000 积分/)
    assert.equal(await page.getByText('API 计费', { exact: true }).count(), 0)
    await page.evaluate(() => {
      window.openedPriceUrls = []
      window.dshWindow = { openExternal(url) { window.openedPriceUrls.push(url) } }
    })
    const priceLink = page.getByRole('link', { name: 'Brave 费用说明' })
    await priceLink.click()
    await priceLink.focus()
    await page.keyboard.press('Enter')
    assert.deepEqual(await page.evaluate(() => window.openedPriceUrls), [
      'https://brave.com/search/api/', 'https://brave.com/search/api/',
    ])
    await page.evaluate(() => { delete window.dshWindow })
    await page.setViewportSize({ width: 960, height: 1100 })
    await shot(page, 'provider-pricing-dark.png')
    await page.evaluate(() => { document.body.style.background = '#fff'; document.body.style.color = '#222' })
    await shot(page, 'provider-pricing-light.png')
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await shot(page, 'provider-pricing-narrow.png')
    await host.reset({ catalog: true, keys: { FIXTURE_ZHIHU_GLOBAL: 'synthetic-key' },
      settings: { searchOrder: ['ddg', 'zhihu-global'] } })
    await remount(page)
    const zhihu = page.getByTestId('web-search-rank-zhihu-global')
    assert.match(await zhihu.innerText(), /与「知乎资料」共用 Access Secret/)
    assert.doesNotMatch(await zhihu.innerText(), /与模型设置共用/)
  })
} catch (error) {
  results.push({ name: 'setup', ok: false, error: String(error?.stack || error) })
  console.error(error)
  if (page) await shot(page, 'fail-setup.png').catch(() => {})
} finally {
  const report = {
    ok: results.length > 0 && results.every((row) => row.ok),
    results,
    snapshot: host ? host.snapshot() : null,
  }
  await mkdir(output, { recursive: true })
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  if (page) await shot(page, 'final.png').catch(() => {})
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  if (httpServer) await new Promise((done) => httpServer.close(() => done()))
  console.log(`report ${resolve(output, 'report.json')}`)
  console.log(JSON.stringify({ ok: report.ok, results: results.map((row) => ({ name: row.name, ok: row.ok, error: row.error })) }, null, 2))
  process.exit(report.ok ? 0 : 1)
}
