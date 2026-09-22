import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHAT_EVENTS_SLOT } from '@klarkxy/dsh-ai-services/contracts'
import {
  apply, createRecapClientWork, inject, recapCardKey, recapHasRunningGeneration, recapSeatProps,
  runRecapAct, runRecapIdleReturn, runRecapStatusLoad,
} from './client.tsx'
import { isCurrentRecapRequest, shouldRequestIdleReturn, shouldSkipRecapAutoRefresh } from './idle.ts'
import { defaultSettings, type RecapStatus, type RpcResult } from './contracts.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail })
  return { promise, resolve, reject }
}

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

function statusFor(sessionId: string, title = '回顾'): RecapStatus {
  return {
    settings: defaultSettings(),
    storageFailed: false,
    checkpoints: [],
    cards: [{
      id: `${sessionId}-card`,
      sessionId,
      sourceVersion: `${sessionId}#1`,
      fromSeq: 0,
      toSeq: 1,
      trigger: 'manual',
      sourceStatus: 'completed',
      title,
      body: title,
      kind: 'generated',
      generation: 'idle',
      createdAt: 1,
      updatedAt: 1,
    }],
  }
}

describe('recap client seats', () => {
  it('registers settings and a quiet background chat controller', () => {
    expect([...inject]).toEqual(['slots', 'connection', 'sessions', 'locale'])
    const injected: string[] = []
    const names: Array<{ name: string; id?: string; label?: string }> = []
    apply({
      effect(fn: () => (() => void) | void) { fn() },
      slots: {
        inject(key: string, callback: () => unknown) {
          injected.push(key)
          callback()
          return () => {}
        },
        register(spec: { name: string; id?: string; label?: string }, _render: unknown) {
          names.push(spec)
          return () => {}
        },
      },
      connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    } as never)
    expect(injected).toEqual(['settings.section', CHAT_EVENTS_SLOT])
    expect(CHAT_EVENTS_SLOT).toBe('dsh-editor.chat.events')
    expect(names).toEqual([
      { name: 'settings.section', id: 'recap', order: 80, label: '回顾' },
      { name: CHAT_EVENTS_SLOT, id: 'recap', order: 40, label: '回顾' },
    ])
    expect(readFileSync(fileURLToPath(new URL('./client.tsx', import.meta.url)), 'utf8')).toContain('hidden={seat.hidden} quiet')
  })

  it('reads sessionId, locale, and hidden from the chat events seat, including owner props', () => {
    expect(recapSeatProps({ sessionId: 's1', locale: 'zh', hidden: true })).toEqual({ sessionId: 's1', locale: 'zh', hidden: true })
    expect(recapSeatProps({ owner: { sessionId: 's2', locale: 'en' } })).toEqual({ sessionId: 's2', locale: 'en', hidden: false })
    expect(recapSeatProps({ locale: 'zh' })).toBeUndefined()
    expect(recapCardKey({ sessionId: 's1', locale: 'zh' })).toBe('s1:zh')
    expect(recapCardKey({ sessionId: 's2' })).toBe('s2:')
  })

  it('ignores stale recap results after a session switch', () => {
    expect(isCurrentRecapRequest({
      mounted: true, sessionId: 'old', viewSessionId: 'new', requestId: 1, latestRequestId: 1,
    })).toBe(false)
    expect(shouldRequestIdleReturn({
      now: 20 * 60_000, lastUserActivityAt: 0, idleReturnMs: 15 * 60_000, cardsEnabled: true, visible: true,
      assistantStreaming: true,
    })).toBe(false)
    expect(shouldRequestIdleReturn({
      now: 20 * 60_000, lastUserActivityAt: 0, idleReturnMs: 15 * 60_000, cardsEnabled: true, visible: true,
      hidden: true,
    })).toBe(false)
  })

  it('drops an earlier status load after a later session generation starts', async () => {
    const work = createRecapClientWork()
    const first = deferred<RpcResult<RecapStatus>>()
    const second = deferred<RpcResult<RecapStatus>>()
    const applied: string[] = []
    const errors: string[] = []
    const load1 = work.beginLoad()
    const pending1 = runRecapStatusLoad({
      rpc: { call: async () => first.promise },
      sessionId: 's1',
      isCurrent: () => work.isLoad(load1),
      failedMessage: 'failed',
      onStatus: status => { applied.push(status.cards[0]?.sessionId ?? '') },
      onError: message => { errors.push(message) },
    })
    const load2 = work.beginLoad()
    const pending2 = runRecapStatusLoad({
      rpc: { call: async () => second.promise },
      sessionId: 's2',
      isCurrent: () => work.isLoad(load2),
      failedMessage: 'failed',
      onStatus: status => { applied.push(status.cards[0]?.sessionId ?? '') },
      onError: message => { errors.push(message) },
    })
    first.resolve(ok(statusFor('s1', '旧会话')))
    await pending1
    expect(applied).toEqual([])
    expect(errors).toEqual([])
    second.resolve(ok(statusFor('s2', '新会话')))
    await pending2
    expect(applied).toEqual(['s2'])
  })

  it('does not let a stale act error or busy reset clobber a newer session request', async () => {
    const work = createRecapClientWork()
    work.beginLoad()
    const firstToken = work.beginRequest()
    const firstAct = deferred<RpcResult<null>>()
    const secondAct = deferred<RpcResult<null>>()
    const secondStatus = deferred<RpcResult<RecapStatus>>()
    const busy: boolean[] = []
    const errors: string[] = []
    const applied: string[] = []
    const first = runRecapAct({
      rpc: { call: async () => firstAct.promise },
      sessionId: 's1',
      endpoint: 'refresh',
      isCurrent: () => work.isRequest(firstToken),
      failedMessage: 'failed',
      onBusy: value => { busy.push(value) },
      onStatus: () => { applied.push('stale') },
      onError: message => { errors.push(message) },
    })
    const secondToken = work.beginRequest()
    const second = runRecapAct({
      rpc: {
        call: async (channel, endpoint) => {
          expect(channel).toBe('/dsh-recap')
          if (endpoint === 'refresh') return secondAct.promise
          return secondStatus.promise
        },
      },
      sessionId: 's2',
      endpoint: 'refresh',
      isCurrent: () => work.isRequest(secondToken),
      failedMessage: 'failed',
      onBusy: value => { busy.push(value) },
      onStatus: status => { applied.push(status.cards[0]?.sessionId ?? '') },
      onError: message => { errors.push(`new:${message}`) },
    })
    firstAct.reject(new Error('旧会话失败'))
    await first
    expect(errors).toEqual([])
    expect(applied).toEqual([])
    expect(busy).toEqual([true, true])
    secondAct.resolve(ok(null))
    secondStatus.resolve(ok(statusFor('s2')))
    await second
    expect(applied).toEqual(['s2'])
    expect(errors).toEqual([])
    expect(busy.at(-1)).toBe(false)
  })

  it('ignores a late idle failure after dispose or a newer generation', async () => {
    const work = createRecapClientWork()
    work.beginLoad()
    const token = work.beginRequest()
    const idle = deferred<RpcResult<null>>()
    const errors: string[] = []
    const applied: string[] = []
    const pending = runRecapIdleReturn({
      rpc: { call: async () => idle.promise },
      sessionId: 's1',
      isCurrent: () => work.isRequest(token),
      failedMessage: 'idle failed',
      onStatus: () => { applied.push('stale') },
      onError: message => { errors.push(message) },
      onActivity: () => { applied.push('activity') },
    })
    work.dispose()
    idle.reject(new Error('closed'))
    await pending
    expect(applied).toEqual([])
    expect(errors).toEqual([])
  })

  it('skips auto refresh while a local action is busy and drops a quiet load after a newer request', async () => {
    expect(shouldSkipRecapAutoRefresh({ busy: true })).toBe(true)
    expect(shouldSkipRecapAutoRefresh({ busy: false, editing: true })).toBe(true)
    expect(shouldSkipRecapAutoRefresh({ busy: false, disposed: true })).toBe(true)
    expect(shouldSkipRecapAutoRefresh({ busy: false })).toBe(false)
    expect(recapHasRunningGeneration([{ ...statusFor('s1').cards[0]!, generation: 'running' }])).toBe(true)
    expect(recapHasRunningGeneration(statusFor('s1').cards)).toBe(false)

    const work = createRecapClientWork()
    work.beginLoad()
    const token = work.snapshot()
    expect(work.isRequest(token)).toBe(true)
    const delayed = deferred<RpcResult<RecapStatus>>()
    const applied: string[] = []
    const errors: string[] = []
    const pending = runRecapStatusLoad({
      rpc: { call: async () => delayed.promise },
      sessionId: 's1',
      isCurrent: () => work.isRequest(token),
      failedMessage: 'failed',
      onStatus: status => { applied.push(status.cards[0]?.sessionId ?? '') },
      onError: message => { errors.push(message) },
    })
    work.beginRequest()
    expect(work.isRequest(token)).toBe(false)
    delayed.resolve(ok(statusFor('s1')))
    await pending
    expect(applied).toEqual([])
    expect(errors).toEqual([])
  })
})
