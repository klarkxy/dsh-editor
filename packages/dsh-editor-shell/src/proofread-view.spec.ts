import { describe, expect, it } from 'vitest'
import type { ProofreadFinding } from 'dsh-editor-workbench/contracts'
import {
  appendIgnoreLine,
  batchPunctuationEdit,
  combineReplacements,
  documentPunctuationFindings,
  excerptParts,
  filterProofreadFindings,
  groupFindingsByFile,
  isStaleFinding,
  kindCounts,
  parseIgnoreTerms,
  quotedTerm,
  singleFindingEdit,
  sortProofreadFindings,
  toggleProofreadKind,
  uniqueReplacement,
} from './proofread-view.ts'

function finding(extra: Partial<ProofreadFinding> = {}): ProofreadFinding {
  return {
    path: '正文/001.md',
    line: 1,
    column: 1,
    start: 0,
    end: 1,
    kind: 'punctuation',
    severity: 'warning',
    message: '半角「,」应使用全角',
    excerpt: '甲,乙',
    suggestion: '，',
    version: 'v1',
    ...extra,
  }
}

describe('proofread view helpers', () => {
  it('groups findings by file and keeps first-seen order', () => {
    const grouped = groupFindingsByFile([
      finding({ path: '正文/002.md', start: 8, message: '口癖「忽然」偏多', kind: 'habit', severity: 'info' }),
      finding({ path: '正文/001.md', start: 2, kind: 'typo', severity: 'error', message: '疑似错别字「既使」' }),
      finding({ path: '正文/002.md', start: 1, message: '半角「.」应使用全角' }),
    ])
    expect(grouped.map((group) => group.path)).toEqual(['正文/002.md', '正文/001.md'])
    expect(grouped[0]!.findings.map((item) => item.start)).toEqual([1, 8])
    expect(grouped[1]!.findings).toHaveLength(1)
  })

  it('orders by severity before offset inside a file', () => {
    const sorted = sortProofreadFindings([
      finding({ start: 1, severity: 'info', kind: 'habit', message: '口癖「然后」偏多' }),
      finding({ start: 8, severity: 'error', kind: 'typo', message: '疑似错别字「既使」' }),
      finding({ start: 3, severity: 'warning' }),
    ])
    expect(sorted.map((item) => item.severity)).toEqual(['error', 'warning', 'info'])
  })

  it('filters by kind chips and habit term', () => {
    const items = [
      finding({ kind: 'punctuation', start: 0 }),
      finding({ kind: 'habit', severity: 'info', start: 4, message: '口癖「忽然」偏多', suggestion: undefined }),
      finding({ kind: 'habit', severity: 'info', start: 10, message: '口癖「然后」偏多', suggestion: undefined }),
      finding({ kind: 'sensitive', start: 12, message: '敏感词「刀」', suggestion: undefined }),
    ]
    expect(filterProofreadFindings(items, { kinds: ['habit'], habitTerm: null }).map((item) => quotedTerm(item.message))).toEqual(['忽然', '然后'])
    expect(filterProofreadFindings(items, { kinds: ['punctuation', 'typo'], habitTerm: '忽然' }).map((item) => quotedTerm(item.message))).toEqual(['忽然'])
    expect(kindCounts(items)).toEqual({ punctuation: 1, sensitive: 1, repeat: 0, typo: 0, habit: 2 })
    expect(toggleProofreadKind(['punctuation', 'typo'], 'typo')).toEqual(['punctuation'])
  })

  it('highlights the matched span inside an excerpt', () => {
    expect(excerptParts('……甲,乙……', ',')).toEqual({ before: '……甲', match: ',', after: '乙……' })
    expect(excerptParts('没有针', '忽然')).toEqual({ before: '没有针', match: '', after: '' })
  })

  it('combines non-overlapping replacements and skips overlaps', () => {
    const source = '甲,乙.丙,丁'
    const combined = combineReplacements(source, [
      { start: 1, end: 2, text: '，' },
      { start: 3, end: 4, text: '。' },
      { start: 3, end: 5, text: '。' },
      { start: 5, end: 6, text: '，' },
    ])
    expect(combined.text).toBe('甲，乙。丙，丁')
    expect(combined.applied).toHaveLength(3)
    expect(combined.skipped).toEqual([{ start: 3, end: 5, text: '。' }])
  })

  it('detects stale findings when the opened version differs', () => {
    expect(isStaleFinding({ version: 'v1' }, 'v2')).toBe(true)
    expect(isStaleFinding({ version: 'v1' }, 'v1')).toBe(false)
    expect(isStaleFinding({ version: 'v1' }, undefined)).toBe(false)
  })

  it('expands a non-unique span until the replacement is unique', () => {
    const source = '他,她,他'
    expect(uniqueReplacement(source, 1, 2, '，')).toEqual({ oldText: '他,', newText: '他，' })
    expect(singleFindingEdit(source, finding({ start: 1, end: 2, suggestion: '，' }))).toEqual({
      path: '正文/001.md',
      oldText: '他,',
      newText: '他，',
      summary: '校对：半角「,」应使用全角',
    })
    expect(singleFindingEdit(source, finding({ path: '正文/001.txt', start: 1, end: 2 }))).toBeUndefined()
  })

  it('builds one document-level punctuation proposal from the same version', () => {
    const source = '甲,乙.丙'
    const items = documentPunctuationFindings([
      finding({ start: 1, end: 2, suggestion: '，' }),
      finding({ start: 3, end: 4, suggestion: '。', message: '半角「.」应使用全角' }),
      finding({ path: '正文/002.md', start: 1, end: 2 }),
      finding({ start: 1, end: 2, version: 'v2' }),
    ], '正文/001.md', 'v1')
    expect(items).toHaveLength(2)
    expect(batchPunctuationEdit(source, '正文/001.md', items)).toEqual({
      path: '正文/001.md',
      oldText: source,
      newText: '甲，乙。丙',
      summary: '校对：批量应用 2 处标点建议',
    })
  })

  it('appends an ignore term without duplicating existing lines', () => {
    expect(parseIgnoreTerms('# 注释\n刀\n刀\n')).toEqual(['刀'])
    expect(appendIgnoreLine('刀\n', '枪')).toBe('刀\n枪\n')
    expect(appendIgnoreLine('刀\n', '刀')).toBe('刀\n')
    expect(appendIgnoreLine(null, '刀')).toBe('刀\n')
  })
})
