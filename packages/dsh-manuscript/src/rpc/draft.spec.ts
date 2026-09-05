import { describe, expect, it } from 'vitest'
import { createDraftStore, type DraftTableLike } from './draft.ts'

function tableFixture(): DraftTableLike {
  const rows = new Map<string, NonNullable<ReturnType<DraftTableLike['get']>>>()
  return {
    get: (key) => rows.get(key),
    entries: () => rows.entries(),
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
    expect(await restartedHost.delete('/workspace-a', { path: '正文/01.md', revision: restartedHost.get('/workspace-a', { path: '正文/01.md' })!.revision })).toEqual({ deleted: true })
    expect(restartedHost.get('/workspace-a', { path: '正文/01.md' })).toBeNull()
  })

  it('rejects escape paths and unbounded input', async () => {
    const store = createDraftStore(tableFixture())
    await expect(store.put('/workspace', { path: '../escape.md', text: '', baseText: '', baseVersion: 'v1' })).rejects.toThrow()
    await expect(store.put('/workspace', { path: '正文/01.md', text: '', baseText: '', baseVersion: '' })).rejects.toThrow(/base version/)
  })
})

  it('isolates window owners and preserves all versions for restart recovery', async () => {
    const table = tableFixture()
    const store = createDraftStore(table)
    const payload = { path: 'a.md', baseText: 'base', baseVersion: 'v1' }
    const a = await store.put('/workspace', { ...payload, ownerId: 'window-A', text: 'A' })
    const b = await store.put('/workspace', { ...payload, ownerId: 'window-B', text: 'B' })
    expect(store.get('/workspace', { ...payload, ownerId: 'window-A' })?.text).toBe('A')
    await store.delete('/workspace', { ...payload, ownerId: 'window-B', revision: b.revision })
    expect(store.get('/workspace', { ...payload, ownerId: 'window-A' })?.revision).toBe(a.revision)
    const restarted = createDraftStore(table)
    expect(restarted.get('/workspace', { ...payload, ownerId: 'new-window' })).toBeNull()
    expect(restarted.list('/workspace', payload)).toMatchObject([{ ownerId: 'window-A', text: 'A' }])
  })
  it('cannot clear a newer draft with an old or missing revision', async () => {
    const store = createDraftStore(tableFixture())
    const payload = { path: 'a.md', ownerId: 'A', baseText: '', baseVersion: 'v1' }
    const first = await store.put('/workspace', { ...payload, text: 'one' })
    await store.put('/workspace', { ...payload, text: 'two' })
    expect(await store.delete('/workspace', { ...payload, revision: first.revision })).toEqual({ deleted: false })
    expect(await store.delete('/workspace', payload)).toEqual({ deleted: false })
    expect(store.get('/workspace', payload)?.text).toBe('two')
  })
  it('lists an existing legacy row without rewriting or losing its contents', async () => {
    const table = tableFixture()
    await table.put(encodeURIComponent('/workspace') + '|a.md', { workspacePath: '/workspace', path: 'a.md', text: 'legacy', baseText: '', baseVersion: 'v1' })
    const store = createDraftStore(table)
    expect(store.list('/workspace', {path:'a.md'})).toMatchObject([{ownerId:'',text:'legacy'}])
    expect(store.get('/workspace', {path:'a.md',ownerId:'A'})).toBeNull()
  })
