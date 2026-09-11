import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { endpointFromRpcPath, registerHostRpc } from './channel.ts'

function request(options: {
  method?: string
  url: string
  headers?: Record<string, string>
  body?: string
}): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage & EventEmitter
  emitter.method = options.method ?? 'POST'
  emitter.url = options.url
  emitter.headers = options.headers ?? { 'content-type': 'application/json' }
  ;(emitter as IncomingMessage & { [Symbol.asyncIterator](): AsyncGenerator<Buffer> })[Symbol.asyncIterator] = async function* () {
    if (options.body) yield Buffer.from(options.body)
  }
  emitter.destroy = vi.fn()
  return emitter
}

function response() {
  const writes: Array<{ status: number; body: string; headers?: Record<string, string | number | string[]> }> = []
  const res = {
    writableEnded: false,
    writeHead(status: number, headers?: Record<string, string | number | string[]>) {
      writes.push({ status, body: '', headers })
      return res
    },
    end(body?: string) {
      res.writableEnded = true
      if (!writes.length) writes.push({ status: 200, body: '' })
      writes[writes.length - 1]!.body = body === undefined ? '' : String(body)
      return res
    },
    on() { return res },
  }
  return { res: res as unknown as ServerResponse, writes }
}

describe('registerHostRpc', () => {
  it('mounts a prefix route on webServer, not connection.rpc.handle', () => {
    const register = vi.fn(() => () => undefined)
    registerHostRpc({
      webServer: { register },
      connection: {},
    }, '/manuscript', async () => ({ ok: true }))
    expect(register).toHaveBeenCalledWith({
      kind: 'prefix',
      path: '/manuscript',
      handler: expect.any(Function),
    })
  })

  it('dispatches a Connection client-request envelope', async () => {
    const register = vi.fn()
    registerHostRpc({
      webServer: { register },
      connection: { requestRejection: () => undefined },
    }, '/manuscript', async (endpoint, payload) => ({ endpoint, payload }))
    const handler = register.mock.calls[0]![0].handler as (req: IncomingMessage, res: ServerResponse) => Promise<void>
    const { res, writes } = response()
    await handler(request({
      url: '/manuscript/file.read',
      body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-1', method: 'file.read', payload: { path: '正文/1.md' } }),
    }), res)
    expect(writes[0]).toMatchObject({ status: 200 })
    expect(JSON.parse(writes[0]!.body)).toEqual({
      type: 'server-response',
      rpcId: 'rpc-1',
      result: { endpoint: 'file.read', payload: { path: '正文/1.md' } },
    })
  })

  it('honors the Host connection fence', async () => {
    const register = vi.fn()
    registerHostRpc({
      webServer: { register },
      connection: { requestRejection: () => 401 },
    }, '/manuscript', async () => ({ ok: true }))
    const handler = register.mock.calls[0]![0].handler as (req: IncomingMessage, res: ServerResponse) => Promise<void>
    const { res, writes } = response()
    await handler(request({ url: '/manuscript/file.read', body: '{}' }), res)
    expect(writes[0]).toMatchObject({ status: 401, body: 'unauthorized' })
  })
})

describe('endpointFromRpcPath', () => {
  it('accepts a single endpoint segment under the channel', () => {
    expect(endpointFromRpcPath('/manuscript', '/manuscript/file.read')).toBe('file.read')
    expect(endpointFromRpcPath('/manuscript', '/manuscript/../secret')).toBeUndefined()
    expect(endpointFromRpcPath('/manuscript', '/other/file.read')).toBeUndefined()
  })
})
