import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TITLE_CLIENT_SERVICE, type RpcResult, type TitleStatus } from './contracts.ts'
import { applyMarkerFromStatus, createTitleClientMarker, disposeTitleClientMarker } from './marker.ts'
import {
  createTitleClientWork, runTitleRegenerateFlow, runTitleSettingsSave, runTitleStatusLoad,
  settingsCopy, shouldSkipTitleRefresh,
} from './client-work.ts'

const clientSource = readFileSync(new URL('./client.tsx', import.meta.url), 'utf8')

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail })
  return { promise, resolve, reject }
}

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

function titleStatus(sessionId: string, title: string): TitleStatus {
  return {
    settings: { revision: 1, locale: 'zh' },
    support: { weOwn: true, nativeOwner: '@klarkxy/dsh-current-title' },
    session: { sessionId, title, generating: false, pinned: false },
  }
}

describe('current title UI', () => {
  it('injects native session and locale and keeps regenerate labels', () => {
    expect(clientSource).toContain("from '@klarkxy/dsh-ai-services/client-utils'")
    expect(clientSource).toContain('type Client = NativeSurfaceClient &')
    expect(clientSource).toContain("export const inject = ['slots', 'connection', 'sessions', 'locale'] as const")
    expect(clientSource).toContain('const seat = useNativeSeat(props.client, props.owner)')
    expect(clientSource).toContain('useFeatureRefresh(')
    expect(clientSource).toContain('(props: unknown) => <TitleSettings client={client} marker={marker} owner={props} />')
    expect(settingsCopy('zh').regenerate).toBe('重新生成')
    expect(settingsCopy('en').regenerate).toBe('Regenerate')
    expect(settingsCopy('zh').label).toBe('当前标题')
    expect(shouldSkipTitleRefresh({ busy: true })).toBe(true)
    expect(shouldSkipTitleRefresh({ busy: false })).toBe(false)
  })

  it('keeps an in-flight request current across a captured status refresh', () => {
    const work = createTitleClientWork()
    work.beginLoad()
    const token = work.beginRequest()
    const captured = work.captureLoad()
    expect(work.isRequest(token)).toBe(true)
    expect(work.isLoad(captured)).toBe(true)
  })

  it('activates the shell marker only after status proves ownership and clears it on dispose', () => {
    expect(TITLE_CLIENT_SERVICE).toBe('dshCurrentTitleClient')
    const marker = createTitleClientMarker()
    expect(marker.active).toBe(false)
    applyMarkerFromStatus(marker, { support: { weOwn: true, nativeOwner: '@klarkxy/dsh-current-title' } }, true)
    expect(marker.active).toBe(true)
    disposeTitleClientMarker(marker)
    expect(marker.active).toBe(false)
  })

  it('drops an earlier status load after a later session generation starts', async () => {
    const work = createTitleClientWork()
    const first = deferred<RpcResult<TitleStatus>>()
    const second = deferred<RpcResult<TitleStatus>>()
    const applied: string[] = []
    const errors: string[] = []
    const markers: Array<string | undefined> = []
    const load1 = work.beginLoad()
    const pending1 = runTitleStatusLoad({
      call: async () => first.promise,
      sessionId: 's1',
      isCurrent: () => work.isLoad(load1),
      failedMessage: 'failed',
      onStatus: status => { applied.push(status.session?.sessionId ?? '') },
      onError: message => { errors.push(message) },
      onMarker: status => { markers.push(status?.session?.sessionId) },
    })
    const load2 = work.beginLoad()
    const pending2 = runTitleStatusLoad({
      call: async () => second.promise,
      sessionId: 's2',
      isCurrent: () => work.isLoad(load2),
      failedMessage: 'failed',
      onStatus: status => { applied.push(status.session?.sessionId ?? '') },
      onError: message => { errors.push(message) },
      onMarker: status => { markers.push(status?.session?.sessionId) },
    })
    first.resolve(ok(titleStatus('s1', '旧会话')))
    await pending1
    expect(applied).toEqual([])
    expect(errors).toEqual([])
    expect(markers).toEqual([])
    second.resolve(ok(titleStatus('s2', '新会话')))
    await pending2
    expect(applied).toEqual(['s2'])
    expect(markers).toEqual(['s2'])
  })

  it('does not issue a status follow-up after regenerate if the work was disposed', async () => {
    const work = createTitleClientWork()
    work.beginLoad()
    const token = work.beginRequest()
    const regen = deferred<RpcResult<null>>()
    const endpoints: string[] = []
    const applied: string[] = []
    const busy: boolean[] = []
    const errors: string[] = []
    const pending = runTitleRegenerateFlow({
      call: async (endpoint, payload) => {
        endpoints.push(endpoint)
        if (endpoint === 'regenerate') {
          expect(payload).toEqual({ sessionId: 's1' })
          return regen.promise
        }
        throw new Error(`unexpected ${endpoint}`)
      },
      sessionId: 's1',
      isCurrent: () => work.isRequest(token),
      failedMessage: 'failed',
      onBusy: value => { busy.push(value) },
      onStatus: status => { applied.push(status.session?.sessionId ?? '') },
      onError: message => { errors.push(message) },
      onMarker: () => { applied.push('marker') },
    })
    work.dispose()
    regen.resolve(ok(null))
    await pending
    expect(endpoints).toEqual(['regenerate'])
    expect(applied).toEqual([])
    expect(errors).toEqual([])
    expect(busy).toEqual([true])
  })

  it('ignores a late regenerate after the session load generation advances', async () => {
    const work = createTitleClientWork()
    work.beginLoad()
    const token = work.beginRequest()
    const regen = deferred<RpcResult<null>>()
    const statusCall = deferred<RpcResult<TitleStatus>>()
    const endpoints: string[] = []
    const applied: string[] = []
    const busy: boolean[] = []
    const errors: string[] = []
    const pending = runTitleRegenerateFlow({
      call: async (endpoint) => {
        endpoints.push(endpoint)
        if (endpoint === 'regenerate') return regen.promise
        return statusCall.promise
      },
      sessionId: 's1',
      isCurrent: () => work.isRequest(token),
      failedMessage: 'failed',
      onBusy: value => { busy.push(value) },
      onStatus: status => { applied.push(status.session?.title ?? '') },
      onError: message => { errors.push(message) },
      onMarker: () => { applied.push('marker') },
    })
    work.beginLoad()
    regen.resolve(ok(null))
    await pending
    expect(endpoints).toEqual(['regenerate'])
    expect(statusCall.promise).toBeInstanceOf(Promise)
    expect(applied).toEqual([])
    expect(errors).toEqual([])
    expect(busy).toEqual([true])
  })

  it('does not let a stale regenerate error or busy reset clobber a newer request', async () => {
    const work = createTitleClientWork()
    work.beginLoad()
    const firstToken = work.beginRequest()
    const firstRegen = deferred<RpcResult<null>>()
    const secondRegen = deferred<RpcResult<null>>()
    const secondStatus = deferred<RpcResult<TitleStatus>>()
    const busy: boolean[] = []
    const errors: string[] = []
    const applied: string[] = []
    const first = runTitleRegenerateFlow({
      call: async (endpoint) => {
        if (endpoint === 'regenerate') return firstRegen.promise
        throw new Error('stale status')
      },
      sessionId: 's1',
      isCurrent: () => work.isRequest(firstToken),
      failedMessage: 'failed',
      onBusy: value => { busy.push(value) },
      onStatus: () => { applied.push('stale') },
      onError: message => { errors.push(message) },
      onMarker: () => { applied.push('stale-marker') },
    })
    const secondToken = work.beginRequest()
    const second = runTitleRegenerateFlow({
      call: async (endpoint) => {
        if (endpoint === 'regenerate') return secondRegen.promise
        return secondStatus.promise
      },
      sessionId: 's2',
      isCurrent: () => work.isRequest(secondToken),
      failedMessage: 'failed',
      onBusy: value => { busy.push(value) },
      onStatus: status => { applied.push(status.session?.sessionId ?? '') },
      onError: message => { errors.push(`new:${message}`) },
      onMarker: status => { applied.push(status?.session?.sessionId ?? 'marker') },
    })
    firstRegen.reject(new Error('旧会话失败'))
    await first
    expect(errors).toEqual([])
    expect(applied).toEqual([])
    expect(busy).toEqual([true, true])
    secondRegen.resolve(ok(null))
    secondStatus.resolve(ok(titleStatus('s2', '新会话')))
    await second
    expect(applied).toEqual(['s2', 's2'])
    expect(errors).toEqual([])
    expect(busy.at(-1)).toBe(false)
  })

  it('does not apply a stale settings save after a newer request', async () => {
    const work = createTitleClientWork()
    work.beginLoad()
    const firstToken = work.beginRequest()
    const firstSave = deferred<RpcResult<TitleStatus['settings']>>()
    const notes: string[] = []
    const errors: string[] = []
    const locales: string[] = []
    const busy: boolean[] = []
    const pending = runTitleSettingsSave({
      call: async () => firstSave.promise,
      locale: 'en',
      expectedRevision: 0,
      isCurrent: () => work.isRequest(firstToken),
      savedMessage: '已保存。',
      failedMessage: 'failed',
      onBusy: value => { busy.push(value) },
      onSettings: settings => { locales.push(settings.locale) },
      onNote: note => { notes.push(note) },
      onError: message => { errors.push(message) },
    })
    work.beginRequest()
    firstSave.resolve(ok({ revision: 1, locale: 'en' }))
    await pending
    expect(locales).toEqual([])
    expect(notes).toEqual([])
    expect(errors).toEqual([])
    expect(busy).toEqual([true])
  })
})
