import { describe, expect, it } from 'vitest'
import { MemoryRuntime, defaultSettings } from '@klarkxy/dsh-memory'
import type { MemoryPersistedState } from '@klarkxy/dsh-memory/contracts'
import { evidenceWatermark, LESSON_SCHEMA_TAG } from './contracts.ts'
import { candidateRecord, hasSameEvidence, parseExtraction } from './extract.ts'
import { lesson } from './fakes.ts'
import { selectActiveLessons } from './recall.ts'

function ephemeralMemory() {
  let n = 0
  let state: MemoryPersistedState = {
    settings: defaultSettings(),
    records: [],
    tombstones: [],
    dreams: [],
  }
  return new MemoryRuntime({
    store: {
      load: () => structuredClone(state),
      async save(next) { state = structuredClone(next) },
    },
    now: () => 1_000,
    id: () => `lesson-${++n}`,
  })
}

describe('extraction parsing', () => {
  it('accepts strict JSON and skip, and rejects prose', () => {
    expect(parseExtraction('{"skip":true}')).toEqual({ skip: true })
    expect(parseExtraction('```json\n{"title":"A","content":"B","exceptions":["x"]}\n```')).toEqual({
      title: 'A', content: 'B', exceptions: ['x'],
    })
    expect(parseExtraction('I learned that we should always…')).toBeUndefined()
  })

  it('dedupes by evidence watermark', () => {
    const trigger = {
      kind: 'human-correction' as const,
      evidence: [{ sessionId: 's', seq: 2, kind: 'user' as const, excerpt: '不对' }],
      titleHint: 't', contentHint: 'c',
    }
    const created = candidateRecord({ title: 't', content: 'c', exceptions: [] }, trigger, '/proj')
    expect(hasSameEvidence([lesson({
      id: 'old', title: 't', content: 'c', status: 'candidate',
      scope: { kind: 'project', projectId: '/proj' },
      evidence: trigger.evidence,
      tags: [`evidence:${evidenceWatermark(trigger.evidence)}`],
    })], trigger)).toBe(true)
    expect(created.status).toBe('candidate')
    expect(created.source).toBe('self-improvement')
    expect(created.tags.every(tag => tag.length > 0 && tag.length <= 40)).toBe(true)
    expect(selectActiveLessons([lesson({
      id: 'c1', title: 'candidate', content: 'no', status: 'candidate',
      scope: { kind: 'project', projectId: '/proj' },
    })], '/proj', { now: 50, requestText: 'candidate no' })).toEqual([])
  })

  it('fits native session evidence into MemoryRuntime create schema', async () => {
    const sessionId = 'session-d7c12130-a2d7-49f2-861f-9c106718baad'
    const projectId = 'D:/0 code/dsh-editor/.dev/ai-plugins-1790011789872/projects/插件验收'
    const correction = '不对，以后调整语言时保留已有剧情。'
    const trigger = {
      kind: 'human-correction' as const,
      evidence: [{ sessionId, seq: 24, kind: 'user' as const, excerpt: correction }],
      titleHint: correction,
      contentHint: correction,
    }
    const draft = { title: '保留剧情', content: '调整语言时保留已有剧情。', exceptions: [] }
    const record = candidateRecord(draft, trigger, projectId)
    const overlongTag = `evidence:${evidenceWatermark(trigger.evidence)}`
    expect(overlongTag.length).toBeGreaterThan(40)
    expect(record.tags).toEqual([LESSON_SCHEMA_TAG])
    expect(record.tags.every(tag => tag.length <= 40)).toBe(true)

    const memory = ephemeralMemory()
    await expect(memory.create({ ...record, tags: [LESSON_SCHEMA_TAG, overlongTag] })).rejects.toMatchObject({
      code: 'MEMORY_INVALID',
    })
    const stored = await memory.create(record)
    expect(stored).toMatchObject({
      kind: 'lesson',
      status: 'candidate',
      source: 'self-improvement',
      title: '保留剧情',
      content: '调整语言时保留已有剧情。',
      evidence: trigger.evidence,
      scope: { kind: 'project', projectId },
    })
    expect(hasSameEvidence([stored], trigger)).toBe(true)
  })
})
