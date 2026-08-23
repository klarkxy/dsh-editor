import type { Context } from '@deepseek-ai/cordis'

export type RpcResult = { ok: true; value: unknown } | { ok: false; error: { message: string } }

export type RpcBag = {
  call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<RpcResult>
  handle: (
    channel: string,
    handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
    options: { authority: string },
  ) => () => void
}

export type SlotSpec = {
  name: string
  children?: Record<string, { kind: string; scope: string }>
}

export type ManuscriptHost = Context & {
  connection: { rpc: RpcBag }
}

export type SessionListSnapshot = {
  current?: string
  byId?: Record<string, { cwd?: string }>
}

export type ManuscriptClient = Context & {
  slots: {
    inject: (key: string, callback: () => unknown) => () => void
    register: (
      spec: SlotSpec,
      render: (props: { sessionId?: string; renderSlot?: (name: string) => unknown }) => unknown,
    ) => () => void
  }
  sessions: {
    list?: {
      getSnapshot?: () => SessionListSnapshot
      subscribe?: (fn: () => void) => () => void
    }
  }
  connection: { rpc: RpcBag }
}

export function asHost(ctx: Context): ManuscriptHost {
  return ctx as ManuscriptHost
}

export function asClient(ctx: Context): ManuscriptClient {
  return ctx as ManuscriptClient
}
