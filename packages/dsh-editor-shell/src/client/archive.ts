import { createElement as e, useRef, useEffect, type KeyboardEvent } from 'react'
import type { ArchiveResponse } from 'dsh-editor-workbench/contracts'
import { documentName } from './shared.ts'
import { intlLocale, t } from '../i18n/index.ts'

export type ArchiveView = ArchiveResponse

export function archiveStateText(item: ArchiveView): string {
  if (item.state === 'archived') return t('archive.title')
  if (item.state === 'pending-archive') return t('archive.incomplete')
  if (item.state === 'pending-restore') return t('archive.restoreIncomplete')
  if (item.state === 'restored') return t('archive.restored')
  return t('archive.needsCheck')
}

export function visibleArchives(items: readonly ArchiveView[]): ArchiveView[] {
  return items.filter((item) => item.state !== 'restored')
}

export function canArchivePath(kind: 'file' | 'directory', path: string): boolean {
  if (kind !== 'file' || !path) return false
  if (path.split('/').some((part) => part.startsWith('.'))) return false
  return /\.(md|txt)$/i.test(path)
}

export function ArchivePanel(props: {
  items: readonly ArchiveView[]
  invalid: number
  busy: boolean
  note: string
  editorDirty: boolean
  onRestore(item: ArchiveView): void
  onContinue(item: ArchiveView): void
  onClose(): void
}) {
  const dialog = useRef<HTMLElement | null>(null)
  const close = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { close.current?.focus() }, [])
  const visible = visibleArchives(props.items)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !props.busy) props.onClose()
  }
  return e('div', { className: 'file-dialog-overlay', onKeyDown },
    e('section', {
      ref: dialog,
      className: 'file-dialog archive-panel',
      role: 'dialog',
      tabIndex: -1,
      'aria-modal': true,
      'aria-labelledby': 'archive-panel-title',
    },
      e('header', null,
        e('div', null,
          e('h2', { id: 'archive-panel-title' }, t('archive.title')),
          e('small', null, t('archive.hint')),
        ),
        e('button', { className: 'icon-button', type: 'button', 'aria-label': t('common.close'), disabled: props.busy, onClick: props.onClose }, '×'),
      ),
      e('div', { className: 'archive-list' },
        props.busy && !visible.length ? e('p', { className: 'muted' }, t('archive.loading')) : null,
        !props.busy && !visible.length ? e('p', { className: 'muted' }, t('archive.empty')) : null,
        visible.map((item) => e('article', { key: item.archiveId },
          e('div', null,
            e('strong', null, documentName(item.path)),
            e('small', null, `${archiveStateText(item)} · ${new Date(item.createdAt).toLocaleString(intlLocale())}`),
            e('code', null, item.path),
          ),
          item.state === 'archived' || item.state === 'pending-restore'
            ? e('button', {
              type: 'button',
              disabled: props.busy || props.editorDirty,
              onClick: () => props.onRestore(item),
            }, item.state === 'pending-restore' ? t('archive.continueRestore') : t('common.restore'))
            : item.state === 'pending-archive'
              ? e('button', {
                type: 'button',
                disabled: props.busy || props.editorDirty,
                onClick: () => props.onContinue(item),
              }, t('archive.continueArchive'))
              : null,
          item.message ? e('p', { className: 'warning' }, t('archive.unsafe')) : null,
        )),
        props.invalid ? e('p', { className: 'warning', role: 'alert' }, t('archive.invalid', { count: props.invalid })) : null,
        props.note ? e('p', { className: 'warning', role: 'alert' }, props.note) : null,
      ),
      e('footer', null,
        e('button', { ref: close, type: 'button', disabled: props.busy, onClick: props.onClose }, t('common.close')),
      ),
    ),
  )
}
