import { useEffect, useRef, useState, type RefObject } from 'react'
import { Flex, Heading, IconButton, Text } from '@radix-ui/themes'
import type { SnapshotChange, SnapshotResponse } from 'dsh-editor-workbench/contracts'
import { formatRecentTime } from '../home-stage.ts'
import { formatBytes, intlLocale, t, useLocale } from '../i18n/index.ts'
import { ActivitySkeleton, ActivityText, Button, Dialog } from './ui/index.ts'
import { CrossIcon } from './icons.tsx'

export type SnapshotView = SnapshotResponse

export function snapshotSubject(item: SnapshotView): string {
  const label = item.label?.trim()
  return label || item.createdAt
}

export function snapshotChanges(item: { changes?: readonly SnapshotChange[] | undefined }): SnapshotChange[] {
  return Array.isArray(item.changes) ? [...item.changes] : []
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

function snapshotWhen(iso: string): string {
  const stamp = Date.parse(iso)
  if (!Number.isFinite(stamp)) return iso
  return new Date(stamp).toLocaleString(intlLocale())
}

function HistoryPanel(props: {
  open?: boolean
  snapshots: SnapshotView[] | null
  busy: boolean
  editorDirty: boolean
  onRollback(item: SnapshotView): void
  onClose(): void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const open = props.open ?? true
  const close = useRef<HTMLButtonElement | null>(null)
  const [selectedId, setSelectedId] = useState<string>()
  const items = Array.isArray(props.snapshots) ? props.snapshots.map(normalizeSnapshot) : []
  const selected = selectedSnapshot(items, selectedId)
  const selectedChanges = selected ? snapshotChanges(selected) : []
  useLocale()
  useEffect(() => {
    const next = Array.isArray(props.snapshots) ? props.snapshots : []
    if (!next.length) {
      setSelectedId(undefined)
      return
    }
    setSelectedId((current) => next.some((item) => item.snapshotId === current) ? current : next[0]!.snapshotId)
  }, [props.snapshots])
  const counts = snapshotChangeCounts(selectedChanges)
  const loading = props.snapshots === null
  const empty = !loading && items.length === 0
  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => { if (!next && !props.busy) props.onClose() }}
      title={t('workspace.commitHistory')}
      description={t('workspace.historyHint')}
      className="file-dialog history-dialog file-dialog-overlay"
      overlayClassName="file-dialog-overlay"
      dismissible={!props.busy}
      initialFocusRef={close}
      returnFocusRef={props.returnFocusRef}>
      <Flex direction="column" gap="3">
        <Flex justify="between" align="start" gap="3">
          <Flex direction="column" gap="1" minWidth="0">
            <Heading as="h2" size="4" id="history-panel-title">
              {t('workspace.commitHistory')}
            </Heading>
            <Text size="1" color="gray">
              {t('workspace.historyHint')}
            </Text>
          </Flex>
          <IconButton
            variant="ghost"
            color="gray"
            className="icon-button"
            aria-label={t('common.close')}
            disabled={props.busy}
            onClick={props.onClose}>
            <CrossIcon size={14} />
          </IconButton>
        </Flex>
        {loading ? <Flex className="history-split" gap="3">
          <div className="history-commits">
            <ActivitySkeleton lines={4} />
            <span className="sr-only">{t('workspace.historyLoading')}</span>
          </div>
        </Flex> : null}
        {empty ? <Text size="1" color="gray">
          {t('workspace.historyEmpty')}
        </Text> : null}
        {!loading && !empty ? <div className="history-split">
          <div className="history-commits" role="listbox" aria-label={t('workspace.commitHistory')}>
              {items.map((item, index) => {
                const current = snapshotChangeCounts(item.changes)
                const active = item.snapshotId === selected?.snapshotId
                return (
                  <button
                    key={item.snapshotId}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-selected={active ? 'true' : undefined}
                    className="history-commit"
                    onClick={() => setSelectedId(item.snapshotId)}>
                    <span className="history-commit-dot" aria-hidden="true" />
                    <span className="history-commit-body">
                      <span className="history-commit-top">
                        <code className="history-hash">{item.hash}</code>
                        <Text size="1" color="gray">
                          {formatRecentTime(item.createdAt)}
                        </Text>
                        {index === 0 ? <Text size="1" color="gray">{t('workspace.historyLatest')}</Text> : null}
                      </span>
                      <Text as="span" size="2" className="history-subject" truncate>
                        {snapshotSubject(item)}
                      </Text>
                      <Text as="span" size="1" color="gray" className="history-commit-meta">
                        {t('workspace.historyFiles', { count: item.files })}
                        {current.added || current.removed || current.modified
                          ? ` · ${t('workspace.historyDiff', current)}`
                          : index === items.length - 1
                            ? ` · ${t('workspace.historyInitial')}`
                            : ''}
                      </Text>
                    </span>
                  </button>
                )
              })}
          </div>
          <Flex className="history-detail" direction="column" gap="3" minWidth="0">
            {selected ? <>
              <Flex direction="column" gap="1" minWidth="0">
                <Flex align="center" gap="2">
                  <code className="history-hash history-hash-lg" title={selected.snapshotId}>
                    {selected.hash}
                  </code>
                  <Text size="1" color="gray" truncate>
                    {snapshotWhen(selected.createdAt)}
                  </Text>
                </Flex>
                <Text size="3" weight="medium">
                  {snapshotSubject(selected)}
                </Text>
                <Text size="1" color="gray">
                  {t('workspace.historyFiles', { count: selected.files })}
                  {' · '}
                  {t('workspace.historyBytes', { bytes: formatBytes(selected.bytes) })}
                  {selected.excluded ? ` · ${t('workspace.historyExcluded', { count: selected.excluded })}` : ''}
                </Text>
              </Flex>
              <Flex direction="column" gap="2" minWidth="0" className="history-changes">
                {selectedChanges.length
                  ? <Text size="1" color="gray">
                    {t('workspace.historyChanged', { count: selectedChanges.length })}
                    {' · '}
                    {t('workspace.historyDiff', counts)}
                  </Text>
                  : <Text size="1" color="gray">
                    {items[items.length - 1]?.snapshotId === selected.snapshotId
                      ? t('workspace.historyInitial')
                      : t('workspace.historyNoChanges')}
                  </Text>}
                {selectedChanges.length ? <ul className="history-change-list">
                  {selectedChanges.map((change) => <li key={`${change.kind}:${change.path}`} className={`history-change history-change-${change.kind}`}>
                    <span className="history-kind" aria-label={t(
                      change.kind === 'added'
                        ? 'workspace.historyAdded'
                        : change.kind === 'removed'
                          ? 'workspace.historyRemoved'
                          : 'workspace.historyModified',
                    )}>
                      {snapshotKindMark(change.kind)}
                    </span>
                    <code>{change.path}</code>
                  </li>)}
                </ul> : null}
              </Flex>
              <Flex justify="end">
                <Button
                  disabled={props.busy || props.editorDirty}
                  title={props.editorDirty ? t('note.saveBeforeRollback') : undefined}
                  onClick={() => props.onRollback(selected)}>
                  {props.busy ? <ActivityText>{t('workspace.rollback')}</ActivityText> : t('workspace.rollback')}
                </Button>
              </Flex>
            </> : <Text size="1" color="gray">
              {t('workspace.historySelect')}
            </Text>}
          </Flex>
        </div> : null}
        <Flex justify="end" gap="2">
          <Button ref={close} disabled={props.busy} onClick={props.onClose}>
            {t('common.close')}
          </Button>
        </Flex>
      </Flex>
    </Dialog>
  )
}

export { HistoryPanel }
