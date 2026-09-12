import { createElement as e, useRef, type RefObject } from 'react'
import type { ArchiveResponse } from 'dsh-editor-workbench/contracts'
import { documentName } from './shared.ts'
import { intlLocale, t } from '../i18n/index.ts'
import { Button, Dialog } from './ui/index.ts'

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
  open?: boolean
  items: readonly ArchiveView[]
  invalid: number
  busy: boolean
  note: string
  editorDirty: boolean
  onRestore(item: ArchiveView): void
  onContinue(item: ArchiveView): void
  onClose(): void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const open = props.open ?? true
  const close = useRef<HTMLButtonElement | null>(null)
  const visible = visibleArchives(props.items)
  return e(Dialog, {
    open,
    onOpenChange: (next: boolean) => { if (!next && !props.busy) props.onClose() },
    title: t('archive.title'),
    description: t('archive.hint'),
    className: 'file-dialog archive-panel',
    overlayClassName: 'file-dialog-overlay',
    dismissible: !props.busy,
    initialFocusRef: close,
    returnFocusRef: props.returnFocusRef,
  },
    e('header', null,
      e('div', null,
        e('h2', { id: 'archive-panel-title' }, t('archive.title')),
        e('small', null, t('archive.hint')),
      ),
      e(Button, { variant: 'icon', className: 'icon-button', 'aria-label': t('common.close'), disabled: props.busy, onClick: props.onClose }, '×'),
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
          ? e(Button, {
            disabled: props.busy || props.editorDirty,
            onClick: () => props.onRestore(item),
          }, item.state === 'pending-restore' ? t('archive.continueRestore') : t('common.restore'))
          : item.state === 'pending-archive'
            ? e(Button, {
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
      e(Button, { ref: close, disabled: props.busy, onClick: props.onClose }, t('common.close')),
    ),
  )
}
