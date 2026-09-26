import { describe, expect, it } from 'vitest'
import { enqueueConversationSettingsWrite, coordinateLegacyConversationArchives, waitForLegacyConversationArchives, isActiveSessionArchiveError, migrateLegacyConversationArchives, orderedConversationIds } from './native-conversation-state.ts'
import type { SessionId } from './dsh-compat.ts'

describe('native conversation state', () => {
  it('orders pinned sessions first and applies active, all, archived filters', () => {
    const input = {
      ids: ['a', 'b', 'c', 'd'],
      archivedIds: ['c'],
      pinnedIds: ['d', 'b'],
    }
    expect(orderedConversationIds({ ...input, filter: 'active' })).toEqual(['d', 'b', 'a'])
    expect(orderedConversationIds({ ...input, filter: 'all' })).toEqual(['d', 'b', 'a', 'c'])
    expect(orderedConversationIds({ ...input, filter: 'archived' })).toEqual(['c'])
  })

  it('recognizes only the official active-session archive rejection', () => {
    const active = new Error('active')
    active.name = 'WorkspaceActiveSessionError'
    expect(isActiveSessionArchiveError(active)).toBe(true)
    const remote = new Error('remote') as Error & { rpcError?: { code: string } }
    remote.name = 'WorkspaceArchiveError'
    remote.rpcError = { code: 'workspace/session-active' }
    expect(isActiveSessionArchiveError(remote)).toBe(true)
    remote.rpcError.code = 'workspace/session-not-found'
    expect(isActiveSessionArchiveError(remote)).toBe(false)
    expect(isActiveSessionArchiveError(new Error('active'))).toBe(false)
    expect(isActiveSessionArchiveError({ name: 'WorkspaceActiveSessionError' })).toBe(false)
  })

  it('migrates old archive markers individually and retains failed entries', async () => {
    const archived: string[] = []
    const cleared: string[] = []
    const failed = await migrateLegacyConversationArchives({
      ids: ['already', 'ok', 'active', 'ok'],
      nativeArchivedIds: ['already'],
      archive: async (id: SessionId) => {
        archived.push(id)
        if (id === 'active') throw new Error('still running')
      },
      clear: async (id: string) => { cleared.push(id) },
    })
    expect(archived).toEqual(['ok', 'active'])
    expect(cleared).toEqual(['already', 'ok'])
    expect(failed).toEqual(['active'])
  })

  it('retains an old marker when its local cleanup fails after native archive', async () => {
    expect(await migrateLegacyConversationArchives({
      ids: ['a'],
      nativeArchivedIds: [],
      archive: async () => undefined,
      clear: async () => { throw new Error('settings unavailable') },
    })).toEqual(['a'])
  })
})

it('joins a migration across remounts and lets restore run only after all archives', async () => {
  const owner = {}
  const calls: string[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const input = { ids: ['a', 'b'], nativeArchivedIds: [], archive: async (id: SessionId) => { calls.push(id); if (id === 'a') await gate }, clear: async () => {} }
  const first = coordinateLegacyConversationArchives(owner, 'work', input)
  await Promise.resolve()
  const remount = coordinateLegacyConversationArchives(owner, 'work', input)
  expect(remount).toBe(first)
  const restored = waitForLegacyConversationArchives(owner, 'work').then(() => calls.push('restore'))
  expect(calls).toEqual(['a'])
  release()
  await restored
  expect(calls).toEqual(['a', 'b', 'restore'])
  await coordinateLegacyConversationArchives(owner, 'work', input)
  expect(calls).toEqual(['a', 'b', 'restore'])
})

it('serializes settings read-modify-write across workspaces before the native queue', async () => {
  const scope = {}
  let snapshot = { a: ['a1', 'a2'], b: ['b1'] }
  let generation = 0
  let pending = Promise.resolve()
  const mutate = (work: 'a' | 'b', ids: string[]) => {
    const acceptedGeneration = ++generation
    pending = pending.then(async () => {
      await new Promise(resolve => setTimeout(resolve, 1))
      if (generation === acceptedGeneration) snapshot = { ...snapshot, [work]: ids }
    })
    return pending
  }
  const clear = (work: 'a' | 'b', id: string) => enqueueConversationSettingsWrite(scope, async () => {
    await mutate(work, snapshot[work].filter(value => value !== id))
  })
  await Promise.all([
    (async () => { await clear('a', 'a1'); await clear('a', 'a2') })(),
    clear('b', 'b1'),
  ])
  expect(snapshot).toEqual({ a: [], b: [] })
})
