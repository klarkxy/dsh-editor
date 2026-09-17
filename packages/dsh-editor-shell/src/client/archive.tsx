import { useRef, type RefObject } from 'react';
import { Callout, Card, Flex, Heading, IconButton, Text } from '@radix-ui/themes'
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
      className="file-dialog archive-panel file-dialog-overlay"
      overlayClassName="file-dialog-overlay"
      dismissible={!props.busy}
      initialFocusRef={close}
      returnFocusRef={props.returnFocusRef}>
      <Flex direction="column" gap="3">
        <Flex justify="between" align="start" gap="3">
          <Heading as="h2" size="4" id="archive-panel-title">
            {t('archive.title')}
          </Heading>
          <IconButton
            variant="ghost"
            color="gray"
            className="icon-button"
            aria-label={t('common.close')}
            disabled={props.busy}
            onClick={props.onClose}>
            ×
          </IconButton>
        </Flex>
        <Flex className="archive-list" direction="column" gap="2">
          {props.busy && !visible.length ? <Text size="1" color="gray">
            <ActivityText>
              {t('archive.loading')}
            </ActivityText>
          </Text> : null}
          {!props.busy && !visible.length ? <Text size="1" color="gray">
            {t('archive.empty')}
          </Text> : null}
          {visible.map((item) => <Card key={item.archiveId} asChild>
            <article>
              <Flex justify="between" align="start" gap="3">
                <Flex direction="column" gap="1" minWidth="0">
                  <Text weight="medium" size="2">
                    {documentName(item.path)}
                  </Text>
                  <Text size="1" color="gray">
                    {`${archiveStateText(item)} · ${new Date(item.createdAt).toLocaleString(intlLocale())}`}
                  </Text>
                  <Text size="1" color="gray">
                    <code>
                      {item.path}
                    </code>
                  </Text>
                </Flex>
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
              </Flex>
              {item.message ? <Callout.Root className="warning" color="red" size="1">
                <Callout.Text>
                  {t('archive.unsafe')}
                </Callout.Text>
              </Callout.Root> : null}
            </article>
          </Card>)}
          {props.invalid ? <Callout.Root className="warning" color="red" role="alert" size="1">
            <Callout.Text>
              {t('archive.invalid', { count: props.invalid })}
            </Callout.Text>
          </Callout.Root> : null}
          {props.note ? <Callout.Root className="warning" color="red" role="alert" size="1">
            <Callout.Text>
              {props.note}
            </Callout.Text>
          </Callout.Root> : null}
        </Flex>
        <Flex justify="end" gap="2">
          <Button ref={close} disabled={props.busy} onClick={props.onClose}>
            {t('common.close')}
          </Button>
        </Flex>
      </Flex>
    </Dialog>
  );
}
