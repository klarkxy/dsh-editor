import React, { useRef, type RefObject } from 'react';
import type { ArchiveResponse } from 'dsh-editor-workbench/contracts'
import { documentName } from './shared.ts'
import { intlLocale, t } from '../i18n/index.ts'
import { ActivityText, Button, Dialog } from './ui/index.ts'

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
  return /\.(md|txt)$/i.test(path);
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
  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => { if (!next && !props.busy) props.onClose() }}
      title={t('archive.title')}
      description={t('archive.hint')}
      className="file-dialog archive-panel"
      overlayClassName="file-dialog-overlay"
      dismissible={!props.busy}
      initialFocusRef={close}
      returnFocusRef={props.returnFocusRef}>
      <header>
        <div>
          <h2 id="archive-panel-title">
            {t('archive.title')}
          </h2>
        </div>
        <Button
          variant="icon"
          className="icon-button"
          aria-label={t('common.close')}
          disabled={props.busy}
          onClick={props.onClose}>
          ×
        </Button>
      </header>
      <div className="archive-list">
        {props.busy && !visible.length ? <p className="muted">
          <ActivityText>
            {t('archive.loading')}
          </ActivityText>
        </p> : null}
        {!props.busy && !visible.length ? <p className="muted">
          {t('archive.empty')}
        </p> : null}
        {visible.map((item) => <article key={item.archiveId}>
          <div>
            <strong>
              {documentName(item.path)}
            </strong>
            <small>
              {`${archiveStateText(item)} · ${new Date(item.createdAt).toLocaleString(intlLocale())}`}
            </small>
            <code>
              {item.path}
            </code>
          </div>
          {item.state === 'archived' || item.state === 'pending-restore'
            ? <Button
            disabled={props.busy || props.editorDirty}
            onClick={() => props.onRestore(item)}>
            {item.state === 'pending-restore' ? t('archive.continueRestore') : t('common.restore')}
          </Button>
            : item.state === 'pending-archive'
              ? <Button
            disabled={props.busy || props.editorDirty}
            onClick={() => props.onContinue(item)}>
            {t('archive.continueArchive')}
          </Button>
              : null}
          {item.message ? <p className="warning">
            {t('archive.unsafe')}
          </p> : null}
        </article>)}
        {props.invalid ? <p className="warning" role="alert">
          {t('archive.invalid', { count: props.invalid })}
        </p> : null}
        {props.note ? <p className="warning" role="alert">
          {props.note}
        </p> : null}
      </div>
      <footer>
        <Button ref={close} disabled={props.busy} onClick={props.onClose}>
          {t('common.close')}
        </Button>
      </footer>
    </Dialog>
  );
}
