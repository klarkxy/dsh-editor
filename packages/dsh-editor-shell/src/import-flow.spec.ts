import { describe, expect, it } from 'vitest'
import { idleImportFlow, importReview, importSummary, recoverImport } from './import-flow.ts'

describe('import flow projection', () => {
  const ready = { state: 'ready' as const, token: 't', files: 2, bytes: 120, skipped: [], preview: ['正文/001.md'] }
  it('only presents an explicit review for a ready token', () => {
    expect(importReview('source-session', 'target', 'workspace', ready)).toMatchObject({ kind: 'review', probe: ready })
    expect(importReview('source-session', 'target', 'workspace', { ...ready, token: undefined })).toEqual(idleImportFlow)
  })
  it('offers recovery only for a persisted incomplete receipt', () => {
    expect(recoverImport('target', 'workspace', { ...ready, state: 'recoverable', receiptId: 'receipt' })).toMatchObject({ kind: 'recover' })
    expect(recoverImport('target', 'workspace', { ...ready, state: 'recoverable' })).toEqual(idleImportFlow)
    expect(recoverImport('target', 'workspace', ready)).toEqual(idleImportFlow)
    expect(importSummary(ready)).toBe('2 个文件，120 字节')
  })
})
