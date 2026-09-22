import type { MemoryMutationOptions, MemoryQuery, MemoryRecord, MemoryService, NewMemoryRecord, SessionWatermark, SkillRecord } from './contracts.ts'
import type { KvTableLike } from './engine.ts'
import type { SessionEventLike } from './detect.ts'
import type { SessionLike } from './engine.ts'

function mutationRejected(message: string, code: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.name = 'MemoryError'
  error.code = code
  return error
}

export class MemoryFake implements MemoryService {
  records = new Map<string, MemoryRecord>()
  private seq = 1
  private chain = Promise.resolve()
  looseRecall = false
  creates = 0
  updates = 0
  promotes = 0
  beforeRead?: () => void | Promise<void>
  beforeCreate?: () => void | Promise<void>
  beforeUpdate?: () => void | Promise<void>
  beforePromote?: () => void | Promise<void>

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const task = this.chain.then(run, run)
    this.chain = task.then(() => {}, () => {})
    return task
  }

  private assertMutation(options?: MemoryMutationOptions): void {
    if (!options) return
    if (options.signal?.aborted) throw mutationRejected('请求已取消', 'MEMORY_CANCELLED')
    if (!options.isCurrent) return
    let current = false
    try {
      current = options.isCurrent()
    } catch {
      throw mutationRejected('请求已取消', 'MEMORY_CANCELLED')
    }
    if (!current) throw mutationRejected('请求已取消', 'MEMORY_CANCELLED')
  }

  async list(query: MemoryQuery): Promise<MemoryRecord[]> {
    await this.beforeRead?.()
    return [...this.records.values()].filter(record => matches(record, query))
  }
  async recall(query: MemoryQuery): Promise<MemoryRecord[]> {
    await this.beforeRead?.()
    if (this.looseRecall) return [...this.records.values()].filter(record => record.kind === 'lesson')
    return this.list({ ...query, statuses: query.statuses ?? ['active'] })
  }
  async create(record: NewMemoryRecord, options?: MemoryMutationOptions): Promise<MemoryRecord> {
    return this.serialize(async () => {
      this.assertMutation(options)
      this.creates += 1
      await this.beforeCreate?.()
      const now = 1_000 + this.seq
      const stored: MemoryRecord = { ...record, id: `m${this.seq++}`, revision: 1, createdAt: now, updatedAt: now }
      this.records.set(stored.id, stored)
      return stored
    })
  }
  async update(
    id: string,
    patch: Partial<Pick<MemoryRecord, 'title' | 'content' | 'tags' | 'exceptions' | 'status' | 'expiresAt'>>,
    expectedRevision: number,
    options?: MemoryMutationOptions,
  ): Promise<MemoryRecord> {
    return this.serialize(async () => {
      this.assertMutation(options)
      this.updates += 1
      await this.beforeUpdate?.()
      const current = this.records.get(id)
      if (!current) throw new Error('missing')
      if (current.revision !== expectedRevision) throw new Error('stale')
      const next = { ...current, ...patch, revision: current.revision + 1, updatedAt: current.updatedAt + 1 }
      this.records.set(id, next)
      return next
    })
  }
  async promoteToGlobal(id: string, expectedRevision: number, options?: MemoryMutationOptions): Promise<MemoryRecord> {
    return this.serialize(async () => {
      this.assertMutation(options)
      this.promotes += 1
      await this.beforePromote?.()
      const current = this.records.get(id)
      if (!current) throw new Error('missing')
      if (current.revision !== expectedRevision) throw new Error('stale')
      const next: MemoryRecord = {
        ...current,
        scope: { kind: 'global' },
        status: 'active',
        revision: current.revision + 1,
        updatedAt: current.updatedAt + 1,
      }
      this.records.set(id, next)
      return next
    })
  }
  async remove(id: string, expectedRevision: number, options?: MemoryMutationOptions): Promise<void> {
    return this.serialize(async () => {
      this.assertMutation(options)
      const current = this.records.get(id)
      if (!current || current.revision !== expectedRevision) throw new Error('stale')
      this.records.delete(id)
    })
  }
}

function matches(record: MemoryRecord, query: MemoryQuery): boolean {
  if (record.scope.kind !== query.scope.kind) return false
  if (query.scope.kind === 'project' && (record.scope.kind !== 'project' || record.scope.projectId !== query.scope.projectId)) return false
  if (query.kinds && !query.kinds.includes(record.kind)) return false
  if (query.statuses && !query.statuses.includes(record.status)) return false
  if (query.query) {
    const needle = query.query.trim().toLowerCase()
    if (needle) {
      const hay = `${record.title}\n${record.content}\n${record.tags.join('\n')}`.toLowerCase()
      if (!hay.includes(needle)) return false
    }
  }
  return true
}

export class TableFake<V> implements KvTableLike<V> {
  private rows = new Map<string, V>()
  puts = 0
  beforePut?: () => void | Promise<void>
  get(key: string): V | undefined { return this.rows.get(key) }
  entries(): IterableIterator<[string, V]> { return this.rows.entries() }
  async put(key: string, value: V): Promise<void> {
    this.puts += 1
    await this.beforePut?.()
    this.rows.set(key, structuredClone(value))
  }
}

export function event(type: string, seq: number, data: unknown): SessionEventLike {
  return { type, seq, data }
}
export function userMessage(seq: number, text: string): SessionEventLike {
  return event('user/message', seq, { id: `u${seq}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
}
export function pluginMessage(seq: number, text: string): SessionEventLike {
  return event('user/message', seq, { id: `p${seq}`, role: 'user', source: { kind: 'plugin', plugin: 'other' }, content: [{ type: 'text', text }] })
}
export function assistantMessage(seq: number, text: string): SessionEventLike {
  return event('assistant/message', seq, { turn: 1, step: 1, message: { content: [{ type: 'text', text }] } })
}
export function toolCall(seq: number, name: string, callId: string): SessionEventLike {
  return event('tool/call', seq, { turn: 1, step: 1, callId, name, arguments: '{}' })
}
export function toolResult(seq: number, callId: string, isError: boolean, text: string): SessionEventLike {
  return event('tool/result', seq, {
    turn: 1, step: 1,
    message: { role: 'user', source: { kind: 'tool', callId }, content: [{ type: 'tool-result', toolCallId: callId, isError, content: [{ type: 'text', text }] }] },
    error: isError ? { name: 'ToolError', code: 'failed' } : undefined,
  })
}

export function session(id: string, cwd: string, events: SessionEventLike[]): SessionLike {
  return { id, header: { cwd }, snapshotEvents: () => events }
}

export function lesson(partial: Partial<MemoryRecord> & Pick<MemoryRecord, 'id' | 'title' | 'content' | 'status' | 'scope'>): MemoryRecord {
  return {
    revision: 1, kind: 'lesson', tags: [], evidence: [], exceptions: [], source: 'self-improvement',
    createdAt: 1, updatedAt: 1, ...partial,
  }
}

export function tables(): { skills: TableFake<SkillRecord>; watermarks: TableFake<SessionWatermark> } {
  return { skills: new TableFake<SkillRecord>(), watermarks: new TableFake<SessionWatermark>() }
}
