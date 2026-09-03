import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  AUTHOR_OBSERVE_TOOL_NAME,
  NOVEL_KNOWLEDGE_TOOL_NAME,
  NOVEL_SEARCH_TOOL_NAME,
  PROPOSAL_TOOL_NAME,
  PROJECT_KNOWLEDGE_TOOL_NAME,
  ZHIHU_ASK_TOOL_NAME,
  ZHIHU_GLOBAL_SEARCH_TOOL_NAME,
  ZHIHU_HOT_LIST_TOOL_NAME,
  ZHIHU_KNOWLEDGE_SEARCH_TOOL_NAME,
  ZHIHU_SEARCH_TOOL_NAME,
} from './contracts.ts'
import { apply, inject, name } from './index.ts'

describe('novel-kernel Host entry', () => {
  it('registers the nine tools, guard and prompt section exactly once', () => {
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
    expect(inject).toEqual(['tools', 'systemPrompt', 'fs', 'credentials', 'connection'])
    expect(tools.map((tool) => (tool as { name: string }).name)).toEqual([
      NOVEL_KNOWLEDGE_TOOL_NAME,
      PROPOSAL_TOOL_NAME,
      AUTHOR_OBSERVE_TOOL_NAME,
      ZHIHU_SEARCH_TOOL_NAME,
      ZHIHU_GLOBAL_SEARCH_TOOL_NAME,
      ZHIHU_HOT_LIST_TOOL_NAME,
      ZHIHU_ASK_TOOL_NAME,
      ZHIHU_KNOWLEDGE_SEARCH_TOOL_NAME,
      PROJECT_KNOWLEDGE_TOOL_NAME,
      NOVEL_SEARCH_TOOL_NAME,
    ])
    expect(guards).toHaveLength(1)
    expect(sections).toEqual([{ name: 'dsh-editor:novel-kernel', order: 90, text: expect.stringContaining('novel_propose') }])
  })

  it('serves the zhihu knowledge RPC channel and rejects unknown endpoints', async () => {
    let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
    const ctx = {
      tools: { register: () => undefined, guard: () => () => undefined },
      systemPrompt: { section: () => undefined },
      fs: {
        resolve: vi.fn(async (path: string) => ({ targetKey: path, displayPath: path })),
        readText: vi.fn(async () => ''),
      },
      credentials: { resolve: vi.fn(async () => undefined) },
      connection: {
        rpc: {
          handle: (_channel: string, fn: typeof handler, _options: unknown) => { handler = fn; return () => undefined },
        },
      },
      effect: (setup: () => unknown) => setup(),
    } as unknown as Context

    apply(ctx)
    expect(handler).toBeDefined()
    const signal = new AbortController().signal
    await expect(handler!('zhihu.knowledge.upload', { fileName: 'a.md' }, signal))
      .resolves.toMatchObject({ ok: false, error: { message: expect.stringContaining('缺少文件内容') } })
    await expect(handler!('nope', {}, signal))
      .resolves.toMatchObject({ ok: false, error: { message: expect.stringContaining('unknown endpoint nope') } })
  })
})
