import { randomUUID } from 'node:crypto'
import type {
  AiFeatureScope, AiPolicy, AiServices, AuxiliaryRequest, AuxiliaryResult, ModelRoute, ModelTarget, PurposeSpec, ResolvedRoute,
  UsageReceipt,
} from './contracts.ts'
import { AiServicesError, AI_DUPLICATE_PURPOSE, AI_INACTIVE, AI_POLICY_CONFLICT, AI_POLICY_INVALID, AI_POLICY_SAVE_FAILED, abortable, fail, isAbortError } from './errors.ts'
import { generateAuxiliary, type LlmGenerate } from './generate.ts'
import { ProviderQueues } from './queue.ts'
import { resolvePurposeRoute, type LlmValidate, type SessionModelsFn } from './routing.ts'
import {
  boundedReceipts, clonePolicy, clonePurpose, defaultPolicy, parsePolicyData, purposeSpecSchema, sanitizeReceipt,
} from './storage.ts'

export type AiServicesStore = {
  savePolicy(policy: AiPolicy, imports?: string[]): Promise<void>
  saveReceipts(items: UsageReceipt[]): Promise<void>
}

export type AiServicesOptions = {
  llm: LlmValidate & LlmGenerate
  initialPolicy?: AiPolicy
  initialImports?: string[]
  initialReceipts?: UsageReceipt[]
  store: AiServicesStore
  sessionModels?: SessionModelsFn
  /** Read lazily so host model changes and manager unloads apply to the next call. */
  defaultModel?: () => ModelRoute | undefined
  modelCenterAvailable?: () => boolean
  now?: () => number
  id?: () => string
}

type OwnedPurpose = PurposeSpec & { plugin: string }

type Lifetime = {
  plugin: string
  controller: AbortController
  active: boolean
  purposes: Map<string, PurposeSpec>
}

const PLUGIN_NAME = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/

function pluginName(value: string): string {
  const id = value.trim()
  if (!id || id.length > 80 || id.includes('..') || !PLUGIN_NAME.test(id)) fail(AI_POLICY_INVALID, '插件标识无效。')
  return id
}

function minLimit(policyValue: number, purposeValue: number | undefined): number {
  return purposeValue === undefined ? policyValue : Math.min(policyValue, purposeValue)
}

export class AiServicesRuntime implements AiServices {
  private policy: AiPolicy
  private imports: string[]
  private receipts: UsageReceipt[]
  private storageFailed = false
  private disposed = false
  private pending = Promise.resolve()
  private readonly purposeRegistry = new Map<string, OwnedPurpose>()
  private readonly lifetimes = new Set<Lifetime>()
  private readonly queues: ProviderQueues
  private readonly now: () => number
  private readonly id: () => string

  constructor(private readonly options: AiServicesOptions) {
    this.imports = [...(options.initialImports ?? [])]
    this.policy = clonePolicy(options.initialPolicy ?? defaultPolicy())
    this.receipts = boundedReceipts(options.initialReceipts ?? [])
    this.now = options.now ?? Date.now
    this.id = options.id ?? (() => randomUUID())
    this.queues = new ProviderQueues(() => this.policy.limits.concurrency)
  }

  get storageFailedFlag(): boolean { return this.storageFailed }

  noteAgent(provider: string, delta: 1 | -1): void {
    this.queues.noteAgent(provider, delta)
  }

  getPolicy(): AiPolicy {
    return clonePolicy(this.policy)
  }

  purposes(): Array<PurposeSpec & { plugin: string }> {
    return [...this.purposeRegistry.values()].map(item => ({ ...clonePurpose(item), plugin: item.plugin }))
  }

  usage(): UsageReceipt[] {
    return this.receipts.map(item => structuredClone(item))
  }

  importPurposes(migrationId: string, defaults: Record<string, ModelTarget>, roles: AiPolicy['roles'] = {}): Promise<AiPolicy> {
    const task = this.pending.then(async () => {
      this.assertOpen()
      if (!/^[A-Za-z][A-Za-z0-9._:-]{0,79}$/.test(migrationId)) fail(AI_POLICY_INVALID, '迁移标识无效。')
      if (this.imports.includes(migrationId)) return this.getPolicy()
      if (this.imports.length >= 100) fail(AI_POLICY_INVALID, '迁移记录已满。')
      const { revision: _revision, ...current } = this.policy
      const parsed = parsePolicyData({ ...current, roles: { ...roles, ...current.roles }, purposes: { ...defaults, ...this.policy.purposes } })
      const purposes = { ...parsed.purposes, ...this.policy.purposes }
      const next = { ...this.getPolicy(), roles: parsed.roles, purposes, revision: this.policy.revision + 1 }
      const imports = [...this.imports, migrationId]
      try { await this.options.store.savePolicy(next, imports) }
      catch { this.storageFailed = true; fail(AI_POLICY_SAVE_FAILED, '旧模型配置迁移失败，已保留原设置。') }
      this.policy = next
      this.imports = imports
      this.storageFailed = false
      return this.getPolicy()
    })
    this.pending = task.then(() => {}, () => {})
    return task
  }

  updatePolicy(policy: Omit<AiPolicy, 'revision'>, expectedRevision: number): Promise<AiPolicy> {
    const task = this.pending.then(async () => {
      if (this.disposed) fail(AI_INACTIVE, 'AI 服务已停止。')
      if (expectedRevision !== this.policy.revision) fail(AI_POLICY_CONFLICT, '策略已被其他页面修改，请刷新后重试。')
      const parsed = parsePolicyData(policy)
      const next: AiPolicy = { ...clonePolicy({ revision: expectedRevision + 1, ...parsed }), revision: expectedRevision + 1 }
      try {
        await this.options.store.savePolicy(next, this.imports)
      } catch {
        this.storageFailed = true
        fail(AI_POLICY_SAVE_FAILED, '策略保存失败，已保留原设置。')
      }
      this.policy = next
      this.storageFailed = false
      this.queues.wake()
      return clonePolicy(this.policy)
    })
    this.pending = task.then(() => {}, () => {})
    return task
  }

  async resolve(purpose: string, sessionId?: string, override?: ModelTarget): Promise<ResolvedRoute> {
    this.assertOpen()
    const spec = this.purposeRegistry.get(purpose)
    return resolvePurposeRoute({
      llm: this.options.llm,
      policy: this.policy,
      purpose,
      spec,
      sessionId,
      override,
      sessionModels: this.options.sessionModels,
      defaultModel: this.options.defaultModel,
      modelCenterAvailable: this.options.modelCenterAvailable?.(),
    })
  }

  activate(plugin: string): AiFeatureScope {
    this.assertOpen()
    const name = pluginName(plugin)
    const lifetime: Lifetime = {
      plugin: name,
      controller: new AbortController(),
      active: true,
      purposes: new Map(),
    }
    this.lifetimes.add(lifetime)
    const scope: AiFeatureScope = {
      plugin: name,
      get signal() { return lifetime.controller.signal },
      get active() { return lifetime.active && !lifetime.controller.signal.aborted },
      registerPurpose: spec => this.registerPurpose(lifetime, spec),
      run: request => this.run(lifetime, request),
      dispose: () => this.disposeLifetime(lifetime),
    }
    return scope
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const lifetime of [...this.lifetimes]) this.disposeLifetime(lifetime)
    await this.pending
  }

  private assertOpen(): void {
    if (this.disposed) fail(AI_INACTIVE, 'AI 服务已停止。')
  }

  private registerPurpose(lifetime: Lifetime, spec: PurposeSpec): () => void {
    if (!lifetime.active) fail(AI_INACTIVE, '插件范围已停用。')
    let parsed: PurposeSpec
    try { parsed = purposeSpecSchema.parse(spec) }
    catch { fail(AI_POLICY_INVALID, '用途声明无效。') }
    const existing = this.purposeRegistry.get(parsed.id)
    if (existing && existing.plugin !== lifetime.plugin) fail(AI_DUPLICATE_PURPOSE, '用途已被其他插件注册。')
    const owned: OwnedPurpose = { ...clonePurpose(parsed), plugin: lifetime.plugin }
    lifetime.purposes.set(parsed.id, owned)
    this.purposeRegistry.set(parsed.id, owned)
    let removed = false
    return () => {
      if (removed) return
      removed = true
      lifetime.purposes.delete(parsed.id)
      this.refreshPurpose(parsed.id)
    }
  }

  private disposeLifetime(lifetime: Lifetime): void {
    if (!lifetime.active && !this.lifetimes.has(lifetime)) return
    lifetime.active = false
    if (!lifetime.controller.signal.aborted) lifetime.controller.abort()
    const ids = [...lifetime.purposes.keys()]
    lifetime.purposes.clear()
    this.lifetimes.delete(lifetime)
    for (const id of ids) this.refreshPurpose(id)
  }

  private refreshPurpose(id: string): void {
    for (const other of this.lifetimes) {
      const spec = other.purposes.get(id)
      if (spec && other.active) {
        this.purposeRegistry.set(id, { ...spec, plugin: other.plugin })
        return
      }
    }
    this.purposeRegistry.delete(id)
  }

  private live(lifetime: Lifetime, request: AuxiliaryRequest): boolean {
    if (!lifetime.active || lifetime.controller.signal.aborted || request.signal?.aborted) return false
    try {
      if (request.isCurrent && !request.isCurrent()) return false
    } catch {
      return false
    }
    return true
  }

  private classify(lifetime: Lifetime, request: AuxiliaryRequest, queued: boolean): UsageReceipt['status'] | undefined {
    const aborted = lifetime.controller.signal.aborted || Boolean(request.signal?.aborted)
    let current = true
    try { current = !request.isCurrent || request.isCurrent() } catch { current = false }
    if (aborted) return 'cancelled'
    if (!lifetime.active || !current) return queued ? 'superseded' : 'skipped'
    return undefined
  }

  private async run(lifetime: Lifetime, request: AuxiliaryRequest): Promise<AuxiliaryResult> {
    const startedAt = this.now()
    const base = {
      id: this.id(),
      plugin: lifetime.plugin,
      purpose: request.purpose,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      sourceVersion: request.sourceVersion,
      ...(request.contractVersion !== undefined ? { contractVersion: request.contractVersion } : {}),
      ...(request.promptVersion ? { promptVersion: request.promptVersion } : {}),
      ...(request.schemaVersion ? { schemaVersion: request.schemaVersion } : {}),
      cost: null as null,
      startedAt,
    }
    let queued = false
    let timeout: AbortSignal | undefined
    const finish = async (receipt: UsageReceipt, text = ''): Promise<AuxiliaryResult> => {
      let sealed = sanitizeReceipt({ ...receipt, finishedAt: this.now(), cost: null })
      await this.record(sealed)
      const again = this.classify(lifetime, request, queued)
      if (again && (sealed.status === 'success' || text !== '')) {
        const { error: _error, ...rest } = sealed
        const timedOut = Boolean(timeout?.aborted) && !request.signal?.aborted && !lifetime.controller.signal.aborted
        sealed = sanitizeReceipt({
          ...rest,
          status: again,
          finishedAt: this.now(),
          cost: null,
          ...(again === 'cancelled' ? { error: timedOut ? '调用超时。' : '调用已取消。' } : {}),
        })
        await this.record(sealed)
        return { text: '', receipt: sealed }
      }
      return { text: sealed.status === 'success' ? text : '', receipt: sealed }
    }
    const early = this.classify(lifetime, request, false)
    if (early) {
      return finish({ ...base, status: early, attempts: 0, finishedAt: this.now(), ...(early === 'cancelled' ? { error: '调用已取消。' } : {}) })
    }

    const spec = lifetime.purposes.get(request.purpose)
    if (!spec) {
      return finish({ ...base, status: 'failed', attempts: 0, finishedAt: this.now(), error: '用途未注册。' })
    }
    if (request.insert && (!Number.isInteger(request.insert.maxChars) || request.insert.maxChars < 1 || request.insert.maxChars > 12000)) return finish({ ...base, status: 'failed', attempts: 0, finishedAt: this.now(), error: '输出字符上限无效。' })
    const policy = this.policy
    const maxInputChars = minLimit(policy.limits.maxInputChars, spec.maxInputChars)
    if (request.input.length + request.system.length > maxInputChars) {
      return finish({
        ...base, status: 'failed', attempts: 0, finishedAt: this.now(), error: '输入超出上限。',
      } satisfies UsageReceipt)
    }

    const timeoutMs = minLimit(policy.limits.timeoutMs, spec.timeoutMs)
    timeout = AbortSignal.timeout(timeoutMs)
    const combined = AbortSignal.any([lifetime.controller.signal, timeout, ...(request.signal ? [request.signal] : [])])

    let route: ResolvedRoute
    try {
      route = await abortable(() => resolvePurposeRoute({
        llm: this.options.llm,
        policy,
        purpose: request.purpose,
        spec,
        sessionId: request.sessionId,
        override: request.override,
        sessionModels: this.options.sessionModels,
        defaultModel: this.options.defaultModel,
        modelCenterAvailable: this.options.modelCenterAvailable?.(),
        signal: combined,
      }), combined)
    } catch (error) {
      const classified = this.classify(lifetime, request, false)
        ?? (isAbortError(error) || combined.aborted ? 'cancelled' : undefined)
      if (classified) {
        const timedOut = timeout.aborted && !request.signal?.aborted && !lifetime.controller.signal.aborted
        return finish({
          ...base, status: classified, attempts: 0, finishedAt: this.now(),
          ...(classified === 'cancelled' ? { error: timedOut ? '调用超时。' : '调用已取消。' } : {}),
        })
      }
      const message = error instanceof AiServicesError ? error.message : '模型路由无效，未改用其他模型。'
      return finish({ ...base, status: 'failed', attempts: 0, finishedAt: this.now(), error: message })
    }

    const afterResolve = this.classify(lifetime, request, false)
    if (afterResolve) {
      return finish({ ...base, status: afterResolve, attempts: 0, finishedAt: this.now(), route, ...(afterResolve === 'cancelled' ? { error: '调用已取消。' } : {}) })
    }

    const maxOutputTokens = minLimit(policy.limits.maxOutputTokens, spec.maxOutputTokens)
    const maxAttempts = policy.limits.maxAttempts
    const priority = request.priority === 'interactive' ? 'interactive' : 'background'

    queued = true
    let release = () => {}
    try {
      release = await this.queues.forProvider(route.provider).acquire(priority, combined)
    } catch (error) {
      const classified = this.classify(lifetime, request, true) ?? (isAbortError(error) || combined.aborted ? 'cancelled' : 'failed')
      return finish({
        ...base, status: classified, attempts: 0, finishedAt: this.now(), route,
        error: classified === 'cancelled' ? (timeout.aborted && !request.signal?.aborted && !lifetime.controller.signal.aborted ? '调用超时。' : '调用已取消。') : '排队失败。',
      })
    }

    try {
      const afterQueue = this.classify(lifetime, request, true)
      if (afterQueue) {
        return finish({
          ...base, status: afterQueue, attempts: 0, finishedAt: this.now(), route,
          ...(afterQueue === 'cancelled' ? { error: '调用已取消。' } : {}),
        })
      }
      const generated = await generateAuxiliary({
        llm: this.options.llm,
        plugin: lifetime.plugin,
        route,
        system: request.system,
        text: request.input,
        maxTokens: maxOutputTokens,
        maxAttempts,
        insert: request.insert,
        signal: combined,
        sessionId: request.sessionId,
        live: () => this.live(lifetime, request),
      })
      const classified = this.classify(lifetime, request, true)
      if (classified === 'superseded') {
        return finish({
          ...base, status: 'superseded', attempts: generated.attempts, finishedAt: this.now(), route,
          ...(generated.inputTokens !== undefined ? { inputTokens: generated.inputTokens } : {}),
          ...(generated.outputTokens !== undefined ? { outputTokens: generated.outputTokens } : {}),
        })
      }
      const timedOut = timeout.aborted && !request.signal?.aborted && !lifetime.controller.signal.aborted
      if (classified === 'cancelled' || generated.status === 'cancelled') {
        return finish({
          ...base, status: 'cancelled', attempts: generated.attempts, finishedAt: this.now(), route,
          ...(generated.inputTokens !== undefined ? { inputTokens: generated.inputTokens } : {}),
          ...(generated.outputTokens !== undefined ? { outputTokens: generated.outputTokens } : {}),
          error: timedOut ? '调用超时。' : '调用已取消。',
        })
      }
      if (generated.status !== 'success') {
        return finish({
          ...base, status: generated.status, attempts: generated.attempts, finishedAt: this.now(), route,
          ...(generated.inputTokens !== undefined ? { inputTokens: generated.inputTokens } : {}),
          ...(generated.outputTokens !== undefined ? { outputTokens: generated.outputTokens } : {}),
          ...(generated.error ? { error: generated.error } : {}),
        })
      }
      return finish({
        ...base, status: 'success', attempts: generated.attempts, finishedAt: this.now(), route,
        ...(generated.inputTokens !== undefined ? { inputTokens: generated.inputTokens } : {}),
        ...(generated.outputTokens !== undefined ? { outputTokens: generated.outputTokens } : {}),
      }, generated.text)
    } finally {
      release()
    }
  }

  private record(receipt: UsageReceipt): Promise<void> {
    const task = this.pending.then(async () => {
      const index = this.receipts.findIndex(row => row.id === receipt.id)
      const list = [...this.receipts]
      if (index >= 0) list[index] = receipt
      else list.push(receipt)
      const next = boundedReceipts(list)
      try {
        await this.options.store.saveReceipts(next)
        this.receipts = next
      } catch {
        this.storageFailed = true
        this.receipts = next
      }
    })
    this.pending = task.then(() => {}, () => {})
    return task
  }
}
