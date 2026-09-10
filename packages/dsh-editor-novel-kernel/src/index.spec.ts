import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  AUTHOR_OBSERVE_TOOL_NAME,
  NOVEL_INDEX_WRITE_TOOL_NAME,
  NOVEL_KNOWLEDGE_TOOL_NAME,
  NOVEL_SCRATCH_LIST_TOOL_NAME,
  NOVEL_SCRATCH_READ_TOOL_NAME,
  NOVEL_SCRATCH_WRITE_TOOL_NAME,
  PROPOSAL_TOOL_NAME,
} from './contracts.ts'
import { apply, inject, name } from './index.ts'

describe('novel-kernel Host entry', () => {
  it('registers only the seven novel tools, guard and prompt without requiring Zhihu', () => {
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
      sandboxPolicy: { resolve: vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: '/tmp' })) },
      effect: (setup: () => unknown) => setup(),
      provide: vi.fn(),
    } as unknown as Context

    apply(ctx)

    expect(name).toBe('dsh-editor-novel-kernel')
    expect(inject).toEqual(['tools', 'systemPrompt', 'fs', 'sandboxPolicy'])
    expect(tools.map((tool) => (tool as { name: string }).name)).toEqual([
      NOVEL_KNOWLEDGE_TOOL_NAME,
      PROPOSAL_TOOL_NAME,
      AUTHOR_OBSERVE_TOOL_NAME,
      NOVEL_INDEX_WRITE_TOOL_NAME,
      NOVEL_SCRATCH_WRITE_TOOL_NAME,
      NOVEL_SCRATCH_READ_TOOL_NAME,
      NOVEL_SCRATCH_LIST_TOOL_NAME,
    ])
    expect(guards).toHaveLength(1)
    expect(sections).toEqual([{ name: 'dsh-editor:novel-kernel', order: 90, text: expect.stringContaining('novel_propose') }])
  })
})
