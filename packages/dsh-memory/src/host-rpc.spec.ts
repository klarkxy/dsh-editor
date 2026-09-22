import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it } from 'vitest'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-ai-services/host-rpc'
import { MEMORY_RPC_CHANNEL } from './contracts.ts'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))))
})

async function host(rejection?: number, omitPolicy = false) {
  let handler: Parameters<HostRpcContext['webServer']['register']>[0]['handler']
  const call = async () => ({ ok: true as const, value: { ready: true } })
  registerHostRpc({
    connection: omitPolicy ? {} : { requestRejection: () => rejection },
    webServer: { register: route => { handler = route.handler; return () => {} } },
  }, MEMORY_RPC_CHANNEL, call)
  const server = createServer((req, res) => { void handler(req, res) })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  return { url: `http://127.0.0.1:${address.port}${MEMORY_RPC_CHANNEL}/status` }
}

function request(url: string, body: unknown = { type: 'client-request', rpcId: 'test', method: 'status', payload: {} }) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

it.each([401, 403])('rejects unauthenticated requests with %s before dispatch', async rejection => {
  const { url } = await host(rejection)
  expect((await request(url)).status).toBe(rejection)
})

it('fails closed when the host authorization policy is missing', async () => {
  const { url } = await host(undefined, true)
  expect((await request(url)).status).toBe(503)
})
