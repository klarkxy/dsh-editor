import { describe, expect, it } from 'vitest'
import { defaultSettings } from './contracts.ts'
import { MoodService, type MoodPersistedState } from './service.ts'
import { domainStore, moodDomain, type MoodDomainHandle } from './storage.ts'

function sessionRow(goal: string): MoodPersistedState['sessions'][string] {
  return {
    pendingManual: false,
    lastHandledVersion: 'u1',
    projectId: '/work/novel',
    clarification: [{ id: 'q1', question: '范围？', status: 'answered', answer: '对白' }],
    contract: {
      id: 'keep-contract',
      sessionId: 'sess-1',
      sourceVersion: 'u1',
      revision: 1,
      goal,
      deliverables: ['修订对白'],
      inScope: ['第一章'],
      outOfScope: [],
      constraints: [],
      acceptance: [],
      assumptions: [],
      questions: [],
      evidence: [{ sessionId: 'sess-1', seq: 2, kind: 'user', excerpt: '改对白' }],
      readiness: 'user-confirmed',
      updatedAt: 10,
    },
  }
}

function createMoodDomain(options?: { failPuts?: number; initial?: MoodPersistedState }) {
  let record = options?.initial ? structuredClone(options.initial) : undefined
  let remainingFails = options?.failPuts ?? 0
  let puts = 0
  return {
    puts: () => puts,
    snapshot: () => record ? structuredClone(record) : undefined,
    open(): MoodDomainHandle {
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
              record = structuredClone(value) as MoodPersistedState
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

const previous: MoodPersistedState = {
  settings: { ...defaultSettings(), revision: 1, mode: 'manual' },
  sessions: { 'sess-1': sessionRow('保留原约定') },
}

describe('aggregate mood domain adapter', () => {
  it('persists the whole record in one state put', async () => {
    const disk = createMoodDomain({ initial: previous })
    const store = domainStore(disk.open())
    await store.save({
      settings: { ...previous.settings, revision: 2, mode: 'strict' },
      sessions: {
        ...previous.sessions,
        'sess-2': sessionRow('另一会话'),
      },
    })
    expect(disk.puts()).toBe(1)
    expect(moodDomain.tables).toEqual(expect.objectContaining({ state: expect.anything() }))
    expect(Object.keys(disk.snapshot()?.sessions ?? {})).toEqual(['sess-1', 'sess-2'])
    expect(disk.snapshot()?.settings.mode).toBe('strict')
  })

  it('keeps the previous entire state after a failed domain write and a fresh reopen', async () => {
    const disk = createMoodDomain({ initial: previous, failPuts: 1 })
    const service = new MoodService({
      store: domainStore(disk.open()),
      readEvents: () => [],
    })
    expect(service.status().settings).toMatchObject({ revision: 1, mode: 'auto' })
    expect(service.getContract('sess-1')?.goal).toBe('保留原约定')
    const result = await service.call('mode', { expectedRevision: 1, mode: 'strict' }, new AbortController().signal)
    expect(result).toEqual({ ok: false, error: { code: 'MOOD_STORAGE', message: '需求澄清保存失败，已保留原内容。' } })
    expect(service.status().settings).toMatchObject({ revision: 1, mode: 'auto' })
    expect(service.getContract('sess-1')?.goal).toBe('保留原约定')
    expect(service.status('sess-1').session?.clarification[0]?.answer).toBe('对白')
    expect(disk.snapshot()).toEqual(previous)
    await service.dispose()

    const reopened = new MoodService({
      store: domainStore(disk.open()),
      readEvents: () => [],
    })
    expect(reopened.status().settings).toMatchObject({ revision: 1, mode: 'auto' })
    expect(reopened.getContract('sess-1')).toMatchObject({ id: 'keep-contract', goal: '保留原约定', readiness: 'user-confirmed' })
    expect(reopened.status('sess-1').session?.projectId).toBe('/work/novel')
    expect(disk.puts()).toBe(1)
    await reopened.dispose()
  })
})
