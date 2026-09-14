import { describe, expect, it } from 'vitest'
import {
  createProposalTool,
  editorToolGuard,
  EDITOR_PROMPT,
  MEMORY_MAINTENANCE_PROMPT,
} from '../packages/dsh-editor-novel-kernel/src/proposal-tool.ts'
import { parseMemoryUpdate } from '../packages/dsh-editor-workbench/src/memory.ts'

describe('author-first prewriting boundary', () => {
  it('directs chapter planning into visible outline Markdown before drafting', () => {
    expect(EDITOR_PROMPT).toContain('开始正文前')
    expect(EDITOR_PROMPT).toContain('章纲统一写入 大纲/')
    expect(EDITOR_PROMPT).toContain('不要求作者回头补章纲或章末小结')
    expect(MEMORY_MAINTENANCE_PROMPT).toContain('写后整理')
    expect(MEMORY_MAINTENANCE_PROMPT).not.toContain('chapter_summary')
  })

  it('rejects hidden chapter-plan and post-draft summary proposals', async () => {
    const execute = createProposalTool().execute as unknown as (args: unknown) => Promise<unknown>
    for (const input of [
      { kind: 'chapter_plan', path: '正文/001.md', summary: '章纲', beats: ['下山'] },
      { kind: 'chapter_summary', path: '正文/001.md', summary: '小结', state: { now: '面馆' } },
    ]) {
      expect(editorToolGuard({ name: 'novel_propose', arguments: input })).toContain('大纲/')
      await expect(execute(input)).rejects.toThrow('大纲/')
    }
  })

  it('keeps the memory tool away from manuscript and chapter summaries', () => {
    expect(() => parseMemoryUpdate({
      path: '正文/001.md',
      operation: 'chapter_summary',
      category: 'fact',
      certainty: 'explicit',
      summary: '小结',
      expectedVersion: 'v1',
      state: { now: '面馆' },
      evidence: [{ kind: 'file', path: '正文/001.md', version: 'v1', quote: '正文' }],
    })).toThrow()
  })
})
