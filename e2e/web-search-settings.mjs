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
    import { NetworkSearchSettings } from '/packages/dsh-web-search-manager/src/client.tsx'

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
    server: { middlewareMode: true, hmr: false },
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
    await page.waitForFunction(() => {
      const index = document.querySelector('[data-testid="web-search-rank-brave"] .web-search-rank-index')
      return index && index.textContent.trim() !== '—'
    })
    await page.getByRole('button', { name: '提高 Brave 优先级' }).click()
    await settle(page)
    await page.waitForFunction(() => (
      document.querySelector('[data-testid="web-search-rank-brave"] .web-search-rank-index')?.textContent?.trim() === '1'
    ))
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
