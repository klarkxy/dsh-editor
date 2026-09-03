import { describe, expect, it } from 'vitest'
import { createAuthorObserveTool, AUTHOR_MEMORY_MARKER, AUTHOR_OBSERVE_MAX_CHARS, AUTHOR_OBSERVE_TOOL_NAME } from './observe-tool.ts'
import { editorToolGuard } from './proposal-tool.ts'

describe('author_observe tool', () => {
  it('uses the canonical tool name and memory marker', () => {
    const tool = createAuthorObserveTool()
    expect(tool.name).toBe(AUTHOR_OBSERVE_TOOL_NAME)
    expect(AUTHOR_OBSERVE_TOOL_NAME).toBe('author_observe')
    expect(AUTHOR_MEMORY_MARKER).toBe('dsh-editor.memory')
    expect(AUTHOR_OBSERVE_MAX_CHARS).toBe(200)
  })

  it('returns a versioned memory marker from execute', async () => {
    const tool = createAuthorObserveTool()
    const result = await tool.execute({ observation: '  留白优先\n', reason: ' 三次要求  ' })
    expect(result).toEqual({ marker: 'dsh-editor.memory', version: 1, observation: '留白优先', reason: '三次要求' })
  })

  it('reports marker JSON as the verbatim text block', () => {
    const tool = createAuthorObserveTool()
    const rendered = tool.output?.render?.({ observation: '留白优先', reason: '多次出现' }, { marker: 'dsh-editor.memory', version: 1, observation: '留白优先', reason: '多次出现' })
    expect(rendered).toEqual([{ type: 'text', text: JSON.stringify({ marker: 'dsh-editor.memory', version: 1, observation: '留白优先', reason: '多次出现' }) }])
  })

  it('guard allows a clean entry and rejects missing, oversized, or extra arguments', () => {
    expect(editorToolGuard({ name: 'author_observe', arguments: { observation: '留白优先', reason: '多次出现' } })).toBeUndefined()
    expect(editorToolGuard({ name: 'author_observe', arguments: { observation: '', reason: 'r' } })).toContain('non-empty')
    expect(editorToolGuard({ name: 'author_observe', arguments: { observation: '   ', reason: 'r' } })).toContain('non-empty')
    expect(editorToolGuard({ name: 'author_observe', arguments: { observation: 'x', reason: '' } })).toContain('non-empty')
    expect(editorToolGuard({ name: 'author_observe', arguments: { observation: 'x'.repeat(AUTHOR_OBSERVE_MAX_CHARS + 1), reason: 'r' } })).toContain('<= 200')
    expect(editorToolGuard({ name: 'author_observe', arguments: { observation: 'x', reason: 'r', path: '正文/001.md' } })).toContain('only accepts')
  })
})
