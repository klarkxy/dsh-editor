import { describe, expect, it } from 'vitest'
import { HOST_GUARD_REJECTION, hostToolGuard } from './host-guard.ts'

describe('Host fail-closed tool guard', () => {
  it('allows generic read, search, ask, Skill and writing_propose', () => {
    expect(hostToolGuard({ name: 'read', arguments: { file_path: 'notes/a.md' } })).toBeUndefined()
    expect(hostToolGuard({ name: 'glob', arguments: { pattern: '**/*.md' } })).toBeUndefined()
    expect(hostToolGuard({ name: 'grep', arguments: { include: '*.md' } })).toBeUndefined()
    expect(hostToolGuard({ name: 'ask_user_question', arguments: { questions: [] } })).toBeUndefined()
    expect(hostToolGuard({ name: 'Skill', arguments: { name: 'demo' } })).toBeUndefined()
    expect(hostToolGuard({ name: 'skill', arguments: { name: 'demo' } })).toBeUndefined()
    expect(hostToolGuard({ name: 'writing_propose', arguments: { kind: 'edit', summary: 'x' } })).toBeUndefined()
    expect(hostToolGuard({ name: 'author_observe', arguments: { observation: 'x', reason: 'y' } })).toBeUndefined()
    expect(hostToolGuard({ name: 'zhihu_search', arguments: { query: '../secret' } })).toBeUndefined()
  })

  it('does not treat grep or glob query patterns as file paths', () => {
    expect(hostToolGuard({ name: 'grep', arguments: { pattern: '../secret', include: '*.md' } })).toBeUndefined()
    expect(hostToolGuard({ name: 'grep', arguments: { pattern: 'C:\\Windows', path: '正文' } })).toBeUndefined()
    expect(hostToolGuard({ name: 'glob', arguments: { pattern: '../**/*.{md,txt}' } })).toBeUndefined()
    expect(hostToolGuard({ name: 'glob', arguments: { pattern: 'C:/secret/**/*.md', path: '大纲' } })).toBeUndefined()
    expect(hostToolGuard({ name: 'grep', arguments: { pattern: 'name', path: '../outside' } })).toBe(HOST_GUARD_REJECTION)
    expect(hostToolGuard({ name: 'glob', arguments: { pattern: '**/*.md', path: '../outside' } })).toBe(HOST_GUARD_REJECTION)
  })

  it('rejects unknown tools and every reachable direct-write entry', () => {
    for (const name of ['write', 'edit', 'bash', 'shell', 'str_replace', 'NotebookEdit', 'unknown_tool']) {
      expect(hostToolGuard({ name, arguments: { path: 'notes/a.md' } })).toBe(HOST_GUARD_REJECTION)
    }
    expect(hostToolGuard({ name: 'read', arguments: { file_path: '../secret.md' } })).toBe(HOST_GUARD_REJECTION)
  })

  it('allows novel_knowledge and the explicit legacy novel_* write names', () => {
    expect(hostToolGuard({ name: 'novel_knowledge', arguments: { topics: ['planning'] } })).toBeUndefined()
    expect(hostToolGuard({ name: 'novel_propose', arguments: {} })).toBeUndefined()
    expect(hostToolGuard({ name: 'novel_memory_update', arguments: {} })).toBeUndefined()
    expect(hostToolGuard({ name: 'novel_index_write', arguments: {} })).toBeUndefined()
    expect(hostToolGuard({ name: 'novel_overview', arguments: {} })).toBeUndefined()
    expect(hostToolGuard({ name: 'novel_scratch_write', arguments: {} })).toBeUndefined()
    expect(hostToolGuard({ name: 'novel_evil', arguments: {} })).toBe(HOST_GUARD_REJECTION)
    expect(hostToolGuard({ name: 'novel_search', arguments: {} })).toBe(HOST_GUARD_REJECTION)
  })
})
