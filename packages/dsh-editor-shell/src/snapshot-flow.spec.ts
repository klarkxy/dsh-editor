import { describe, expect, it } from 'vitest'
import {
  blocksWorkspaceOpen,
  idleSnapshotFlow,
  recoverSnapshot,
  restoreSummary,
  snapshotReview,
  snapshotSummary,
} from './snapshot-flow.ts'

describe('snapshot restore flow', () => {
  const ready = { state: 'ready' as const, token: 't', snapshotId: 'snapshot', files: 2, bytes: 2048, excluded: [], preview: [] }
  it('requires an explicit ready token before review', () => {
    expect(snapshotReview('source', 'target', 'workspace', ready)).toMatchObject({ kind: 'review', probe: ready })
    expect(snapshotReview('source', 'target', 'workspace', { ...ready, token: undefined })).toEqual(idleSnapshotFlow)
  })
  it('only exposes recovery for a bound incomplete receipt', () => {
    expect(recoverSnapshot('target', 'workspace', { ...ready, state: 'recoverable', receiptId: 'r' })).toMatchObject({ kind: 'recover' })
    expect(recoverSnapshot('target', 'workspace', { ...ready, state: 'recoverable', receiptId: undefined })).toEqual(idleSnapshotFlow)
    expect(recoverSnapshot('target', 'workspace', ready)).toEqual(idleSnapshotFlow)
    expect(blocksWorkspaceOpen({ ...ready, state: 'recoverable', receiptId: 'r' })).toBe(true)
    expect(blocksWorkspaceOpen({ ...ready, state: 'complete' })).toBe(false)
  })
  it('renders compact author-facing metadata', () => {
    expect(snapshotSummary({ files: 2, bytes: 2048, excluded: 3 })).toBe('2 个文件，2,048 字节，排除 3 项')
    expect(restoreSummary({ ...ready, excluded: [{ path: '.git', reason: 'hidden' }] })).toBe('2 个文件，2,048 字节，排除 1 项')
  })
})
