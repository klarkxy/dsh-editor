import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createTextDiff, segmentDiffText } from './text-diff.ts'

const segmenter = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!
afterEach(() => Object.defineProperty(Intl, 'Segmenter', segmenter))

function roundtrip(before: string, after: string) {
  const result = createTextDiff(before, after)
  expect(result.parts.filter((part) => part.kind !== 'insert').map((part) => part.text).join('')).toBe(before)
  expect(result.parts.filter((part) => part.kind !== 'delete').map((part) => part.text).join('')).toBe(after)
  expect(result.parts.every((part) => part.text.length > 0)).toBe(true)
  return result
}

describe('display-only Chinese selection diff', () => {
  it('highlights a change in certainty rather than hiding it in two plain paragraphs', () => {
    const result = roundtrip('他可能没有背叛她。', '他从未背叛她。')
    expect(result.coarse).toBe(false)
    expect(result.parts.some((part) => part.kind === 'delete' && part.text.includes('可能'))).toBe(true)
    expect(result.parts.some((part) => part.kind === 'insert' && part.text.includes('从未'))).toBe(true)
    expect(result.parts.some((part) => part.kind === 'equal' && part.text.includes('背叛'))).toBe(true)
  })

  it.each([
    ['', ''], ['', '新增'], ['删除', ''], ['未变化', '未变化'],
    ['首段。\n\n尾段。', '首段。\n\n插入一段。\n\n尾段。'],
    ['第一段\r\n\r\n第二段\r\n', '第一段\r\n\r\n修改段\r\n'],
    ['  text\t猫  \n', '\ttext 猫\r\n'],
    ['👩🏽‍💻和e\u0301与猫🐈', '👩🏽‍💻和é与狗🐕'],
    ['甲\r乙\r', '甲\r丙\r'], ['<script>alert(1)</script>', '<img src=x onerror=alert(2)>'],
  ])('preserves both original strings exactly: %j -> %j', (before, after) => { roundtrip(before, after) })

  it('aligns unchanged paragraphs before refining changed text', () => {
    const result = roundtrip('开头不变。\n\n中间修改。\n\n结尾不变。', '开头不变。\n\n中间改写。\n\n结尾不变。')
    expect(result.parts.filter((part) => part.kind !== 'equal').every((part) => !part.text.includes('不变'))).toBe(true)
  })

  it('falls back to code points when native segmentation is unavailable', () => {
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined })
    expect(segmentDiffText('猫🐈e\u0301')).toEqual(['猫', '🐈', 'e', '\u0301'])
    roundtrip('🐈可能没有', '🐈从未')
  })

  it('rejects incomplete segmenter output rather than dropping punctuation', () => {
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: class {
      segment() { return [{ segment: '猫' }] }
    } })
    expect(segmentDiffText('猫。')).toEqual(['猫', '。'])
  })

  it('degrades before segmenting oversized input', () => {
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, get() { throw new Error('must not segment') } })
    expect(roundtrip('甲'.repeat(100_001), '乙'.repeat(100_001)).coarse).toBe(true)
  })

  it('bounds the cumulative alignment matrix budget', () => {
    const before = Array.from({ length: 1000 }, (_, i) => `甲${i}\n`).join('')
    const after = Array.from({ length: 1000 }, (_, i) => `乙${i}\n`).join('')
    expect(roundtrip(before, after).coarse).toBe(true)
  })

  it('roundtrips deterministic mixed-language edits', () => {
    let seed = 42
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0)
    const chars = ['猫', '没', '有', ' ', '\n', '\r', '\t', '🐈', 'e\u0301', '<', '&', 'a', '。']
    for (let sample = 0; sample < 150; sample += 1) {
      const before = Array.from({ length: next() % 60 }, () => chars[next() % chars.length]).join('')
      const at = next() % (before.length + 1)
      const after = before.slice(0, at) + chars[next() % chars.length] + before.slice(Math.min(before.length, at + 2))
      roundtrip(before, after)
    }
  })

  it('renders semantic, escaped markers without feeding the diff back into writes', () => {
    const display = readFileSync(new URL('./selection-diff.tsx', import.meta.url), 'utf8')
    const editor = readFileSync(new URL('./editor.tsx', import.meta.url), 'utf8')
    expect(display).toContain('<del')
    expect(display).toContain('<ins')
    expect(display).not.toContain('dangerouslySetInnerHTML')
    expect(editor).toContain('<SelectionDiff original={proposal.ticket.selectedText} revised={proposal.text}')
    expect(editor).toContain('setText(applySelectionPatch(textRef.current, proposal.ticket, proposal.text))')
    expect(editor).toContain('!isSelectionCurrent(proposal.ticket, docRef.current, textRef.current, revisionRef.current)')
  })
})
