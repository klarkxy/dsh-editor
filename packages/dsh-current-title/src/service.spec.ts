import { describe, expect, it, vi } from 'vitest'
import type { AiFeatureScope, AiServices, AuxiliaryResult } from '@klarkxy/dsh-ai-services/contracts'
import { PLUGIN_NAME, PROVIDER_ID, PURPOSE_ID, type TitleSettings } from './contracts.ts'
import { CurrentTitleService } from './service.ts'
import type { LoaderEntry, LoaderFace, SessionTitleServiceLike } from './native-slot.ts'

function receipt(text: string): AuxiliaryResult {
  return {
    text,
    receipt: {
      id: 'r1', plugin: PLUGIN_NAME, purpose: PURPOSE_ID, sourceVersion: 's',
      status: 'success', attempts: 1, cost: null, startedAt: 0, finishedAt: 1,
    },
  }
}

function ai(run: AiFeatureScope['run'] = async () => receipt('{"type":"fix","summary":"登录"}')): AiServices {
  const activate = vi.fn((): AiFeatureScope => ({
    plugin: PLUGIN_NAME,
    signal: new AbortController().signal,
    active: true,
    registerPurpose: vi.fn(() => () => {}),
    run,
    dispose: vi.fn(),
  }))
  return {
    activate,
    getPolicy: () => ({ revision: 0, roles: {}, purposes: {}, limits: { concurrency: 1, timeoutMs: 1, maxInputChars: 1, maxOutputTokens: 1, maxAttempts: 1 } }),
    updatePolicy: async policy => ({ ...policy, revision: 1 }),
    resolve: async () => ({ provider: 'p', model: 'm', source: 'default', target: { kind: 'role', role: 'weak' }, policyRevision: 0 }),
    purposes: () => [],
    usage: () => [],
  }
}

function nativeExclusive(initial?: string) {
  let registration: { id: string } | undefined = initial ? { id: initial } : undefined
  const active = new Set<Promise<unknown>>()
  const titles = new Map<string, { title: string; source: { kind: 'user' | 'provider' | 'fallback' } }>()
  const service: SessionTitleServiceLike & {
    occupant(): string | undefined
    hold(work: Promise<unknown>): void
    drop(id: string): Promise<void>
  } = {
    occupant: () => registration?.id,
    hold(work) { active.add(work); void work.finally(() => active.delete(work)) },
    async drop(id) {
      if (registration?.id !== id) return
      await Promise.allSettled([...active])
      if (registration?.id === id) registration = undefined
    },
    register(provider) {
      if (registration !== undefined) throw new Error(`session-title provider "${registration.id}" is already registered`)
      const current = { id: provider.id }
      registration = current
      return async () => {
        await Promise.allSettled([...active])
        if (registration === current) registration = undefined
      }
    },
    get(session) {
      const id = (session as { id: string }).id
      const row = titles.get(id)
      return row ? { title: row.title, source: row.source, eventSeq: 1, updatedAt: 1, messageSeqs: [] } : undefined
    },
    async refresh(session) {
      const id = (session as { id: string }).id
      titles.set(id, { title: '0903 | 修复 | 登录', source: { kind: 'provider' } })
    },
  }
  return service
}

function loader(rows: LoaderEntry[], exclusive?: ReturnType<typeof nativeExclusive>): LoaderFace & { updates: string[] } {
  const updates: string[] = []
  return {
    updates,
    entries: () => rows,
    async update(id, options) {
      updates.push(`${id}:${String(options.disabled)}`)
      const entry = rows.find(item => item.id === id)
      if (entry) entry.options = { ...entry.options, ...options }
      if (!exclusive || id !== 'session-title-llm') return
      if (options.disabled === true) await exclusive.drop('session-title-first-prompt-llm')
      else if (options.disabled === false && exclusive.occupant() === undefined) {
        exclusive.register({ id: 'session-title-first-prompt-llm', automatic: 'first-prompt', generate: async () => ({ title: '', messageSeqs: [] }) })
      }
    },
  }
}

function store(initial?: TitleSettings) {
  let row = initial
  return {
    load: () => row,
    save: async (next: TitleSettings) => { row = next },
    value: () => row,
  }
}

describe('CurrentTitleService', () => {
  it('stays inert when required host services are missing', async () => {
    const services = ai()
    const update = vi.fn()
    const service = new CurrentTitleService({
      plugin: PLUGIN_NAME,
      ai: services,
      loader: { entries: () => [], update },
    })
    await service.start()
    expect(service.support.weOwn).toBe(false)
    expect(service.support.limitation).toMatch(/required host services/)
    expect(update).not.toHaveBeenCalled()
    expect(services.activate).not.toHaveBeenCalled()
    await service.dispose()
    expect(update).not.toHaveBeenCalled()
  })

  it('forces auto locale with CAS across disable and restart', async () => {
    const persisted = store()
    const exclusive = nativeExclusive()
    const service = new CurrentTitleService({
      plugin: PLUGIN_NAME,
      ai: ai(),
      sessionTitle: exclusive,
      sessions: { get: () => undefined },
      loader: loader([]),
      store: persisted,
    })
    await service.start()
    expect((await service.updateLocale('en', 0)).locale).toBe('auto')
    expect(persisted.value()?.locale).toBe('auto')
    await expect(service.updateLocale('zh', 0)).rejects.toThrow(/changed/)
    expect(service.status().settings.locale).toBe('auto')
    await service.dispose()
    const again = new CurrentTitleService({
      plugin: PLUGIN_NAME,
      ai: ai(),
      sessionTitle: nativeExclusive(),
      sessions: { get: () => undefined },
      loader: loader([]),
      store: persisted,
    })
    await again.start()
    expect(again.status().settings).toEqual({ revision: 1, locale: 'auto' })
    await again.dispose()
  })

  it('does not keep a saved locale when storage write fails', async () => {
    const service = new CurrentTitleService({
      plugin: PLUGIN_NAME,
      ai: ai(),
      sessionTitle: nativeExclusive(),
      sessions: { get: () => undefined },
      loader: loader([]),
      store: { load: () => undefined, save: async () => { throw new Error('disk') } },
    })
    await service.start()
    await expect(service.updateLocale('zh', 0)).rejects.toThrow(/disk/)
    expect(service.status().settings.locale).toBe('auto')
    await service.dispose()
  })

  it('ignores a persisted locale and runs auto without dropping revision', async () => {
    const persisted = store({ revision: 4, locale: 'en' })
    const service = new CurrentTitleService({
      plugin: PLUGIN_NAME,
      ai: ai(),
      sessionTitle: nativeExclusive(),
      sessions: { get: () => undefined },
      loader: loader([]),
      store: persisted,
    })
    await service.start()
    expect(service.status().settings).toEqual({ revision: 4, locale: 'auto' })
    await service.dispose()
  })

  it('displaces the occupied first-prompt provider and restores it after awaited dispose', async () => {
    const exclusive = nativeExclusive('session-title-first-prompt-llm')
    const rows: LoaderEntry[] = [{
      id: 'session-title-llm',
      options: { name: '@deepseek-ai/dsh-session-title-first-prompt-llm', disabled: false },
    }]
    const host = loader(rows, exclusive)
    const service = new CurrentTitleService({
      plugin: PLUGIN_NAME,
      ai: ai(),
      sessionTitle: exclusive,
      sessions: { get: () => undefined },
      loader: host,
    })
    await service.start()
    expect(service.support.weOwn).toBe(true)
    expect(rows[0]?.options?.disabled).toBe(true)
    expect(exclusive.occupant()).toBe(PROVIDER_ID)
    let resume!: () => void
    const held = new Promise<void>(resolve => { resume = resolve })
    exclusive.hold(held)
    const disposing = service.dispose()
    await Promise.resolve()
    expect(exclusive.occupant()).toBe(PROVIDER_ID)
    resume()
    await disposing
    expect(exclusive.occupant()).toBe('session-title-first-prompt-llm')
    expect(host.updates).toContain('session-title-llm:false')
    expect(rows[0]?.options?.disabled).toBe(false)
  })

  it('does not restore the previous owner when another provider holds the slot', async () => {
    const exclusive = nativeExclusive()
    const host = loader([])
    const service = new CurrentTitleService({
      plugin: PLUGIN_NAME,
      ai: ai(),
      sessionTitle: exclusive,
      sessions: { get: () => undefined },
      loader: host,
    })
    await service.start()
    const slot = (service as unknown as { nativeSlot?: { owner(): string | undefined } }).nativeSlot
    if (slot) Object.defineProperty(slot, 'owner', { value: () => 'other-plugin' })
    await service.dispose()
    expect(host.updates).toEqual([])
  })

  it('regenerates through native refresh', async () => {
    const exclusive = nativeExclusive()
    const session = { id: 's1', snapshotEvents: () => [] }
    const service = new CurrentTitleService({
      plugin: PLUGIN_NAME,
      ai: ai(),
      sessionTitle: exclusive,
      sessions: { get: id => id === 's1' ? session : undefined },
      loader: loader([]),
    })
    await service.start()
    const snapshot = await service.regenerate('s1', new AbortController().signal)
    expect(snapshot?.title).toBe('0903 | 修复 | 登录')
    await service.dispose()
  })
})
