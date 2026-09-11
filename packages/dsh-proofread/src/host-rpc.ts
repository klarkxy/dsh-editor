import type { IncomingMessage, ServerResponse } from 'node:http'

const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/
const MAX_BODY_BYTES = 64 * 1024 * 1024

export type HostRpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>

export type HostRpcContext = {
  webServer: {
    register: (route: {
      kind: 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }) => () => void
  }
  connection: {
    requestRejection?: (request: IncomingMessage) => number | undefined
  }
}

/** Standalone copy of manuscript Host RPC registration; this package cannot depend on manuscript. */
export function registerHostRpc(ctx: HostRpcContext, channel: string, handler: HostRpcHandler): () => void {
  if (!CHANNEL_PATTERN.test(channel) || channel === '/api') {
    throw new Error(`invalid RPC channel ${JSON.stringify(channel)}`)
  }
  return ctx.webServer.register({
    kind: 'prefix',
    path: channel,
    handler: (req, res) => dispatchHostRpc(ctx, channel, handler, req, res),
  })
}

function endpointFromRpcPath(channel: string, pathname: string): string | undefined {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  if (endpoint.split('/').some((segment) => segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT.test(segment))) {
    return undefined
  }
  return endpoint
}

async function dispatchHostRpc(
  ctx: HostRpcContext,
  channel: string,
  handler: HostRpcHandler,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const rejection = ctx.connection.requestRejection?.(req)
  if (rejection !== undefined) {
    res.writeHead(rejection)
    res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
    return
  }
  const abort = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) abort.abort()
  })
  const url = new URL(req.url ?? '/', 'http://dsh.internal')
  const endpoint = endpointFromRpcPath(channel, url.pathname)
  if (req.method !== 'POST' || endpoint === undefined) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  const contentType = String(req.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    res.writeHead(415)
    res.end('content type must be application/json')
    return
  }
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    received += buffer.byteLength
    if (received > MAX_BODY_BYTES) {
      res.writeHead(413, { connection: 'close' })
      res.end()
      req.destroy()
      return
    }
    chunks.push(buffer)
  }
  let body: unknown
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')
  } catch {
    res.writeHead(400)
    res.end('body is not JSON')
    return
  }
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  const rpcId = typeof record.rpcId === 'string' ? record.rpcId : 'invalid-request'
  if (record.type !== 'client-request' || record.method !== endpoint) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      type: 'server-response',
      rpcId,
      result: {
        ok: false,
        error: {
          code: 'gateway/bad-request',
          message: record.method !== endpoint
            ? `method ${JSON.stringify(record.method)} does not match endpoint ${JSON.stringify(endpoint)}`
            : 'invalid client-request message',
          details: { issues: [] },
        },
      },
    }))
    return
  }
  try {
    const result = await handler(endpoint, record.payload, abort.signal)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ type: 'server-response', rpcId, result }))
  } catch (error) {
    res.writeHead(500)
    res.end(`handler failure: ${String(error)}`)
  }
}
