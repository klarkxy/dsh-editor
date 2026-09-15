import { describe, expect, it } from 'vitest'
import {
  IndexWriteError,
  NOVEL_INDEX_PATH,
  NOVEL_INDEX_WRITE_MAX_CHARS,
  NOVEL_INDEX_WRITE_TOOL_NAME,
  createIndexWriteTool,
  normalizeIndexWriteArguments,
  type IndexWriter,
} from './index-write-tool.ts'
import { WorkspaceAuthorityError } from './internal-workspace-access.ts'

const NOOP_SIGNAL = new AbortController().signal

type Exec = { signal: AbortSignal; agent?: { session: { id: string; header: { cwd?: string } } } }

function makeExec(sessionId?: string, cwd = '/forged/outside'): Exec {
  return sessionId === undefined
    ? { signal: NOOP_SIGNAL }
    : { signal: NOOP_SIGNAL, agent: { session: { id: sessionId, header: { cwd } } } }
}

describe('novel_index_write', () => {
  describe('normalizeIndexWriteArguments', () => {
    it('accepts exactly one non-empty text parameter', () => {
      expect(normalizeIndexWriteArguments({ text: '# 作品索引' })).toBe('# 作品索引')
      expect(() => normalizeIndexWriteArguments({})).toThrow(/只接受 text/)
      expect(() => normalizeIndexWriteArguments({ text: 'a', path: 'b' })).toThrow(/只接受 text/)
      expect(() => normalizeIndexWriteArguments({ text: '   ' })).toThrow(/不能为空/)
      expect(() => normalizeIndexWriteArguments({ text: 1 })).toThrow(/只接受 text/)
      expect(() => normalizeIndexWriteArguments({ text: 'a'.repeat(NOVEL_INDEX_WRITE_MAX_CHARS + 1) })).toThrow(/不能超过/)
    })
  })

  describe('createIndexWriteTool', () => {
    it('rejects construction without a writer', () => {
      expect(() => createIndexWriteTool({ writer: undefined as unknown as IndexWriter })).toThrow(IndexWriteError)
    })

    it('writes through the injected writer using the live session id, not header.cwd', async () => {
      let captured: { text: string; sessionId: string } | undefined
      const writer: IndexWriter = async ({ text, sessionId }) => {
        captured = { text, sessionId }
      }
      const tool = createIndexWriteTool({ writer })
      expect(tool.name).toBe(NOVEL_INDEX_WRITE_TOOL_NAME)
      const result = await (tool as unknown as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
        { text: '# 作品索引\n正文' },
        makeExec('session-1', '/forged/outside'),
      )
      expect(captured).toEqual({ text: '# 作品索引\n正文', sessionId: 'session-1' })
      expect(result).toEqual({ version: 1, path: NOVEL_INDEX_PATH, chars: '# 作品索引\n正文'.length })
    })

    it('throws SESSION_REQUIRED when no agent session id is available', async () => {
      const writer: IndexWriter = async () => { throw new Error('never called') }
      const tool = createIndexWriteTool({ writer })
      await expect(
        (tool as unknown as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
          { text: '内容' },
          makeExec(),
        ),
      ).rejects.toMatchObject({ name: 'WorkspaceAuthorityError', code: 'SESSION_REQUIRED' })
    })

    it('renders a confirmation without leaking the internal dot-path', () => {
      const tool = createIndexWriteTool({ writer: async () => undefined })
      const blocks = (tool as unknown as { output: { render: (args: unknown, value: unknown) => Array<{ type: string; text: string }> } }).output.render(
        { text: 'x' },
        { version: 1, path: NOVEL_INDEX_PATH, chars: 2 },
      )
      expect(blocks[0]?.text).toContain('作品索引已写入（2 字符）')
      expect(blocks[0]?.text).not.toContain('.dsh-editor')
    })
  })
})
