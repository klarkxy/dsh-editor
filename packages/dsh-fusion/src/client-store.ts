import { FUSION_RPC_CHANNEL, type FusionStatus, type RpcResult } from './contracts.ts'
import { currentTask, needsRefresh } from './client-projection.ts'

export interface FusionRpc { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }
export interface FusionEventSource { subscribe(listener: () => void): () => void }
export interface FusionClientSources {
  sessions: { binding?(sessionId: string): { eventSource: FusionEventSource } | undefined }
  connection: { rpc: FusionRpc; generation?: FusionEventSource }
}
export interface FusionSnapshot { status?: FusionStatus; error?: string }
const EMPTY: FusionSnapshot = Object.freeze({})
type Entry = {
  snapshot: FusionSnapshot; listeners: Set<() => void>; epoch: number; inFlight?: Promise<void>
  timer?: ReturnType<typeof setTimeout>; dispose?: () => void
}

/** One read-only status projection per viewed Session; no task or native state is copied back to DSH. */
export class FusionClientStore {
  private entries = new Map<string, Entry>()
  private announcedApplied = new Set<string>()
  private readonly client: FusionClientSources
  constructor(client: FusionClientSources) { this.client = client }

  snapshot(sessionId: string): FusionSnapshot { return this.entries.get(sessionId)?.snapshot ?? EMPTY }

  subscribe(sessionId: string, listener: () => void): () => void {
    let entry = this.entries.get(sessionId)
    if (!entry) {
      entry = { snapshot: EMPTY, listeners: new Set(), epoch: 0 }
      this.entries.set(sessionId, entry)
      const queue = () => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') void this.refresh(sessionId)
      }
      const stopEvents = this.client.sessions.binding?.(sessionId)?.eventSource.subscribe(queue)
      const stopConnection = this.client.connection.generation?.subscribe(queue)
      if (typeof window !== 'undefined') window.addEventListener('focus', queue)
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', queue)
      entry.dispose = () => {
        stopEvents?.(); stopConnection?.()
        if (typeof window !== 'undefined') window.removeEventListener('focus', queue)
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', queue)
      }
      void this.refresh(sessionId)
    }
    entry.listeners.add(listener)
    return () => {
      entry!.listeners.delete(listener)
      if (entry!.listeners.size) return
      entry!.epoch++
      clearTimeout(entry!.timer)
      entry!.dispose?.()
      this.entries.delete(sessionId)
    }
  }

  /** Supersede older reads before a user mutation so a late status cannot erase its result. */
  invalidate(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    entry.epoch++
    entry.inFlight = undefined
    clearTimeout(entry.timer)
  }

  async refresh(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    if (entry.inFlight) return entry.inFlight
    const epoch = ++entry.epoch
    const work = (async () => {
      try {
        const result = await this.client.connection.rpc.call(FUSION_RPC_CHANNEL, 'status', { sessionId }) as RpcResult<FusionStatus>
        if (this.entries.get(sessionId) !== entry || entry.epoch !== epoch) return
        if (!result.ok) throw new Error(result.error.message)
        entry.snapshot = { status: result.value }
      } catch (error) {
        if (this.entries.get(sessionId) !== entry || entry.epoch !== epoch) return
        entry.snapshot = { ...entry.snapshot, error: error instanceof Error ? error.message : String(error) }
      } finally {
        if (this.entries.get(sessionId) !== entry || entry.epoch !== epoch) return
        entry.inFlight = undefined
        for (const listener of entry.listeners) listener()
        this.schedule(sessionId, entry)
      }
    })()
    entry.inFlight = work
    return work
  }

  private schedule(sessionId: string, entry: Entry): void {
    clearTimeout(entry.timer)
    if (!needsRefresh(currentTask(entry.snapshot.status?.pair))) return
    // Keep a visible, active task fresh for its entire lifetime, including work past five minutes.
    entry.timer = setTimeout(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void this.refresh(sessionId)
    }, 2500)
  }

  /** A Host-confirmed application refreshes one Editor view once per UI lifetime. */
  announceApplied(sessionId: string, receiptId: string, path: string, notify: (path: string) => void): boolean {
    const key = `${sessionId}\u0000${receiptId}`
    if (this.announcedApplied.has(key)) return false
    this.announcedApplied.add(key)
    try { notify(path) }
    catch (error) { this.announcedApplied.delete(key); throw error }
    return true
  }

  dispose(): void {
    this.announcedApplied.clear()
    for (const [sessionId, entry] of this.entries) {
      entry.epoch++
      clearTimeout(entry.timer)
      entry.dispose?.()
      this.entries.delete(sessionId)
    }
  }
}
