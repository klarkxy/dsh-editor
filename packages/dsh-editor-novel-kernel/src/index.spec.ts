import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  AUTHOR_OBSERVE_TOOL_NAME,
  NOVEL_INDEX_WRITE_TOOL_NAME,
  NOVEL_KNOWLEDGE_TOOL_NAME,
  NOVEL_SCRATCH_LIST_TOOL_NAME,
  NOVEL_SCRATCH_READ_TOOL_NAME,
  NOVEL_SCRATCH_WRITE_TOOL_NAME,
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
  it('registers only the nine novel tools, guard and prompt without requiring Zhihu', () => {
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
    expect(inject).toEqual(['tools', 'systemPrompt', 'fs', 'connection', 'sandboxPolicy'])
    expect(tools.map((tool) => (tool as { name: string }).name)).toEqual([
      NOVEL_KNOWLEDGE_TOOL_NAME,
      PROPOSAL_TOOL_NAME,
      AUTHOR_OBSERVE_TOOL_NAME,
      PROJECT_KNOWLEDGE_TOOL_NAME,
      NOVEL_SEARCH_TOOL_NAME,
      NOVEL_INDEX_WRITE_TOOL_NAME,
      NOVEL_SCRATCH_WRITE_TOOL_NAME,
      NOVEL_SCRATCH_READ_TOOL_NAME,
      NOVEL_SCRATCH_LIST_TOOL_NAME,
    ])
    expect(guards).toHaveLength(1)
    expect(sections).toEqual([{ name: 'dsh-editor:novel-kernel', order: 90, text: expect.stringContaining('novel_propose') }])
  })

  it('keeps one legacy channel and forwards the unchanged payload and cancellation to the optional service', async () => {
    let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
    const call = vi.fn(async () => ({ ok: true, value: { bases: [] } }))
    let available = true
    const ctx = {
      tools: { register: () => undefined, guard: () => () => undefined },
      systemPrompt: { section: () => undefined },
      fs: { resolve: vi.fn(), readText: vi.fn() },
      get: (name: string) => name === 'zhihu' && available ? { call } : undefined,
      provide: vi.fn(),
      connection: { rpc: { handle: vi.fn((_channel: string, fn: typeof handler) => { handler = fn; return () => undefined }) } },
      effect: (setup: () => unknown) => setup(),
    } as unknown as Context
    apply(ctx)
    const signal = new AbortController().signal
    const payload = { days: 3 }
    await expect(handler!('zhihu.knowledge.bases', payload, signal)).resolves.toEqual({ ok: true, value: { bases: [] } })
    expect(call).toHaveBeenCalledExactlyOnceWith('zhihu.knowledge.bases', payload, signal)
    await expect(handler!('nope', {}, signal)).resolves.toMatchObject({ ok: false, error: { message: 'unknown endpoint nope' } })
    expect(call).toHaveBeenCalledTimes(1)
    available = false
    await expect(handler!('zhihu.knowledge.bases', {}, signal)).resolves.toMatchObject({ ok: false, error: { code: 'bad-request', message: '知乎插件未启用' } })
    expect(ctx.connection.rpc.handle).toHaveBeenCalledTimes(1)
  })
})
