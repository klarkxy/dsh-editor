import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it } from 'vitest'
import { registerHostRpc, type HostRpcContext } from './host-rpc.ts'
import type { RpcResult } from './contracts.ts'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))))
})

async function host(rejection?: number, omitPolicy = false, result: RpcResult = { ok: true, value: { configured: false } }) {
  let handler: Parameters<HostRpcContext['webServer']['register']>[0]['handler']
  const call = async () => result
  const spy = { calls: 0, impl: call }
  registerHostRpc({
    connection: omitPolicy ? {} : { requestRejection: () => rejection },
    webServer: { register: route => { handler = route.handler; return () => {} } },
  }, '/dsh-ai-services', async (...args) => {
    spy.calls += 1
    return spy.impl(...args)
  })
  const server = createServer((req, res) => { void handler(req, res) })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  return { spy, url: `http://127.0.0.1:${address.port}/dsh-ai-services/status` }
}

function request(url: string, body: unknown = { type: 'client-request', rpcId: 'test', method: 'status', payload: {} }) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

it.each([401, 403])('rejects unauthenticated/foreign-origin requests with %s before dispatch', async rejection => {
  const { spy, url } = await host(rejection)
  expect((await request(url)).status).toBe(rejection)
  expect(spy.calls).toBe(0)
})

it('fails closed when the host authorization policy is missing', async () => {
  const { spy, url } = await host(undefined, true)
  expect((await request(url)).status).toBe(503)
  expect(spy.calls).toBe(0)
})

it('uses the existing client-request envelope and disables caching', async () => {
  const { spy, url } = await host()
  const response = await request(url)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({
    type: 'server-response', rpcId: 'test', result: { ok: true, value: { configured: false } },
  })
  expect(spy.calls).toBe(1)
})

it('rejects invalid method envelopes before dispatch', async () => {
  const { spy, url } = await host()
  expect((await request(url, { type: 'client-request', rpcId: 'test', method: 'update', payload: {} })).status).toBe(400)
  expect(spy.calls).toBe(0)
})

it('serializes RpcResult shapes that carry extra error fields', async () => {
  const detailed: RpcResult = { ok: false, error: { code: 'X', message: 'no' } }
  const extra = { ok: false as const, error: { code: 'X', message: 'no', details: { n: 1 } } }
  const { url } = await host(undefined, false, extra as RpcResult)
  expect(await (await request(url)).json()).toEqual({
    type: 'server-response', rpcId: 'test', result: extra,
  })
  expect(detailed.ok).toBe(false)
})

it('supplies the required native connection failure details when a plugin omits them', async () => {
  const { url } = await host(undefined, false, { ok: false, error: { code: 'AI_POLICY_CONFLICT', message: 'Refresh before saving.' } })
  const response = await request(url)
  const body = await response.json()
  expect(body.result).toEqual({ ok: false, error: { code: 'AI_POLICY_CONFLICT', message: 'Refresh before saving.', details: {} } })
})
