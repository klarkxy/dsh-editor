import { describe, expect, it } from 'vitest'
import {
  PROJECT_KNOWLEDGE_MAX_CHARS,
  PROJECT_KNOWLEDGE_TOOL_NAME,
  ProjectKnowledgeError,
  createProjectKnowledgeTool,
  isProjectKnowledgeArguments,
  loadProjectKnowledge,
  normalizeProjectKnowledgeArguments,
  renderProjectKnowledge,
  type ProjectKnowledgeReader,
  type ProjectKnowledgeResult,
} from './project-knowledge.ts'

const NOOP_SIGNAL = new AbortController().signal

function makeReader(map: Record<string, string | { error: string }>): ProjectKnowledgeReader {
  return async ({ path }) => {
    const entry = map[path]
    if (entry === undefined) throw new Error('ENOENT')
    if (typeof entry !== 'string') throw new Error(entry.error)
    return entry
  }
}

describe('project_knowledge', () => {
  describe('normalizeProjectKnowledgeArguments', () => {
    it('accepts one to three project-relative Markdown or text paths', () => {
      expect(normalizeProjectKnowledgeArguments({ paths: ['大纲/总纲.md'] })).toEqual(['大纲/总纲.md'])
      expect(normalizeProjectKnowledgeArguments({ paths: ['人物卡/主角.md', '世界书/设定.md', 'notes.txt'] })).toEqual([
        '人物卡/主角.md', '世界书/设定.md', 'notes.txt',
      ])
      expect(isProjectKnowledgeArguments({ paths: ['notes.TXT'] })).toBe(true)
    })

    it('rejects empty, too long, non-array, or non-string paths', () => {
      expect(() => normalizeProjectKnowledgeArguments({})).toThrow(ProjectKnowledgeError)
      expect(() => normalizeProjectKnowledgeArguments({ paths: [] })).toThrow(/paths 需要/)
      expect(() => normalizeProjectKnowledgeArguments({ paths: ['a.md', 'b.md', 'c.md', 'd.md'] })).toThrow(/paths 需要/)
      expect(() => normalizeProjectKnowledgeArguments({ paths: 'a.md' })).toThrow(/只接受 paths 数组/)
      expect(() => normalizeProjectKnowledgeArguments({ paths: [''] })).toThrow(/字符串/)
      expect(() => normalizeProjectKnowledgeArguments({ paths: [1] })).toThrow(/字符串/)
      expect(() => normalizeProjectKnowledgeArguments({ paths: ['a.md', 'a.md'] })).toThrow(/重复路径/)
      expect(isProjectKnowledgeArguments({ paths: ['../secret.md'] })).toBe(false)
    })

    it('rejects paths that escape, hit hidden dirs, or use disallowed extensions', () => {
      for (const bad of ['../secret.md', '/etc/passwd', 'C:\\\\Windows\\\\a.md', '子目录/.git/config.md', 'a.png', 'a.json', 'a.MD\u0000bad']) {
        expect(isProjectKnowledgeArguments({ paths: [bad] })).toBe(false)
      }
    })
  })

  describe('loadProjectKnowledge', () => {
    it('reads each path through the injected reader and reports bytes', async () => {
      const reader = makeReader({ '大纲/总纲.md': '很久以前', '人物卡/主角.md': '夏目' })
      const result = await loadProjectKnowledge(['大纲/总纲.md', '人物卡/主角.md'], reader, { signal: NOOP_SIGNAL, cwd: '/tmp' })
      expect(result.version).toBe(1)
      expect(result.files[0]).toEqual({ path: '大纲/总纲.md', ok: true, content: '很久以前', truncated: false, bytes: 4 })
      expect(result.files[1]).toEqual({ path: '人物卡/主角.md', ok: true, content: '夏目', truncated: false, bytes: 2 })
    })

    it('truncates long files and labels the truncation', async () => {
      const long = 'a'.repeat(PROJECT_KNOWLEDGE_MAX_CHARS * 2)
      const reader = makeReader({ '长.md': long })
      const result = await loadProjectKnowledge(['长.md'], reader, { signal: NOOP_SIGNAL, cwd: '/tmp' })
      const file = result.files[0]
      expect(file?.ok).toBe(true)
      if (file?.ok) {
        expect(file.bytes).toBe(long.length)
        expect(file.truncated).toBe(true)
        expect(file.content).toContain('[截断：原文共')
        expect(file.content.length).toBeLessThan(long.length)
      }
    })

    it('marks only the failing file as missing without throwing the whole batch', async () => {
      const reader = makeReader({ '存在.md': '好', '缺失.md': { error: 'ENOENT: no such file' } })
      const result = await loadProjectKnowledge(['存在.md', '缺失.md'], reader, { signal: NOOP_SIGNAL, cwd: '/tmp' })
      expect(result.files[0]).toMatchObject({ ok: true, content: '好' })
      expect(result.files[1]).toEqual({ path: '缺失.md', ok: false, reason: '未找到（ENOENT: no such file）' })
    })
  })

  describe('renderProjectKnowledge', () => {
    const result: ProjectKnowledgeResult = {
      version: 1,
      files: [
        { path: 'A.md', ok: true, content: '内容 A', truncated: false, bytes: 4 },
        { path: 'B.md', ok: true, content: '内容 B', truncated: true, bytes: 9999 },
        { path: 'C.md', ok: false, reason: '未找到（boom）' },
      ],
    }
    const rendered = renderProjectKnowledge(result)
    it('produces a Markdown block per file with headings', () => {
      expect(rendered).toContain('项目资料（3 个文件）')
      expect(rendered).toContain('### A.md')
      expect(rendered).toContain('内容 A')
      expect(rendered).toContain('### B.md')
      expect(rendered).toContain('（已截断）')
      expect(rendered).toContain('### C.md')
      expect(rendered).toContain('未找到（boom）')
    })
  })

  describe('createProjectKnowledgeTool', () => {
    it('rejects construction without a reader', () => {
      expect(() => createProjectKnowledgeTool({ reader: undefined as unknown as ProjectKnowledgeReader })).toThrow(ProjectKnowledgeError)
    })

    it('uses the canonical tool name and renders Markdown from the output schema', () => {
      const reader: ProjectKnowledgeReader = async ({ path }) => {
        if (path === '好.md') return '远山'
        throw new Error('missing')
      }
      const tool = createProjectKnowledgeTool({ reader })
      expect(tool.name).toBe(PROJECT_KNOWLEDGE_TOOL_NAME)
      const blocks = (tool as unknown as { output: { render: (args: unknown, value: unknown) => Array<{ type: string; text: string }> } }).output.render(
        { paths: ['好.md'] },
        { version: 1, files: [{ path: '好.md', ok: true, content: '远山', truncated: false, bytes: 2 }] },
      )
      expect(blocks[0]?.text).toContain('远山')
    })

    it('throws UNREADABLE when no agent session cwd is available', async () => {
      const reader: ProjectKnowledgeReader = async () => 'never called'
      const tool = createProjectKnowledgeTool({ reader })
      const exec = { signal: new AbortController().signal } as unknown as { signal: AbortSignal; agent?: { session: { header: { cwd?: string } } } }
      await expect(
        (tool as unknown as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
          { paths: ['好.md'] },
          exec,
        ),
      ).rejects.toMatchObject({ name: 'ProjectKnowledgeError', code: 'UNREADABLE' })
    })

    it('passes the session cwd to the reader when calling execute', async () => {
      let captured: { path: string; cwd: string } | undefined
      const reader: ProjectKnowledgeReader = async ({ path, cwd }) => {
        captured = { path, cwd }
        return 'text'
      }
      const tool = createProjectKnowledgeTool({ reader })
      const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: 'D:/work/project' } } } } as unknown as { signal: AbortSignal; agent: { session: { header: { cwd?: string } } } }
      const result = await (tool as unknown as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute(
        { paths: ['好.md'] },
        exec,
      )
      expect(captured).toEqual({ path: '好.md', cwd: 'D:/work/project' })
      expect(result).toMatchObject({ version: 1, files: [{ path: '好.md', ok: true, content: 'text' }] })
    })
  })
})
