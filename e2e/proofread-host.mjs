/** Real Cordis + DSH HTTP connection, with no Agent/session/file/model services. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRequire = createRequire(resolve(root, '.dev/desktop-dsh-runtime/package.json'))
const load = name => import(pathToFileURL(runtimeRequire.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { WebServer } = await load('@deepseek-ai/dsh-host-webserver')
const connection = await load('@deepseek-ai/dsh-client-connection')
const proofread = await import(pathToFileURL(resolve(root, 'packages/dsh-proofread/lib/index.js')).href)
const ctx = new Context()
const missing = ['sessions', 'workspaceRegistry', 'fs', 'sandboxPolicy', 'llm', 'tools', 'systemPrompt', 'credentials', 'agent', 'agents']
const report = { ok: false, runtime: '0.1.1-rc.2', provided: ['webServer', 'connection'], missing: [], checks: [] }
let port
try {
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(connection)
  let plugin = await ctx.plugin(proofread)
  report.plugins = [...ctx.registry.values()].map(runtime => runtime.name)
  const deadline = Date.now() + 15_000
  while (!(ctx.get('webServer')?.port) || !ctx.get('connection')) {
    if (Date.now() > deadline) throw new Error('minimal Host did not start')
    await new Promise(resolvePromise => setTimeout(resolvePromise, 30))
  }
  port = ctx.get('webServer').port
  const endpoint = `http://127.0.0.1:${port}/proofread/text.check`
  const call = (payload, headers = {}) => fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ type: 'client-request', rpcId: 'proofread-host-check', method: 'text.check', payload }),
    signal: AbortSignal.timeout(5000),
  })
  for (const service of missing) { assert.equal(ctx.get(service), undefined, service); report.missing.push(service) }
  const initial = await call({ text: '我们以经做好准备。', kinds: ['typo'] })
  assert.equal(initial.status, 200)
  const envelope = await initial.json()
  assert.equal(envelope.result.ok, true, JSON.stringify(envelope))
  assert.equal(envelope.result.value.findings[0].suggestion, '已经')
  report.checks.push('text RPC over real HTTP without AI/workspace services')
  const hostile = await call({ text: '' }, { origin: 'https://untrusted.example' })
  assert.equal(hostile.status, 403)
  report.checks.push('inherited browser trust fence')
  await plugin.dispose()
  assert.equal((await call({ text: '' })).status, 404)
  report.checks.push('plugin unload removes route')
  plugin = await ctx.plugin(proofread)
  await new Promise(resolvePromise => setTimeout(resolvePromise, 30))
  const restored = await (await call({ text: '按装', kinds: ['typo'] })).json()
  assert.equal(restored.result.ok, true)
  assert.equal(restored.result.value.findings.length, 1)
  report.checks.push('reload registers once and still works')
  await plugin.dispose()
  report.ok = true
} finally {
  await ctx.fiber.dispose()
  if (port) {
    let unavailable = false
    try { await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) }) } catch { unavailable = true }
    assert.equal(unavailable, true, 'host still listening after stop')
    report.checks.push('host stop releases port')
  }
  const output = resolve(root, 'e2e/out/proofread-host')
  await mkdir(output, { recursive: true })
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
}
console.log(JSON.stringify(report, null, 2))
