import {
  EXTRACT_PURPOSE, MEMORY_UNAVAILABLE_MESSAGE, SELF_IMPROVEMENT_ACTIVATE_ID,
  fail, projectIdFromCwd, sessionCwd, type AiFeatureScope, type AiServices, type LessonTrigger,
  type MemoryMutationOptions, type MemoryRecord, type MemoryService, type PreStepDecision, type ReviewSnapshot,
  type RpcResult, type SkillRecord, type SessionWatermark,
} from './contracts.ts'
import { detectLessonTriggers, lastHumanRequestText, requestTextFromMessages, type SessionEventLike } from './detect.ts'
import { candidateRecord, draftFromTrigger, EXTRACT_SYSTEM, hasSameEvidence, parseExtraction } from './extract.ts'
import { injectLessonMessages } from './inject.ts'
import { collectLessonRecords, isExpired, selectActiveLessons } from './recall.ts'
import {
  renderSkillMarkdown, skillDownloadName, skillSourcesFromLessons, skillTitleFromLessons, sourcesMatchLive,
} from './skills.ts'

export interface KvTableLike<V> {
  get(key: string): V | undefined
  entries(): IterableIterator<[string, V]>
  put(key: string, value: V): Promise<void>
}

export interface SessionLike {
  id?: unknown
  header?: { cwd?: string }
  meta?: { cwd?: string }
  snapshotEvents(): readonly SessionEventLike[]
}

export interface EngineOptions {
  memory: () => MemoryService | undefined
  ai: () => Pick<AiServices, 'activate'> | undefined
  sessionOf: (sessionId: string) => SessionLike | undefined
  skills: KvTableLike<SkillRecord>
  watermarks: KvTableLike<SessionWatermark>
  now?: () => number
}

const STALE_MESSAGE = '结果已过期，未写入。'
const WRONG_SCOPE_MESSAGE = '教训不属于当前项目，未接受。'
const STALE_SKILL_MESSAGE = '来源教训已变更或失效，不能使用这份草稿。'

function asObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
}
function str(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === 'string' ? body[key] : ''
}
function int(body: Record<string, unknown>, key: string): number | undefined {
  return typeof body[key] === 'number' && Number.isInteger(body[key]) ? body[key] : undefined
}
function sessionIdOf(session: SessionLike): string {
  return String(session.id ?? '')
}

export class SelfImprovementEngine {
  private generation = 1
  private active = true
  private lifetime = new AbortController()
  private storageFailed = false
  private chain = Promise.resolve()
  private readonly extractJobs = new Map<string, number>()
  private aiScope: AiFeatureScope | undefined
  private seenProjects = new Set<string>()
  private readonly now: () => number

  constructor(private readonly options: EngineOptions) {
    this.now = options.now ?? Date.now
  }

  getGeneration(): number { return this.generation }
  isActive(): boolean { return this.active }

  dispose(): void {
    this.active = false
    this.generation += 1
    this.lifetime.abort()
    this.aiScope?.dispose()
    this.aiScope = undefined
  }

  private memoryOrError(): MemoryService | RpcResult<never> {
    const memory = this.options.memory()
    if (!memory) return fail('MEMORY_UNAVAILABLE', MEMORY_UNAVAILABLE_MESSAGE)
    return memory
  }
  private asMemory(value: MemoryService | RpcResult<never>): value is MemoryService {
    return typeof (value as MemoryService).list === 'function'
  }

  private requireActive(): RpcResult<never> | undefined {
    if (this.active) return undefined
    return fail('DISABLED', '自我改进已关闭，摘录和教训注入已停止。')
  }

  private async persist<T>(work: () => Promise<T>): Promise<T> {
    try {
      const value = await work()
      this.storageFailed = false
      return value
    } catch (error) {
      this.storageFailed = true
      throw error
    }
  }

  private currentSignal(signal?: AbortSignal): AbortSignal {
    return signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal
  }

  private rememberProject(projectId: string): void {
    this.seenProjects.add(projectId)
  }

  private knownProjectIds(extra?: string): string[] {
    const ids = new Set(this.seenProjects)
    if (extra) ids.add(extra)
    for (const [, row] of this.options.watermarks.entries()) {
      if (row.projectId) ids.add(row.projectId)
    }
    return [...ids]
  }

  private sameMemory(expected: MemoryService): boolean {
    return this.options.memory() === expected
  }

  private beginWork(): { generation: number; memory: MemoryService } | RpcResult<never> {
    const disabled = this.requireActive()
    if (disabled) return disabled
    const memory = this.memoryOrError()
    if (!this.asMemory(memory)) return memory
    return { generation: this.generation, memory }
  }

  private isWork(value: { generation: number; memory: MemoryService } | RpcResult<never>): value is { generation: number; memory: MemoryService } {
    return 'memory' in value
  }

  /** Linearize disable/replace against captured generation + Memory. Never start a new write after this fails. */
  private revalidate(generation: number, memory: MemoryService): RpcResult<never> | undefined {
    if (this.active && this.generation === generation && this.sameMemory(memory)) return undefined
    if (!this.active) return this.requireActive()
    if (!this.sameMemory(memory)) return fail('MEMORY_UNAVAILABLE', MEMORY_UNAVAILABLE_MESSAGE)
    return fail('SUPERSEDED', STALE_MESSAGE)
  }

  private failed<T>(value: T | RpcResult<never>): value is RpcResult<never> {
    return typeof value === 'object' && value !== null && 'ok' in value && (value as { ok: unknown }).ok === false
  }

  private mutationGuards(generation: number, memory: MemoryService): MemoryMutationOptions {
    return {
      signal: this.lifetime.signal,
      isCurrent: () => !this.revalidate(generation, memory),
    }
  }

  private isGuardRejection(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const name = 'name' in error ? String(error.name) : ''
    const code = 'code' in error ? String((error as { code?: unknown }).code) : ''
    return name === 'AbortError' || name === 'TimeoutError'
      || code === 'ABORT_ERR' || code === 'ABORTED' || code === 'MEMORY_CANCELLED' || code === 'MEMORY_DISABLED' || code === 'CANCELLED'
  }

  /** Invoke a Memory/Skill write only while still current. Queued Memory work receives captured generation/identity + lifetime abort. An already-started write is not rolled back; the RPC still fails if we are no longer current after it. */
  private async mutateWhileCurrent<T>(
    generation: number,
    memory: MemoryService,
    run: (guards: MemoryMutationOptions) => Promise<T>,
  ): Promise<T | RpcResult<never>> {
    const before = this.revalidate(generation, memory)
    if (before) return before
    try {
      const value = await run(this.mutationGuards(generation, memory))
      const after = this.revalidate(generation, memory)
      if (after) return after
      return value
    } catch (error) {
      return this.rejectionOrThrow(error, generation, memory)
    }
  }

  private rejectionOrThrow(error: unknown, generation: number, memory: MemoryService): RpcResult<never> {
    const stale = this.revalidate(generation, memory)
    if (stale) return stale
    if (this.isGuardRejection(error) || this.lifetime.signal.aborted) return fail('CANCELLED', '操作已取消。')
    throw error
  }

  async listAllLessons(projectId?: string, expectedMemory?: MemoryService): Promise<MemoryRecord[]> {
    const memory = expectedMemory ?? this.options.memory()
    if (!memory) return []
    const scopes = [{ kind: 'global' as const }, ...this.knownProjectIds(projectId).map(id => ({ kind: 'project' as const, projectId: id }))]
    const rows = await Promise.all(scopes.map(scope => memory.list({ scope, kinds: ['lesson'] })))
    if (!this.sameMemory(memory)) return []
    const byId = new Map<string, MemoryRecord>()
    for (const record of rows.flat()) {
      if (record.kind === 'lesson') byId.set(record.id, record)
    }
    return [...byId.values()]
  }

  currentRequestText(session: SessionLike, decision?: PreStepDecision): string {
    if (decision?.kind === 'enter') {
      const fromDecision = requestTextFromMessages(decision.messages)
      if (fromDecision) return fromDecision
    }
    return lastHumanRequestText(session.snapshotEvents())
  }

  async recordsForInjection(projectId: string | undefined, requestText: string, expectedMemory?: MemoryService): Promise<MemoryRecord[]> {
    const generation = this.generation
    const memory = expectedMemory ?? this.options.memory()
    if (!memory || !this.active) return []
    const listed = await collectLessonRecords(scope => memory.list({ scope, kinds: ['lesson'] }), projectId)
    if (!this.active || this.generation !== generation || !this.sameMemory(memory)) return []
    return selectActiveLessons(listed, projectId, { now: this.now(), requestText })
  }

  async applyPreStep(session: SessionLike, decision: PreStepDecision, signal: AbortSignal): Promise<PreStepDecision> {
    signal.throwIfAborted()
    if (!this.active || decision.kind !== 'enter') return decision
    const generation = this.generation
    const memory = this.options.memory()
    if (!memory) return injectLessonMessages(decision, [])
    const projectId = projectIdFromCwd(sessionCwd(session))
    const requestText = this.currentRequestText(session, decision)
    const lessons = await this.recordsForInjection(projectId, requestText, memory)
    if (!this.active || this.generation !== generation || !this.sameMemory(memory)) return injectLessonMessages(decision, [])
    return injectLessonMessages(decision, lessons)
  }

  private async writeWatermark(sessionId: string, seq: number, projectId?: string): Promise<void> {
    await this.persist(() => this.options.watermarks.put(sessionId, {
      sessionId, seq, projectId, updatedAt: this.now(),
    }))
  }

  private ensureAi(): AiFeatureScope | undefined {
    if (this.aiScope?.active) return this.aiScope
    const ai = this.options.ai()
    if (!ai) return undefined
    this.aiScope = ai.activate(SELF_IMPROVEMENT_ACTIVATE_ID)
    this.aiScope.registerPurpose({
      id: EXTRACT_PURPOSE,
      label: '自我改进摘录',
      defaultTarget: { kind: 'role', role: 'normal' },
      maxOutputTokens: 400,
      maxInputChars: 8000,
    })
    return this.aiScope
  }

  private async draftTrigger(trigger: LessonTrigger, sessionId: string, sourceVersion: string, signal: AbortSignal, generation: number) {
    const scope = this.ensureAi()
    if (!scope) return draftFromTrigger(trigger)
    const result = await scope.run({
      purpose: EXTRACT_PURPOSE,
      sessionId,
      sourceVersion,
      system: EXTRACT_SYSTEM,
      input: JSON.stringify({ kind: trigger.kind, evidence: trigger.evidence, hint: trigger.contentHint }),
      signal,
      isCurrent: () => this.active && this.generation === generation && scope.active,
      priority: 'background',
    })
    if (!this.active || this.generation !== generation) return undefined
    if (result.receipt.status !== 'success') return undefined
    const parsed = parseExtraction(result.text)
    if (!parsed || 'skip' in parsed) return undefined
    return parsed
  }

  private noteExtractStart(sessionId: string): void {
    this.extractJobs.set(sessionId, (this.extractJobs.get(sessionId) ?? 0) + 1)
  }

  private noteExtractEnd(sessionId: string): void {
    const next = (this.extractJobs.get(sessionId) ?? 1) - 1
    if (next <= 0) this.extractJobs.delete(sessionId)
    else this.extractJobs.set(sessionId, next)
  }

  private isExtracting(sessionId?: string): boolean {
    if (sessionId) return (this.extractJobs.get(sessionId) ?? 0) > 0
    for (const count of this.extractJobs.values()) if (count > 0) return true
    return false
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const task = this.chain.then(run, run)
    this.chain = task.then(() => {}, () => {})
    return task
  }

  /** Queue auto and manual extract on the existing chain. Counts rise synchronously at request entry. */
  private enqueueExtract(
    session: SessionLike,
    signal: AbortSignal,
    mode: 'auto' | 'manual',
  ): Promise<RpcResult<{ created: MemoryRecord[]; skipped: number }>> {
    const sessionId = sessionIdOf(session)
    this.noteExtractStart(sessionId)
    return this.enqueue(async () => {
      try {
        return await this.runExtractFromSession(session, signal, mode)
      } finally {
        this.noteExtractEnd(sessionId)
      }
    })
  }

  async extractFromSession(session: SessionLike, signal: AbortSignal, mode: 'auto' | 'manual' = 'auto'): Promise<RpcResult<{ created: MemoryRecord[]; skipped: number }>> {
    return this.enqueueExtract(session, signal, mode)
  }

  considerSession(session: SessionLike, signal: AbortSignal): Promise<void> {
    return this.enqueueExtract(session, signal, 'auto').then(() => {}, () => {})
  }

  private async runExtractFromSession(session: SessionLike, signal: AbortSignal, mode: 'auto' | 'manual'): Promise<RpcResult<{ created: MemoryRecord[]; skipped: number }>> {
    const disabled = this.requireActive()
    if (disabled) return disabled
    const memory = this.memoryOrError()
    if (!this.asMemory(memory)) return memory
    const sessionId = sessionIdOf(session)
    if (!sessionId) return fail('INVALID', '缺少会话。')
    const projectId = projectIdFromCwd(sessionCwd(session))
    if (!projectId) return fail('WRONG_SCOPE', '无法确定当前项目，未写入候选。')
    const generation = this.generation
    try {
      const combined = this.currentSignal(signal)
      combined.throwIfAborted()
      const events = session.snapshotEvents()
      const lastSeq = events.reduce((max, event) => Math.max(max, event.seq), -1)
      const watermark = this.options.watermarks.get(sessionId)?.seq ?? -1
      const triggers = detectLessonTriggers(events, sessionId, mode === 'manual' ? -1 : watermark)
      if (triggers.length === 0) {
        if (mode === 'auto') {
          const written = await this.mutateWhileCurrent(generation, memory, () => this.writeWatermark(sessionId, lastSeq, projectId))
          if (this.failed(written)) return written
        }
        const stale = this.revalidate(generation, memory)
        if (stale) return stale
        return { ok: true, value: { created: [], skipped: 0 } }
      }
      const existing = await this.listAllLessons(projectId, memory)
      const staleList = this.revalidate(generation, memory)
      if (staleList) return staleList
      const created: MemoryRecord[] = []
      let skipped = 0
      const sourceVersion = `${sessionId}:${watermark}:${lastSeq}:${generation}`
      for (const trigger of triggers) {
        combined.throwIfAborted()
        if (hasSameEvidence(existing.concat(created), trigger)) { skipped += 1; continue }
        const draft = await this.draftTrigger(trigger, sessionId, sourceVersion, combined, generation)
        const staleDraft = this.revalidate(generation, memory)
        if (staleDraft) return staleDraft
        if (!draft) { skipped += 1; continue }
        const record = await this.mutateWhileCurrent(generation, memory, guards => memory.create(candidateRecord(draft, trigger, projectId), guards))
        if (this.failed(record)) return record
        this.rememberProject(projectId)
        created.push(record)
        existing.push(record)
      }
      const watermarkWrite = await this.mutateWhileCurrent(generation, memory, () => this.writeWatermark(sessionId, lastSeq, projectId))
      if (this.failed(watermarkWrite)) return watermarkWrite
      return { ok: true, value: { created, skipped } }
    } catch (error) {
      return this.rejectionOrThrow(error, generation, memory)
    }
  }

  private async requireLesson(
    id: string,
    extraProjectId: string | undefined,
    memory: MemoryService,
    generation: number,
  ): Promise<MemoryRecord | RpcResult<never>> {
    const rows = await this.listAllLessons(extraProjectId, memory)
    const stale = this.revalidate(generation, memory)
    if (stale) return stale
    const record = rows.find(item => item.id === id)
    if (!record || record.kind !== 'lesson') return fail('NOT_FOUND', '找不到该教训。')
    return record
  }

  async acceptLesson(id: string, expectedRevision: number, scope: 'project' | 'global', currentProjectId?: string): Promise<RpcResult<MemoryRecord>> {
    const work = this.beginWork()
    if (!this.isWork(work)) return work
    const { generation, memory } = work
    const record = await this.requireLesson(id, currentProjectId, memory, generation)
    if (!('id' in record)) return record
    const stale = this.revalidate(generation, memory)
    if (stale) return stale
    if (record.revision !== expectedRevision) return fail('STALE', '记录已更新，请刷新后重试。')
    if (isExpired(record, this.now())) return fail('STALE', '教训已过期。')
    if (record.status !== 'candidate' && record.status !== 'active') return fail('INVALID', '只能接受候选或已生效的教训。')
    if (scope === 'project') {
      if (record.scope.kind === 'project' && currentProjectId && record.scope.projectId !== currentProjectId) {
        return fail('WRONG_SCOPE', WRONG_SCOPE_MESSAGE)
      }
      const updated = await this.mutateWhileCurrent(generation, memory, guards => memory.update(id, { status: 'active' }, expectedRevision, guards))
      if (this.failed(updated)) return updated
      return { ok: true, value: updated }
    }
    if (record.scope.kind === 'global') {
      const updated = await this.mutateWhileCurrent(generation, memory, guards => memory.update(id, { status: 'active' }, expectedRevision, guards))
      if (this.failed(updated)) return updated
      return { ok: true, value: updated }
    }
    const promoted = await this.mutateWhileCurrent(generation, memory, guards => memory.promoteToGlobal(id, expectedRevision, guards))
    if (this.failed(promoted)) return promoted
    return { ok: true, value: promoted }
  }

  async setLessonStatus(id: string, expectedRevision: number, status: 'rejected' | 'revoked', extraProjectId?: string): Promise<RpcResult<MemoryRecord>> {
    const work = this.beginWork()
    if (!this.isWork(work)) return work
    const { generation, memory } = work
    const record = await this.requireLesson(id, extraProjectId, memory, generation)
    if (!('id' in record)) return record
    const stale = this.revalidate(generation, memory)
    if (stale) return stale
    if (record.revision !== expectedRevision) return fail('STALE', '记录已更新，请刷新后重试。')
    const updated = await this.mutateWhileCurrent(generation, memory, guards => memory.update(id, { status }, expectedRevision, guards))
    if (this.failed(updated)) return updated
    return { ok: true, value: updated }
  }

  private skills(): SkillRecord[] {
    return [...this.options.skills.entries()].map(([, row]) => row).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private async liveSkillLessons(
    lessonIds: string[],
    memory: MemoryService,
    generation: number,
  ): Promise<MemoryRecord[] | RpcResult<never>> {
    const records = await this.listAllLessons(undefined, memory)
    const stale = this.revalidate(generation, memory)
    if (stale) return stale
    const lessons = lessonIds.map(id => records.find(item => item.id === id))
    if (lessons.some(item => !item || item.kind !== 'lesson')) return fail('INVALID', '找不到所选教训。')
    return lessons as MemoryRecord[]
  }

  async previewSkill(lessonIds: string[]): Promise<RpcResult<SkillRecord>> {
    const work = this.beginWork()
    if (!this.isWork(work)) return work
    const { generation, memory } = work
    if (lessonIds.length === 0) return fail('INVALID', '请选择已接受的教训。')
    const lessons = await this.liveSkillLessons(lessonIds, memory, generation)
    if (!Array.isArray(lessons)) return lessons
    const stale = this.revalidate(generation, memory)
    if (stale) return stale
    const now = this.now()
    if (lessons.some(item => item.status !== 'active' || isExpired(item, now))) {
      return fail('INVALID', '只能从未过期且已接受的教训生成技能草稿。')
    }
    const record: SkillRecord = {
      id: crypto.randomUUID(),
      revision: 0,
      status: 'preview',
      lessonIds,
      sources: skillSourcesFromLessons(lessons),
      title: skillTitleFromLessons(lessons),
      markdown: renderSkillMarkdown(lessons, now),
      createdAt: now,
      updatedAt: now,
      exportState: 'none',
      audit: [{ at: now, action: 'preview' }],
    }
    const stored = await this.mutateWhileCurrent(generation, memory, () => this.persist(() => this.options.skills.put(record.id, record)))
    if (this.failed(stored)) return stored
    return { ok: true, value: record }
  }

  private skillOrError(id: string): SkillRecord | RpcResult<never> {
    const record = this.options.skills.get(id)
    if (!record) return fail('NOT_FOUND', '找不到该技能草稿。')
    return record
  }

  private async requireCurrentSkillSources(
    skill: SkillRecord,
    memory: MemoryService,
    generation: number,
  ): Promise<RpcResult<never> | undefined> {
    const lessons = await this.liveSkillLessons(skill.lessonIds, memory, generation)
    if (!Array.isArray(lessons)) return lessons
    const stale = this.revalidate(generation, memory)
    if (stale) return stale
    if (!sourcesMatchLive(skill.sources, lessons, this.now())) return fail('STALE', STALE_SKILL_MESSAGE)
    return undefined
  }

  async patchSkill(id: string, expectedRevision: number, patch: (current: SkillRecord) => SkillRecord): Promise<RpcResult<SkillRecord>> {
    const work = this.beginWork()
    if (!this.isWork(work)) return work
    const { generation, memory } = work
    const current = this.skillOrError(id)
    if (!('id' in current)) return current
    if (current.revision !== expectedRevision) return fail('STALE', '记录已更新，请刷新后重试。')
    const next = { ...patch(current), revision: current.revision + 1, updatedAt: this.now() }
    const stored = await this.mutateWhileCurrent(generation, memory, () => this.persist(() => this.options.skills.put(id, next)))
    if (this.failed(stored)) return stored
    return { ok: true, value: next }
  }

  async acceptSkill(id: string, expectedRevision: number): Promise<RpcResult<SkillRecord>> {
    const work = this.beginWork()
    if (!this.isWork(work)) return work
    const { generation, memory } = work
    const current = this.skillOrError(id)
    if (!('id' in current)) return current
    const stale = await this.requireCurrentSkillSources(current, memory, generation)
    if (stale) return stale
    const after = this.revalidate(generation, memory)
    if (after) return after
    return this.patchSkill(id, expectedRevision, record => ({
      ...record, status: 'accepted', audit: [...record.audit, { at: this.now(), action: 'accepted' }],
    }))
  }

  async prepareSkillExport(id: string, expectedRevision: number): Promise<RpcResult<{ filename: string; markdown: string; skill: SkillRecord }>> {
    const work = this.beginWork()
    if (!this.isWork(work)) return work
    const { generation, memory } = work
    const current = this.skillOrError(id)
    if (!('id' in current)) return current
    if (current.revision !== expectedRevision) return fail('STALE', '记录已更新，请刷新后重试。')
    if (current.status !== 'accepted' && current.status !== 'preview') return fail('INVALID', '只能导出预览或已接受的技能草稿。')
    const stale = await this.requireCurrentSkillSources(current, memory, generation)
    if (stale) return stale
    const after = this.revalidate(generation, memory)
    if (after) return after
    const filename = skillDownloadName(current.id, current.title)
    return { ok: true, value: { filename, markdown: current.markdown, skill: current } }
  }

  async recordSkillExport(id: string, expectedRevision: number, filename: string): Promise<RpcResult<SkillRecord>> {
    return this.patchSkill(id, expectedRevision, record => ({
      ...record,
      exportState: 'recorded',
      exportedAt: this.now(),
      exportFilename: filename,
      audit: [...record.audit, { at: this.now(), action: 'export', detail: filename }],
    }))
  }

  async snapshot(sessionId?: string): Promise<RpcResult<ReviewSnapshot>> {
    const session = sessionId ? this.options.sessionOf(sessionId) : undefined
    const projectId = projectIdFromCwd(sessionCwd(session))
    const memoryAvailable = Boolean(this.options.memory())
    return {
      ok: true,
      value: {
        memoryAvailable,
        memoryMessage: memoryAvailable ? undefined : MEMORY_UNAVAILABLE_MESSAGE,
        projectId,
        generation: this.generation,
        storageFailed: this.storageFailed,
        lessons: memoryAvailable ? await this.listAllLessons(projectId) : [],
        skills: this.skills(),
        extracting: this.isExtracting(sessionId),
      },
    }
  }

  async call(endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult> {
    try {
      signal.throwIfAborted()
      const body = asObject(payload)
      const sessionId = str(body, 'sessionId')
      const projectId = projectIdFromCwd(sessionCwd(this.options.sessionOf(sessionId)))
      if (endpoint === 'status') return await this.snapshot(sessionId || undefined)
      if (endpoint === 'extract') {
        const session = this.options.sessionOf(sessionId)
        if (!session) return fail('NOT_FOUND', '找不到会话。')
        return await this.extractFromSession(session, signal, 'manual')
      }
      if (endpoint === 'inspect') {
        const work = this.beginWork()
        if (!this.isWork(work)) return work
        const record = await this.requireLesson(str(body, 'id'), projectId, work.memory, work.generation)
        return 'id' in record ? { ok: true, value: record } : record
      }
      if (endpoint === 'accept') {
        const revision = int(body, 'expectedRevision')
        if (!str(body, 'id') || revision === undefined) return fail('INVALID', '缺少记录或版本。')
        const scope = str(body, 'scope') === 'global' ? 'global' : 'project'
        return await this.acceptLesson(str(body, 'id'), revision, scope, projectId)
      }
      if (endpoint === 'reject' || endpoint === 'revoke') {
        const revision = int(body, 'expectedRevision')
        if (!str(body, 'id') || revision === undefined) return fail('INVALID', '缺少记录或版本。')
        return await this.setLessonStatus(str(body, 'id'), revision, endpoint === 'reject' ? 'rejected' : 'revoked', projectId)
      }
      if (endpoint === 'skill.preview') {
        const lessonIds = Array.isArray(body.lessonIds) ? body.lessonIds.filter((id): id is string => typeof id === 'string') : []
        return await this.previewSkill(lessonIds)
      }
      if (endpoint === 'skill.accept') {
        const revision = int(body, 'expectedRevision')
        if (!str(body, 'id') || revision === undefined) return fail('INVALID', '缺少记录或版本。')
        return await this.acceptSkill(str(body, 'id'), revision)
      }
      if (endpoint === 'skill.reject' || endpoint === 'skill.revoke') {
        const revision = int(body, 'expectedRevision')
        if (!str(body, 'id') || revision === undefined) return fail('INVALID', '缺少记录或版本。')
        const status = endpoint === 'skill.reject' ? 'rejected' : 'revoked'
        return await this.patchSkill(str(body, 'id'), revision, current => ({
          ...current, status, audit: [...current.audit, { at: this.now(), action: status }],
        }))
      }
      if (endpoint === 'skill.export') {
        const revision = int(body, 'expectedRevision')
        if (!str(body, 'id') || revision === undefined) return fail('INVALID', '缺少记录或版本。')
        return await this.prepareSkillExport(str(body, 'id'), revision)
      }
      if (endpoint === 'skill.exported') {
        const revision = int(body, 'expectedRevision')
        const filename = str(body, 'filename')
        if (!str(body, 'id') || revision === undefined || !filename) return fail('INVALID', '缺少记录、版本或文件名。')
        return await this.recordSkillExport(str(body, 'id'), revision, filename)
      }
      if (endpoint === 'skill.unexport') {
        const revision = int(body, 'expectedRevision')
        if (!str(body, 'id') || revision === undefined) return fail('INVALID', '缺少记录或版本。')
        return await this.patchSkill(str(body, 'id'), revision, current => ({
          ...current,
          exportState: 'revoked',
          exportRevokedAt: this.now(),
          audit: [...current.audit, { at: this.now(), action: 'unexport', detail: 'in-app record only' }],
        }))
      }
      return fail('INVALID', '未知操作。')
    } catch (error) {
      if (this.isGuardRejection(error) || this.lifetime.signal.aborted) return fail('CANCELLED', '操作已取消。')
      if (this.storageFailed) return fail('STORAGE_FAILED', '保存失败，已保留上一次成功的状态。')
      return fail('INTERNAL', error instanceof Error ? error.message : '操作失败。')
    }
  }
}
