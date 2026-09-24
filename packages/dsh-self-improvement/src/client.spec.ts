import { createElement, isValidElement, type ReactElement } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MEMORY_UNAVAILABLE_MESSAGE, SELF_IMPROVEMENT_REVIEW_SERVICE } from './contracts.ts'
import {
  apply, beginReviewRequest, disposeReviewRequest, exportSkillIfCurrent, inject, loadReviewSnapshot,
  memoryUnavailableCopy, parseSeatProps, peekReviewSnapshot, ReviewPanel, reviewPanelKey, SelfImprovementSettings,
  shouldSkipReviewRefresh, unwrap,
} from './client.tsx'
import { exportRevocationCopy } from './skills.ts'

const client = {
  connection: { rpc: { call: async () => ({ ok: true, value: { memoryAvailable: true, generation: 0, storageFailed: false, lessons: [], skills: [] } }) } },
  slots: { inject() { return () => {} }, register() { return () => {} } },
}

const clientSrc = readFileSync(fileURLToPath(new URL('./client.tsx', import.meta.url)), 'utf8')

function captureReview() {
  const provided: Record<string, { render(props: unknown): unknown }> = {}
  apply({
    effect(fn: () => (() => void) | void) { fn() },
    provide(name: string, value: { render(props: unknown): unknown }) { provided[name] = value },
    slots: {
      inject(_key: string, callback: () => unknown) {
        callback()
        return () => {}
      },
      register() { return () => {} },
    },
    connection: client.connection,
  } as never)
  return provided
}

function propsOf(node: unknown): Record<string, unknown> {
  if (!isValidElement(node)) throw new Error('expected a React element')
  return (node as ReactElement<Record<string, unknown>>).props
}

describe('self-improvement client seats', () => {
  it('provides the review panel for Memory without a settings nav row or chat seat', () => {
    const provided = captureReview()
    const review = provided[SELF_IMPROVEMENT_REVIEW_SERVICE]
    expect(review).toBeDefined()
    expect(clientSrc).not.toContain('settings.section')
    expect(clientSrc).not.toContain('dsh-editor.chat.events')
    const wrapped = review!.render({ sessionId: 'sess-9', locale: 'en' })
    expect(isValidElement(wrapped)).toBe(true)
    expect(wrapped.type).toBe(SelfImprovementSettings)
    expect(propsOf(wrapped).props).toEqual({ sessionId: 'sess-9', locale: 'en' })
  })

  it('passes host session and locale into the full review panel', () => {
    expect(createElement(SelfImprovementSettings, { client, props: { owner: { sessionId: 'sess-9', locale: 'en' } } }).type).toBe(SelfImprovementSettings)
    expect(createElement(SelfImprovementSettings, { client, props: { close() {} } }).type).toBe(SelfImprovementSettings)
    expect(reviewPanelKey('sess-9', 'en')).toBe('sess-9:en')
  })

  it('remounts review state per session and locale', () => {
    expect(reviewPanelKey('s1', 'zh')).not.toBe(reviewPanelKey('s2', 'en'))
  })

  it('reads seat props including owner.hidden', () => {
    expect(parseSeatProps({ sessionId: 's1', locale: 'en' })).toEqual({ sessionId: 's1', locale: 'en', hidden: false })
    expect(parseSeatProps({ owner: { sessionId: 's2', hidden: true } })).toEqual({ sessionId: 's2', locale: 'zh', hidden: true })
  })

  it('keeps Memory-unavailable copy actionable and does not claim downloaded files are recalled', () => {
    expect(memoryUnavailableCopy('zh')).toBe(MEMORY_UNAVAILABLE_MESSAGE)
    expect(memoryUnavailableCopy('en')).toMatch(/Enable the Memory plugin separately/)
    expect(exportRevocationCopy('zh')).toContain('不会收回')
    expect(unwrap({ ok: true, value: 1 })).toBe(1)
    expect(() => unwrap({ ok: false, error: { code: 'X', message: 'no' } })).toThrow('no')
  })

  it('ReviewPanel captures request lifetime before await and applies load/export only when current', () => {
    expect(clientSrc).toContain('beginReviewRequest(gate.current, sessionId, workRef.current)')
    expect(clientSrc).toContain('disposeReviewRequest(gate.current, workRef.current ?? request.controller)')
    expect(clientSrc).toContain('viewSessionId: () => sessionRef.current')
    expect(clientSrc).toContain('void loadReviewSnapshot(')
    expect(clientSrc).toContain('await exportSkillIfCurrent(')
    expect(clientSrc).toContain('key={reviewPanelKey(seat.sessionId, seat.locale)}')
    const loadEffect = clientSrc.slice(clientSrc.indexOf('useEffect(() => {'), clientSrc.indexOf('async function action'))
    expect(loadEffect).toContain('beginReviewRequest')
    expect(loadEffect).toContain('loadReviewSnapshot')
    expect(loadEffect).not.toContain("'accept'")
    const source = ReviewPanel.toString()
    expect(source).toContain('beginReviewRequest')
    expect(source).toContain('loadReviewSnapshot')
    expect(source).toContain('exportSkillIfCurrent')
    expect(source).toContain('disposeReviewRequest')
    expect(typeof beginReviewRequest).toBe('function')
    expect(typeof disposeReviewRequest).toBe('function')
    expect(typeof loadReviewSnapshot).toBe('function')
    expect(typeof exportSkillIfCurrent).toBe('function')
  })

  it('resolves native settings seats and peeks without aborting an in-progress review action', () => {
    expect(inject).toEqual(['slots', 'connection', 'sessions', 'locale', 'uiWorkspace', 'uiSession'])
    expect(clientSrc).toContain("from '@klarkxy/dsh-ai-services/client-utils'")
    expect(clientSrc).toContain('type Client = NativeSurfaceClient &')
    expect(clientSrc).toContain('useNativeSeat(client, props)')
    expect(clientSrc).toContain('useFeatureRefresh(')
    expect(clientSrc).toContain('void peekReviewSnapshot(')
    expect(clientSrc).toContain('useNativeSeat(client, props)')
    expect(clientSrc).not.toMatch(/beginReviewRequest\([^)]*\)[\s\S]{0,80}peekReviewSnapshot/)
    expect(shouldSkipReviewRefresh({ busy: true, editing: false })).toBe(true)
    expect(shouldSkipReviewRefresh({ busy: false, editing: true })).toBe(true)
    expect(typeof peekReviewSnapshot).toBe('function')
  })
})
