import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  loadNovelKnowledge,
  NOVEL_KNOWLEDGE_MAX_CARD_CHARS,
  novelKnowledgeTopics,
  normalizeNovelKnowledgeArguments,
} from './novel-knowledge.ts'

describe('bundled novel knowledge', () => {
  it('contains every fixed topic as a non-empty bounded card', async () => {
    const topics = novelKnowledgeTopics()
    expect(topics).toEqual([
      'planning', 'characters', 'drafting', 'dialogue', 'interiority',
      'style', 'review', 'deai', 'chinese-flow', 'first-reader', 'canon',
    ])
    for (const topic of topics) {
      const result = await loadNovelKnowledge({ topics: [topic] })
      expect(result.version).toBe(2)
      expect(result.topics[0]).toMatchObject({ id: topic })
      expect(result.topics[0].content.length).toBeGreaterThan(100)
      expect(result.topics[0].content.length).toBeLessThanOrEqual(NOVEL_KNOWLEDGE_MAX_CARD_CHARS)
    }
    const sources = await readFile(new URL('../resources/novel-knowledge/SOURCES.md', import.meta.url), 'utf8')
    expect(sources).toContain('知识资产版本：2')
    expect(sources).toContain('dsh-grill')
    expect(sources).toContain('grill-your-novel')
    expect(sources).toContain('sepia')
  })

  it('deduplicates topics while preserving first-use order', () => {
    expect(normalizeNovelKnowledgeArguments({ topics: ['dialogue', 'planning', 'dialogue'] })).toEqual(['dialogue', 'planning'])
  })

  it('rejects too many, unknown, empty, and path-bearing requests', () => {
    expect(() => normalizeNovelKnowledgeArguments({ topics: [] })).toThrow()
    expect(() => normalizeNovelKnowledgeArguments({ topics: ['planning', 'characters', 'drafting', 'review'] })).toThrow()
    expect(() => normalizeNovelKnowledgeArguments({ topics: ['planning', 'unknown'] })).toThrow(/unknown/)
    expect(() => normalizeNovelKnowledgeArguments({ topics: ['planning'], path: 'anything.md' })).toThrow(/only accepts/)
  })
})
