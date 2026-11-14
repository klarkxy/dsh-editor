import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { WRITING_PROPOSE_TOOL_NAME } from 'dsh-manuscript/host-api'
import { AUTHOR_OBSERVE_TOOL_NAME } from '../memory/author-memory.ts'
import { MEMORY_UPDATE_TOOL_NAME } from '../memory/memory-tool.ts'
import { installNovelMemoryTool } from '../tools/novel-tools.ts'
import { apply } from '../tools/tools.ts'

type RegisteredTool = { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }

function registrationCtx(extra: Record<string, unknown> = {}) {
  const tools: RegisteredTool[] = []
  const ctx = {
    effect: (setup: () => unknown) => setup(),
    on: () => undefined,
    tools: { register: (tool: unknown) => tools.push(tool as RegisteredTool) },
    get: () => undefined,
    ...extra,
  }
  return { ctx: ctx as unknown as Context, tools, names: () => tools.map((tool) => tool.name) }
}

describe('workbench tool isolation', () => {
  it('generic apply (writing / article / technical) registers writing_propose and author_observe only', () => {
    const { ctx, names } = registrationCtx()
    apply(ctx)
    expect(names()).toEqual([WRITING_PROPOSE_TOOL_NAME, AUTHOR_OBSERVE_TOOL_NAME, 'conversation_search', 'conversation_read', 'conversation_wrap_up'])
    expect(names().some((name) => name.startsWith('novel_'))).toBe(false)
  })

  it('installNovelMemoryTool registers only novel_memory_update', () => {
    const { ctx, names } = registrationCtx()
    installNovelMemoryTool(ctx)
    expect(names()).toEqual([MEMORY_UPDATE_TOOL_NAME])
    expect(names().filter((name) => name === AUTHOR_OBSERVE_TOOL_NAME)).toHaveLength(0)
  })

  it('generic apply plus novel installer registers author_observe exactly once', () => {
    const { ctx, names } = registrationCtx()
    apply(ctx)
    installNovelMemoryTool(ctx)
    expect(names().filter((name) => name === AUTHOR_OBSERVE_TOOL_NAME)).toHaveLength(1)
    expect(names()).toEqual([
      WRITING_PROPOSE_TOOL_NAME,
      AUTHOR_OBSERVE_TOOL_NAME,
      'conversation_search',
      'conversation_read',
      'conversation_wrap_up',
      MEMORY_UPDATE_TOOL_NAME,
    ])
  })
})
