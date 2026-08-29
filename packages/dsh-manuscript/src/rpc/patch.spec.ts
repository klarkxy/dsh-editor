import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { dispatch, mapError } from '../index.ts'
import type { FileSystemLike, ManuscriptHost } from '../host.ts'
import { completePatch, PATCH_LIMITS, parsePatchRequest } from './patch.ts'

function fixture(config: { provider?: string; model?: string } = { provider: 'configured-provider', model: 'configured-model' }) {
  const canonical = '/canonical/workspace'
  const fs: FileSystemLike = {
    async resolve(path, opts) {
      const targetKey = path === '.' ? canonical : `${opts?.cwd}/${path}`.replace('/./', '/')
      return { targetKey, displayPath: targetKey }
    },
    contains(parent, child) { return child.targetKey === parent.targetKey || child.targetKey.startsWith(`${parent.targetKey}/`) },
    async stat() { return { type: 'directory', version: 'root' } },
    async lstat() { return { type: 'directory', version: 'root' } },
    async readText() { return '' },
    async listDir() { return [] },
    async writeText() { throw new Error('patch.complete must not write files') },
  }
  const stream = vi.fn(() => chunks([{ type: 'text-delta', text: '雨落在窗台上。' }]))
  const host = {
    get(name: string) { return name === 'llm' ? { stream } : undefined },
    sessions: {
      get: () => ({
        id: 'session-1',
        header: { cwd: '/header/workspace' },
        requestHeader: () => ({ config }),
      }),
    },
    workspaceRegistry: { resolveByPath: vi.fn(async () => ({ path: canonical, sessionIds: ['session-1'] })) },
    sandboxPolicy: { resolve: vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: canonical, sessionId: 'session-1' })) },
    fs,
    connection: { rpc: { call: vi.fn(), handle: vi.fn() } },
  } as unknown as ManuscriptHost
  return { host, stream }
}

async function* chunks(items: Array<{ type: string; text?: string }>) {
  for (const item of items) yield item
}

describe('patch.complete', () => {
  it('validates required, confined, and bounded request fields', () => {
    expect(() => parsePatchRequest({ path: 'chapter.md', selectedText: '' })).toThrow('selected text is required')
    expect(() => parsePatchRequest({ path: '../secret.md', selectedText: '正文' })).toThrow('path escapes workspace')
    expect(() => parsePatchRequest({ path: '.', selectedText: '正文' })).toThrow('path is required')
    expect(() => parsePatchRequest({ path: 'chapter.md', selectedText: 'x'.repeat(PATCH_LIMITS.selectedText + 1) })).toThrow('exceeds')
  })

  it('normalizes the relative path and bounds context around the selection', () => {
    const request = parsePatchRequest({
      path: './chapters/one.md',
      selectedText: '改写对象',
      before: `d${'a'.repeat(PATCH_LIMITS.context)}`,
      after: `${'b'.repeat(PATCH_LIMITS.context)}e`,
      authorPreferences: `  保持克制\r\n${'x'.repeat(1_300)}  `,
    })
    expect(request.path).toBe('chapters/one.md')
    expect(request.before).toBe('a'.repeat(PATCH_LIMITS.context))
    expect(request.after).toBe('b'.repeat(PATCH_LIMITS.context))
    expect(request.authorPreferences.startsWith('保持克制\n')).toBe(true)
    expect(request.authorPreferences.length).toBe(1_200)
  })

  it('derives provider and model from the live session, never from RPC input', async () => {
    const { host, stream } = fixture()
    await expect(dispatch(
      host as unknown as Context,
      'patch.complete',
      { sessionId: 'session-1', path: 'chapter.md', selectedText: '旧句', before: '前文', after: '后文', provider: 'forged', model: 'forged' },
      new AbortController().signal,
    )).resolves.toEqual({ text: '雨落在窗台上。', route: 'dsh-llm' })
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ provider: 'configured-provider', model: 'configured-model' }))
  })

  it('keeps author preferences in system guidance instead of replacement text', async () => {
    const { host, stream } = fixture()
    await dispatch(
      host as unknown as Context,
      'patch.complete',
      { sessionId: 'session-1', path: 'chapter.md', selectedText: '旧句', before: '前文', after: '后文', authorPreferences: '对白保持克制' },
      new AbortController().signal,
    )
    expect(stream).toHaveBeenCalledWith(expect.objectContaining({ system: expect.stringContaining('【作者跨作品约定】\n对白保持克制') }))
  })

  it('returns an empty proposal without a configured live-session model', async () => {
    const { host, stream } = fixture({})
    await expect(dispatch(
      host as unknown as Context,
      'patch.complete',
      { sessionId: 'session-1', path: 'chapter.md', selectedText: '旧句', before: '', after: '' },
      new AbortController().signal,
    )).resolves.toEqual({ text: '', route: 'dsh-llm' })
    expect(stream).not.toHaveBeenCalled()
  })

  it('passes cancellation through and returns no stale partial proposal', async () => {
    const controller = new AbortController()
    const stream = vi.fn(() => chunks([{ type: 'text-delta', text: 'partial' }]))
    controller.abort()
    await expect(completePatch({
      ctx: { get: () => ({ stream }) },
      provider: 'provider',
      model: 'model',
      request: parsePatchRequest({ path: 'chapter.md', selectedText: '旧句', before: '', after: '' }),
      signal: controller.signal,
    })).resolves.toEqual({ text: '', route: 'dsh-llm' })
    expect(stream).not.toHaveBeenCalled()
  })

  it('safely returns an empty proposal for unavailable or failed streams', async () => {
    await expect(completePatch({
      ctx: {},
      provider: 'provider',
      model: 'model',
      request: parsePatchRequest({ path: 'chapter.md', selectedText: '旧句', before: '', after: '' }),
      signal: new AbortController().signal,
    })).resolves.toEqual({ text: '', route: 'dsh-llm' })

    await expect(completePatch({
      ctx: { get: () => ({ stream: () => chunks([{ type: 'text-delta', text: 'partial' }, { type: 'finish', reason: { kind: 'error' } }]) }) },
      provider: 'provider',
      model: 'model',
      request: parsePatchRequest({ path: 'chapter.md', selectedText: '旧句', before: '', after: '' }),
      signal: new AbortController().signal,
    })).resolves.toEqual({ text: '', route: 'dsh-llm' })

    async function* failed() {
      yield { type: 'text-delta', text: 'partial' }
      throw new Error('provider failed')
    }
    await expect(completePatch({
      ctx: { get: () => ({ stream: () => failed() }) },
      provider: 'provider',
      model: 'model',
      request: parsePatchRequest({ path: 'chapter.md', selectedText: '旧句', before: '', after: '' }),
      signal: new AbortController().signal,
    })).resolves.toEqual({ text: '', route: 'dsh-llm' })
  })

  it('caps a successful proposal to the short replacement bound', async () => {
    const result = await completePatch({
      ctx: { get: () => ({ stream: () => chunks([{ type: 'text-delta', text: 'x'.repeat(PATCH_LIMITS.proposal + 20) }]) }) },
      provider: 'provider',
      model: 'model',
      request: parsePatchRequest({ path: 'chapter.md', selectedText: '旧句', before: '', after: '' }),
      signal: new AbortController().signal,
    })
    expect(result.text).toHaveLength(PATCH_LIMITS.proposal)
  })

  it('maps invalid patch input to schema-valid Host errors', () => {
    expect(mapError(new Error('unrelated')).error.code).toBe('internal')
    try {
      parsePatchRequest({ path: 'chapter.md', selectedText: '' })
    } catch (error) {
      expect(mapError(error)).toMatchObject({
        error: { code: 'bad-request', details: { issues: [{ code: 'custom', path: [] }] } },
      })
    }
  })
})
