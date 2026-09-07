import { describe, expect, it } from 'vitest'
import type { CharacterCard, WorldbookCard } from './contracts.ts'
import {
  CARD_NEARMISS_SKIP_REASON,
  CARD_NEARMISS_TERM_LIMIT,
  buildCardProofreadIndex,
  collectCardNearmiss,
  emitCardNearmiss,
  normalizeCardGender,
  scanCardGender,
} from './proofread-cards.ts'

function character(name: string, extra: CharacterCard['frontmatter'] = {}): CharacterCard {
  return {
    path: `人物卡/${name}.md`,
    title: name,
    frontmatter: { name, ...extra },
    summary: '',
    version: 'v1',
    modifiedAt: null,
  }
}

function worldbook(title: string, triggers: string[]): WorldbookCard {
  return {
    path: `世界书/${title}.md`,
    title,
    frontmatter: { triggers, enabled: true, priority: 0 },
    summary: '',
    version: 'v1',
    modifiedAt: null,
  }
}

describe('normalizeCardGender', () => {
  it('accepts Chinese and English labels and skips unknown values', () => {
    expect(normalizeCardGender('男')).toBe('男')
    expect(normalizeCardGender('男性')).toBe('男')
    expect(normalizeCardGender('Male')).toBe('男')
    expect(normalizeCardGender('女')).toBe('女')
    expect(normalizeCardGender('女性')).toBe('女')
    expect(normalizeCardGender('FEMALE')).toBe('女')
    expect(normalizeCardGender('unknown')).toBeUndefined()
    expect(normalizeCardGender('alive')).toBeUndefined()
  })
})

describe('buildCardProofreadIndex', () => {
  it('drops substring terms and bails out when the CJK term set exceeds 400', () => {
    const small = buildCardProofreadIndex({
      characters: [character('林见', { aliases: ['见'], gender: '男' })],
      worldbook: [worldbook('青云门', ['青云门', '青云'])],
    })
    expect(small.nearmiss.skipped).toBe(false)
    expect(small.nearmiss.terms).toEqual(['林见', '青云门'])

    const names = Array.from({ length: CARD_NEARMISS_TERM_LIMIT + 1 }, (_, index) => {
      const left = String.fromCharCode(0x4e00 + index)
      const right = String.fromCharCode(0x4e00 + index + 80)
      return `${left}${right}`
    })
    const huge = buildCardProofreadIndex({
      characters: names.map((name) => character(name)),
      worldbook: [],
    })
    expect(huge.nearmiss.skipped).toBe(true)
    expect(huge.nearmiss.skipReason).toBe(CARD_NEARMISS_SKIP_REASON)
    expect(huge.nearmiss.terms).toEqual([])
  })
})

describe('scanCardGender', () => {
  const index = buildCardProofreadIndex({
    characters: [
      character('林见', { aliases: ['见哥'], gender: '男' }),
      character('苏晚', { gender: '女' }),
    ],
    worldbook: [],
  })

  it('reports the pronoun span and skips 他们 / 她们', () => {
    const text = '林见走了，她没有回头。'
    expect(scanCardGender(text, index)).toMatchObject([{
      start: text.indexOf('她'),
      end: text.indexOf('她') + 1,
      suggestion: '他',
      code: 'card-gender',
    }])
    expect(scanCardGender('林见走了，她们没有回头。', index)).toEqual([])
    expect(scanCardGender('林见走了，他们没有回头。', index)).toEqual([])
  })
})

describe('collectCardNearmiss', () => {
  const index = buildCardProofreadIndex({
    characters: [],
    worldbook: [worldbook('青云门', ['青云门', '青云派'])],
  })

  it('matches one-character substitutions and ignores known terms', () => {
    const text = '他加入了青峰门。'
    expect(collectCardNearmiss(text, '正文/1.md', index)).toMatchObject([{
      candidate: '青峰门',
      term: '青云门',
      start: text.indexOf('青峰门'),
    }])
    expect(collectCardNearmiss('见哥走进青云派。', '正文/1.md', index)).toEqual([])
  })

  it('drops frequent variants when emitting', () => {
    const text = '青峰门。青峰门。青峰门。青峰门。'
    const hits = collectCardNearmiss(text, '正文/1.md', index)
    expect(hits.length).toBeGreaterThanOrEqual(4)
    expect(emitCardNearmiss(hits, [{ path: '正文/1.md', masked: text }])).toEqual([])
  })
})
