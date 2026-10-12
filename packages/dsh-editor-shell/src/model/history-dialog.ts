import type { SnapshotChange, SnapshotResponse } from 'dsh-editor-workbench/contracts'
import { isAuthorFacingDocumentPath } from '../project-files.ts'

export type SnapshotView = SnapshotResponse

export function snapshotSubject(item: SnapshotView): string {
  const label = item.label?.trim()
  return label || item.createdAt
}

export function snapshotChanges(item: { changes?: readonly SnapshotChange[] | undefined }): SnapshotChange[] {
  return Array.isArray(item.changes) ? [...item.changes] : []
}

export function snapshotManuscriptChanges(item: { changes?: readonly SnapshotChange[] | undefined }): SnapshotChange[] {
  return snapshotChanges(item).filter(change => isAuthorFacingDocumentPath(change.path))
}

export function snapshotHashOf(item: { snapshotId: string; hash?: string }): string {
  return item.hash?.trim() || item.snapshotId.replace(/-/g, '').slice(0, 7)
}

export function normalizeSnapshot(item: SnapshotView): SnapshotView {
  return {
    ...item,
    hash: snapshotHashOf(item),
    changes: snapshotChanges(item),
  }
}

export function snapshotChangeCounts(changes: readonly SnapshotChange[] | undefined): {
  added: number
  removed: number
  modified: number
} {
  let added = 0
  let removed = 0
  let modified = 0
  for (const change of changes ?? []) {
    if (change.kind === 'added') added += 1
    else if (change.kind === 'removed') removed += 1
    else modified += 1
  }
  return { added, removed, modified }
}

export function selectedSnapshot(items: readonly SnapshotView[], id: string | undefined): SnapshotView | undefined {
  if (!items.length) return undefined
  return items.find((item) => item.snapshotId === id) ?? items[0]
}

export function snapshotKindMark(kind: SnapshotChange['kind']): 'A' | 'M' | 'D' {
  if (kind === 'added') return 'A'
  if (kind === 'removed') return 'D'
  return 'M'
}
