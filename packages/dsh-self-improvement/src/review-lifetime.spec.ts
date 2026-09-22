import { describe, expect, it } from 'vitest'
import {
  beginReviewRequest, createReviewGeneration, disposeReviewRequest, exportSkillIfCurrent,
  loadReviewSnapshot, peekReviewSnapshot, reviewRequestStillCurrent, shouldSkipReviewRefresh,
} from './review-lifetime.ts'
import type { ReviewSnapshot, SkillRecord } from './contracts.ts'

const snapshot = (sessionId: string): ReviewSnapshot => ({
  memoryAvailable: true, projectId: `/${sessionId}`, generation: 1, storageFailed: false, lessons: [], skills: [],
})

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>(next => { resolve = next })
  return { promise, resolve: () => resolve() }
}

describe('review request lifetime', () => {
  it('drops a late status after unmount dispose, matching ReviewPanel cleanup', async () => {
    const gate = createReviewGeneration()
    const sessionRef = { current: 's1' }
    const request = beginReviewRequest(gate, sessionRef.current)
    let applied: ReviewSnapshot | undefined
    const hang = deferred()
    const loading = loadReviewSnapshot({
      rpc: async () => {
        await hang.promise
        return { ok: true, value: snapshot('s1') }
      },
      sessionId: request.sessionId,
      token: request.token,
      gate,
      signal: request.signal,
      viewSessionId: () => sessionRef.current,
    }).then(next => {
      if (next === undefined) return
      applied = next
    })
    disposeReviewRequest(gate, request.controller)
    hang.resolve()
    await loading
    expect(applied).toBeUndefined()
    expect(reviewRequestStillCurrent({
      token: request.token, gate, signal: request.signal, sessionId: request.sessionId, viewSessionId: sessionRef.current,
    })).toBe(false)
  })

  it('drops a late status after generation bump from a later request', async () => {
    const gate = createReviewGeneration()
    const sessionRef = { current: 's1' }
    const first = beginReviewRequest(gate, sessionRef.current)
    const hang = deferred()
    let applied: string | undefined
    const loading = loadReviewSnapshot({
      rpc: async () => {
        await hang.promise
        return { ok: true, value: snapshot('s1') }
      },
      sessionId: first.sessionId,
      token: first.token,
      gate,
      signal: first.signal,
      viewSessionId: () => sessionRef.current,
    }).then(next => {
      if (next) applied = next.projectId
    })
    const second = beginReviewRequest(gate, sessionRef.current, first.controller)
    hang.resolve()
    await loading
    expect(applied).toBeUndefined()
    const current = await loadReviewSnapshot({
      rpc: async () => ({ ok: true, value: snapshot('s1') }),
      sessionId: second.sessionId,
      token: second.token,
      gate,
      signal: second.signal,
      viewSessionId: () => sessionRef.current,
    })
    expect(current?.projectId).toBe('/s1')
  })

  it('drops a late status after the live session changes', async () => {
    const gate = createReviewGeneration()
    const sessionRef = { current: 'old' }
    const request = beginReviewRequest(gate, sessionRef.current)
    const hang = deferred()
    const loading = loadReviewSnapshot({
      rpc: async () => {
        await hang.promise
        return { ok: true, value: snapshot('old') }
      },
      sessionId: request.sessionId,
      token: request.token,
      gate,
      signal: request.signal,
      viewSessionId: () => sessionRef.current,
    })
    sessionRef.current = 'new'
    hang.resolve()
    expect(await loading).toBeUndefined()
  })

  it('does not download after navigation even if export RPC already returned', async () => {
    const gate = createReviewGeneration()
    const sessionRef = { current: 's1' }
    const request = beginReviewRequest(gate, sessionRef.current)
    const downloads: string[] = []
    const hang = deferred()
    const work = exportSkillIfCurrent({
      rpc: async endpoint => {
        if (endpoint === 'skill.export') {
          await hang.promise
          return {
            ok: true,
            value: {
              filename: 'stale.md', markdown: '# stale',
              skill: { id: 'sk', revision: 1 } as SkillRecord,
            },
          }
        }
        throw new Error(endpoint)
      },
      sessionId: request.sessionId,
      token: request.token,
      gate,
      signal: request.signal,
      viewSessionId: () => sessionRef.current,
      record: { id: 'sk', revision: 1 },
      download: filename => { downloads.push(filename); return true },
    })
    sessionRef.current = 's2'
    hang.resolve()
    expect(await work).toBe('stale')
    expect(downloads).toEqual([])
  })

  it('does not download after unmount dispose even if export RPC already returned', async () => {
    const gate = createReviewGeneration()
    const sessionRef = { current: 's1' }
    const request = beginReviewRequest(gate, sessionRef.current)
    const downloads: string[] = []
    const hang = deferred()
    const work = exportSkillIfCurrent({
      rpc: async endpoint => {
        if (endpoint === 'skill.export') {
          await hang.promise
          return {
            ok: true,
            value: {
              filename: 'stale.md', markdown: '# stale',
              skill: { id: 'sk', revision: 1 } as SkillRecord,
            },
          }
        }
        throw new Error(endpoint)
      },
      sessionId: request.sessionId,
      token: request.token,
      gate,
      signal: request.signal,
      viewSessionId: () => sessionRef.current,
      record: { id: 'sk', revision: 1 },
      download: filename => { downloads.push(filename); return true },
    })
    disposeReviewRequest(gate, request.controller)
    hang.resolve()
    expect(await work).toBe('stale')
    expect(downloads).toEqual([])
  })

  it('records export only after a current download invocation', async () => {
    const gate = createReviewGeneration()
    const sessionRef = { current: 's1' }
    const request = beginReviewRequest(gate, sessionRef.current)
    const calls: string[] = []
    const result = await exportSkillIfCurrent({
      rpc: async endpoint => {
        calls.push(endpoint)
        if (endpoint === 'skill.export') {
          return {
            ok: true,
            value: { filename: 'ok.md', markdown: '# ok', skill: { id: 'sk', revision: 2 } as SkillRecord },
          }
        }
        if (endpoint === 'skill.exported') return { ok: true, value: { id: 'sk', exportState: 'recorded' } }
        throw new Error(endpoint)
      },
      sessionId: request.sessionId,
      token: request.token,
      gate,
      signal: request.signal,
      viewSessionId: () => sessionRef.current,
      record: { id: 'sk', revision: 1 },
      download: () => true,
    })
    expect(result).toBe('recorded')
    expect(calls).toEqual(['skill.export', 'skill.exported'])
  })

  it('skips refresh while busy or editing', () => {
    expect(shouldSkipReviewRefresh({ busy: true, editing: false })).toBe(true)
    expect(shouldSkipReviewRefresh({ busy: false, editing: true })).toBe(true)
    expect(shouldSkipReviewRefresh({ busy: false, editing: false })).toBe(false)
  })

  it('peeks status without aborting an in-flight write signal', async () => {
    const gate = createReviewGeneration()
    const sessionRef = { current: 's1' }
    const write = beginReviewRequest(gate, sessionRef.current)
    let writeSignalAborted = false
    const hang = deferred()
    const writing = loadReviewSnapshot({
      rpc: async (_endpoint, _payload, signal) => {
        await hang.promise
        writeSignalAborted = signal?.aborted === true
        return { ok: true, value: snapshot('s1') }
      },
      sessionId: write.sessionId,
      token: write.token,
      gate,
      signal: write.signal,
      viewSessionId: () => sessionRef.current,
    })
    const peeked = await peekReviewSnapshot({
      rpc: async () => ({ ok: true, value: snapshot('s1') }),
      sessionId: write.sessionId,
      token: write.token,
      gate,
      viewSessionId: () => sessionRef.current,
      busy: () => false,
      editing: () => false,
    })
    expect(peeked?.projectId).toBe('/s1')
    expect(write.signal.aborted).toBe(false)
    hang.resolve()
    await writing
    expect(writeSignalAborted).toBe(false)
    expect(write.signal.aborted).toBe(false)
  })

  it('does not apply a peek once an action becomes busy', async () => {
    const gate = createReviewGeneration()
    const request = beginReviewRequest(gate, 's1')
    const hang = deferred()
    let busy = false
    const peeking = peekReviewSnapshot({
      rpc: async () => {
        await hang.promise
        return { ok: true, value: snapshot('s1') }
      },
      sessionId: request.sessionId,
      token: request.token,
      gate,
      viewSessionId: () => 's1',
      busy: () => busy,
      editing: () => false,
    })
    busy = true
    hang.resolve()
    expect(await peeking).toBeUndefined()
  })
})
