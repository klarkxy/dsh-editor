import { describe, expect, it } from 'vitest'
import { isActiveSessionArchiveError, orderedConversationIds } from './native-conversation-state.ts'

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

})
