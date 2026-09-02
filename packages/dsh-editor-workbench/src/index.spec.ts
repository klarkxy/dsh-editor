import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { FileSystemLike, ManuscriptHost } from 'dsh-manuscript/host-api'
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
      )).resolves.toEqual({ hasVisibleEntries: true, textFiles: ['正文/001.md'] })
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
