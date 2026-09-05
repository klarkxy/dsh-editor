export type EditorDraft = {
  path: string
  text: string
  baseText: string
  baseVersion: string
  /** 草稿归属窗口：Host 按 ownerId 隔离，每个窗口只读写自己的备份。 */
  ownerId?: string
  /** Host 返回的草稿修订号；delete 必须回传最近一次 get/put 拿到的 revision。 */
  revision?: string
  updatedAt?: string
}

export type DraftEndpoint = 'draft.get' | 'draft.put' | 'draft.delete' | 'draft.list'
export type DraftRpcCall = (endpoint: DraftEndpoint, payload: Record<string, unknown>) => Promise<unknown>

type DraftRpcResult =
  | { ok: true; value?: unknown }
  | { ok: false; error?: { message?: string } }

function draftRevisionKey(payload: Record<string, unknown>): string {
  return `${typeof payload.sessionId === 'string' ? payload.sessionId : ''}\u0000${typeof payload.path === 'string' ? payload.path : ''}`
}

function revisionFromResult(endpoint: DraftEndpoint, result: DraftRpcResult): string | null {
  if (!result.ok || !result.value || typeof result.value !== 'object') return null
  const value = result.value as Record<string, unknown>
  if (endpoint === 'draft.get') {
    const draft = value.draft
    if (!draft || typeof draft !== 'object') return null
    const revision = (draft as Record<string, unknown>).revision
    return typeof revision === 'string' && revision ? revision : null
  }
  if (endpoint === 'draft.put') {
    const revision = value.revision
    return typeof revision === 'string' && revision ? revision : null
  }
  return null
}

/**
 * Preserve per-renderer RPC order so a delayed put cannot land after save's
 * delete. The queue also remembers the latest revision each draft.get/put
 * returned per file; tracked deletes carry that revision (Host rejects
 * mismatches with `{ deleted: false }`), and a file whose revision was never
 * observed is left alone rather than deleted blindly.
 */
export class DraftSyncQueue {
  private tail: Promise<void> = Promise.resolve()
  private readonly revisions = new Map<string, string>()

  constructor(private readonly call: DraftRpcCall) {}

  run(endpoint: DraftEndpoint, payload: Record<string, unknown>): Promise<unknown> {
    const operation = this.tail.then(async () => {
      const result = await this.call(endpoint, payload) as DraftRpcResult
      if (endpoint === 'draft.get' || endpoint === 'draft.put') {
        const key = draftRevisionKey(payload)
        const revision = revisionFromResult(endpoint, result)
        if (revision) this.revisions.set(key, revision)
        else if (endpoint === 'draft.get' && result.ok) this.revisions.delete(key)
      }
      return result
    })
    this.tail = operation.then(() => undefined, () => undefined)
    return operation
  }

  /**
   * Ordered draft.delete that injects the revision recorded by the most
   * recent get/put at execution time. Files never observed through this
   * queue are not deleted (Host owns other windows' backups).
   */
  delete(payload: Record<string, unknown>): Promise<unknown> {
    const operation = this.tail.then(async (): Promise<unknown> => {
      const key = draftRevisionKey(payload)
      const revision = this.revisions.get(key)
      if (!revision) return { ok: true, value: { deleted: false } }
      const result = await this.call('draft.delete', { ...payload, revision }) as DraftRpcResult
      if (result.ok) this.revisions.delete(key)
      return result
    })
    this.tail = operation.then(() => undefined, () => undefined)
    return operation
  }
}
