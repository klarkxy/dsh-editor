import { createElement, isValidElement, type ReactElement } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHAT_EVENTS_SLOT } from './contracts.ts'
import {
  apply, copy, inject, isCurrentMoodRequest, modeFromKey, MoodChatCard, MoodSettings, moodPanelKey,
  peekMoodStatus, shouldOfferRecovery, shouldShowCard, shouldSkipMoodRefresh,
} from './client.tsx'

const client = {
  connection: { rpc: { call: async () => ({ ok: true, value: { settings: { revision: 0, mode: 'auto' }, storageFailed: false } }) } },
  slots: { inject() { return () => {} }, register() { return () => {} } },
}

const clientSrc = readFileSync(fileURLToPath(new URL('./client.tsx', import.meta.url)), 'utf8')

function captureRenders() {
  const renders: Record<string, (props: unknown) => unknown> = {}
  const names: Array<{ name: string; id?: string; order?: number; label?: string }> = []
  apply({
    effect(fn: () => (() => void) | void) { fn() },
    slots: {
      inject(_key: string, callback: () => unknown) {
        callback()
        return () => {}
      },
      register(spec: { name: string; id?: string; order?: number; label?: string }, render: unknown) {
        names.push(spec)
        renders[spec.name] = render as (props: unknown) => unknown
        return () => {}
      },
    },
    connection: client.connection,
  } as never)
  return { renders, names }
}

function propsOf(node: unknown): Record<string, unknown> {
  if (!isValidElement(node)) throw new Error('expected a React element')
  return (node as ReactElement<Record<string, unknown>>).props
}

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>(next => { resolve = next })
  return { promise, resolve: () => resolve() }
}

describe('mood settings and card helpers', () => {
  it('uses the frozen chat seat and compact mode keys', () => {
    expect(CHAT_EVENTS_SLOT).toBe('dsh-editor.chat.events')
    expect(modeFromKey('auto', 'ArrowRight')).toBe('manual')
    expect(modeFromKey('manual', 'ArrowRight')).toBe('strict')
    expect(modeFromKey('strict', 'Home')).toBe('auto')
    expect(copy('zh').settings).toBe('需求澄清')
    expect(copy('zh').retry).toBe('按原请求重试')
    expect(copy('zh').sessionHint).toContain('会话')
  })

  it('hides the contract card when empty or hidden, and shows pending recovery', () => {
    expect(shouldShowCard(true, { id: '1' } as never, false)).toBe(false)
    expect(shouldShowCard(false, undefined, false)).toBe(false)
    expect(shouldShowCard(false, undefined, true)).toBe(true)
    expect(shouldShowCard(false, undefined, false, true)).toBe(true)
  })

  it('drops stale session-switch loads and offers recovery for pending holds', () => {
    expect(isCurrentMoodRequest({
      mounted: true, sessionId: 'a', viewSessionId: 'b', requestId: 1, latestRequestId: 1,
    })).toBe(false)
    expect(isCurrentMoodRequest({
      mounted: true, sessionId: 'a', viewSessionId: 'a', requestId: 1, latestRequestId: 2,
    })).toBe(false)
    expect(isCurrentMoodRequest({
      mounted: true, sessionId: 'a', viewSessionId: 'a', requestId: 2, latestRequestId: 2,
    })).toBe(true)
    expect(shouldOfferRecovery({
      settings: { revision: 0, mode: 'auto' },
      storageFailed: false,
      session: {
        sessionId: 'a',
        clarification: [{ id: 'q1', question: '范围？', status: 'pending' }],
        pendingManual: false,
        held: true,
        contract: { readiness: 'pending' } as never,
      },
    })).toBe(true)
  })
})

describe('native settings seat and contract refresh', () => {
  it('registers settings.section and the shared chat events seat', () => {
    const { names } = captureRenders()
    expect(names).toEqual([
      { name: 'settings.section', id: 'mood', order: 55, label: '需求澄清' },
      { name: CHAT_EVENTS_SLOT, id: 'mood', order: 10, label: '需求约定' },
    ])
  })

  it('forwards native close-only props into MoodSettings so the seat can resolve the session', () => {
    const { renders } = captureRenders()
    const close = () => {}
    const native = renders['settings.section']!({ close })
    expect(isValidElement(native)).toBe(true)
    expect(native.type).toBe(MoodSettings)
    expect(propsOf(native).props).toEqual({ close })
    const hosted = renders['settings.section']!({ sessionId: 'sess-9', locale: 'en' })
    expect(hosted.type).toBe(MoodSettings)
    expect(propsOf(hosted).props).toEqual({ sessionId: 'sess-9', locale: 'en' })
    expect(createElement(MoodSettings, { client, props: { owner: { sessionId: 'sess-9', locale: 'en' } } }).type).toBe(MoodSettings)
  })

  it('hides the chat card when owner.hidden and remounts the contract per session', () => {
    const { renders } = captureRenders()
    const wrapped = renders[CHAT_EVENTS_SLOT]!({ sessionId: 's1', owner: { hidden: true } })
    expect(isValidElement(wrapped)).toBe(true)
    expect(wrapped.type).toBe(MoodChatCard)
    expect(moodPanelKey('s1', 'zh')).not.toBe(moodPanelKey('s2', 'en'))
  })

  it('resolves native settings seats and peeks without clobbering edits or writes', () => {
    expect(inject).toEqual(['slots', 'connection', 'sessions', 'locale'])
    expect(clientSrc).toContain("from '@klarkxy/dsh-ai-services/client-utils'")
    expect(clientSrc).toContain('type Client = NativeSurfaceClient &')
    expect(clientSrc).toContain('useNativeSeat(client, props)')
    expect(clientSrc).toContain('useFeatureRefresh(')
    expect(clientSrc).toContain('void peekMoodStatus(')
    expect(clientSrc).toContain('surface="settings"')
    expect(clientSrc).toContain('if (seat.hidden || !seat.sessionId) return null')
    expect(clientSrc).not.toMatch(/beginMood|requestId\.current \+= 1[\s\S]{0,40}peekMoodStatus/)
    expect(shouldSkipMoodRefresh({ busy: true, editing: false })).toBe(true)
    expect(shouldSkipMoodRefresh({ busy: false, editing: true })).toBe(true)
    expect(shouldSkipMoodRefresh({ busy: false, editing: false })).toBe(false)
    expect(typeof peekMoodStatus).toBe('function')
  })

  it('peeks status without bumping request generation', async () => {
    const latest = { current: 3 }
    const peeked = await peekMoodStatus({
      call: async () => ({ ok: true, value: { settings: { revision: 0, mode: 'auto' }, storageFailed: false, session: { sessionId: 's1', clarification: [], pendingManual: false, held: false } } }),
      sessionId: 's1',
      requestId: 3,
      latestRequestId: () => latest.current,
      viewSessionId: () => 's1',
      mounted: () => true,
      busy: () => false,
      editing: () => false,
    })
    expect(peeked?.session?.sessionId).toBe('s1')
    expect(latest.current).toBe(3)
  })

  it('does not apply a peek once an action becomes busy or the goal is being edited', async () => {
    const hang = deferred()
    let busy = false
    const peeking = peekMoodStatus({
      call: async () => {
        await hang.promise
        return { ok: true, value: { settings: { revision: 0, mode: 'auto' }, storageFailed: false } }
      },
      sessionId: 's1',
      requestId: 1,
      latestRequestId: () => 1,
      viewSessionId: () => 's1',
      mounted: () => true,
      busy: () => busy,
      editing: () => false,
    })
    busy = true
    hang.resolve()
    expect(await peeking).toBeUndefined()
  })
})
