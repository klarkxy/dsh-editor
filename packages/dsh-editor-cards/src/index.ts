import type { Context } from '@deepseek-ai/cordis'
import { asHost, badRequest, mapHostError, resolveWorkspaceAccess, withWorkspaceWrite, WorkspaceAuthorityError } from 'dsh-manuscript/host-api'
import { workspaceOpAccess } from 'dsh-editor-workspace-kit'
import { CARDS_RPC_CHANNEL, type CardsRpcResult } from 'dsh-editor-cards/contracts'
import { CardsError, createCard, listCardReferences, listCards, setCardMeta } from './host/cards.ts'

export const name = 'dsh-editor-cards'
export const inject = ['connection', 'sessions', 'workspaceRegistry', 'fs', 'sandboxPolicy'] as const

type Payload = Record<string, unknown>

function str(payload: Payload, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}

export function mapCardsError(error: unknown): CardsRpcResult {
  if (error instanceof CardsError) {
    if (error.code === 'READ_ONLY') return { ok: false, error: { code: 'directory-unreadable', message: error.message, details: { path: '' } } }
    if (error.code === 'EXISTS') return { ok: false, error: { code: 'directory-exists', message: error.message, details: { path: '' } } }
    if (error.code === 'BLOCKED' || error.code === 'INVALID_PATH' || error.code === 'INVALID' || error.code === 'STALE') return badRequest(error.message)
    return { ok: false, error: { code: 'internal', message: error.message, details: {} } }
  }
  return mapHostError(error) ?? { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} } }
}

export async function dispatchCards(ctx: Context, endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Payload : {}
  const host = asHost(ctx)
  const access = await resolveWorkspaceAccess(host, str(body, 'sessionId'), signal)
  const run = async (): Promise<unknown> => {
    const opAccess = workspaceOpAccess(host, access, signal)
    const rel = str(body, 'path')
    if (endpoint === 'cards.list') return await listCards({ access: opAccess, kind: body.kind })
    if (endpoint === 'cards.references') return await listCardReferences({ access: opAccess, path: rel })
    if (endpoint === 'cards.metaSet') return await setCardMeta({ access: opAccess, path: rel, version: str(body, 'version'), fields: body.fields })
    if (endpoint === 'cards.create') return await createCard({ access: opAccess, kind: body.kind, title: str(body, 'title'), fields: body.fields })
    throw new Error(`unknown cards endpoint ${endpoint}`)
  }
  const mutations = ['cards.metaSet', 'cards.create']
  return mutations.includes(endpoint) ? withWorkspaceWrite(access.root.targetKey, run) : run()
}

export function registerCardsRpc(ctx: Context): () => void {
  const host = asHost(ctx)
  return host.connection.rpc.handle(CARDS_RPC_CHANNEL, async (endpoint: string, payload: unknown, signal: AbortSignal) => {
    try {
      return { ok: true, value: await dispatchCards(ctx, endpoint, payload, signal) }
    } catch (error) {
      if (error instanceof WorkspaceAuthorityError) return mapHostError(error) ?? mapCardsError(error)
      return mapCardsError(error)
    }
  }, { authority: 'loopback' })
}

export function apply(ctx: Context): void {
  ctx.effect(() => registerCardsRpc(ctx), 'dsh-editor-cards.rpc')
}
