import { describe, expect, it } from 'vitest'
import type { RecapPersistedState } from './contracts.ts'
import { RecapService } from './service.ts'
import { domainStore, recapDomain, type RecapDomainHandle } from './storage.ts'

function card(id: string, sessionId = 's1'): RecapPersistedState['cards'][number] {
  return {
    id,
    sessionId,
    sourceVersion: `${sessionId}#6`,
    fromSeq: 0,
    toSeq: 6,
    trigger: 'turn-end',
    sourceStatus: 'completed',
    title: '回顾 · 已完成',
    body: id,
    kind: 'deterministic',
    generation: 'idle',
    createdAt: 1,
    updatedAt: 1,
  }
}

function checkpoint(id: string): RecapPersistedState['checkpoints'][number] {
  return {
    id,
    sessionId: 's1',
    sourceVersion: 's1#6',
    fromSeq: 0,
    toSeq: 6,
    revision: 1,
    status: 'completed',
    items: [{ label: '作者要求', state: 'verified', evidence: [{ sessionId: 's1', seq: 2, kind: 'user' }] }],
    constraints: ['不要改名'],
    nextAction: '继续',
    createdAt: 1,
  }
}

function createRecapDomain(options?: { failPuts?: number; initial?: RecapPersistedState }) {
  let record = options?.initial ? structuredClone(options.initial) : undefined
  let remainingFails = options?.failPuts ?? 0
  let puts = 0
  return {
    puts: () => puts,
    snapshot: () => record ? structuredClone(record) : undefined,
    open(): RecapDomainHandle {
      return {
        table(name) {
          if (name !== 'state') throw new Error(`unexpected table ${name}`)
          return {
            get(key) {
              return key === 'global' && record ? structuredClone(record) : undefined
            },
            async put(key, value) {
              puts += 1
              if (key !== 'global') throw new Error(`unexpected key ${key}`)
              if (remainingFails > 0) {
                remainingFails -= 1
                throw new Error('disk')
              }
              record = structuredClone(value) as RecapPersistedState
            },
            async delete() { return false },
            *entries() {
              if (record) yield ['global', structuredClone(record)] as [string, unknown]
            },
          }
        },
        async close() {},
      }
    },
  }
}

const previous: RecapPersistedState = {
  settings: {
    revision: 1,
    cardsEnabled: true,
    checkpointsEnabled: false,
    semanticCheckpointsEnabled: false,
    idleReturnMs: 15 * 60_000,
  },
  cards: [card('keep-a'), card('keep-b')],
  checkpoints: [checkpoint('cp-1')],
}

describe('aggregate recap domain adapter', () => {
  it('persists the whole record in one state put', async () => {
    const disk = createRecapDomain({ initial: previous })
    const store = domainStore(disk.open())
    await store.save({
      ...previous,
      settings: { ...previous.settings, revision: 2, checkpointsEnabled: true },
      cards: [...previous.cards, card('keep-c')],
    })
    expect(disk.puts()).toBe(1)
    expect(recapDomain.tables).toEqual(expect.objectContaining({ state: expect.anything() }))
    expect(disk.snapshot()?.cards.map(row => row.id)).toEqual(['keep-a', 'keep-b', 'keep-c'])
  })

  it('keeps the previous entire state after a failed domain write and a fresh reopen', async () => {
    const disk = createRecapDomain({ initial: previous, failPuts: 1 })
    const service = new RecapService({
      store: domainStore(disk.open()),
      readEvents: () => [],
    })
    expect(service.status().cards.map(row => row.id)).toEqual(['keep-a', 'keep-b'])
    const result = await service.call('update', {
      expectedRevision: 1,
      settings: {
        cardsEnabled: true,
        checkpointsEnabled: true,
        semanticCheckpointsEnabled: true,
        idleReturnMs: 120_000,
      },
    }, new AbortController().signal)
    expect(result).toEqual({ ok: false, error: { code: 'RECAP_STORAGE', message: '回顾保存失败，已保留原内容。' } })
    expect(service.status().settings).toMatchObject({
      revision: 1,
      checkpointsEnabled: true,
      semanticCheckpointsEnabled: true,
      idleReturnMs: 15 * 60_000,
    })
    expect(service.status().cards.map(row => row.id)).toEqual(['keep-a', 'keep-b'])
    expect(service.status().checkpoints.map(row => row.id)).toEqual(['cp-1'])
    expect(disk.snapshot()).toEqual(previous)
    await service.dispose()

    const reopened = new RecapService({
      store: domainStore(disk.open()),
      readEvents: () => [],
    })
    expect(reopened.status().settings).toMatchObject({ revision: 1, checkpointsEnabled: true, idleReturnMs: 15 * 60_000 })
    expect(reopened.status().cards.map(row => row.id)).toEqual(['keep-a', 'keep-b'])
    expect(reopened.status().checkpoints).toEqual([expect.objectContaining({ id: 'cp-1', nextAction: '继续' })])
    expect(disk.puts()).toBe(1)
    await reopened.dispose()
  })
})
