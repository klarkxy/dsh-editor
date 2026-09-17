import { describe, expect, it } from 'vitest'
import { HOST_GUARD_REJECTION, hostToolGuard, isWritingAgentPreset, WRITING_AGENT_PRESETS } from './host-guard.ts'

function exec(name: string, args: Record<string, unknown> = {}, preset: string | null | undefined = 'dsh-editor-writing') {
  return {
    name,
    arguments: args,
    ...(preset === undefined ? {} : { agent: { session: { header: { agentPreset: preset } } } }),
  }
}

function guard(name: string, args: Record<string, unknown> = {}, preset: string | null | undefined = 'dsh-editor-writing') {
  return hostToolGuard(exec(name, args, preset))
}

describe('Host fail-closed tool guard', () => {
  it('allows generic read, search, ask, Skill and writing_propose', () => {
    expect(guard('read', { file_path: 'notes/a.md' })).toBeUndefined()
    expect(guard('glob', { pattern: '**/*.md' })).toBeUndefined()
    expect(guard('grep', { include: '*.md' })).toBeUndefined()
    expect(guard('ask_user_question', { questions: [] })).toBeUndefined()
    expect(guard('Skill', { name: 'demo' })).toBeUndefined()
    expect(guard('skill', { name: 'demo' })).toBeUndefined()
    expect(guard('writing_propose', { kind: 'edit', summary: 'x' })).toBeUndefined()
    expect(guard('author_observe', { observation: 'x', reason: 'y' })).toBeUndefined()
    expect(guard('zhihu_search', { query: '../secret' })).toBeUndefined()
  })

  it('does not treat grep or glob query patterns as file paths', () => {
    expect(guard('grep', { pattern: '../secret', include: '*.md' })).toBeUndefined()
    expect(guard('grep', { pattern: 'C:\\Windows', path: '正文' })).toBeUndefined()
    expect(guard('glob', { pattern: '../**/*.{md,txt}' })).toBeUndefined()
    expect(guard('glob', { pattern: 'C:/secret/**/*.md', path: '大纲' })).toBeUndefined()
    expect(guard('grep', { pattern: 'name', path: '../outside' })).toBe(HOST_GUARD_REJECTION)
    expect(guard('glob', { pattern: '**/*.md', path: '../outside' })).toBe(HOST_GUARD_REJECTION)
  })

  it('rejects unknown tools and every reachable direct-write entry on writing presets', () => {
    for (const name of ['write', 'edit', 'bash', 'pwsh', 'shell', 'str_replace', 'NotebookEdit', 'unknown_tool']) {
      expect(guard(name, { path: 'notes/a.md' })).toBe(HOST_GUARD_REJECTION)
    }
    expect(guard('read', { file_path: '../secret.md' })).toBe(HOST_GUARD_REJECTION)
  })

  it('allows novel_knowledge and the explicit legacy novel_* write names', () => {
    expect(guard('novel_knowledge', { topics: ['planning'] })).toBeUndefined()
    expect(guard('novel_propose')).toBeUndefined()
    expect(guard('novel_memory_update')).toBeUndefined()
    expect(guard('novel_index_write')).toBeUndefined()
    expect(guard('novel_overview')).toBeUndefined()
    expect(guard('novel_scratch_write')).toBeUndefined()
    expect(guard('novel_evil')).toBe(HOST_GUARD_REJECTION)
    expect(guard('novel_search')).toBe(HOST_GUARD_REJECTION)
  })

  it('applies the lock to every app-owned writing preset, including legacy', () => {
    expect(WRITING_AGENT_PRESETS).toEqual([
      'dsh-editor-writing',
      'dsh-editor-novel',
      'dsh-editor-article',
      'dsh-editor-technical',
      'dsh-editor',
    ])
    for (const preset of WRITING_AGENT_PRESETS) {
      expect(isWritingAgentPreset(preset)).toBe(true)
      expect(guard('pwsh', {}, preset)).toBe(HOST_GUARD_REJECTION)
    }
  })

  it('does not restrict official or community presets, or calls without a writing session', () => {
    expect(isWritingAgentPreset('standard')).toBe(false)
    expect(isWritingAgentPreset('plugin-preset')).toBe(false)
    expect(isWritingAgentPreset(null)).toBe(false)
    expect(isWritingAgentPreset(undefined)).toBe(false)
    expect(guard('pwsh', { command: 'Get-ChildItem' }, 'standard')).toBeUndefined()
    expect(guard('bash', { command: 'ls' }, 'plugin-preset')).toBeUndefined()
    expect(guard('write', { path: 'notes/a.md' }, null)).toBeUndefined()
    expect(hostToolGuard({ name: 'pwsh', arguments: { command: 'Get-ChildItem' } })).toBeUndefined()
  })
})
