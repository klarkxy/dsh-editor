import { createElement, isValidElement, type ReactElement } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHAT_EVENTS_SLOT, projectIdFromCwd, sessionCwd } from './contracts.ts'
import {
  apply, beginMemoryRequest, candidateAvailabilityLabel, canAccept, canReject, canRevoke,
  chatSummaryTitle, disposeMemoryRequest, dreamStatusLabel, inject, loadMemoryStatus, MemoryChatShell, MemorySettings,
  memoryPanelKey, parseSeatProps, peekMemoryStatus, shouldSkipMemoryRefresh,
} from './client.tsx'

const client = {
  connection: { rpc: { call: async () => ({ ok: true, value: { settings: { revision: 0, injectEnabled: true, dreamIdleEnabled: false, idleMs: 15 * 60_000 }, records: [], dreams: [], storageFailed: false, aiAvailable: false } }) } },
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

describe('frozen seat and project identity', () => {
  it('keeps the shared chat-events seat id', () => {
    expect(CHAT_EVENTS_SLOT).toBe('dsh-editor.chat.events')
  })

  it('normalizes session.meta.cwd exactly without inventing a global id', () => {
    expect(projectIdFromCwd(undefined)).toBeUndefined()
    expect(projectIdFromCwd('  ')).toBeUndefined()
    expect(projectIdFromCwd('D:\\work\\Novel\\')).toBe('D:/work/Novel')
    expect(projectIdFromCwd('/work/novel/')).toBe('/work/novel')
    expect(projectIdFromCwd('/')).toBe('/')
    const long = `/${'p'.repeat(300)}/novel`
    expect(projectIdFromCwd(long)).toBe(long)
    expect(sessionCwd({ meta: { cwd: '/from-meta' }, header: { cwd: '/from-header' } })).toBe('/from-meta')
    expect(sessionCwd({ header: { cwd: '/from-header' } })).toBe('/from-header')
  })

  it('reads settings seat props from owner or top-level fields', () => {
    expect(parseSeatProps({ sessionId: 's1', locale: 'en', hidden: true })).toEqual({ sessionId: 's1', locale: 'en', hidden: true })
    expect(parseSeatProps({ owner: { sessionId: 's2', locale: 'zh' } })).toEqual({ sessionId: 's2', locale: 'zh', hidden: false })
    expect(parseSeatProps({ owner: { sessionId: 's2', hidden: true } })).toEqual({ sessionId: 's2', locale: 'zh', hidden: true })
  })

  it('gates accept/reject/revoke by status', () => {
    const candidate = { status: 'candidate' as const }
    const active = { status: 'active' as const }
    expect(canAccept(candidate as never)).toBe(true)
    expect(canReject(candidate as never)).toBe(true)
    expect(canRevoke(candidate as never)).toBe(false)
    expect(canAccept(active as never)).toBe(false)
    expect(canRevoke(active as never)).toBe(true)
  })

  it('labels dream history read-only without pending states', () => {
    const base = {
      id: 'd', revision: 1, sessionId: 's1', status: 'applied' as const, sourceVersion: 'v',
      snapshot: [], proposals: [], generation: 0, createdAt: 1, updatedAt: 1,
    }
    const proposal = {
      title: '合并语气', content: '更克制', kind: 'preference' as const, tags: [], exceptions: [],
      evidence: [], sourceIds: ['id-1'], scope: { kind: 'global' as const },
    }
    expect(dreamStatusLabel(base, 'zh')).toBe('已应用')
    expect(dreamStatusLabel({ ...base, status: 'noop' }, 'zh')).toBe('无变化')
    expect(dreamStatusLabel({ ...base, status: 'failed' }, 'zh')).toBe('失败')
    expect(dreamStatusLabel({ ...base, status: 'stale' }, 'zh')).toBe('失败')
    expect(dreamStatusLabel({ ...base, status: 'cancelled' }, 'zh')).toBe('已取消')
    expect(dreamStatusLabel({ ...base, status: 'preview' }, 'zh')).toBe('无变化')
    expect(dreamStatusLabel({ ...base, status: 'preview', proposals: [proposal] }, 'zh')).toBe('未应用')
    expect(dreamStatusLabel(base, 'en')).toBe('Applied')
    expect(dreamStatusLabel({ ...base, status: 'noop' }, 'en')).toBe('No change')
  })
})

describe('memory settings and host locale', () => {
  it('registers management in settings without exposing memory in chat', () => {
    const { names, renders } = captureRenders()
    expect(names).toEqual([
      { name: 'settings.section', id: 'memory', order: 65, label: '记忆' },
    ])
    expect(renders[CHAT_EVENTS_SLOT]).toBeUndefined()
  })

  it('passes host settings.section session and locale into the settings panel', () => {
    const { renders } = captureRenders()
    const wrapped = renders['settings.section']!({ sessionId: 'sess-9', locale: 'en' })
    expect(isValidElement(wrapped)).toBe(true)
    expect(wrapped.type).toBe(MemorySettings)
    expect(propsOf(wrapped).props).toEqual({ sessionId: 'sess-9', locale: 'en' })
    expect(createElement(MemorySettings, { client, props: { owner: { sessionId: 'sess-9', locale: 'en' } } }).type).toBe(MemorySettings)
    expect(createElement(MemorySettings, { client, props: { sessionId: 'sess-9', locale: 'en' } }).type).toBe(MemorySettings)
  })

  it('remounts settings management per session and locale', () => {
    expect(memoryPanelKey('s1', 'zh')).not.toBe(memoryPanelKey('s2', 'en'))
  })

  it('renders collapsed memory management in settings with candidate availability', () => {
    const tree = MemoryChatShell({
      locale: 'zh',
      candidateCount: 2,
      children: createElement('p', null, 'management'),
    })
    expect(tree.type).toBe('details')
    expect(tree.props.open).toBeUndefined()
    expect(tree.props['data-testid']).toBe('memory-chat')
    const [summary, body] = tree.props.children as [ReactElement, ReactElement]
    expect(summary.type).toBe('summary')
    const summaryChildren = summary.props.children as [ReactElement, ReactElement]
    expect(summaryChildren[0].props.children).toBe('记忆')
    expect(summaryChildren[1].props.children).toBe('2 条候选')
    expect(JSON.stringify(summary)).not.toContain('采纳')
    expect(JSON.stringify(body)).toContain('management')
    expect(chatSummaryTitle('zh')).toBe('记忆')
    expect(candidateAvailabilityLabel(0, 'zh')).toBe('暂无候选')
  })

  it('captures request lifetime before await and does not default-open memory management', () => {
    expect(clientSrc).toContain('beginMemoryRequest(gate.current, sessionId, workRef.current)')
    expect(clientSrc).toContain('disposeMemoryRequest(gate.current, workRef.current ?? request.controller)')
    expect(clientSrc).toContain('viewSessionId: () => sessionRef.current')
    expect(clientSrc).toContain('void loadMemoryStatus(')
    expect(clientSrc).toContain('<MemoryChatShell')
    expect(clientSrc).not.toMatch(/<details[^>]*\sopen[\s>]/)
    expect(typeof beginMemoryRequest).toBe('function')
    expect(typeof disposeMemoryRequest).toBe('function')
    expect(typeof loadMemoryStatus).toBe('function')
  })

  it('resolves native settings seats and refreshes without clobbering edits or writes', () => {
    expect(inject).toEqual(['slots', 'connection', 'sessions', 'locale', 'uiWorkspace', 'uiSession'])
    expect(clientSrc).toContain("from '@klarkxy/dsh-ai-services/client-utils'")
    expect(clientSrc).toContain('type Client = NativeSurfaceClient &')
    expect(clientSrc).toContain('useNativeSeat(client, props)')
    expect(clientSrc).toContain('useFeatureRefresh(')
    expect(clientSrc).toContain('peekMemoryStatus(')
    expect(clientSrc).toContain('<MemoryChatPanel key={`manage:${memoryPanelKey(seat.sessionId, seat.locale)}`}')
    expect(clientSrc).toContain('key={`settings:${memoryPanelKey(seat.sessionId, seat.locale)}`}')
    expect(clientSrc).toContain("get('dshSelfImprovementReview')")
    expect(clientSrc).toContain('data-testid="self-improvement-entry"')
    expect(clientSrc).not.toContain('空闲间隔')
    expect(clientSrc).toContain('void peekMemoryStatus(')
    expect(clientSrc).not.toMatch(/beginMemoryRequest\([^)]*\)[\s\S]{0,80}peekMemoryStatus/)
    expect(shouldSkipMemoryRefresh({ busy: true, editing: false })).toBe(true)
    expect(shouldSkipMemoryRefresh({ busy: false, editing: true })).toBe(true)
    expect(typeof peekMemoryStatus).toBe('function')
  })
})
