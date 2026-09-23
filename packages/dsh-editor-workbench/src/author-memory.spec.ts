import { describe, expect, it } from 'vitest'
import {
  AUTHOR_MEMORY_MARKER,
  AUTHOR_OBSERVE_MAX_CHARS,
  AUTHOR_OBSERVE_TOOL_NAME,
  authorMemoryMarker,
  parseAuthorMemoryMarker,
} from './author-memory.ts'
import { createAuthorObserveTool } from './observe-tool.ts'

describe('workbench author-memory contracts', () => {
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

  it('author_observe returns the marker the shell persists silently', async () => {
    const tool = createAuthorObserveTool()
    expect(tool.name).toBe(AUTHOR_OBSERVE_TOOL_NAME)
    const result = await tool.execute({ observation: '  留白优先\n', reason: ' 三次要求  ' })
    expect(result).toEqual({ marker: 'dsh-editor.memory', version: 1, observation: '留白优先', reason: '三次要求' })
  })
})
