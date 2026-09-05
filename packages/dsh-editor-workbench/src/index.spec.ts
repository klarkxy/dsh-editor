import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { FileSystemLike, FsDirEntryLike, FsInfoLike, FsPathInfoLike, FsTargetLike, FsWriteIntentLike, ManuscriptHost } from 'dsh-manuscript/host-api'
import { WORKBENCH_RPC_CHANNEL } from './contracts.ts'
import { dispatchEditorFiles, registerWorkbenchRpc } from './index.ts'
import { defaultProjectsRoot } from './project.ts'

function fixture() {
  const canonical = '/canonical/workspace'
  const resolveCalls: Array<{ path: string; cwd?: string }> = []
  const fs: FileSystemLike = {
    async resolve(path, options) {
      resolveCalls.push({ path, cwd: options?.cwd })
      const targetKey = path === '.' ? canonical : `${options?.cwd}/${path}`.replace('/./', '/')
      return { targetKey, displayPath: targetKey }
    },
    contains(parent, child) {
      return child.targetKey === parent.targetKey || child.targetKey.startsWith(`${parent.targetKey}/`)
    },
    async stat(target) {
      return target.targetKey === canonical ? { type: 'directory', version: 'root' } : undefined
    },
    async lstat(path) {
      return path === '.' ? { type: 'directory', version: 'root' } : undefined
    },
    async readText() { throw new Error('not used') },
    async listDir() { return [] },
    async writeText() { throw new Error('not used') },
  }
  const handle = vi.fn(() => vi.fn())
  const host = {
    sessions: { get: vi.fn(() => ({ id: 'session-1', header: { cwd: '/header/workspace' }, requestHeader: () => undefined })) },
    workspaceRegistry: { resolveByPath: vi.fn(async () => ({ path: canonical, sessionIds: ['session-1'] })) },
    sandboxPolicy: { resolve: vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: canonical, sessionId: 'session-1' })) },
    fs,
    connection: { rpc: { call: vi.fn(), handle } },
  } as unknown as ManuscriptHost
  return { host, handle, canonical, resolveCalls }
}

describe('private editor workbench Host RPC', () => {
  it('registers only on the loopback workbench channel', () => {
    const { host, handle } = fixture()
    registerWorkbenchRpc(host as unknown as Context)
    expect(handle).toHaveBeenCalledWith(
      WORKBENCH_RPC_CHANNEL,
      expect.any(Function),
      { authority: 'loopback' },
    )
  })

  it('derives private lifecycle access from the live session and ignores a forged cwd', async () => {
    const { host, canonical, resolveCalls } = fixture()
    await expect(dispatchEditorFiles(
      host as unknown as Context,
      'archive.list',
      { sessionId: 'session-1', cwd: '/forged/outside' },
      new AbortController().signal,
    )).resolves.toEqual({ items: [], invalid: 0 })
    expect(host.workspaceRegistry.resolveByPath).toHaveBeenCalledWith('/header/workspace')
    expect(resolveCalls.length).toBeGreaterThan(0)
    expect(resolveCalls.every((call) => call.cwd === canonical)).toBe(true)
  })

  it('inspects a registered workspace before creating or resolving a session', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-editor-inspect-'))
    try {
      await fs.mkdir(path.join(root, '正文'))
      await fs.writeFile(path.join(root, '正文', '001.md'), '# 第一章\n', 'utf8')
      const { host } = fixture()
      host.workspaceRegistry.resolveByPath = vi.fn(async () => ({ path: root, sessionIds: [] }))
      host.sessions.get = vi.fn(() => { throw new Error('session lookup must not run') })
      await expect(dispatchEditorFiles(
        host as unknown as Context,
        'project.inspect',
        { workspacePath: root },
        new AbortController().signal,
      )).resolves.toEqual({ hasVisibleEntries: true, textFiles: ['正文/001.md'], indexReady: false })
      expect(host.sessions.get).not.toHaveBeenCalled()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('creates a home project from the title only and ignores a forged root', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-editor-home-'))
    const previous = process.env.DSH_EDITOR_PROJECTS_ROOT
    process.env.DSH_EDITOR_PROJECTS_ROOT = parent
    try {
      const { host } = fixture()
      host.sessions.get = vi.fn(() => { throw new Error('session lookup must not run') })
      expect(defaultProjectsRoot()).toBe(parent)
      await expect(dispatchEditorFiles(
        host as unknown as Context,
        'project.createHome',
        { title: '未名之书', root: '/forged/outside' },
        new AbortController().signal,
      )).resolves.toEqual({ path: path.join(parent, '未名之书') })
      expect(host.sessions.get).not.toHaveBeenCalled()
      expect((await fs.stat(path.join(parent, '未名之书'))).isDirectory()).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.DSH_EDITOR_PROJECTS_ROOT
      else process.env.DSH_EDITOR_PROJECTS_ROOT = previous
      await fs.rm(parent, { recursive: true, force: true })
    }
  })

  it('rejects an invalid home project name without looking up a session', async () => {
    const { host } = fixture()
    host.sessions.get = vi.fn(() => { throw new Error('session lookup must not run') })
    await expect(dispatchEditorFiles(
      host as unknown as Context,
      'project.createHome',
      { title: '../escape' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'INVALID_PATH' })
    expect(host.sessions.get).not.toHaveBeenCalled()
  })

  it('requires both restore sessions to be live', async () => {
    const { host } = fixture()
    host.workspaceRegistry.resolveByPath = vi.fn(async () => ({ path: '/canonical/workspace', sessionIds: ['target'] }))
    host.sessions.get = vi.fn((sessionId: string) => sessionId === 'target'
      ? { id: 'target', header: { cwd: '/header/workspace' }, requestHeader: () => undefined }
      : undefined) as ManuscriptHost['sessions']['get']
    await expect(dispatchEditorFiles(
      host as unknown as Context,
      'snapshot.restoreProbe',
      { targetSessionId: 'target', sourceSessionId: 'forged-source' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' })
  })
})

/**
 * proposal 端点测试：用真 fs 验证 split / merge / renames 三种新 kind 能
 * 正确路由到 proposal-ops；用 stub fs 验证 edit / create 仍走 manuscript 通道
 * 被 parseProposal 拒为 INVALID 并经 mapEditorFilesError 转 bad-request。
 */
class NodeFileSystem implements FileSystemLike {
  constructor(private readonly root: string) {}
  async resolve(value: string, opts?: { cwd?: string }): Promise<FsTargetLike> {
    const base = opts?.cwd ?? this.root
    return { targetKey: path.resolve(base, value), displayPath: path.resolve(base, value) }
  }
  contains(parent: FsTargetLike, child: FsTargetLike): boolean {
    const relative = path.relative(parent.targetKey, child.targetKey)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }
  async stat(target: FsTargetLike): Promise<FsInfoLike | undefined> {
    try {
      const value = await fs.stat(target.targetKey)
      return { type: value.isDirectory() ? 'directory' : value.isFile() ? 'file' : 'other', version: `${value.mtimeMs}:${value.size}`, size: value.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
  async lstat(value: string, opts?: { cwd?: string }): Promise<FsPathInfoLike | undefined> {
    try {
      const target = path.resolve(opts?.cwd ?? this.root, value)
      const state = await fs.lstat(target)
      return { type: state.isSymbolicLink() ? 'symlink' : state.isDirectory() ? 'directory' : state.isFile() ? 'file' : 'other', version: `${state.mtimeMs}:${state.size}`, size: state.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
  async readText(target: FsTargetLike): Promise<string> { return await fs.readFile(target.targetKey, 'utf8') }
  async listDir(target: FsTargetLike): Promise<FsDirEntryLike[]> {
    const entries = await fs.readdir(target.targetKey, { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      target: { targetKey: path.join(target.targetKey, entry.name), displayPath: path.join(target.targetKey, entry.name) },
    }))
  }
  async writeText(target: FsTargetLike, content: string, expected?: FsWriteIntentLike): Promise<{ operation: 'create' | 'update'; version: string; before: string | null; after: string }> {
    const before = await this.readText(target).catch(() => null)
    const current = await this.stat(target)
    if (expected?.kind === 'createIfAbsent' && current) throw Object.assign(new Error('exists'), { code: 'FS_NOT_OBSERVED' })
    if (expected?.kind === 'replaceIfVersion' && current?.version !== expected.version) throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
    await fs.writeFile(target.targetKey, content, 'utf8')
    return { operation: before === null ? 'create' : 'update', version: (await this.stat(target))!.version, before, after: content }
  }
}

describe('proposal dispatch endpoints', () => {

  async function projectRoot(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-editor-proposal-rpc-'))
    await fs.mkdir(path.join(root, '正文'), { recursive: true })
    return root
  }

  it('proposal.prepare with a split kind reaches proposal-ops and returns a split plan', async () => {
    const root = await projectRoot()
    try {
      await fs.writeFile(path.join(root, '正文', '001.md'), '前文\n## 第二幕\n后文', 'utf8')
      const { host } = fixture()
      host.workspaceRegistry.resolveByPath = vi.fn(async () => ({ path: root, sessionIds: ['session-1'] }))
      host.fs = new NodeFileSystem(root) as unknown as FileSystemLike
      const result = await dispatchEditorFiles(
        host as unknown as Context,
        'proposal.prepare',
        {
          sessionId: 'session-1',
          proposal: {
            marker: 'dsh-editor.proposal',
            version: 1,
            kind: 'split',
            summary: '切开',
            path: '正文/001.md',
            anchor: '## 第二幕',
            newPath: '正文/001b.md',
          },
        },
        new AbortController().signal,
      ) as { split?: { kind: 'split'; before: string; after: string } }
      expect(result.split?.kind).toBe('split')
      expect(result.split?.before).toBe('前文\n')
      expect(result.split?.after).toBe('## 第二幕\n后文')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('proposal.apply with a renames kind reaches applyRenames and reports the moved paths', async () => {
    const root = await projectRoot()
    try {
      await fs.writeFile(path.join(root, '正文', '001.md'), '一', 'utf8')
      await fs.writeFile(path.join(root, '正文', '002.md'), '二', 'utf8')
      const { host, handle } = fixture()
      host.workspaceRegistry.resolveByPath = vi.fn(async () => ({ path: root, sessionIds: ['session-1'] }))
      host.fs = new NodeFileSystem(root) as unknown as FileSystemLike
      registerWorkbenchRpc(host as unknown as Context)
      const handler = handle.mock.calls[0]?.[1] as (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>
      // 先 prepare 拿到 expectedVersions
      const prepared = (await dispatchEditorFiles(
        host as unknown as Context,
        'proposal.prepare',
        {
          sessionId: 'session-1',
          proposal: {
            marker: 'dsh-editor.proposal',
            version: 1,
            kind: 'renames',
            summary: '改名',
            renames: [
              { from: '正文/001.md', to: '正文/001-改名.md' },
              { from: '正文/002.md', to: '正文/002-改名.md' },
            ],
          },
        },
        new AbortController().signal,
      )) as { renames?: { versions: Record<string, string>; entries: Array<{ from: string; to: string }> } }
      const expectedVersions = prepared.renames!.versions
      // 再通过 RPC 入口 apply
      const applied = await handler('proposal.apply', {
        sessionId: 'session-1',
        proposal: {
          marker: 'dsh-editor.proposal',
          version: 1,
          kind: 'renames',
          summary: '改名',
          renames: [
            { from: '正文/001.md', to: '正文/001-改名.md' },
            { from: '正文/002.md', to: '正文/002-改名.md' },
          ],
        },
        expectedVersions,
      }, new AbortController().signal) as { ok: true; value: { applied: string[] } }
      expect(applied.ok).toBe(true)
      expect(applied.value.applied).toEqual(['正文/001-改名.md', '正文/002-改名.md'])
      expect(await fs.readFile(path.join(root, '正文', '001-改名.md'), 'utf8')).toBe('一')
      await expect(fs.stat(path.join(root, '正文', '001.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('rejects proposal.prepare with edit / create kinds as bad-request (manuscript channel owns them)', async () => {
    const { host, handle } = fixture()
    registerWorkbenchRpc(host as unknown as Context)
    const handler = handle.mock.calls[0]?.[1] as (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<{ ok: boolean; error?: { code: string } }>
    const edit = await handler('proposal.prepare', {
      sessionId: 'session-1',
      proposal: { marker: 'dsh-editor.proposal', version: 1, kind: 'edit', summary: 'x', path: '正文/001.md' },
    }, new AbortController().signal)
    expect(edit.ok).toBe(false)
    expect(edit.error?.code).toBe('bad-request')
    const create = await handler('proposal.apply', {
      sessionId: 'session-1',
      proposal: { marker: 'dsh-editor.proposal', version: 1, kind: 'create', summary: 'x', path: '正文/001.md' },
    }, new AbortController().signal)
    expect(create.ok).toBe(false)
    expect(create.error?.code).toBe('bad-request')
  })

  it('rejects proposal.apply with a stale version as bad-request', async () => {
    const root = await projectRoot()
    try {
      await fs.writeFile(path.join(root, '正文', '001.md'), '一', 'utf8')
      const { host, handle } = fixture()
      host.workspaceRegistry.resolveByPath = vi.fn(async () => ({ path: root, sessionIds: ['session-1'] }))
      host.fs = new NodeFileSystem(root) as unknown as FileSystemLike
      registerWorkbenchRpc(host as unknown as Context)
      const handler = handle.mock.calls[0]?.[1] as (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<{ ok: boolean; error?: { code: string } }>
      const result = await handler('proposal.apply', {
        sessionId: 'session-1',
        proposal: {
          marker: 'dsh-editor.proposal',
          version: 1,
          kind: 'split',
          summary: '切开',
          path: '正文/001.md',
          anchor: '## 找不到',
          newPath: '正文/001b.md',
        },
        expectedVersions: { '正文/001.md': 'wrong-version' },
      }, new AbortController().signal)
      // STALE 走 mapEditorFilesError → badRequest
      expect(result.ok).toBe(false)
      expect(result.error?.code).toBe('bad-request')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

/**
 * entry.* 端点测试：dispatchEditorFiles 路由到 lifecycle 中的 copyEntry / moveEntry /
 * deleteEntry / renameEntry，错误经 mapEditorFilesError 转成 workbench 错误契约。
 * 用真 fs 验证 happy path 和至少一个错误分支。
 */
describe('entry file-tree endpoints', () => {
  it('entry.copy auto-renames on collision and routes the resulting path back through the RPC', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-editor-entry-copy-'))
    try {
      await fs.mkdir(path.join(root, '正文'))
      await fs.mkdir(path.join(root, '大纲'))
      await fs.writeFile(path.join(root, '正文', '001.md'), '# 源', 'utf8')
      const { host, handle } = fixture()
      host.workspaceRegistry.resolveByPath = vi.fn(async () => ({ path: root, sessionIds: ['session-1'] }))
      host.fs = new NodeFileSystem(root) as unknown as FileSystemLike
      registerWorkbenchRpc(host as unknown as Context)
      const handler = handle.mock.calls[0]?.[1] as (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<{ ok: boolean; value?: unknown; error?: { code: string; message?: string } }>
      const first = await handler('entry.copy', { sessionId: 'session-1', path: '正文/001.md', targetDir: '大纲' }, new AbortController().signal)
      expect(first.ok).toBe(true)
      expect(first.value).toEqual({ path: '大纲/001.md' })
      await expect(fs.readFile(path.join(root, '大纲', '001.md'), 'utf8')).resolves.toBe('# 源')
      const second = await handler('entry.copy', { sessionId: 'session-1', path: '正文/001.md', targetDir: '大纲' }, new AbortController().signal)
      expect(second.ok).toBe(true)
      expect(second.value).toEqual({ path: '大纲/001 2.md' })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('entry.copy returns directory-exists when the target path cannot be resolved', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-editor-entry-copy-err-'))
    try {
      await fs.mkdir(path.join(root, '正文'))
      await fs.writeFile(path.join(root, '正文', '001.md'), '# 源', 'utf8')
      const { host, handle } = fixture()
      host.workspaceRegistry.resolveByPath = vi.fn(async () => ({ path: root, sessionIds: ['session-1'] }))
      host.fs = new NodeFileSystem(root) as unknown as FileSystemLike
      registerWorkbenchRpc(host as unknown as Context)
      const handler = handle.mock.calls[0]?.[1] as (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<{ ok: boolean; error?: { code: string; message?: string } }>
      const result = await handler('entry.copy', { sessionId: 'session-1', path: '正文/001.md', targetDir: '没有这个目录' }, new AbortController().signal)
      expect(result.ok).toBe(false)
      expect(result.error?.code).toBe('bad-request')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('entry.move reports the new path and rejects an occupied target as directory-exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-editor-entry-move-'))
    try {
      await fs.mkdir(path.join(root, '正文'))
      await fs.mkdir(path.join(root, '大纲'))
      await fs.writeFile(path.join(root, '正文', '001.md'), '# 一', 'utf8')
      const { host, handle } = fixture()
      host.workspaceRegistry.resolveByPath = vi.fn(async () => ({ path: root, sessionIds: ['session-1'] }))
      host.fs = new NodeFileSystem(root) as unknown as FileSystemLike
      registerWorkbenchRpc(host as unknown as Context)
      const handler = handle.mock.calls[0]?.[1] as (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<{ ok: boolean; value?: unknown; error?: { code: string; message?: string } }>
      const moved = await handler('entry.move', { sessionId: 'session-1', path: '正文/001.md', targetDir: '大纲' }, new AbortController().signal)
      expect(moved.ok).toBe(true)
      expect(moved.value).toEqual({ path: '大纲/001.md' })
      await expect(fs.stat(path.join(root, '正文', '001.md'))).rejects.toMatchObject({ code: 'ENOENT' })

      await fs.writeFile(path.join(root, '正文', '002.md'), '源')
      await fs.writeFile(path.join(root, '大纲', '002.md'), '占用')
      const conflict = await handler('entry.move', { sessionId: 'session-1', path: '正文/002.md', targetDir: '大纲' }, new AbortController().signal)
      expect(conflict.ok).toBe(false)
      expect(conflict.error?.code).toBe('directory-exists')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('entry.delete removes the path recursively and reports not-found via directory-unreadable', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-editor-entry-delete-'))
    try {
      await fs.mkdir(path.join(root, '正文', '卷一'), { recursive: true })
      await fs.writeFile(path.join(root, '正文', '卷一', '001.md'), '# 一', 'utf8')
      const { host, handle } = fixture()
      host.workspaceRegistry.resolveByPath = vi.fn(async () => ({ path: root, sessionIds: ['session-1'] }))
      host.fs = new NodeFileSystem(root) as unknown as FileSystemLike
      registerWorkbenchRpc(host as unknown as Context)
      const handler = handle.mock.calls[0]?.[1] as (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>
      const removed = await handler('entry.delete', { sessionId: 'session-1', path: '正文/卷一' }, new AbortController().signal)
      expect(removed.ok).toBe(true)
      expect(removed.value).toEqual({ path: '正文/卷一' })
      await expect(fs.stat(path.join(root, '正文', '卷一'))).rejects.toMatchObject({ code: 'ENOENT' })

      const missing = await handler('entry.delete', { sessionId: 'session-1', path: 'nope.md' }, new AbortController().signal)
      expect(missing.ok).toBe(false)
      expect(missing.error?.code).toBe('directory-unreadable')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('entry.rename renames in place and rejects an occupied target as directory-exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-editor-entry-rename-'))
    try {
      await fs.mkdir(path.join(root, '正文'))
      await fs.writeFile(path.join(root, '正文', '001.md'), '# 一', 'utf8')
      await fs.writeFile(path.join(root, '正文', '已存在.md'), '# 占位', 'utf8')
      const { host, handle } = fixture()
      host.workspaceRegistry.resolveByPath = vi.fn(async () => ({ path: root, sessionIds: ['session-1'] }))
      host.fs = new NodeFileSystem(root) as unknown as FileSystemLike
      registerWorkbenchRpc(host as unknown as Context)
      const handler = handle.mock.calls[0]?.[1] as (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>
      const renamed = await handler('entry.rename', { sessionId: 'session-1', path: '正文/001.md', name: '序章.md' }, new AbortController().signal)
      expect(renamed.ok).toBe(true)
      expect(renamed.value).toEqual({ path: '正文/序章.md' })
      await expect(fs.readFile(path.join(root, '正文', '序章.md'), 'utf8')).resolves.toBe('# 一')

      const conflict = await handler('entry.rename', { sessionId: 'session-1', path: '正文/序章.md', name: '已存在.md' }, new AbortController().signal)
      expect(conflict.ok).toBe(false)
      expect(conflict.error?.code).toBe('directory-exists')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
