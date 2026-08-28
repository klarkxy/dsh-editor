export type EditorDraft = {
  path: string
  text: string
  baseText: string
  baseVersion: string
}

export type DraftEndpoint = 'draft.put' | 'draft.delete'
export type DraftRpcCall = (endpoint: DraftEndpoint, payload: Record<string, unknown>) => Promise<unknown>

/** Preserve per-renderer RPC order so a delayed put cannot land after save's delete. */
export class DraftSyncQueue {
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly call: DraftRpcCall) {}

  run(endpoint: DraftEndpoint, payload: Record<string, unknown>): Promise<unknown> {
    const operation = this.tail.then(() => this.call(endpoint, payload))
    this.tail = operation.then(() => undefined, () => undefined)
    return operation
  }
}
