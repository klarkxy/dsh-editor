import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { FileSystemLike, ManuscriptHost, SessionLike } from 'dsh-manuscript/host-api'
import { apply as applyWorkbenchTools } from 'dsh-editor-workbench/tools'
import {
  AUTHOR_OBSERVE_TOOL_NAME,
  NOVEL_INDEX_PATH,
  NOVEL_INDEX_WRITE_TOOL_NAME,
  NOVEL_KNOWLEDGE_TOOL_NAME,
  NOVEL_OVERVIEW_TOOL_NAME,
  NOVEL_SCRATCH_LIST_TOOL_NAME,
  NOVEL_SCRATCH_READ_TOOL_NAME,
  NOVEL_SCRATCH_WRITE_TOOL_NAME,
  PROPOSAL_TOOL_NAME,
  SCRATCH_DIRECTORY,
} from './contracts.ts'
import {
  apply,
  inject,
  name,
  NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE,
  NOVEL_KERNEL_LEGACY_MODE,
  resolveNovelKernelMode,
} from './index.ts'

type Tool = { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }

function abortError(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function kernelFixture(label: string, options: { live?: boolean; member?: boolean } = {}) {
  const canonical = `/mem/dsh-editor-novel-kernel/${label}`
  const resolveCalls: Array<{ path: string; cwd?: string }> = []
  const writes: Array<{ path: string; content: string }> = []
  const files = new Map<string, string>()
  const session: SessionLike = { id: 'session-1', header: { cwd: '/header/workspace' } }
  let live = options.live !== false
  let afterList: (() => void) | undefined
  const tools: Tool[] = []
  const fs: FileSystemLike = {
    async resolve(path, opts) {
      throwIfAborted(opts?.signal)
      resolveCalls.push({ path, cwd: opts?.cwd })
      const cwd = opts?.cwd ?? canonical
      const targetKey = path === '.' ? cwd : `${cwd}/${path}`
      return { targetKey, displayPath: targetKey }
    },
    contains(parent, child) {
      return child.targetKey === parent.targetKey || child.targetKey.startsWith(`${parent.targetKey}/`)
    },
    async stat(target, signal) {
      throwIfAborted(signal)
      if (target.targetKey === canonical) return { type: 'directory', version: 'root' }
      return { type: 'file', version: 'v1', size: 1 }
    },
    async lstat() { return undefined },
    async readText(target, signal) {
      throwIfAborted(signal)
      const relative = target.targetKey.slice(canonical.length + 1)
      const text = files.get(relative)
      if (text === undefined) throw new Error('missing')
      return text
    },
    async listDir(target, signal) {
      throwIfAborted(signal)
      afterList?.()
      const prefix = `${canonical}/${SCRATCH_DIRECTORY}`
      if (target.targetKey !== prefix && !target.targetKey.startsWith(`${prefix}/`)) return []
      const scope = target.targetKey === prefix ? '' : target.targetKey.slice(prefix.length + 1)
      const names = new Set<string>()
      const entries: Array<{ name: string; type: 'file' | 'directory' | 'other'; target: { targetKey: string; displayPath: string } }> = []
      for (const path of files.keys()) {
        if (!path.startsWith(`${SCRATCH_DIRECTORY}/`)) continue
        const rest = path.slice(`${SCRATCH_DIRECTORY}/`.length)
        if (scope && (rest === scope || !rest.startsWith(`${scope}/`))) continue
        const tail = scope ? rest.slice(scope.length + 1) : rest
        const name = tail.split('/')[0]
        if (!name || names.has(name)) continue
        names.add(name)
        const isFile = !tail.includes('/')
        entries.push({
          name,
          type: isFile ? 'file' : 'directory',
          target: { targetKey: `${prefix}/${scope ? `${scope}/` : ''}${name}`, displayPath: name },
        })
      }
      return entries
    },
    async writeText(target, content, _expected, signal) {
      throwIfAborted(signal)
      writes.push({ path: target.targetKey, content })
      files.set(target.targetKey.slice(canonical.length + 1), content)
      return { operation: 'create' as const, version: 'v1', before: null, after: content }
    },
  }
  const host = {
    sessions: { get: vi.fn((id: string) => live && id === 'session-1' ? session : undefined) },
    workspaceRegistry: {
      resolveByPath: vi.fn(async () => ({ path: canonical, sessionIds: options.member === false ? [] : ['session-1'] })),
    },
    sandboxPolicy: {
      resolve: vi.fn(() => ({ mode: 'workspace-write' as const, workspaceRoot: canonical, sessionId: 'session-1' })),
    },
    fs,
    tools: {
      register: (tool: unknown) => tools.push(tool as Tool),
      guard: () => () => undefined,
    },
    systemPrompt: { section: vi.fn() },
    effect: (setup: () => unknown) => setup(),
    provide: vi.fn(),
  }
  apply(host as unknown as Context, { mode: NOVEL_KERNEL_LEGACY_MODE })
  const exec = (sessionId = 'session-1', cwd = '/forged/outside', signal = new AbortController().signal) => ({
    signal,
    agent: { session: { id: sessionId, header: { cwd } } },
  })
  const tool = (toolName: string) => {
    const found = tools.find((item) => item.name === toolName)
    if (!found) throw new Error(`missing tool ${toolName}`)
    return found
  }
  return {
    host: host as unknown as ManuscriptHost,
    tools,
    canonical,
    resolveCalls,
    writes,
    files,
    exec,
    tool,
    dropSession() { live = false },
    onAfterList(callback: () => void) { afterList = callback },
  }
}

const NOVEL_MEMORY_UPDATE_TOOL_NAME = 'novel_memory_update'
const WRITING_PROPOSE_TOOL_NAME = 'writing_propose'

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
    fs: {
      resolve: vi.fn(async (path: string) => ({ targetKey: path, displayPath: path })),
      readText: vi.fn(async () => ''),
    },
    sandboxPolicy: { resolve: vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: '/tmp' })) },
    sessions: { get: vi.fn() },
    workspaceRegistry: { resolveByPath: vi.fn() },
    effect: (setup: () => unknown) => setup(),
    on: () => undefined,
    get: () => undefined,
    provide: vi.fn(),
  } as unknown as Context
  return { ctx, tools, guards, sections, names: () => tools.map((tool) => tool.name) }
}

describe('novel-kernel Host entry', () => {
  it('registers novel-only tools via the workbench installer and does not register author_observe', () => {
    const { ctx, names, guards, sections } = registrationHost()
    apply(ctx, { mode: NOVEL_KERNEL_LEGACY_MODE })

    expect(name).toBe('dsh-editor-novel-kernel')
    expect(inject).toEqual(['tools', 'systemPrompt', 'fs', 'sandboxPolicy', 'sessions', 'workspaceRegistry'])
    expect(names()).toEqual([
      NOVEL_KNOWLEDGE_TOOL_NAME,
      PROPOSAL_TOOL_NAME,
      NOVEL_INDEX_WRITE_TOOL_NAME,
      NOVEL_SCRATCH_WRITE_TOOL_NAME,
      NOVEL_SCRATCH_READ_TOOL_NAME,
      NOVEL_SCRATCH_LIST_TOOL_NAME,
      NOVEL_OVERVIEW_TOOL_NAME,
      NOVEL_MEMORY_UPDATE_TOOL_NAME,
    ])
    expect(names().filter((toolName) => toolName === AUTHOR_OBSERVE_TOOL_NAME)).toHaveLength(0)
    expect(guards).toHaveLength(1)
    expect(sections).toEqual([{ name: 'dsh-editor:novel-kernel', order: 90, text: expect.stringContaining('novel_propose') }])
    expect(ctx.provide).not.toHaveBeenCalled()
  })

  it('generic/article/technical mount only workbench tools and have no novel_*', () => {
    const { ctx, names } = registrationHost()
    applyWorkbenchTools(ctx)
    expect(names()).toEqual([WRITING_PROPOSE_TOOL_NAME, AUTHOR_OBSERVE_TOOL_NAME])
    expect(names().some((toolName) => toolName.startsWith('novel_'))).toBe(false)
  })

  it('novel/legacy mount workbench tools plus kernel: no duplicate author_observe, novel_* present', () => {
    const { ctx, names } = registrationHost()
    applyWorkbenchTools(ctx)
    apply(ctx, { mode: NOVEL_KERNEL_LEGACY_MODE })
    expect(names().filter((toolName) => toolName === AUTHOR_OBSERVE_TOOL_NAME)).toHaveLength(1)
    expect(names()).toContain(WRITING_PROPOSE_TOOL_NAME)
    expect(names()).toEqual(expect.arrayContaining([
      NOVEL_KNOWLEDGE_TOOL_NAME,
      PROPOSAL_TOOL_NAME,
      NOVEL_OVERVIEW_TOOL_NAME,
      NOVEL_MEMORY_UPDATE_TOOL_NAME,
    ]))
    expect(names().filter((toolName) => toolName.startsWith('novel_'))).toHaveLength(8)
  })

  it('omitted, null, and empty config fail closed instead of resolving to the full surface', () => {
    expect(() => resolveNovelKernelMode(undefined)).toThrow(/requires an explicit mode/)
    expect(() => resolveNovelKernelMode(null)).toThrow(/requires an explicit mode/)
    expect(() => resolveNovelKernelMode({})).toThrow(/requires an explicit mode/)
    const { ctx, names, guards, sections } = registrationHost()
    expect(() => apply(ctx, undefined)).toThrow(/requires an explicit mode/)
    expect(names()).toEqual([])
    expect(guards).toHaveLength(0)
    expect(sections).toEqual([])
  })

  it('legacy and full config resolve to the historical full surface', () => {
    expect(resolveNovelKernelMode({ mode: NOVEL_KERNEL_LEGACY_MODE })).toBe(NOVEL_KERNEL_LEGACY_MODE)
    expect(resolveNovelKernelMode({ mode: 'full' })).toBe(NOVEL_KERNEL_LEGACY_MODE)
    expect(resolveNovelKernelMode(NOVEL_KERNEL_LEGACY_MODE)).toBe(NOVEL_KERNEL_LEGACY_MODE)
    expect(resolveNovelKernelMode('full')).toBe(NOVEL_KERNEL_LEGACY_MODE)
    for (const config of [{ mode: NOVEL_KERNEL_LEGACY_MODE }, { mode: 'full' }] as const) {
      const { ctx, names, guards, sections } = registrationHost()
      apply(ctx, config)
      expect(names()).toEqual([
        NOVEL_KNOWLEDGE_TOOL_NAME,
        PROPOSAL_TOOL_NAME,
        NOVEL_INDEX_WRITE_TOOL_NAME,
        NOVEL_SCRATCH_WRITE_TOOL_NAME,
        NOVEL_SCRATCH_READ_TOOL_NAME,
        NOVEL_SCRATCH_LIST_TOOL_NAME,
        NOVEL_OVERVIEW_TOOL_NAME,
        NOVEL_MEMORY_UPDATE_TOOL_NAME,
      ])
      expect(guards).toHaveLength(1)
      expect(sections).toHaveLength(1)
    }
  })

  it('knowledge-only registers novel_knowledge and nothing that writes or maintains legacy state', () => {
    expect(resolveNovelKernelMode({ mode: NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE })).toBe(NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE)
    expect(resolveNovelKernelMode(NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE)).toBe(NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE)
    const { ctx, names, guards, sections } = registrationHost()
    apply(ctx, { mode: NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE })
    expect(names()).toEqual([NOVEL_KNOWLEDGE_TOOL_NAME])
    expect(names().some((toolName) => (
      toolName === PROPOSAL_TOOL_NAME
      || toolName === NOVEL_INDEX_WRITE_TOOL_NAME
      || toolName === NOVEL_SCRATCH_WRITE_TOOL_NAME
      || toolName === NOVEL_SCRATCH_READ_TOOL_NAME
      || toolName === NOVEL_SCRATCH_LIST_TOOL_NAME
      || toolName === NOVEL_OVERVIEW_TOOL_NAME
      || toolName === NOVEL_MEMORY_UPDATE_TOOL_NAME
    ))).toBe(false)
    expect(guards).toHaveLength(0)
    expect(sections).toEqual([])
    expect(ctx.provide).not.toHaveBeenCalled()
  })

  it('new novel preset is workbench tools plus knowledge-only: writing_propose, author_observe, novel_knowledge', () => {
    const { ctx, names } = registrationHost()
    applyWorkbenchTools(ctx)
    apply(ctx, { mode: NOVEL_KERNEL_KNOWLEDGE_ONLY_MODE })
    expect(names()).toEqual([
      WRITING_PROPOSE_TOOL_NAME,
      AUTHOR_OBSERVE_TOOL_NAME,
      NOVEL_KNOWLEDGE_TOOL_NAME,
    ])
    expect(names().filter((toolName) => toolName.startsWith('novel_'))).toEqual([NOVEL_KNOWLEDGE_TOOL_NAME])
  })

  it('rejects an unknown kernel mode instead of falling back to the full surface', () => {
    expect(() => resolveNovelKernelMode({ mode: 'knowledge_only' })).toThrow(/unknown mode/)
    const { ctx, names, guards, sections } = registrationHost()
    expect(() => apply(ctx, { mode: 'knowledge_only' })).toThrow(/unknown mode/)
    expect(names()).toEqual([])
    expect(guards).toHaveLength(0)
    expect(sections).toEqual([])
  })

  it('writes the fixed index path on the registered workspace, ignoring a forged exec cwd', async () => {
    const { tool, exec, writes, canonical, resolveCalls, host } = kernelFixture('index-write')
    await expect(tool(NOVEL_INDEX_WRITE_TOOL_NAME).execute({ text: '# 作品索引' }, exec())).resolves.toMatchObject({
      path: NOVEL_INDEX_PATH,
      chars: '# 作品索引'.length,
    })
    expect(host.workspaceRegistry.resolveByPath).toHaveBeenCalledWith('/header/workspace')
    expect(writes).toEqual([{ path: `${canonical}/${NOVEL_INDEX_PATH}`, content: '# 作品索引' }])
    expect(resolveCalls.every((call) => call.cwd === undefined || call.cwd === canonical)).toBe(true)
    expect(resolveCalls.some((call) => call.path === NOVEL_INDEX_PATH)).toBe(true)
    expect(resolveCalls.some((call) => call.cwd === '/forged/outside')).toBe(false)
  })

  it('does not write the index when the session is gone or not attached', async () => {
    const removed = kernelFixture('index-removed', { live: false })
    await expect(removed.tool(NOVEL_INDEX_WRITE_TOOL_NAME).execute({ text: '# 作品索引' }, removed.exec())).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    })
    expect(removed.writes).toEqual([])

    const mismatch = kernelFixture('index-mismatch', { member: false })
    await expect(mismatch.tool(NOVEL_INDEX_WRITE_TOOL_NAME).execute({ text: '# 作品索引' }, mismatch.exec())).rejects.toMatchObject({
      code: 'WORKSPACE_MISMATCH',
    })
    expect(mismatch.writes).toEqual([])
  })

  it('does not write the index when the tool signal is aborted', async () => {
    const { tool, exec, writes } = kernelFixture('index-abort')
    const controller = new AbortController()
    controller.abort()
    await expect(tool(NOVEL_INDEX_WRITE_TOOL_NAME).execute({ text: '# 作品索引' }, exec('session-1', '/forged/outside', controller.signal)))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(writes).toEqual([])
  })

  it('serializes two index writes on the same workspace', async () => {
    const { tool, exec, host, writes } = kernelFixture('index-serial')
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const originalWrite = host.fs.writeText.bind(host.fs)
    let first = true
    host.fs.writeText = (async (target, content, expected, signal, policy) => {
      if (first) {
        first = false
        await held
      }
      return originalWrite(target, content, expected, signal, policy)
    }) as typeof host.fs.writeText
    const firstWrite = tool(NOVEL_INDEX_WRITE_TOOL_NAME).execute({ text: '# one' }, exec())
    const secondWrite = tool(NOVEL_INDEX_WRITE_TOOL_NAME).execute({ text: '# two' }, exec())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(writes).toEqual([])
    release()
    await Promise.all([firstWrite, secondWrite])
    expect(writes.map((row) => row.content)).toEqual(['# one', '# two'])
  })

  it('keeps scratch read/list/write on the live workspace and the fixed scratch directory', async () => {
    const { tool, exec, writes, files, canonical, resolveCalls } = kernelFixture('scratch-roundtrip')
    files.set(`${SCRATCH_DIRECTORY}/笔记.md`, '已有')
    await expect(tool(NOVEL_SCRATCH_READ_TOOL_NAME).execute({ path: '笔记.md' }, exec())).resolves.toEqual({
      version: 1,
      path: '笔记.md',
      text: '已有',
    })
    await expect(tool(NOVEL_SCRATCH_LIST_TOOL_NAME).execute({}, exec())).resolves.toEqual({
      version: 1,
      files: ['笔记.md'],
    })
    await tool(NOVEL_SCRATCH_WRITE_TOOL_NAME).execute({ path: '分析/线索.md', text: '草稿' }, exec())
    expect(writes.map((row) => row.path)).toEqual([
      `${canonical}/${SCRATCH_DIRECTORY}/.gitignore`,
      `${canonical}/${SCRATCH_DIRECTORY}/分析/线索.md`,
    ])
    expect(writes[0]?.content).toBe('*\n')
    expect(resolveCalls.filter((call) => call.path !== '.').every((call) => (
      call.path === NOVEL_INDEX_PATH || call.path === SCRATCH_DIRECTORY || call.path.startsWith(`${SCRATCH_DIRECTORY}/`)
    ))).toBe(true)
    expect(resolveCalls.some((call) => call.cwd === '/forged/outside')).toBe(false)
  })

  it('does not write scratch after list if the session disappears', async () => {
    const listed = kernelFixture('scratch-list-then-gone')
    await expect(listed.tool(NOVEL_SCRATCH_LIST_TOOL_NAME).execute({}, listed.exec())).resolves.toEqual({ version: 1, files: [] })
    listed.dropSession()
    await expect(listed.tool(NOVEL_SCRATCH_WRITE_TOOL_NAME).execute({ path: 'x.md', text: 'nope' }, listed.exec())).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    })
    expect(listed.writes).toEqual([])

    const duringWrite = kernelFixture('scratch-list-inside-write')
    let lists = 0
    duringWrite.onAfterList(() => {
      lists += 1
      if (lists >= 2) duringWrite.dropSession()
    })
    await expect(duringWrite.tool(NOVEL_SCRATCH_WRITE_TOOL_NAME).execute({ path: 'x.md', text: 'nope' }, duringWrite.exec())).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    })
    expect(duringWrite.writes).toEqual([])
  })

  it('does not write scratch when the session is stale, mismatched, or aborted', async () => {
    const removed = kernelFixture('scratch-removed', { live: false })
    await expect(removed.tool(NOVEL_SCRATCH_WRITE_TOOL_NAME).execute({ path: 'x.md', text: 'nope' }, removed.exec())).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    })
    await expect(removed.tool(NOVEL_SCRATCH_READ_TOOL_NAME).execute({ path: 'x.md' }, removed.exec())).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    })
    expect(removed.writes).toEqual([])

    const mismatch = kernelFixture('scratch-mismatch', { member: false })
    await expect(mismatch.tool(NOVEL_SCRATCH_WRITE_TOOL_NAME).execute({ path: 'x.md', text: 'nope' }, mismatch.exec())).rejects.toMatchObject({
      code: 'WORKSPACE_MISMATCH',
    })
    expect(mismatch.writes).toEqual([])

    const aborted = kernelFixture('scratch-abort')
    const controller = new AbortController()
    controller.abort()
    await expect(aborted.tool(NOVEL_SCRATCH_WRITE_TOOL_NAME).execute({ path: 'x.md', text: 'nope' }, aborted.exec('session-1', '/forged/outside', controller.signal)))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(aborted.writes).toEqual([])
  })

  it('serializes two scratch writes on the same workspace, including gitignore and the target', async () => {
    const { tool, exec, host, writes } = kernelFixture('scratch-serial')
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const originalWrite = host.fs.writeText.bind(host.fs)
    let heldOnce = false
    host.fs.writeText = (async (target, content, expected, signal, policy) => {
      if (!heldOnce) {
        heldOnce = true
        await held
      }
      return originalWrite(target, content, expected, signal, policy)
    }) as typeof host.fs.writeText
    const firstWrite = tool(NOVEL_SCRATCH_WRITE_TOOL_NAME).execute({ path: 'a.md', text: 'one' }, exec())
    const secondWrite = tool(NOVEL_SCRATCH_WRITE_TOOL_NAME).execute({ path: 'b.md', text: 'two' }, exec())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(writes).toEqual([])
    release()
    await Promise.all([firstWrite, secondWrite])
    expect(writes.map((row) => row.content)).toEqual(['*\n', 'one', '*\n', 'two'])
  })
})
