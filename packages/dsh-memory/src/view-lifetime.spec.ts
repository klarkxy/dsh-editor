import { describe, expect, it } from 'vitest'
import {
  beginMemoryRequest, createMemoryGeneration, disposeMemoryRequest, loadMemoryStatus, memoryRequestStillCurrent,
  peekMemoryStatus, shouldSkipMemoryRefresh,
} from './view-lifetime.ts'
import { defaultSettings, type MemoryStatus } from './contracts.ts'

const status = (sessionId: string): MemoryStatus => ({
  settings: defaultSettings(),
  records: [{
    id: sessionId, revision: 1, scope: { kind: 'project', projectId: `/${sessionId}` }, kind: 'preference',
    status: 'active', title: sessionId, content: 'x', tags: [], evidence: [], exceptions: [], source: 'user',
    createdAt: 1, updatedAt: 1,
  }],
  dreams: [],
  projectId: `/${sessionId}`,
  storageFailed: false,
  aiAvailable: false,
})

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>(next => { resolve = next })
  return { promise, resolve: () => resolve() }
}

describe('memory view request lifetime', () => {
  it('drops a late status after unmount dispose', async () => {
    const gate = createMemoryGeneration()
    const sessionRef = { current: 's1' }
    const request = beginMemoryRequest(gate, sessionRef.current)
    let applied: MemoryStatus | undefined
    const hang = deferred()
    const loading = loadMemoryStatus({
      rpc: async () => {
        await hang.promise
        return { ok: true, value: status('s1') }
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
    disposeMemoryRequest(gate, request.controller)
    hang.resolve()
    await loading
    expect(applied).toBeUndefined()
    expect(memoryRequestStillCurrent({
      token: request.token, gate, signal: request.signal, sessionId: request.sessionId, viewSessionId: sessionRef.current,
    })).toBe(false)
  })

  it('drops a late status after the live session changes', async () => {
    const gate = createMemoryGeneration()
    const sessionRef = { current: 'old' }
    const request = beginMemoryRequest(gate, sessionRef.current)
    const hang = deferred()
    const loading = loadMemoryStatus({
      rpc: async () => {
        await hang.promise
        return { ok: true, value: status('old') }
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

  it('applies the later request after a generation bump', async () => {
    const gate = createMemoryGeneration()
    const sessionRef = { current: 's1' }
    const first = beginMemoryRequest(gate, sessionRef.current)
    const hang = deferred()
    let applied: string | undefined
    const loading = loadMemoryStatus({
      rpc: async () => {
        await hang.promise
        return { ok: true, value: status('s1') }
      },
      sessionId: first.sessionId,
      token: first.token,
      gate,
      signal: first.signal,
      viewSessionId: () => sessionRef.current,
    }).then(next => {
      if (next) applied = next.records[0]?.id
    })
    const second = beginMemoryRequest(gate, sessionRef.current, first.controller)
    hang.resolve()
    await loading
    expect(applied).toBeUndefined()
    const current = await loadMemoryStatus({
      rpc: async () => ({ ok: true, value: status('s1') }),
      sessionId: second.sessionId,
      token: second.token,
      gate,
      signal: second.signal,
      viewSessionId: () => sessionRef.current,
    })
    expect(current?.records[0]?.id).toBe('s1')
  })

  it('skips refresh while a local edit or action is busy', () => {
    expect(shouldSkipMemoryRefresh({ busy: true, editing: false })).toBe(true)
    expect(shouldSkipMemoryRefresh({ busy: false, editing: true })).toBe(true)
    expect(shouldSkipMemoryRefresh({ busy: false, editing: false })).toBe(false)
  })

  it('peeks status without aborting an in-flight write signal', async () => {
    const gate = createMemoryGeneration()
    const sessionRef = { current: 's1' }
    const write = beginMemoryRequest(gate, sessionRef.current)
    let writeSignalAborted = false
    const hang = deferred()
    const writing = loadMemoryStatus({
      rpc: async (_endpoint, _payload, signal) => {
        await hang.promise
        writeSignalAborted = signal?.aborted === true
        return { ok: true, value: status('s1') }
      },
      sessionId: write.sessionId,
      token: write.token,
      gate,
      signal: write.signal,
      viewSessionId: () => sessionRef.current,
    })
    const peeked = await peekMemoryStatus({
      rpc: async () => ({ ok: true, value: status('s1') }),
      sessionId: write.sessionId,
      token: write.token,
      gate,
      viewSessionId: () => sessionRef.current,
      busy: () => false,
      editing: () => false,
    })
    expect(peeked?.records[0]?.id).toBe('s1')
    expect(write.signal.aborted).toBe(false)
    hang.resolve()
    await writing
    expect(writeSignalAborted).toBe(false)
    expect(write.signal.aborted).toBe(false)
  })

  it('does not apply a peek once an action becomes busy or a row is being edited', async () => {
    const gate = createMemoryGeneration()
    const request = beginMemoryRequest(gate, 's1')
    const hang = deferred()
    let busy = false
    const peeking = peekMemoryStatus({
      rpc: async () => {
        await hang.promise
        return { ok: true, value: status('s1') }
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
