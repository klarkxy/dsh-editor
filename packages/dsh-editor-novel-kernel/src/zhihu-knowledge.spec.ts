import { describe, expect, it, vi } from 'vitest'
import type { ZhihuSearchFetcher } from './zhihu-client.ts'
import {
  checkKnowledgeFile,
  listZhihuKnowledgeBases,
  uploadZhihuKnowledgeFile,
  ZHIHU_KNOWLEDGE_UPLOAD_MAX_BYTES,
} from './zhihu-knowledge.ts'

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return { ...actual, readFile: vi.fn() }
})

const ENV = { ZHIHU_ACCESS_TOKEN: 'primarytoken1' }
const ENVELOPE = (data: unknown, code = 0, message = 'success') => ({ Code: code, Message: message, Data: data })

function jsonResponse(body: unknown): Awaited<ReturnType<ZhihuSearchFetcher>> {
  return {
    ok: true,
    status: 200,
    async text() { return JSON.stringify(body) },
    async json() { return body },
  }
}

describe('zhihu knowledge admin', () => {
  it('lists bases with normalization and drops entries without an id', async () => {
    const fetcher: ZhihuSearchFetcher = (input) => {
      const u = new URL(String(input))
      expect(u.pathname).toBe('/api/v1/knowledge/bases')
      expect(u.searchParams.get('Scope')).toBe('all')
      return Promise.resolve(jsonResponse(ENVELOPE({
        Items: [
          { KnowledgeBaseID: 'kb-1', Name: '参考', Relation: 'created', Visibility: 'private', IsDefault: true, ContentCount: 3 },
          { KnowledgeBaseID: '', Name: '坏行' },
          'junk',
        ],
      })))
    }
    const list = await listZhihuKnowledgeBases({ fetcher, env: ENV })
    expect(list.bases).toEqual([
      { id: 'kb-1', name: '参考', relation: 'created', visibility: 'private', isDefault: true, contentCount: 3 },
    ])
  })

  it('uploads via multipart form without a hand-written Content-Type', async () => {
    let seen: { method?: string; headers?: Record<string, string>; body?: unknown } | undefined
    const fetcher: ZhihuSearchFetcher = (input, init) => {
      expect(new URL(String(input)).pathname).toBe('/api/v1/knowledge/files')
      seen = init
      return Promise.resolve(jsonResponse(ENVELOPE({
        KnowledgeBaseID: 'kb-9', RecallContentID: 'rc-1', FileName: 'notes.md', FileSize: 5, Title: '笔记',
      })))
    }
    const upload = await uploadZhihuKnowledgeFile(
      { fileName: 'notes.md', data: new TextEncoder().encode('hello'), knowledgeBaseId: ' kb-9 ' },
      { fetcher, env: ENV },
    )
    expect(seen?.method).toBe('POST')
    expect(seen?.headers?.['Content-Type']).toBeUndefined()
    expect(seen?.body).toBeInstanceOf(FormData)
    const form = seen?.body as FormData
    expect(form.get('KnowledgeBaseID')).toBe(' kb-9 ')
    const file = form.get('File') as File
    expect(file.name).toBe('notes.md')
    expect(file.type).toBe('text/markdown')
    expect(upload).toMatchObject({ knowledgeBaseId: 'kb-9', recallContentId: 'rc-1', fileName: 'notes.md', title: '笔记' })
  })

  it('rejects bad file names, oversize payloads and unsupported extensions', () => {
    expect(() => checkKnowledgeFile('  ', 10)).toThrow('文件名不能为空')
    expect(() => checkKnowledgeFile('a\nb.md', 10)).toThrow('控制字符')
    expect(() => checkKnowledgeFile('ok.md', 0)).toThrow('不能为空')
    expect(() => checkKnowledgeFile('ok.md', ZHIHU_KNOWLEDGE_UPLOAD_MAX_BYTES + 1)).toThrow('20MB')
    expect(() => checkKnowledgeFile('ok.exe', 10)).toThrow('仅支持')
    expect(checkKnowledgeFile('dir\\设定集.md', 10)).toBe('.md')
  })
})
