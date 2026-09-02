import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  NOVEL_KNOWLEDGE_TOOL_NAME,
  PROPOSAL_TOOL_NAME,
  PROJECT_KNOWLEDGE_TOOL_NAME,
  ZHIHU_SEARCH_TOOL_NAME,
} from './contracts.ts'
import { apply, inject, name } from './index.ts'

describe('novel-kernel Host entry', () => {
  it('registers the four tools, guard and prompt section exactly once', () => {
    const tools: unknown[] = []
    const guards: unknown[] = []
    const sections: unknown[] = []
    const cleanup = vi.fn()
    const fs = {
      resolve: vi.fn(async (path: string) => ({ targetKey: path, displayPath: path })),
      readText: vi.fn(async () => ''),
    }
    const credentials = {
      resolve: vi.fn(async () => undefined),
    }
    const ctx = {
      tools: {
        register: (tool: unknown) => tools.push(tool),
        guard: (guard: unknown) => { guards.push(guard); return cleanup },
      },
      systemPrompt: { section: (section: unknown) => sections.push(section) },
      fs,
      credentials,
      effect: (setup: () => unknown) => setup(),
    } as unknown as Context

    apply(ctx)

    expect(name).toBe('dsh-editor-novel-kernel')
    expect(inject).toEqual(['tools', 'systemPrompt', 'fs', 'credentials'])
    expect(tools.map((tool) => (tool as { name: string }).name)).toEqual([
      NOVEL_KNOWLEDGE_TOOL_NAME,
      PROPOSAL_TOOL_NAME,
      ZHIHU_SEARCH_TOOL_NAME,
      PROJECT_KNOWLEDGE_TOOL_NAME,
    ])
    expect(guards).toHaveLength(1)
    expect(sections).toEqual([{ name: 'dsh-editor:novel-kernel', order: 90, text: expect.stringContaining('novel_propose') }])
  })
})
