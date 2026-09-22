import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RpcResult } from './contracts.ts'

export interface HostRpcContext {
  webServer: { register(route: { kind: 'prefix'; path: string; handler(req: IncomingMessage, res: ServerResponse): void | Promise<void> }): () => void }
  connection: { requestRejection?: (request: IncomingMessage) => number | undefined }
}

/** Safe host RPC registration. Missing requestRejection fails closed. Result type accepts any RpcResult shape. */
export function registerHostRpc<R extends RpcResult = RpcResult>(
  ctx: HostRpcContext,
  channel: string,
  call: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<R>,
): () => void {
  return ctx.webServer.register({ kind: 'prefix', path: channel, handler: async (req, res) => {
    // Require the host's origin/auth policy. Missing policy must not expose settings.
    if (!ctx.connection.requestRejection) { res.writeHead(503); res.end(); return }
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) { res.writeHead(rejection); res.end(); return }
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
    const endpoint = pathname.startsWith(`${channel}/`) ? pathname.slice(channel.length + 1) : ''
    if (req.method !== 'POST' || !/^[a-z.]+$/.test(endpoint)) { res.writeHead(404); res.end(); return }
    if (String(req.headers['content-type'] ?? '').split(';')[0]?.trim() !== 'application/json') {
      res.writeHead(415); res.end(); return
    }
    const controller = new AbortController()
    res.on('close', () => { if (!res.writableEnded) controller.abort() })
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > 64 * 1024) { res.writeHead(413, { connection: 'close' }); res.end(); req.destroy(); return }
        chunks.push(buffer)
      }
      let request: Record<string, unknown>
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
        request = parsed as Record<string, unknown>
      } catch { res.writeHead(400); res.end(); return }
      if (request.type !== 'client-request' || request.method !== endpoint || typeof request.rpcId !== 'string') {
        res.writeHead(400); res.end(); return
      }
      const raw = await call(endpoint, request.payload, controller.signal)
      const result = raw.ok ? raw : { ...raw, error: { details: {}, ...raw.error } }
      if (!res.destroyed) {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result }))
      }
    } catch {
      if (!res.destroyed) { res.writeHead(500); res.end('rpc request failed') }
    }
  } })
}
