import { describe, expect, it } from 'vitest'
import { createDraftStore, type DraftTableLike } from './draft.ts'

function tableFixture(): DraftTableLike {
  const rows = new Map<string, ReturnType<DraftTableLike['get']>>()
  return {
    get: (key) => rows.get(key),
    async put(key, value) { rows.set(key, value) },
    async delete(key) { return rows.delete(key) },
  }
}

describe('DSH storage-domain manuscript drafts', () => {
  it('binds durable rows to the canonical workspace and relative path', async () => {
    const table = tableFixture()
    const firstHost = createDraftStore(table)
    await firstHost.put('/workspace-a', { path: '正文/01.md', text: '草稿', baseText: '原文', baseVersion: 'v1' })
    const restartedHost = createDraftStore(table)
    expect(restartedHost.get('/workspace-a', { path: '正文/01.md' })).toMatchObject({ text: '草稿', baseVersion: 'v1' })
    expect(restartedHost.get('/workspace-b', { path: '正文/01.md' })).toBeNull()
    expect(await restartedHost.delete('/workspace-a', { path: '正文/01.md' })).toEqual({ deleted: true })
    expect(restartedHost.get('/workspace-a', { path: '正文/01.md' })).toBeNull()
  })

  it('rejects escape paths and unbounded input', async () => {
    const store = createDraftStore(tableFixture())
    await expect(store.put('/workspace', { path: '../escape.md', text: '', baseText: '', baseVersion: 'v1' })).rejects.toThrow()
    await expect(store.put('/workspace', { path: '正文/01.md', text: '', baseText: '', baseVersion: '' })).rejects.toThrow(/base version/)
  })
})
