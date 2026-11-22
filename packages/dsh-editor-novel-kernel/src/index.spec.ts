import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply as applyWorkbenchTools } from 'dsh-editor-workbench/tools'
import { AUTHOR_OBSERVE_TOOL_NAME, NOVEL_KNOWLEDGE_TOOL_NAME } from './contracts.ts'
import {
  apply,
  inject,
  name,
  NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE,
  resolveNovelKernelMode,
} from './index.ts'

const NOVEL_MEMORY_UPDATE_TOOL_NAME = 'novel_memory_update'
const WRITING_CHANGE_TOOL_NAME = 'writing_change'
const REMOVED_TOOL_NAMES = [
  'novel_propose',
  'novel_index_write',
  'novel_scratch_write',
  'novel_scratch_read',
  'novel_scratch_list',
  'novel_overview',
]

function registrationHost() {
  const tools: Array<{ name: string }> = []
  const guards: unknown[] = []
  const sections: unknown[] = []
  const ctx = {
    tools: {
      register: (tool: unknown) => tools.push(tool as { name: string }),
      guard: (guard: unknown) => { guards.push(guard); return vi.fn() },
    },
    systemPrompt: { section: (section: unknown) => sections.push(section) },
    effect: (setup: () => unknown) => setup(),
    on: () => undefined,
    get: () => undefined,
    provide: vi.fn(),
  } as unknown as Context
  return { ctx, tools, guards, sections, names: () => tools.map((tool) => tool.name) }
}

describe('novel-kernel Host entry', () => {
  it('registers novel_knowledge and novel_memory_update and does not register author_observe', () => {
    const { ctx, names, guards, sections } = registrationHost()
    apply(ctx, { mode: NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE })

    expect(name).toBe('dsh-editor-novel-kernel')
    expect(inject).toEqual(['tools', 'fs', 'sandboxPolicy', 'sessions', 'workspaceRegistry'])
    expect(names()).toEqual([NOVEL_KNOWLEDGE_TOOL_NAME, NOVEL_MEMORY_UPDATE_TOOL_NAME])
    expect(names()).not.toContain(AUTHOR_OBSERVE_TOOL_NAME)
    expect(names().some((toolName) => REMOVED_TOOL_NAMES.includes(toolName))).toBe(false)
    expect(guards).toHaveLength(0)
    expect(sections).toEqual([])
    expect(ctx.provide).not.toHaveBeenCalled()
  })

  it('workbench tools register writing_propose, author_observe and conversation recall, and no novel_*', () => {
    const { ctx, names } = registrationHost()
    applyWorkbenchTools(ctx)
    expect(names()).toEqual([
      WRITING_CHANGE_TOOL_NAME,
      AUTHOR_OBSERVE_TOOL_NAME,
      'conversation_search',
      'conversation_read',
      'conversation_wrap_up',
    ])
    expect(names().some((toolName) => toolName.startsWith('novel_'))).toBe(false)
  })

  it('workbench tools plus the kernel register writing_propose, author_observe, novel_knowledge and novel_memory_update', () => {
    const { ctx, names } = registrationHost()
    applyWorkbenchTools(ctx)
    apply(ctx, { mode: NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE })
    expect(names()).toEqual([
      WRITING_CHANGE_TOOL_NAME,
      AUTHOR_OBSERVE_TOOL_NAME,
      'conversation_search',
      'conversation_read',
      'conversation_wrap_up',
      NOVEL_KNOWLEDGE_TOOL_NAME,
      NOVEL_MEMORY_UPDATE_TOOL_NAME,
    ])
    expect(names().filter((toolName) => toolName.startsWith('novel_'))).toEqual([
      NOVEL_KNOWLEDGE_TOOL_NAME,
      NOVEL_MEMORY_UPDATE_TOOL_NAME,
    ])
  })

  it('accepts omitted config and mode: knowledge-only, and ignores other keys', () => {
    expect(resolveNovelKernelMode(undefined)).toBe(NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE)
    expect(resolveNovelKernelMode(null)).toBe(NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE)
    expect(resolveNovelKernelMode({})).toBe(NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE)
    expect(resolveNovelKernelMode({ mode: undefined, leftover: true })).toBe(NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE)
    expect(resolveNovelKernelMode(NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE)).toBe(NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE)
    expect(resolveNovelKernelMode({ mode: NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE, extra: true })).toBe(NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE)
    const { ctx, names, guards, sections } = registrationHost()
    apply(ctx)
    expect(names()).toEqual([NOVEL_KNOWLEDGE_TOOL_NAME, NOVEL_MEMORY_UPDATE_TOOL_NAME])
    expect(guards).toHaveLength(0)
    expect(sections).toEqual([])
  })

  it('rejects removed legacy and full modes instead of mounting them', () => {
    for (const mode of ['legacy', 'full']) {
      expect(() => resolveNovelKernelMode(mode)).toThrow(/was removed/)
      expect(() => resolveNovelKernelMode({ mode })).toThrow(/was removed/)
      const { ctx, names, guards, sections } = registrationHost()
      expect(() => apply(ctx, { mode })).toThrow(/was removed/)
      expect(names()).toEqual([])
      expect(guards).toHaveLength(0)
      expect(sections).toEqual([])
    }
  })

  it('rejects an unknown kernel mode instead of mounting the knowledge surface', () => {
    expect(() => resolveNovelKernelMode({ mode: 'knowledge_only' })).toThrow(/unknown mode/)
    expect(() => resolveNovelKernelMode('knowledge_only')).toThrow(/unknown mode/)
    const { ctx, names, guards, sections } = registrationHost()
    expect(() => apply(ctx, { mode: 'knowledge_only' })).toThrow(/unknown mode/)
    expect(names()).toEqual([])
    expect(guards).toHaveLength(0)
    expect(sections).toEqual([])
  })
})
