import type { Context } from '@deepseek-ai/cordis'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { FileSystemLike, FsDirEntryLike } from 'dsh-manuscript/host-api'
import { WRITING_PROPOSE_TOOL_NAME } from 'dsh-manuscript/host-api'
import { AUTHOR_OBSERVE_TOOL_NAME } from './author-memory.ts'
import { MEMORY_UPDATE_TOOL_NAME } from './memory-tool.ts'
import { installNovelWorkbenchTools } from './novel-tools.ts'
import { apply } from './tools.ts'
import { NOVEL_OVERVIEW_TOOL_NAME } from './workbench-tools.ts'

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
    expect(names()).toEqual([WRITING_PROPOSE_TOOL_NAME, AUTHOR_OBSERVE_TOOL_NAME])
    expect(names().some((name) => name.startsWith('novel_'))).toBe(false)
  })

  it('installNovelWorkbenchTools registers only novel_overview and novel_memory_update', () => {
    const { ctx, names } = registrationCtx()
    installNovelWorkbenchTools(ctx)
    expect(names()).toEqual([NOVEL_OVERVIEW_TOOL_NAME, MEMORY_UPDATE_TOOL_NAME])
    expect(names().filter((name) => name === AUTHOR_OBSERVE_TOOL_NAME)).toHaveLength(0)
  })

  it('generic apply plus novel installer registers author_observe exactly once', () => {
    const { ctx, names } = registrationCtx()
    apply(ctx)
    installNovelWorkbenchTools(ctx)
    expect(names().filter((name) => name === AUTHOR_OBSERVE_TOOL_NAME)).toHaveLength(1)
    expect(names()).toEqual([
      WRITING_PROPOSE_TOOL_NAME,
      AUTHOR_OBSERVE_TOOL_NAME,
      NOVEL_OVERVIEW_TOOL_NAME,
      MEMORY_UPDATE_TOOL_NAME,
    ])
  })

  it('novel_overview resolves via exec.agent.session.id and live workspace, ignoring header.cwd', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-wb-isolation-'))
    try {
      await fs.mkdir(path.join(root, '正文'))
      await fs.writeFile(path.join(root, '正文', '001.md'), '# 第一章\n\n正文一', 'utf8')
      const resolveByPath = vi.fn(async () => ({ path: root, sessionIds: ['session-1'] }))
      const hostFs: FileSystemLike = {
        async resolve(value, opts) {
          const base = opts?.cwd ?? root
          const targetKey = path.resolve(base, value)
          return { targetKey, displayPath: targetKey }
        },
        contains(parent, child) {
          return child.targetKey === parent.targetKey || child.targetKey.startsWith(`${parent.targetKey}${path.sep}`)
        },
        async stat(target) {
          try {
            const value = await fs.stat(target.targetKey)
            return { type: value.isDirectory() ? 'directory' : 'file', version: `${value.mtimeMs}:${value.size}`, size: value.size }
          } catch {
            return undefined
          }
        },
        async lstat(value, opts) {
          try {
            const target = path.resolve(opts?.cwd ?? root, value)
            const state = await fs.lstat(target)
            return { type: state.isDirectory() ? 'directory' : 'file', version: `${state.mtimeMs}:${state.size}`, size: state.size }
          } catch {
            return undefined
          }
        },
        async readText(target) { return await fs.readFile(target.targetKey, 'utf8') },
        async listDir(target) {
          const entries = await fs.readdir(target.targetKey, { withFileTypes: true })
          return entries.map((entry): FsDirEntryLike => ({
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
            target: { targetKey: path.join(target.targetKey, entry.name), displayPath: path.join(target.targetKey, entry.name) },
          }))
        },
        async writeText() { throw new Error('not used') },
      }
      const { ctx, tools } = registrationCtx({
        sessions: { get: vi.fn((id: string) => id === 'session-1' ? { id: 'session-1', header: { cwd: root } } : undefined) },
        workspaceRegistry: { resolveByPath },
        sandboxPolicy: { resolve: vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: root, sessionId: 'session-1' })) },
        fs: hostFs,
      })
      installNovelWorkbenchTools(ctx)
      const overview = tools.find((tool) => tool.name === NOVEL_OVERVIEW_TOOL_NAME)
      if (!overview) throw new Error('missing novel_overview')
      const value = await overview.execute({}, {
        signal: new AbortController().signal,
        agent: { session: { id: 'session-1', header: { cwd: '/forged/outside' } } },
      }) as { chapters: Array<{ path: string }> }
      expect(resolveByPath).toHaveBeenCalledWith(root)
      expect(resolveByPath).not.toHaveBeenCalledWith('/forged/outside')
      expect(value.chapters.map((chapter) => chapter.path)).toEqual(['正文/001.md'])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
