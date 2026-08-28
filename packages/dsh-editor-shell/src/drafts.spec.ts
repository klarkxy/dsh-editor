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
