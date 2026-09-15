import { describe, expect, it } from 'vitest'
import {
  NOVEL_SCRATCH_LIST_TOOL_NAME,
  NOVEL_SCRATCH_READ_TOOL_NAME,
  NOVEL_SCRATCH_WRITE_TOOL_NAME,
  SCRATCH_MAX_FILE_CHARS,
  SCRATCH_MAX_FILES,
  ScratchError,
  collectScratchFiles,
  createScratchListTool,
  createScratchReadTool,
  createScratchWriteTool,
  isScratchRelativePath,
  type ScratchStore,
} from './scratch-tool.ts'
import { WorkspaceAuthorityError } from './internal-workspace-access.ts'

const NOOP_SIGNAL = new AbortController().signal

type Exec = { signal: AbortSignal; agent?: { session: { id: string; header: { cwd?: string } } } }

function makeExec(sessionId?: string, cwd = '/forged/outside'): Exec {
  return sessionId === undefined
    ? { signal: NOOP_SIGNAL }
    : { signal: NOOP_SIGNAL, agent: { session: { id: sessionId, header: { cwd } } } }
}

function memoryStore(initial: Record<string, string> = {}): ScratchStore & { files: Map<string, string>; sessionIds: string[] } {
  const files = new Map(Object.entries(initial))
  const sessionIds: string[] = []
  return {
    files,
    sessionIds,
    async read({ path, sessionId }) {
      sessionIds.push(sessionId)
      const text = files.get(path)
      if (text === undefined) throw new Error('missing')
      return text
    },
    async write({ path, text, sessionId }) {
      sessionIds.push(sessionId)
      files.set(path, text)
    },
    async list({ sessionId }) {
      sessionIds.push(sessionId)
      return [...files.keys()].sort((a, b) => a.localeCompare(b))
    },
  }
}

type Tool = { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown>; output: { render: (args: unknown, value: unknown) => Array<{ type: string; text: string }> } }

describe('scratch tools', () => {
  describe('isScratchRelativePath', () => {
    it('accepts shallow .md/.txt paths inside scratch and rejects escapes', () => {
      expect(isScratchRelativePath('notes.md')).toBe(true)
      expect(isScratchRelativePath('分析/人物动机.txt')).toBe(true)
      expect(isScratchRelativePath('a/b/c.md')).toBe(true)
      expect(isScratchRelativePath('a/b/c/d.md')).toBe(false)
      expect(isScratchRelativePath('../secret.md')).toBe(false)
      expect(isScratchRelativePath('sub/../../x.md')).toBe(false)
      expect(isScratchRelativePath('/abs.md')).toBe(false)
      expect(isScratchRelativePath('D:/x.md')).toBe(false)
      expect(isScratchRelativePath('.hidden.md')).toBe(false)
      expect(isScratchRelativePath('sub/.hidden.md')).toBe(false)
      expect(isScratchRelativePath('double//slash.md')).toBe(false)
      expect(isScratchRelativePath('noext')).toBe(false)
      expect(isScratchRelativePath('image.png')).toBe(false)
      expect(isScratchRelativePath('')).toBe(false)
      expect(isScratchRelativePath(1)).toBe(false)
    })
  })

  describe('novel_scratch_write', () => {
    it('creates and overwrites files through the injected store', async () => {
      const store = memoryStore()
      const tool = createScratchWriteTool({ store }) as unknown as Tool
      expect(tool.name).toBe(NOVEL_SCRATCH_WRITE_TOOL_NAME)
      const result = await tool.execute({ path: '分析/线索.md', text: '# 线索整理' }, makeExec('session-1'))
      expect(result).toEqual({ version: 1, path: '分析/线索.md', chars: '# 线索整理'.length })
      expect(store.files.get('分析/线索.md')).toBe('# 线索整理')
      expect(store.sessionIds).toEqual(['session-1', 'session-1'])
      await tool.execute({ path: '分析/线索.md', text: '# v2' }, makeExec('session-1'))
      expect(store.files.get('分析/线索.md')).toBe('# v2')
    })

    it('normalizes backslashes and enforces the file cap only for new files', async () => {
      const initial: Record<string, string> = {}
      for (let n = 0; n < SCRATCH_MAX_FILES; n += 1) initial[`f${n}.md`] = 'x'
      const store = memoryStore(initial)
      const tool = createScratchWriteTool({ store }) as unknown as Tool
      await expect(tool.execute({ path: 'new.md', text: 'x' }, makeExec('session-1'))).rejects.toMatchObject({ name: 'ScratchError', code: 'LIMIT' })
      await tool.execute({ path: 'f0.md', text: 'y' }, makeExec('session-1'))
      expect(store.files.get('f0.md')).toBe('y')
      const slash = createScratchWriteTool({ store: memoryStore() }) as unknown as Tool
      await slash.execute({ path: 'sub\\win.md', text: 'z' }, makeExec('session-1'))
      expect(await slash.execute({ path: 'sub/win.md', text: 'z2' }, makeExec('session-1'))).toMatchObject({ path: 'sub/win.md' })
    })

    it('rejects bad paths, oversized text and missing session id', async () => {
      const tool = createScratchWriteTool({ store: memoryStore() }) as unknown as Tool
      await expect(tool.execute({ path: '../x.md', text: 'x' }, makeExec('session-1'))).rejects.toMatchObject({ code: 'INVALID_ARGS' })
      await expect(tool.execute({ path: 'x.md', text: 'a'.repeat(SCRATCH_MAX_FILE_CHARS + 1) }, makeExec('session-1'))).rejects.toMatchObject({ code: 'INVALID_ARGS' })
      await expect(tool.execute({ path: 'x.md', text: 'x', extra: 1 }, makeExec('session-1'))).rejects.toMatchObject({ code: 'INVALID_ARGS' })
      await expect(tool.execute({ path: 'x.md', text: 'x' }, makeExec())).rejects.toMatchObject({ name: 'WorkspaceAuthorityError', code: 'SESSION_REQUIRED' })
      expect(() => createScratchWriteTool({})).toThrow(ScratchError)
    })
  })

  describe('novel_scratch_read', () => {
    it('reads back file content and reports missing files', async () => {
      const store = memoryStore({ '笔记.md': '内容' })
      const tool = createScratchReadTool({ store }) as unknown as Tool
      expect(tool.name).toBe(NOVEL_SCRATCH_READ_TOOL_NAME)
      await expect(tool.execute({ path: '笔记.md' }, makeExec('session-1'))).resolves.toEqual({ version: 1, path: '笔记.md', text: '内容' })
      await expect(tool.execute({ path: '没有.md' }, makeExec('session-1'))).rejects.toMatchObject({ code: 'UNREADABLE' })
      await expect(tool.execute({ path: '.gitignore' }, makeExec('session-1'))).rejects.toMatchObject({ code: 'INVALID_ARGS' })
      const blocks = tool.output.render({}, { version: 1, path: '笔记.md', text: '内容' })
      expect(blocks[0]?.text).toContain('内容')
    })

    it('does not hide a live-session authority failure as a missing file', async () => {
      const tool = createScratchReadTool({
        store: {
          async read() { throw new WorkspaceAuthorityError('session is not live', 'SESSION_NOT_FOUND', { sessionId: 'gone' }) },
          async write() { throw new Error('unused') },
          async list() { return [] },
        },
      }) as unknown as Tool
      await expect(tool.execute({ path: '笔记.md' }, makeExec('gone'))).rejects.toMatchObject({
        name: 'WorkspaceAuthorityError',
        code: 'SESSION_NOT_FOUND',
      })
    })
  })

  describe('novel_scratch_list', () => {
    it('lists files and renders the empty state', async () => {
      const empty = createScratchListTool({ store: memoryStore() }) as unknown as Tool
      expect(empty.name).toBe(NOVEL_SCRATCH_LIST_TOOL_NAME)
      await expect(empty.execute({}, makeExec('session-1'))).resolves.toEqual({ version: 1, files: [] })
      expect(empty.output.render({}, { files: [] })[0]?.text).toContain('为空')
      const store = memoryStore({ 'b.md': '1', 'a/x.txt': '2' })
      const tool = createScratchListTool({ store }) as unknown as Tool
      await expect(tool.execute({}, makeExec('session-1'))).resolves.toEqual({ version: 1, files: ['a/x.txt', 'b.md'] })
      expect(store.sessionIds).toEqual(['session-1'])
    })
  })

  describe('collectScratchFiles', () => {
    it('walks subdirectories, skips hidden entries and tolerates a missing root', async () => {
      const tree: Record<string, Array<{ name: string; type: 'file' | 'directory' | 'other' }>> = {
        '': [{ name: '.gitignore', type: 'file' }, { name: 'a.md', type: 'file' }, { name: 'sub', type: 'directory' }, { name: 'x.png', type: 'file' }],
        sub: [{ name: 'b.txt', type: 'file' }, { name: '.hidden.md', type: 'file' }],
      }
      const files = await collectScratchFiles(async (scope) => {
        const entries = tree[scope]
        if (!entries) throw new Error('missing')
        return entries
      })
      expect(files).toEqual(['a.md', 'sub/b.txt'])
    })

    it('does not treat abort or a dead session as an empty scratch directory', async () => {
      const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' })
      await expect(collectScratchFiles(async () => { throw aborted })).rejects.toMatchObject({ name: 'AbortError' })
      await expect(collectScratchFiles(async () => {
        throw new WorkspaceAuthorityError('session is not live', 'SESSION_NOT_FOUND', { sessionId: 'gone' })
      })).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' })
    })
  })
})
