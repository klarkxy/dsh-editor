import { describe, expect, it } from 'vitest'
import { DraftSyncQueue, type EditorDraft } from './drafts.ts'

describe('editor draft protocol shape', () => {
  it('carries only workspace-relative document state for the Host RPC', () => {
    const draft: EditorDraft = { path: '正文/01.md', text: '本地草稿', baseText: '原文', baseVersion: 'v1' }
    expect(draft).toEqual({ path: '正文/01.md', text: '本地草稿', baseText: '原文', baseVersion: 'v1' })
  })

  it('serializes a delayed put before save deletion', async () => {
    const calls: string[] = []
    let releasePut!: () => void
    const putPending = new Promise<void>((resolve) => { releasePut = resolve })
    const queue = new DraftSyncQueue(async (endpoint) => {
      calls.push(endpoint)
      if (endpoint === 'draft.put') await putPending
      return { ok: true }
    })
    const put = queue.run('draft.put', { path: '正文/01.md', text: '旧草稿' })
    const deletion = queue.run('draft.delete', { path: '正文/01.md' })
    await Promise.resolve()
    expect(calls).toEqual(['draft.put'])
    releasePut()
    await Promise.all([put, deletion])
    expect(calls).toEqual(['draft.put', 'draft.delete'])
  })
})

describe('tracked draft deletion', () => {
  it('injects the latest recorded revision when the delete executes', async () => {
    const deletes: Array<Record<string, unknown>> = []
    let releaseFirst!: () => void
    const firstPut = new Promise<void>((resolve) => { releaseFirst = resolve })
    let putCount = 0
    const queue = new DraftSyncQueue(async (endpoint, payload) => {
      if (endpoint === 'draft.put') {
        putCount += 1
        if (putCount === 1) await firstPut
        return { ok: true, value: { stored: true, revision: `r${putCount}` } }
      }
      deletes.push(payload)
      return { ok: true, value: { deleted: true } }
    })
    /* 第一次 put 挂起期间又来了新 put 和 delete：delete 执行时必须带最新的 r2。 */
    const p1 = queue.run('draft.put', { path: '正文/01.md', text: '一' })
    const p2 = queue.run('draft.put', { path: '正文/01.md', text: '二' })
    const del = queue.delete({ path: '正文/01.md' })
    releaseFirst()
    await Promise.all([p1, p2, del])
    expect(deletes).toEqual([{ path: '正文/01.md', revision: 'r2' }])
  })

  it('never issues a delete for a file whose revision was never observed', async () => {
    const calls: string[] = []
    const queue = new DraftSyncQueue(async (endpoint) => { calls.push(endpoint); return { ok: true } })
    const result = await queue.delete({ path: '正文/02.md' }) as { ok: boolean; value: { deleted: boolean } }
    expect(calls).toEqual([])
    expect(result).toEqual({ ok: true, value: { deleted: false } })
  })

  it('keeps the revision record after a failed delete and clears it only on success', async () => {
    const deletes: Array<Record<string, unknown>> = []
    let failDelete = true
    const queue = new DraftSyncQueue(async (endpoint, payload) => {
      if (endpoint === 'draft.put') return { ok: true, value: { stored: true, revision: payload.text === '一' ? 'r1' : 'r2' } }
      deletes.push(payload)
      return failDelete ? { ok: false, error: { message: 'io' } } : { ok: true, value: { deleted: true } }
    })
    await queue.run('draft.put', { path: '正文/03.md', text: '一' })
    const failed = await queue.delete({ path: '正文/03.md' }) as { ok: boolean }
    expect(failed.ok).toBe(false)
    expect(deletes).toEqual([{ path: '正文/03.md', revision: 'r1' }])
    /* 失败的 delete 不清记录：草稿更新后重试仍带最新 revision，不会退化成盲删。 */
    await queue.run('draft.put', { path: '正文/03.md', text: '二' })
    failDelete = false
    await queue.delete({ path: '正文/03.md' })
    expect(deletes[1]).toEqual({ path: '正文/03.md', revision: 'r2' })
    /* 成功后记录清除：再次 delete 不发 RPC，不会误删之后新建/更新的草稿。 */
    await queue.delete({ path: '正文/03.md' })
    expect(deletes).toHaveLength(2)
  })
})
