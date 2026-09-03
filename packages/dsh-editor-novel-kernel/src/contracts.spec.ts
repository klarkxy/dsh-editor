import { describe, expect, it } from 'vitest'
import {
  AUTHOR_MEMORY_MARKER,
  AUTHOR_OBSERVE_MAX_CHARS,
  AUTHOR_OBSERVE_TOOL_NAME,
  NOVEL_KNOWLEDGE_TOOL_NAME,
  PROPOSAL_MARKER,
  PROPOSAL_TOOL_NAME,
  authorMemoryMarker,
  parseAuthorMemoryMarker,
  parseProposalMarker,
  proposalMarker,
} from './contracts.ts'

describe('novel-kernel browser contracts', () => {
  it('keeps the established public tool and proposal identifiers', () => {
    expect({ NOVEL_KNOWLEDGE_TOOL_NAME, PROPOSAL_TOOL_NAME, PROPOSAL_MARKER }).toEqual({
      NOVEL_KNOWLEDGE_TOOL_NAME: 'novel_knowledge',
      PROPOSAL_TOOL_NAME: 'novel_propose',
      PROPOSAL_MARKER: 'dsh-editor.proposal',
    })
  })

  it('rejects non-Markdown or escaping proposal paths', () => {
    expect(() => proposalMarker({ kind: 'create', path: '../secret.md', summary: 'x', text: 'x' })).toThrow()
    expect(() => proposalMarker({ kind: 'create', path: '正文/001.txt', summary: 'x', text: 'x' })).toThrow()
  })

  it('parses valid serialized edit and create markers', () => {
    expect(parseProposalMarker(JSON.stringify(proposalMarker({
      kind: 'edit', path: '正文/001.md', summary: '润色', oldText: '旧文', newText: '新文',
    })))).toMatchObject({ kind: 'edit', path: '正文/001.md', oldText: '旧文', newText: '新文' })
    expect(parseProposalMarker(JSON.stringify(proposalMarker({
      kind: 'create', path: '人物卡/主角.md', summary: '新建', text: '# 主角',
    })))).toMatchObject({ kind: 'create', path: '人物卡/主角.md', text: '# 主角' })
  })

  it('rejects malformed and forged serialized markers', () => {
    expect(parseProposalMarker('not json')).toBeUndefined()
    expect(parseProposalMarker(JSON.stringify({ marker: PROPOSAL_MARKER, version: 2, kind: 'create', path: '正文/001.md', summary: '伪造', text: 'x' }))).toBeUndefined()
    expect(parseProposalMarker(JSON.stringify({ marker: PROPOSAL_MARKER, version: 1, kind: 'edit', path: '正文/001.md', summary: '缺失', oldText: '旧' }))).toBeUndefined()
    expect(parseProposalMarker(JSON.stringify({ marker: 'other', version: 1, kind: 'create', path: '正文/001.md', summary: '伪造', text: 'x' }))).toBeUndefined()
    expect(parseProposalMarker(JSON.stringify({ marker: PROPOSAL_MARKER, version: 1, kind: 'create', path: '../secret.md', summary: '伪造', text: 'x' }))).toBeUndefined()
    expect(parseProposalMarker(JSON.stringify({ marker: PROPOSAL_MARKER, version: 1, kind: 'create', path: '正文/001.md', summary: '', text: 'x' }))).toBeUndefined()
    expect(parseProposalMarker(JSON.stringify({ marker: PROPOSAL_MARKER, version: 1, kind: 'create', path: '正文/001.md', summary: '伪造', text: '' }))).toBeUndefined()
    expect(parseProposalMarker(JSON.stringify({ marker: PROPOSAL_MARKER, version: 1, kind: 'edit', path: '正文/001.md', summary: '伪造', oldText: '相同', newText: '相同' }))).toBeUndefined()
    expect(parseProposalMarker(JSON.stringify({ marker: PROPOSAL_MARKER, version: 1, kind: 'create', path: '正文/001.md', summary: '伪造', text: 'x', extra: true }))).toBeUndefined()
  })

  it('publishes the author_observe tool name and memory marker identifier', () => {
    expect(AUTHOR_OBSERVE_TOOL_NAME).toBe('author_observe')
    expect(AUTHOR_MEMORY_MARKER).toBe('dsh-editor.memory')
    expect(AUTHOR_OBSERVE_MAX_CHARS).toBe(200)
  })

  it('accepts a trimmed author-memory entry and round-trips through the parser', () => {
    expect(authorMemoryMarker({ observation: '  留白优先 \n', reason: ' 三次要求  ' })).toEqual({
      marker: 'dsh-editor.memory', version: 1, observation: '留白优先', reason: '三次要求',
    })
    expect(parseAuthorMemoryMarker(JSON.stringify({ marker: AUTHOR_MEMORY_MARKER, version: 1, observation: '留白', reason: '多次' }))).toEqual({
      marker: 'dsh-editor.memory', version: 1, observation: '留白', reason: '多次',
    })
  })

  it('rejects empty, oversized or extra-key author-memory markers', () => {
    expect(() => authorMemoryMarker({ observation: '', reason: 'r' })).toThrow('observation')
    expect(() => authorMemoryMarker({ observation: 'x', reason: '' })).toThrow('reason')
    expect(() => authorMemoryMarker({ observation: 'x'.repeat(AUTHOR_OBSERVE_MAX_CHARS + 1), reason: 'r' })).toThrow('200 characters')
    expect(parseAuthorMemoryMarker(JSON.stringify({ marker: AUTHOR_MEMORY_MARKER, version: 1, observation: '', reason: 'r' }))).toBeUndefined()
    expect(parseAuthorMemoryMarker(JSON.stringify({ marker: AUTHOR_MEMORY_MARKER, version: 1, observation: 'x', reason: '' }))).toBeUndefined()
    expect(parseAuthorMemoryMarker(JSON.stringify({ marker: AUTHOR_MEMORY_MARKER, version: 1, observation: 'x'.repeat(AUTHOR_OBSERVE_MAX_CHARS + 1), reason: 'r' }))).toBeUndefined()
    expect(parseAuthorMemoryMarker(JSON.stringify({ marker: AUTHOR_MEMORY_MARKER, version: 2, observation: 'x', reason: 'r' }))).toBeUndefined()
    expect(parseAuthorMemoryMarker(JSON.stringify({ marker: 'other', version: 1, observation: 'x', reason: 'r' }))).toBeUndefined()
    expect(parseAuthorMemoryMarker(JSON.stringify({ marker: AUTHOR_MEMORY_MARKER, version: 1, observation: 'x', reason: 'r', extra: true }))).toBeUndefined()
    expect(parseAuthorMemoryMarker('not json')).toBeUndefined()
  })
})
