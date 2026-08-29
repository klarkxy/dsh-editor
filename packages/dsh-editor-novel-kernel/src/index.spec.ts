import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { NOVEL_KNOWLEDGE_TOOL_NAME, PROPOSAL_TOOL_NAME } from './contracts.ts'
import { apply, inject, name } from './index.ts'

describe('novel-kernel Host entry', () => {
  it('registers the two tools, guard and prompt section exactly once', () => {
    const tools: unknown[] = []
    const guards: unknown[] = []
    const sections: unknown[] = []
    const cleanup = vi.fn()
    const ctx = {
      tools: {
        register: (tool: unknown) => tools.push(tool),
        guard: (guard: unknown) => { guards.push(guard); return cleanup },
      },
      systemPrompt: { section: (section: unknown) => sections.push(section) },
      effect: (setup: () => unknown) => setup(),
    } as unknown as Context

    apply(ctx)

    expect(name).toBe('dsh-editor-novel-kernel')
    expect(inject).toEqual(['tools', 'systemPrompt'])
    expect(tools.map((tool) => (tool as { name: string }).name)).toEqual([NOVEL_KNOWLEDGE_TOOL_NAME, PROPOSAL_TOOL_NAME])
    expect(guards).toHaveLength(1)
    expect(sections).toEqual([{ name: 'dsh-editor:novel-kernel', order: 90, text: expect.stringContaining('novel_propose') }])
  })
})
