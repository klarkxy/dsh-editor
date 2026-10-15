import { describe, expect, it, vi } from 'vitest'
import {
  applyAllGroup,
  applyReadyProposals,
  createProposalBoard,
  pendingProposalEntries,
  type ProposalBoardEntry,
  type ProposalCardStatus,
} from './proposal-board.ts'

function entry(partial: Partial<ProposalBoardEntry> & { id: string; status: () => ProposalCardStatus }): ProposalBoardEntry {
  return {
    turnKey: 0,
    element: () => null,
    apply: () => {},
    ...partial,
  }
}

function card(id: string, initial: ProposalCardStatus, outcome?: ProposalCardStatus) {
  let status = initial
  const apply = vi.fn(async () => {
    status = outcome ?? 'applied'
  })
  const item = entry({ id, status: () => status, apply })
  return { item, apply, status: () => status }
}

describe('createProposalBoard', () => {
  it('registers, notifies and unregisters', () => {
    const board = createProposalBoard()
    const listener = vi.fn()
    const unsubscribe = board.subscribe(listener)
    const unregister = board.register(card('a', 'ready').item)
    expect(board.entries()).toHaveLength(1)
    expect(listener).toHaveBeenCalledTimes(1)
    board.notify()
    expect(listener).toHaveBeenCalledTimes(2)
    unregister()
    expect(board.entries()).toHaveLength(0)
    unsubscribe()
    board.notify()
    expect(listener).toHaveBeenCalledTimes(3)
  })
})

describe('pendingProposalEntries', () => {
  it('keeps unsettled states and drops settled ones', () => {
    const pending = pendingProposalEntries([
      card('checking', 'checking').item,
      card('ready', 'ready').item,
      card('applying', 'applying').item,
      card('expired', 'expired').item,
      card('applied', 'applied').item,
      card('ignored', 'ignored').item,
      card('deferred', 'deferred').item,
      card('undone', 'undone').item,
    ])
    expect(pending.map((item) => item.id)).toEqual(['checking', 'ready', 'applying', 'expired'])
  })
})

describe('applyAllGroup', () => {
  it('requires two ready proposals from the same turn', () => {
    const group = applyAllGroup([
      card('a', 'ready').item,
      card('b', 'ready').item,
    ])
    expect(group?.turnKey).toBe(0)
    expect(group?.entries.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('stays empty when fewer than two are ready or the turn fails precheck', () => {
    expect(applyAllGroup([card('a', 'ready').item])).toBeNull()
    expect(applyAllGroup([
      card('a', 'ready').item,
      card('b', 'checking').item,
    ])).toBeNull()
  })

  it('scopes the group to the last qualifying turn', () => {
    const old = card('old1', 'ready').item
    const old2 = { ...card('old2', 'ready').item, turnKey: 0 }
    const fresh = card('new1', 'ready').item
    const fresh2 = { ...card('new2', 'ready').item, turnKey: 7 }
    const group = applyAllGroup([
      { ...old, turnKey: 0 },
      old2,
      { ...fresh, turnKey: 7 },
      fresh2,
    ])
    expect(group?.turnKey).toBe(7)
    expect(group?.entries.map((item) => item.id)).toEqual(['new1', 'new2'])
  })
})

describe('applyReadyProposals', () => {
  it('applies every ready entry in order', async () => {
    const order: string[] = []
    const make = (id: string) => {
      let status: ProposalCardStatus = 'ready'
      return entry({
        id,
        status: () => status,
        apply: async () => {
          order.push(id)
          status = 'applied'
        },
      })
    }
    const result = await applyReadyProposals([make('a'), make('b'), make('c')])
    expect(result).toEqual({ applied: 3, stopped: false })
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('stops at the first apply that does not land', async () => {
    const failed = card('b', 'ready', 'expired')
    const untouched = card('c', 'ready')
    const result = await applyReadyProposals([card('a', 'ready').item, failed.item, untouched.item])
    expect(result).toEqual({ applied: 1, stopped: true })
    expect(failed.apply).toHaveBeenCalledTimes(1)
    expect(untouched.apply).not.toHaveBeenCalled()
    expect(untouched.status()).toBe('ready')
  })

  it('stops before a pending entry that lost its ready status', async () => {
    const stale = card('b', 'expired')
    const untouched = card('c', 'ready')
    const result = await applyReadyProposals([card('a', 'ready').item, stale.item, untouched.item])
    expect(result).toEqual({ applied: 1, stopped: true })
    expect(stale.apply).not.toHaveBeenCalled()
    expect(untouched.apply).not.toHaveBeenCalled()
  })

  it('skips already-settled entries without stopping', async () => {
    const skipped = card('b', 'applied')
    const late = card('c', 'ready')
    const result = await applyReadyProposals([card('a', 'ready').item, skipped.item, late.item])
    expect(result).toEqual({ applied: 2, stopped: false })
    expect(skipped.apply).not.toHaveBeenCalled()
    expect(late.apply).toHaveBeenCalledTimes(1)
  })
})
