/** Browser-safe contracts for collaboration-owned project memory. */
export type MemoryEvidence =
  | { kind: 'file'; path: string; version: string; quote: string }
  | { kind: 'user'; messageId: string; quote: string }

export type MemoryUpdate = {
  path: string
  operation: 'create' | 'append' | 'edit'
  summary: string
  expectedVersion: string | null
  category: 'rule' | 'fact'
  certainty: 'explicit' | 'uncertain'
  evidence: MemoryEvidence[]
  text?: string
  oldText?: string
  newText?: string
}

export type MemoryStatus = 'pending' | 'applied' | 'stale' | 'failed' | 'undone'
export type MemoryChangeSummary = {
  id: string
  path: string
  summary: string
  status: MemoryStatus
  createdAt: string
  message?: string
}
export type MemoryChange = MemoryChangeSummary & {
  version: 1
  sessionId: string
  update: MemoryUpdate
  before: string | null
  after: string
  appliedVersion?: string
  undoOf?: string
  archiveOnApply?: boolean
}
export type MemoryUpdateReceipt = MemoryChangeSummary & {
  marker: 'dsh-editor.memory-update'
  version: 1
}

export function parseMemoryUpdateReceipt(text: string): MemoryUpdateReceipt | undefined {
  try {
    const value = JSON.parse(text)
    if (!value || value.marker !== 'dsh-editor.memory-update' || value.version !== 1
      || typeof value.id !== 'string' || typeof value.path !== 'string'
      || typeof value.summary !== 'string' || typeof value.createdAt !== 'string'
      || !['pending', 'applied', 'stale', 'failed', 'undone'].includes(value.status)) return undefined
    return value
  } catch { return undefined }
}
