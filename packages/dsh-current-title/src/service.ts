import type { AiFeatureScope, AiServices, RpcResult } from '@klarkxy/dsh-ai-services/contracts'
import type { GenerateConfig, TitleSettings, TitleSnapshot, TitleStatus, TitleSupport } from './contracts.ts'
import { PROVIDER_ID, defaultGenerateConfig, isTitleLocaleMode } from './contracts.ts'
import { generateCurrentTitle, registerTitlePurpose } from './generate.ts'
import { collectHumanMessages, type SessionLike } from './messages.ts'
import {
  createNativeTitleSlot, restoreOwnDisplacement, type LoaderFace, type SessionTitleServiceLike,
} from './native-slot.ts'
import { claimTitleSlot, releaseTitleSlot, type OwnershipClaim } from './ownership.ts'
import { storedSettings } from './storage.ts'
import type { TitleLocaleMode } from './output.ts'

export interface TitleSettingsStore {
  load(): TitleSettings | undefined
  save(settings: TitleSettings): Promise<void>
}

export interface CurrentTitleHost {
  get(name: string): unknown
}

export class CurrentTitleService {
  private settings: TitleSettings
  private config: GenerateConfig
  private scope?: AiFeatureScope
  private unregisterPurpose?: () => void
  private claim?: OwnershipClaim
  private nativeSlot?: ReturnType<typeof createNativeTitleSlot>
  private generation = 0
  private readonly inFlight = new Map<string, AbortController>()
  readonly support: TitleSupport

  constructor(private readonly options: {
    plugin: string
    ai?: AiServices
    sessionTitle?: SessionTitleServiceLike
    loader?: LoaderFace
    sessions?: { get(id: string): SessionLike | undefined }
    store?: TitleSettingsStore
    localePreference?: () => string | undefined
    initialLocale?: TitleLocaleMode
    now?: () => Date
  }) {
    const stored = storedSettings(options.store?.load(), options.initialLocale ?? 'auto')
    this.settings = stored
    this.config = defaultGenerateConfig(this.settings.locale)
    this.support = { nativeOwner: null, weOwn: false }
  }

  async start(): Promise<void> {
    const { ai, sessionTitle, loader, sessions } = this.options
    if (!ai || !sessionTitle?.register || !sessions || !loader) {
      this.support.weOwn = false
      this.support.limitation = 'required host services are missing'
      return
    }
    this.scope = ai.activate(this.options.plugin)
    this.unregisterPurpose = registerTitlePurpose(this.scope)
    this.nativeSlot = createNativeTitleSlot({
      sessionTitle,
      loader,
      generate: request => this.nativeGenerate(request),
    })
    try {
      this.claim = await claimTitleSlot(this.nativeSlot, PROVIDER_ID)
      this.support.weOwn = true
      this.support.nativeOwner = PROVIDER_ID
      delete this.support.limitation
    } catch (error) {
      this.support.weOwn = false
      this.support.nativeOwner = this.nativeSlot.owner() ?? null
      this.support.limitation = error instanceof Error ? error.message : 'native title provider slot is occupied'
    }
  }

  async dispose(): Promise<void> {
    this.generation += 1
    for (const controller of this.inFlight.values()) controller.abort(new Error('current-title disabled'))
    this.inFlight.clear()
    const snapshot = this.nativeSlot?.displacement
    const outcome = await releaseTitleSlot(this.nativeSlot ?? { owner: () => undefined, occupy: async () => () => {} }, this.claim)
    if (outcome === 'released') await restoreOwnDisplacement(this.options.loader, snapshot)
    this.claim = undefined
    this.support.weOwn = false
    this.support.nativeOwner = this.nativeSlot?.owner() ?? null
    if (outcome === 'left-other-owner') {
      this.support.limitation = 'another title provider owns the slot; previous owner was not restored'
    }
    this.unregisterPurpose?.()
    this.unregisterPurpose = undefined
    this.scope?.dispose()
    this.scope = undefined
  }

  status(sessionId?: string): TitleStatus {
    const session = sessionId && this.options.sessions ? this.options.sessions.get(sessionId) : undefined
    const snapshot = session ? this.read(session) : undefined
    return {
      settings: { ...this.settings },
      support: { ...this.support, nativeOwner: this.nativeSlot?.owner() ?? this.support.nativeOwner },
      ...(sessionId ? {
        session: {
          sessionId,
          title: snapshot?.title,
          sourceKind: snapshot?.source.kind,
          generating: this.inFlight.has(sessionId),
          pinned: snapshot?.source.kind === 'user',
        },
      } : {}),
    }
  }

  async updateLocale(locale: TitleLocaleMode, expectedRevision: number): Promise<TitleSettings> {
    if (this.settings.revision !== expectedRevision) {
      throw Object.assign(new Error('current-title settings changed'), { code: 'revision' })
    }
    const next = { revision: this.settings.revision + 1, locale }
    if (this.options.store) await this.options.store.save(next)
    this.settings = next
    this.config = { ...this.config, locale }
    return { ...this.settings }
  }

  async regenerate(sessionId: string, signal: AbortSignal): Promise<TitleSnapshot | undefined> {
    if (!this.support.weOwn) throw Object.assign(new Error('title provider is inactive'), { code: 'unavailable' })
    const session = this.options.sessions?.get(sessionId)
    if (!session) throw Object.assign(new Error('session not found'), { code: 'not-found' })
    await this.options.sessionTitle?.refresh(session, signal)
    return this.read(session)
  }

  read(session: SessionLike): TitleSnapshot | undefined {
    const snapshot = this.options.sessionTitle?.get(session)
    if (!snapshot?.title) return undefined
    const kind = snapshot.source?.kind
    return {
      title: snapshot.title,
      messageSeqs: snapshot.messageSeqs ? [...snapshot.messageSeqs] : [],
      source: {
        kind: kind === 'user' || kind === 'fallback' || kind === 'provider' ? kind : 'provider',
        ...(typeof snapshot.source?.provider === 'string' ? { provider: snapshot.source.provider } : {}),
      },
      eventSeq: Number(snapshot.eventSeq ?? 0),
      updatedAt: snapshot.updatedAt ?? 0,
    }
  }

  private async nativeGenerate(request: {
    session: { id: string; snapshotEvents(): readonly unknown[] }
    messages: ReadonlyArray<{ seq: number; text: string }>
    signal: AbortSignal
  }) {
    const scope = this.scope
    if (!scope) throw new Error('dsh-current-title: aiServices is not available')
    const generation = this.generation
    const controller = new AbortController()
    this.inFlight.get(request.session.id)?.abort(new Error('newer title generation superseded older work'))
    this.inFlight.set(request.session.id, controller)
    try {
      const combined = AbortSignal.any([request.signal, controller.signal, scope.signal])
      const session = this.options.sessions?.get(request.session.id)
      const messages = collectHumanMessages(
        request.messages.map(message => ({
          type: 'user/message',
          seq: message.seq,
          data: { source: { kind: 'user' }, content: [{ type: 'text', text: message.text }] },
        })),
      )
      const generated = await generateCurrentTitle({
        scope,
        config: this.config,
        sessionId: request.session.id,
        messages: messages.length > 0 ? messages : [...request.messages],
        localePreference: this.options.localePreference?.(),
        signal: combined,
        isCurrent: () => this.generation === generation && scope.active && this.support.weOwn
          && (!session || this.options.sessions?.get(request.session.id) === session),
        now: this.options.now?.(),
      })
      return { title: generated.title, messageSeqs: generated.messageSeqs, model: generated.model }
    } finally {
      if (this.inFlight.get(request.session.id) === controller) this.inFlight.delete(request.session.id)
    }
  }
}

export function hostLocalePreference(host: CurrentTitleHost): string | undefined {
  try {
    const settings = host.get('settings') as { get?(namespace: string): unknown } | undefined
    const value = settings?.get?.('locale')
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const preference = (value as Record<string, unknown>).preference
    return typeof preference === 'string' ? preference : undefined
  } catch {
    return undefined
  }
}

export async function handleRpc(service: CurrentTitleService, endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult> {
  signal.throwIfAborted()
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
  if (endpoint === 'status') {
    return { ok: true, value: service.status(typeof body.sessionId === 'string' ? body.sessionId : undefined) }
  }
  if (endpoint === 'settings') {
    if (!isTitleLocaleMode(body.locale) || typeof body.expectedRevision !== 'number') {
      return { ok: false, error: { code: 'bad-request', message: '标题语言设置无效。' } }
    }
    try {
      return { ok: true, value: await service.updateLocale(body.locale, body.expectedRevision) }
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String((error as { code?: string }).code) : 'failed'
      if (code === 'revision') return { ok: false, error: { code, message: '设置已更新，请刷新后重试。' } }
      return { ok: false, error: { code: 'failed', message: '无法保存标题设置。' } }
    }
  }
  if (endpoint === 'regenerate') {
    if (typeof body.sessionId !== 'string' || !body.sessionId) {
      return { ok: false, error: { code: 'bad-request', message: '缺少会话。' } }
    }
    try {
      const snapshot = await service.regenerate(body.sessionId, signal)
      return { ok: true, value: snapshot ?? null }
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String((error as { code?: string }).code) : 'failed'
      if (code === 'not-found') return { ok: false, error: { code, message: '找不到该会话。' } }
      if (code === 'unavailable') return { ok: false, error: { code, message: '标题服务未就绪。' } }
      if (signal.aborted) return { ok: false, error: { code: 'cancelled', message: '已取消。' } }
      return { ok: false, error: { code: 'failed', message: '标题生成失败。' } }
    }
  }
  return { ok: false, error: { code: 'bad-request', message: '未知操作。' } }
}
