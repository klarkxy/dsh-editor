import { randomUUID } from 'node:crypto'
import type {
  AiFeatureScope, DreamPlan, InjectedMemoryMessage, KnowledgeScope, MemoryMutationOptions, MemoryPersistedState,
  MemoryQuery, MemoryRecord, MemoryService, MemorySettings, MemoryStatus, NewMemoryRecord, PreStepDecision, PurposeSpec,
} from './contracts.ts'
import { cloneRecord, INJECT_KINDS, MEMORY_DREAM_PURPOSE, projectIdFromCwd, sessionCwd } from './contracts.ts'
import {
  DREAM_SYSTEM, assertBasisCurrent, assertDreamApply, basisFromSnapshot, inheritEvidence, isDreamSource,
  parseDreamText, recordMap, snapshotRecords, stampInheritedExpiry, tombstoneSet, dreamSourceVersion,
} from './dream.ts'
import {
  fail, isAbortError, MemoryError, MEMORY_AI_UNAVAILABLE, MEMORY_CANCELLED, MEMORY_CAPACITY, MEMORY_CONFLICT,
  MEMORY_DELETED, MEMORY_DISABLED, MEMORY_INVALID, MEMORY_NOT_FOUND, MEMORY_SAVE_FAILED, MEMORY_SCOPE, MEMORY_STALE,
  MEMORY_TOMBSTONE,
} from './errors.ts'
import { assertCreatable, assertNoSilentGlobal, hasEvidence } from './evidence.ts'
import { applyMemoryInjection, requestTextFromMessages, stripMemoryInjection } from './inject.ts'
import { boundRecall, injectKinds, isExpired, recordMatchesQuery } from './recall.ts'
import { compactMemoryState, memoryStateOverCapacity } from './capacity.ts'
import { cloneState, type MemoryStore } from './store.ts'
import { memoryStateSchema, newMemoryRecordSchema } from './storage.ts'

export interface MemoryRuntimeOptions {
  store: MemoryStore
  now?: () => number
  id?: () => string
  activateAi?: () => AiFeatureScope | undefined
  createInjectMessage?: (payload: InjectedMemoryMessage) => unknown
}

const dreamPurpose: PurposeSpec = {
  id: MEMORY_DREAM_PURPOSE,
  label: '记忆整理',
  defaultTarget: { kind: 'role', role: 'strong' },
  maxOutputTokens: 1024,
  maxInputChars: 12_000,
  timeoutMs: 60_000,
}

type DreamJob = { abort: AbortController; generation: number; planId: string }

export class MemoryRuntime implements MemoryService {
  private live: MemoryPersistedState
  private generation = 0
  private disposed = false
  private storageFailed = false
  private pending = Promise.resolve()
  private ai?: AiFeatureScope
  private unregisterPurpose?: () => void
  private readonly jobs = new Map<string, DreamJob>()
  private readonly now: () => number
  private readonly customId?: () => string

  constructor(private readonly options: MemoryRuntimeOptions) {
    this.live = cloneState(options.store.load())
    this.now = options.now ?? Date.now
    this.customId = options.id
    this.syncAi()
  }

  get pluginActive(): boolean { return !this.disposed }

  status(sessionId?: string, projectId?: string): MemoryStatus {
    const records = this.live.records
      .filter(record => !this.tombstoned(record.id))
      .filter(record => !sessionId || this.visibleInSession(record, projectId))
      .map(cloneRecord)
    const dreams = this.live.dreams
      .filter(plan => !sessionId || plan.sessionId === sessionId)
      .map(plan => structuredClone(plan))
    return {
      settings: structuredClone(this.live.settings),
      records,
      dreams,
      runningDreams: dreams.filter(plan => this.jobs.has(plan.id)).map(plan => plan.id),
      projectId,
      storageFailed: this.storageFailed,
      aiAvailable: Boolean(this.ai?.active),
    }
  }

  /** Wait for durable state writes, never for model generation. */
  async readStatus(sessionId?: string, projectId?: string): Promise<MemoryStatus> {
    await this.pending
    return this.status(sessionId, projectId)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.generation += 1
    this.abortDreams()
    this.detachAi()
    await this.pending
  }

  async updateSettings(next: Omit<MemorySettings, 'revision'>, expectedRevision: number): Promise<MemorySettings> {
    return this.serialize(async () => {
      this.assertOpen()
      if (expectedRevision !== this.live.settings.revision) fail(MEMORY_CONFLICT, '记忆设置已更新，请刷新后重试。')
      const proposed = this.snapshot()
      proposed.settings = { ...next, revision: expectedRevision + 1 }
      const disableInject = this.live.settings.injectEnabled && !proposed.settings.injectEnabled
      const disableDream = this.live.settings.dreamIdleEnabled && !proposed.settings.dreamIdleEnabled
      await this.persistProposed(proposed)
      this.commit(proposed)
      if (disableInject || disableDream) {
        this.generation += 1
        this.abortDreams()
      }
      this.syncAi()
      return structuredClone(this.live.settings)
    })
  }

  async list(query: MemoryQuery): Promise<MemoryRecord[]> {
    const now = this.now()
    const limit = query.limit ?? 100
    return this.live.records
      .filter(record => !this.tombstoned(record.id))
      .filter(record => recordMatchesQuery(record, query, now))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .slice(0, Math.min(100, Math.max(1, limit)))
      .map(cloneRecord)
  }

  async recall(query: MemoryQuery): Promise<MemoryRecord[]> {
    const listed = await this.list({
      ...query,
      query: undefined,
      kinds: query.kinds && query.kinds.length ? query.kinds : [...INJECT_KINDS],
      statuses: query.statuses ?? ['active'],
      limit: 100,
    })
    return boundRecall(listed, this.now(), { query: query.query, limit: query.limit ?? 5 })
  }

  async create(record: NewMemoryRecord, options?: MemoryMutationOptions): Promise<MemoryRecord> {
    return this.serialize(async () => {
      this.assertMutationCurrent(options)
      this.assertOpen()
      const parsed = newMemoryRecordSchema.safeParse(record)
      if (!parsed.success) fail(MEMORY_INVALID, '记忆条目格式无效。')
      assertCreatable(parsed.data)
      const proposed = this.snapshot()
      const id = this.mintId(proposed)
      const now = this.now()
      const stored: MemoryRecord = { ...parsed.data, id, revision: 1, createdAt: now, updatedAt: now }
      proposed.records.push(stored)
      await this.persistProposed(proposed)
      this.commit(proposed)
      return cloneRecord(stored)
    })
  }

  async update(id: string, patch: Partial<Pick<MemoryRecord, 'title' | 'content' | 'tags' | 'exceptions' | 'status' | 'expiresAt'>>, expectedRevision: number, options?: MemoryMutationOptions): Promise<MemoryRecord> {
    return this.serialize(async () => {
      this.assertMutationCurrent(options)
      return this.updateIn(this.snapshot(), id, patch, expectedRevision, true)
    })
  }

  async remove(id: string, expectedRevision: number, options?: MemoryMutationOptions): Promise<void> {
    return this.serialize(async () => {
      this.assertMutationCurrent(options)
      this.assertOpen()
      const proposed = this.snapshot()
      const current = this.requireIn(proposed, id)
      if (current.revision !== expectedRevision) fail(MEMORY_CONFLICT, '条目已被其他操作修改，请刷新后重试。')
      proposed.tombstones.push({ id, deletedAt: this.now(), lastRevision: current.revision })
      proposed.records = proposed.records.filter(record => record.id !== id)
      this.staleDreamsTouching(proposed, [id])
      await this.persistProposed(proposed)
      this.commit(proposed)
    })
  }

  async accept(id: string, expectedRevision: number): Promise<MemoryRecord> {
    return this.serialize(async () => {
      this.assertOpen()
      const proposed = this.snapshot()
      const current = this.requireIn(proposed, id)
      if (current.revision !== expectedRevision) fail(MEMORY_CONFLICT, '条目已被其他操作修改，请刷新后重试。')
      if (current.status !== 'candidate') fail(MEMORY_INVALID, '只能采纳候选条目。')
      const now = this.now()
      assertBasisCurrent(current, recordMap(proposed), tombstoneSet(proposed), now)
      const sources = (current.basis ?? []).map(ref => proposed.records.find(item => item.id === ref.id)).filter((item): item is MemoryRecord => Boolean(item))
      stampInheritedExpiry(current, sources)
      if (isExpired(current, now)) fail(MEMORY_STALE, '候选已过期，不能采纳。')
      current.status = 'active'
      current.revision += 1
      current.updatedAt = now
      for (const sourceId of current.supersedes ?? []) {
        const source = proposed.records.find(record => record.id === sourceId)
        if (!source || this.tombstonedIn(proposed, sourceId)) continue
        const pin = current.basis?.find(ref => ref.id === sourceId)
        if (current.basis?.length) {
          if (!pin || source.revision !== pin.revision) fail(MEMORY_STALE, '依据记录已修改，须按当前版本重新整理。')
        }
        if (source.status === 'deleted') fail(MEMORY_TOMBSTONE, '依据记录已删除，不能采纳。')
        if (source.status === 'active') {
          source.status = 'superseded'
          source.revision += 1
          source.updatedAt = now
        }
      }
      this.staleDreamsTouching(proposed, [id, ...(current.supersedes ?? [])])
      await this.persistProposed(proposed)
      this.commit(proposed)
      return cloneRecord(this.requireIn(this.live, id))
    })
  }

  async reject(id: string, expectedRevision: number): Promise<MemoryRecord> {
    return this.serialize(async () => {
      const proposed = this.snapshot()
      return this.updateIn(proposed, id, { status: 'rejected' }, expectedRevision, true, record => {
        if (record.status !== 'candidate') fail(MEMORY_INVALID, '只能拒绝候选条目。')
      })
    })
  }

  async revoke(id: string, expectedRevision: number): Promise<MemoryRecord> {
    return this.serialize(async () => {
      const proposed = this.snapshot()
      return this.updateIn(proposed, id, { status: 'revoked' }, expectedRevision, true, record => {
        if (record.status !== 'active') fail(MEMORY_INVALID, '只能撤销已生效条目。')
      })
    })
  }

  async promoteToGlobal(id: string, expectedRevision: number, options?: MemoryMutationOptions): Promise<MemoryRecord> {
    return this.serialize(async () => {
      this.assertMutationCurrent(options)
      this.assertOpen()
      const proposed = this.snapshot()
      const current = this.requireIn(proposed, id)
      if (current.revision !== expectedRevision) fail(MEMORY_CONFLICT, '条目已被其他操作修改，请刷新后重试。')
      if (current.status !== 'candidate' && current.status !== 'active') {
        fail(MEMORY_INVALID, '只能把未过期的候选或已生效条目提升为全局。')
      }
      const now = this.now()
      if (isExpired(current, now)) fail(MEMORY_STALE, '条目已过期，不能提升为全局。')
      current.scope = { kind: 'global' }
      current.status = 'active'
      current.revision += 1
      current.updatedAt = now
      this.staleDreamsTouching(proposed, [id])
      await this.persistProposed(proposed)
      this.commit(proposed)
      return cloneRecord(this.requireIn(this.live, id))
    })
  }

  async handlePreStep(input: {
    sessionId: string
    session?: unknown
    signal: AbortSignal
    next: () => Promise<PreStepDecision>
  }): Promise<PreStepDecision> {
    const generation = this.generation
    const decision = await input.next()
    if (!this.canInject(generation, input.signal)) return stripMemoryInjection(decision)
    if (decision.kind !== 'enter') return decision
    const requestText = requestTextFromMessages(decision.messages)
    if (!requestText) return stripMemoryInjection(decision)
    const projectId = projectIdFromCwd(sessionCwd(input.session))
    const scope: KnowledgeScope = projectId ? { kind: 'project', projectId } : { kind: 'global' }
    const records = await this.recall({
      scope,
      query: requestText,
      kinds: injectKinds(undefined),
      limit: 5,
    })
    if (!this.canInject(generation, input.signal)) return stripMemoryInjection(decision)
    const create = this.options.createInjectMessage ?? (payload => payload)
    return applyMemoryInjection(decision, records, create)
  }

  async previewDream(sessionId: string, projectId: string | undefined, trigger: 'manual' | 'idle' = 'manual'): Promise<DreamPlan> {
    this.requireAi()
    const prepared = await this.serialize(async () => {
      this.assertOpen()
      if (trigger === 'idle' && !this.live.settings.dreamIdleEnabled) fail(MEMORY_DISABLED, '闲时整理未开启。')
      const generation = this.generation
      const now = this.now()
      const scope: KnowledgeScope = projectId ? { kind: 'project', projectId } : { kind: 'global' }
      const records = (await this.list({ scope, statuses: ['active', 'candidate'], limit: 64 }))
        .filter(record => isDreamSource(record, now))
      const snapshot = snapshotRecords(records)
      const proposed = this.snapshot()
      const plan = {
        id: this.mintId(proposed),
        revision: 1,
        sessionId,
        projectId,
        status: 'preview' as const,
        sourceVersion: dreamSourceVersion(snapshot),
        snapshot,
        proposals: [],
        generation,
        createdAt: now,
        updatedAt: now,
      }
      proposed.dreams.push(plan)
      await this.persistProposed(proposed)
      this.commit(proposed)
      const abort = new AbortController()
      this.jobs.set(plan.id, { abort, generation, planId: plan.id })
      return { plan, records, snapshot, scope, generation, abort }
    })
    const ai = this.requireAi()
    try {
      const result = await ai.run({
        purpose: MEMORY_DREAM_PURPOSE,
        sessionId,
        sourceVersion: prepared.plan.sourceVersion,
        system: DREAM_SYSTEM,
        input: JSON.stringify({
          scope: prepared.scope,
          records: prepared.records.map(record => ({
            id: record.id, kind: record.kind, title: record.title, content: record.content,
            scope: record.scope, exceptions: record.exceptions, evidence: record.evidence,
            status: record.status, revision: record.revision, expiresAt: record.expiresAt ?? null,
          })),
        }),
        priority: trigger === 'idle' ? 'background' : 'interactive',
        signal: prepared.abort.signal,
        isCurrent: () => this.isDreamCurrent(prepared.plan.id, prepared.generation),
      })
      return this.serialize(async () => {
        if (!this.isDreamCurrent(prepared.plan.id, prepared.generation)) {
          return this.markDream(prepared.plan.id, { status: 'stale', error: '已取消或设置已关闭。' })
        }
        if (result.receipt.status !== 'success') {
          const status = result.receipt.status === 'cancelled' ? 'cancelled' : 'failed'
          return this.markDream(prepared.plan.id, { status, error: result.receipt.error ?? '整理未完成。' })
        }
        const proposals = parseDreamText(result.text, prepared.snapshot, prepared.scope).map(proposal => ({
          ...proposal,
          evidence: inheritEvidence(prepared.records, proposal.sourceIds),
        }))
        return this.markDream(prepared.plan.id, { proposals, status: 'preview' })
      })
    } catch (error) {
      return this.serialize(async () => {
        if (isAbortError(error) || !this.isDreamCurrent(prepared.plan.id, prepared.generation)) {
          return this.markDream(prepared.plan.id, { status: 'cancelled', error: '已取消。' })
        }
        return this.markDream(prepared.plan.id, { status: 'failed', error: '整理失败。' })
      })
    } finally {
      this.jobs.delete(prepared.plan.id)
    }
  }

  async applyDream(planId: string, expectedRevision: number): Promise<DreamPlan> {
    return this.serialize(async () => {
      this.assertOpen()
      if (this.jobs.has(planId)) fail(MEMORY_INVALID, '整理尚未完成，请稍候。')
      const proposed = this.snapshot()
      const plan = this.requireDreamIn(proposed, planId)
      if (plan.revision !== expectedRevision) fail(MEMORY_CONFLICT, '梦境预览已更新，请刷新后重试。')
      const now = this.now()
      try {
        assertDreamApply(plan, recordMap(proposed), tombstoneSet(proposed), now)
      } catch (error) {
        plan.status = 'stale'
        plan.revision += 1
        plan.updatedAt = this.now()
        plan.error = error instanceof Error ? error.message : '预览已过期。'
        await this.persistProposed(proposed)
        this.commit(proposed)
        throw error instanceof Error ? error : fail(MEMORY_STALE, '预览已过期。')
      }
      for (const proposal of plan.proposals) {
        const id = this.mintId(proposed)
        const sources = proposal.sourceIds
          .map(sourceId => proposed.records.find(item => item.id === sourceId))
          .filter((item): item is MemoryRecord => Boolean(item))
        const record: MemoryRecord = {
          id,
          revision: 1,
          scope: proposal.scope,
          kind: proposal.kind,
          status: 'candidate',
          title: proposal.title,
          content: proposal.content,
          tags: proposal.tags,
          evidence: hasEvidence(proposal.evidence) ? proposal.evidence : [{ sessionId: plan.sessionId, seq: 0, kind: 'manual', excerpt: 'dream' }],
          exceptions: proposal.exceptions,
          source: 'dream',
          createdAt: now,
          updatedAt: now,
          supersedes: proposal.sourceIds,
          basis: basisFromSnapshot(plan.snapshot, proposal.sourceIds),
        }
        stampInheritedExpiry(record, sources)
        if (isExpired(record, now)) fail(MEMORY_STALE, '依据记录已过期，梦境预览作废。')
        assertCreatable(record)
        proposed.records.push(record)
      }
      plan.status = 'applied'
      plan.revision += 1
      plan.updatedAt = now
      await this.persistProposed(proposed)
      this.commit(proposed)
      return structuredClone(this.requireDreamIn(this.live, planId))
    })
  }

  async cancelDream(planId: string, expectedRevision: number): Promise<DreamPlan> {
    return this.serialize(async () => {
      const plan = this.live.dreams.find(item => item.id === planId)
      if (!plan) fail(MEMORY_NOT_FOUND, '找不到该梦境预览。')
      if (plan.revision !== expectedRevision) fail(MEMORY_CONFLICT, '梦境预览已更新，请刷新后重试。')
      this.jobs.get(planId)?.abort.abort()
      this.jobs.delete(planId)
      return this.markDream(planId, { status: 'cancelled' })
    })
  }

  createManualRecord(input: {
    sessionId: string
    projectId?: string
    explicitGlobal: boolean
    title: string
    content: string
    kind: NewMemoryRecord['kind']
    tags?: string[]
    exceptions?: string[]
    evidence?: NewMemoryRecord['evidence']
    expiresAt?: number
  }): Promise<MemoryRecord> {
    assertNoSilentGlobal(input.explicitGlobal, input.projectId)
    const scope: KnowledgeScope = input.explicitGlobal ? { kind: 'global' } : { kind: 'project', projectId: input.projectId! }
    return this.create({
      scope,
      kind: input.kind,
      status: 'active',
      title: input.title,
      content: input.content,
      tags: input.tags ?? [],
      exceptions: input.exceptions ?? [],
      evidence: input.evidence ?? [],
      source: 'user',
      expiresAt: input.expiresAt,
    })
  }

  abortDreams(): void {
    for (const job of this.jobs.values()) job.abort.abort()
    this.jobs.clear()
  }

  hasActiveDream(sessionId?: string): boolean {
    for (const job of this.jobs.values()) {
      const plan = this.live.dreams.find(item => item.id === job.planId)
      if (!plan) continue
      if (!sessionId || plan.sessionId === sessionId) return true
    }
    return false
  }

  private async updateIn(
    proposed: MemoryPersistedState,
    id: string,
    patch: Partial<Pick<MemoryRecord, 'title' | 'content' | 'tags' | 'exceptions' | 'status' | 'expiresAt'>>,
    expectedRevision: number,
    persist: boolean,
    guard?: (record: MemoryRecord) => void,
  ): Promise<MemoryRecord> {
    this.assertOpen()
    const current = this.requireIn(proposed, id)
    if (current.revision !== expectedRevision) fail(MEMORY_CONFLICT, '条目已被其他操作修改，请刷新后重试。')
    if (current.status === 'deleted') fail(MEMORY_DELETED, '条目已删除，不能恢复。')
    guard?.(current)
    Object.assign(current, patch, {
      id: current.id,
      revision: current.revision + 1,
      scope: current.scope,
      kind: current.kind,
      source: current.source,
      createdAt: current.createdAt,
      updatedAt: this.now(),
    })
    this.staleDreamsTouching(proposed, [id])
    if (persist) {
      await this.persistProposed(proposed)
      this.commit(proposed)
      return cloneRecord(this.requireIn(this.live, id))
    }
    return cloneRecord(current)
  }

  private mintId(proposed: MemoryPersistedState): string {
    if (this.customId) {
      const id = this.customId()
      if (this.idTaken(proposed, id)) {
        if (this.tombstonedIn(proposed, id)) fail(MEMORY_TOMBSTONE, '该标识已删除，不能恢复。')
        fail(MEMORY_CONFLICT, '记忆编号冲突。')
      }
      return id
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = randomUUID()
      if (!this.idTaken(proposed, id)) return id
    }
    fail(MEMORY_CONFLICT, '记忆编号冲突。')
  }

  private idTaken(state: MemoryPersistedState, id: string): boolean {
    return this.tombstonedIn(state, id)
      || state.records.some(record => record.id === id)
      || state.dreams.some(plan => plan.id === id)
  }

  private tombstoned(id: string): boolean {
    return this.tombstonedIn(this.live, id)
  }

  private tombstonedIn(state: MemoryPersistedState, id: string): boolean {
    return state.tombstones.some(row => row.id === id)
  }

  private requireIn(state: MemoryPersistedState, id: string): MemoryRecord {
    if (this.tombstonedIn(state, id)) fail(MEMORY_TOMBSTONE, '条目已删除，不能恢复。')
    const record = state.records.find(item => item.id === id)
    if (!record) fail(MEMORY_NOT_FOUND, '找不到该记忆条目。')
    return record
  }

  private requireDreamIn(state: MemoryPersistedState, id: string): DreamPlan {
    const plan = state.dreams.find(item => item.id === id)
    if (!plan) fail(MEMORY_NOT_FOUND, '找不到该梦境预览。')
    return plan
  }

  private async markDream(
    id: string,
    patch: Partial<Pick<DreamPlan, 'status' | 'proposals' | 'error'>>,
  ): Promise<DreamPlan> {
    const proposed = this.snapshot()
    const plan = this.requireDreamIn(proposed, id)
    Object.assign(plan, patch, { revision: plan.revision + 1, updatedAt: this.now() })
    await this.persistProposed(proposed)
    this.commit(proposed)
    return structuredClone(this.requireDreamIn(this.live, id))
  }

  private staleDreamsTouching(state: MemoryPersistedState, ids: readonly string[]): void {
    const set = new Set(ids)
    const now = this.now()
    for (const plan of state.dreams) {
      if (plan.status !== 'preview') continue
      if (plan.snapshot.some(entry => set.has(entry.id))) {
        plan.status = 'stale'
        plan.revision += 1
        plan.updatedAt = now
        plan.error = '相关记录已删除或修正。'
      }
    }
  }

  private visibleInSession(record: MemoryRecord, projectId: string | undefined): boolean {
    if (record.scope.kind === 'global') return true
    return Boolean(projectId) && record.scope.kind === 'project' && record.scope.projectId === projectId
  }

  private canInject(generation: number, signal: AbortSignal): boolean {
    return !this.disposed && this.live.settings.injectEnabled && this.generation === generation && !signal.aborted
  }

  private isDreamCurrent(planId: string, generation: number): boolean {
    if (this.disposed || this.generation !== generation) return false
    const plan = this.live.dreams.find(item => item.id === planId)
    return Boolean(plan && plan.status === 'preview' && this.ai?.active)
  }

  private requireAi(): AiFeatureScope {
    this.syncAi()
    if (!this.ai?.active) fail(MEMORY_AI_UNAVAILABLE, '需要先加载 @klarkxy/dsh-ai-services，记忆插件不会自动启用它。')
    return this.ai
  }

  private syncAi(): void {
    if (this.disposed) { this.detachAi(); return }
    if (this.ai?.active) return
    const ai = this.options.activateAi?.()
    this.ai = ai
    if (ai) {
      try { this.unregisterPurpose = ai.registerPurpose(dreamPurpose) }
      catch { this.unregisterPurpose = undefined }
    }
  }

  private detachAi(): void {
    this.unregisterPurpose?.()
    this.unregisterPurpose = undefined
    this.ai?.dispose()
    this.ai = undefined
  }

  private assertOpen(): void {
    if (this.disposed) fail(MEMORY_DISABLED, '记忆插件已停止。')
  }

  private snapshot(): MemoryPersistedState {
    return cloneState(this.live)
  }

  private commit(proposed: MemoryPersistedState): void {
    this.live = cloneState(proposed)
  }

  private assertMutationCurrent(options?: MemoryMutationOptions): void {
    if (!options) return
    if (options.signal?.aborted) fail(MEMORY_CANCELLED, '请求已取消')
    if (!options.isCurrent) return
    let current = false
    try {
      current = options.isCurrent()
    } catch {
      fail(MEMORY_CANCELLED, '请求已取消')
    }
    if (!current) fail(MEMORY_CANCELLED, '请求已取消')
  }

  private async persistProposed(proposed: MemoryPersistedState): Promise<void> {
    compactMemoryState(proposed, new Set(this.jobs.keys()))
    const parsed = memoryStateSchema.safeParse(proposed)
    if (!parsed.success) {
      if (memoryStateOverCapacity(proposed)) fail(MEMORY_CAPACITY, '记忆容量已满，已保留原内容。')
      fail(MEMORY_INVALID, '记忆状态格式无效。')
    }
    try {
      await this.options.store.save(cloneState(proposed))
      this.storageFailed = false
    } catch (error) {
      if (error instanceof MemoryError && (error.code === MEMORY_CANCELLED || error.code === MEMORY_CAPACITY)) throw error
      this.storageFailed = true
      if (error instanceof Error && 'code' in error) throw error
      fail(MEMORY_SAVE_FAILED, '记忆保存失败，已保留原内容。')
    }
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const task = this.pending.then(run, run)
    this.pending = task.then(() => {}, () => {})
    return task
  }
}

export { MEMORY_SCOPE }
