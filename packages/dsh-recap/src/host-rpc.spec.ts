import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-ai-services/host-rpc'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))))
})

async function host(rejection?: number, omitPolicy = false) {
  let handler: Parameters<HostRpcContext['webServer']['register']>[0]['handler']
  const call = vi.fn(async () => ({ ok: true as const, value: { cardsEnabled: false } }))
  registerHostRpc({
    connection: omitPolicy ? {} : { requestRejection: () => rejection },
    webServer: { register: route => { handler = route.handler; return () => {} } },
  }, '/dsh-recap', call)
  const server = createServer((req, res) => { void handler(req, res) })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  return { call, url: `http://127.0.0.1:${address.port}/dsh-recap/status` }
}

function request(url: string, body: unknown = { type: 'client-request', rpcId: 'test', method: 'status', payload: {} }) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

it.each([401, 403])('rejects unauthenticated/foreign-origin requests with %s before dispatch', async rejection => {
  const { call, url } = await host(rejection)
  expect((await request(url)).status).toBe(rejection)
  expect(call).not.toHaveBeenCalled()
})

it('fails closed when the host authorization policy is missing', async () => {
  const { call, url } = await host(undefined, true)
  expect((await request(url)).status).toBe(503)
  expect(call).not.toHaveBeenCalled()
})

it('uses the existing client-request envelope and disables caching', async () => {
  const { call, url } = await host()
  const response = await request(url)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({
    type: 'server-response', rpcId: 'test', result: { ok: true, value: { cardsEnabled: false } },
  })
  expect(call).toHaveBeenCalledOnce()
})

it('rejects invalid method envelopes before dispatch', async () => {
  const { call, url } = await host()
  expect((await request(url, { type: 'client-request', rpcId: 'test', method: 'update', payload: {} })).status).toBe(400)
  expect(call).not.toHaveBeenCalled()
})
