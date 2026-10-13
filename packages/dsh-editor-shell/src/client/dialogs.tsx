import { Fragment, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Button as ThemesButton, Callout, Flex, Heading, IconButton, Text } from '@radix-ui/themes'
import { t } from '../i18n/index.ts'
import { ActivityDots, Button, Confirm, ConfirmCancel, Dialog, Input } from './ui/index.ts'
import { CrossIcon } from './icons.tsx'

export function ConfirmDialog(props: {
  id: string
  title: string
  message: string
  confirmLabel: string
  note?: string
  busy?: boolean
  open?: boolean
  returnFocusRef?: RefObject<HTMLElement | null>
  onCancel(): void
  onConfirm(): void
}) {
  const open = props.open ?? true
  const cancel = useRef<HTMLButtonElement | null>(null)
  const shown = useRef({ title: props.title, message: props.message, confirmLabel: props.confirmLabel })
  if (open) shown.current = { title: props.title, message: props.message, confirmLabel: props.confirmLabel }
  const display = shown.current
  return (
    <Confirm
      open={open}
      onOpenChange={(next: boolean) => { if (!next) props.onCancel() }}
      title={display.title}
      description={display.message}
      className="file-dialog confirm-dialog file-dialog-overlay"
      overlayClassName="file-dialog-overlay confirm-overlay"
      initialFocusRef={cancel}
      returnFocusRef={props.returnFocusRef}>
      <Flex direction="column" gap="3">
        <Heading as="h2" size="4" id={`${props.id}-title`}>
          {display.title}
        </Heading>
        <Text size="2" id={`${props.id}-message`}>
          {display.message}
        </Text>
        {props.note ? <Callout.Root color="red" role="alert" size="1">
          <Callout.Text>
            {props.note}
          </Callout.Text>
        </Callout.Root> : null}
        <Flex justify="end" gap="2">
          <ConfirmCancel
            children={<Button ref={cancel} disabled={props.busy}>
              {t('common.cancel')}
            </Button>} />
          <ThemesButton variant="solid" color="red" className="danger-action" disabled={props.busy} onClick={props.onConfirm}>
            {display.confirmLabel}
          </ThemesButton>
        </Flex>
      </Flex>
    </Confirm>
  );
}

export function TextPromptDialog(props: {
  id: string
  title: string
  label: string
  initialValue: string
  confirmLabel: string
  note?: string
  busy?: boolean
  open?: boolean
  returnFocusRef?: RefObject<HTMLElement | null>
  onCancel(): void
  onConfirm(value: string): void
}) {
  const open = props.open ?? true
  const [value, setValue] = useState(props.initialValue)
  const input = useRef<HTMLInputElement | null>(null)
  const shown = useRef({ title: props.title, label: props.label, confirmLabel: props.confirmLabel })
  const wasOpen = useRef(open)
  if (open) shown.current = { title: props.title, label: props.label, confirmLabel: props.confirmLabel }
  useEffect(() => {
    if (open && !wasOpen.current) setValue(props.initialValue)
    wasOpen.current = open
  }, [open, props.initialValue])
  const display = shown.current
  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => { if (!next && !props.busy) props.onCancel() }}
      title={display.title}
      className="file-dialog prompt-dialog file-dialog-overlay"
      overlayClassName="file-dialog-overlay"
      dismissible={!props.busy}
      initialFocusRef={input}
      returnFocusRef={props.returnFocusRef}>
      <Flex direction="column" gap="3">
        <Flex justify="between" align="start" gap="3">
          <Heading as="h2" size="4" id={`${props.id}-title`}>
            {display.title}
          </Heading>
          <IconButton
            variant="ghost"
            color="gray"
            className="icon-button"
            aria-label={t('common.close')}
            disabled={props.busy}
            onClick={props.onCancel}>
            <CrossIcon size={14} />
          </IconButton>
        </Flex>
        <Flex
          direction="column"
          gap="3"
          asChild>
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              if (value.trim() && !props.busy) props.onConfirm(value.trim())
            }}>
            <Text as="label" size="2">
              <Flex direction="column" gap="1">
                {display.label}
                <Input
                  ref={input}
                  value={value}
                  maxLength={80}
                  disabled={props.busy}
                  onChange={setValue} />
              </Flex>
            </Text>
            {props.note ? <Callout.Root className="warning" color="red" role="alert" size="1">
              <Callout.Text>
                {props.note}
              </Callout.Text>
            </Callout.Root> : null}
            <Flex justify="end" gap="2">
              <Button disabled={props.busy} onClick={props.onCancel}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                type="submit"
                className="primary-action"
                disabled={props.busy || !value.trim()}>
                {props.busy ? <Fragment>
                  <ActivityDots />
                  {t('common.saving')}
                </Fragment> : display.confirmLabel}
              </Button>
            </Flex>
          </form>
        </Flex>
      </Flex>
    </Dialog>
  );
}

export function NewProjectDialog(props: {
  directory?: string
  open?: boolean
  busy: boolean
  note: string
  returnFocusRef?: RefObject<HTMLElement | null>
  onClose(): void
  onCreate(title: string): void
}) {
  const open = props.open ?? true
  const [title, setTitle] = useState('')
  const input = useRef<HTMLInputElement | null>(null)
  const wasOpen = useRef(open)
  useEffect(() => {
    if (open && !wasOpen.current) setTitle('')
    wasOpen.current = open
  }, [open])
  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => { if (!next && !props.busy) props.onClose() }}
      title={t('dialog.newProject')}
      description={props.directory ? t('dialog.projectDirectory', { path: props.directory }) : undefined}
      className="file-dialog create-dialog file-dialog-overlay"
      overlayClassName="file-dialog-overlay"
      dismissible={!props.busy}
      initialFocusRef={input}
      returnFocusRef={props.returnFocusRef}>
      <Flex direction="column" gap="3">
        <Flex justify="between" align="start" gap="3">
          <Flex direction="column" gap="1">
            <Heading as="h2" size="4" id="new-project-dialog-title">
              {t('dialog.newProject')}
            </Heading>
            <Text size="2" color="gray" className="project-directory">
              {props.directory === undefined ? t('dialog.projectDirectoryLoading') : props.directory
                ? t('dialog.projectDirectory', { path: props.directory }) : t('dialog.newProjectHint')}
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
        <Flex
          direction="column"
          gap="3"
          asChild>
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              if (title.trim() && !props.busy) props.onCreate(title.trim())
            }}>
            <Text as="label" size="2">
              <Flex direction="column" gap="1">
                {t('dialog.workName')}
                <Input
                  ref={input}
                  value={title}
                  maxLength={80}
                  placeholder={t('dialog.workNamePlaceholder')}
                  disabled={props.busy}
                  onChange={setTitle} />
              </Flex>
            </Text>
            {!title.trim() && !props.note ? <Text size="1" color="gray">
              {t('dialog.workNameRequired')}
            </Text> : null}
            {props.note ? <Callout.Root className="warning" color="red" role="alert" size="1">
              <Callout.Text>
                {props.note}
              </Callout.Text>
            </Callout.Root> : null}
            <Flex justify="end" gap="2">
              <Button disabled={props.busy} onClick={props.onClose}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                type="submit"
                className="primary-action"
                disabled={props.busy || !title.trim()}>
                {props.busy ? <Fragment>
                  <ActivityDots />
                  {t('common.creating')}
                </Fragment> : t('common.create')}
              </Button>
            </Flex>
          </form>
        </Flex>
      </Flex>
    </Dialog>
  );
}
