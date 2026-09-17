import { describe, expect, it } from 'vitest'
import type { SnapshotResponse } from 'dsh-editor-workbench/contracts'
import { normalizeSnapshot, selectedSnapshot, snapshotChangeCounts, snapshotKindMark, snapshotSubject } from './history-dialog.tsx'

function snapshot(partial: Partial<SnapshotResponse> & Pick<SnapshotResponse, 'snapshotId'>): SnapshotResponse {
  return {
    hash: 'a1b2c3d',
    createdAt: '2026-09-12T09:20:00.000Z',
    files: 2,
    bytes: 40,
    excluded: 0,
    changes: [],
    ...partial,
  }
}

describe('version history presentation', () => {
  it('uses the commit message when present and falls back to the timestamp', () => {
    expect(snapshotSubject(snapshot({ snapshotId: 'a', label: '  修订  ' }))).toBe('修订')
    expect(snapshotSubject(snapshot({ snapshotId: 'b', createdAt: '2026-10-10T01:00:00.000Z' }))).toBe('2026-10-10T01:00:00.000Z')
  })

  it('counts added, removed, and modified files like git status', () => {
    expect(snapshotChangeCounts([
      { path: '正文/001.md', kind: 'modified' },
      { path: '正文/002.md', kind: 'added' },
      { path: 'keep.md', kind: 'removed' },
    ])).toEqual({ added: 1, removed: 1, modified: 1 })
    expect(snapshotKindMark('added')).toBe('A')
    expect(snapshotKindMark('modified')).toBe('M')
    expect(snapshotKindMark('removed')).toBe('D')
  })

  it('keeps the current commit when it still exists, otherwise selects the newest', () => {
    const items = [
      snapshot({ snapshotId: 'new', label: '修订' }),
      snapshot({ snapshotId: 'old', label: '开篇' }),
    ]
    expect(selectedSnapshot(items, 'old')?.snapshotId).toBe('old')
    expect(selectedSnapshot(items, 'missing')?.snapshotId).toBe('new')
    expect(selectedSnapshot([], 'old')).toBeUndefined()
  })

  it('treats a legacy snapshot without hash or changes as an empty commit', () => {
    const legacy = normalizeSnapshot({
      snapshotId: 'a1b2c3d4-e5f6-4789-abcd-0123456789ab',
      createdAt: '2026-09-12T09:20:00.000Z',
      files: 2,
      bytes: 40,
      excluded: 0,
    } as SnapshotResponse)
    expect(legacy.hash).toBe('a1b2c3d')
    expect(legacy.changes).toEqual([])
    expect(snapshotChangeCounts(undefined)).toEqual({ added: 0, removed: 0, modified: 0 })
  })
})
