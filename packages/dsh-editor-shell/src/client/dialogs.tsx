import { Fragment, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Button as ThemesButton, Callout, Card, Flex, Heading, IconButton, ScrollArea, Text } from '@radix-ui/themes'
import type { ConversationPresetChoice } from '../conversation-presets.ts'
import { t } from '../i18n/index.ts'
import { ActivityDots, Button, Confirm, ConfirmCancel, Dialog, Input } from './ui/index.ts'

export function ConfirmDialog(props: {
  id: string
  title: string
  message: string
  confirmLabel: string
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
        <Flex justify="end" gap="2">
          <ConfirmCancel
            children={<Button ref={cancel}>
              {t('common.cancel')}
            </Button>} />
          <ThemesButton variant="solid" color="red" className="danger-action" onClick={props.onConfirm}>
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
            ×
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
      description={t('dialog.newProjectHint')}
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
            <Text size="1" color="gray">
              {t('dialog.newProjectHint')}
            </Text>
          </Flex>
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

export function ConversationPresetPicker(props: {
  open: boolean
  phase: 'loading' | 'list-error' | 'ready'
  presets: readonly ConversationPresetChoice[]
  selectedId?: string
  error?: string
  busy?: boolean
  returnFocusRef?: RefObject<HTMLElement | null>
  onSelect(id: string): void
  onRetry(): void
  onCancel(): void
  onConfirm(): void
}) {
  const close = useRef<HTMLButtonElement | null>(null)
  const retry = useRef<HTMLButtonElement | null>(null)
  const firstChoice = useRef<HTMLButtonElement | null>(null)
  const confirm = useRef<HTMLButtonElement | null>(null)
  const initialFocus = props.phase === 'list-error' ? retry : props.phase === 'ready' ? firstChoice : close
  const canConfirm = props.phase === 'ready' && Boolean(props.selectedId) && props.presets.some((item) => item.id === props.selectedId && item.available)
  useEffect(() => {
    if (!props.open || props.busy) return
    if (props.phase === 'list-error') retry.current?.focus()
    else if (props.phase === 'ready') firstChoice.current?.focus()
  }, [props.open, props.phase, props.busy])
  return (
    <Dialog
      open={props.open}
      onOpenChange={(next: boolean) => { if (!next && !props.busy) props.onCancel() }}
      title={t('chat.presetPickerTitle')}
      description={t('chat.presetPickerHint')}
      className="file-dialog prompt-dialog preset-picker-dialog file-dialog-overlay"
      overlayClassName="file-dialog-overlay"
      dismissible={!props.busy}
      initialFocusRef={initialFocus}
      returnFocusRef={props.returnFocusRef}>
      <Flex direction="column" gap="3">
        <Flex justify="between" align="start" gap="3">
          <Flex direction="column" gap="1">
            <Heading as="h2" size="4" id="conversation-preset-picker-title">
              {t('chat.presetPickerTitle')}
            </Heading>
            <Text size="1" color="gray" id="conversation-preset-picker-hint">
              {t('chat.presetPickerHint')}
            </Text>
          </Flex>
          <IconButton
            ref={close}
            variant="ghost"
            color="gray"
            className="icon-button"
            aria-label={t('common.close')}
            disabled={props.busy}
            onClick={props.onCancel}>
            ×
          </IconButton>
        </Flex>
        {props.phase === 'loading' ? <Text size="2" role="status" aria-live="polite">
          <ActivityDots />
          {' '}
          {t('chat.presetLoading')}
        </Text> : null}
        {props.phase === 'list-error' ? <Callout.Root className="warning" color="red" role="alert" size="1">
          <Callout.Text>
            {props.error ?? t('chat.presetListFailed')}
          </Callout.Text>
        </Callout.Root> : null}
        {props.phase === 'ready' ? <ScrollArea
          className="file-dialog-actions"
          type="auto"
          scrollbars="vertical"
          role="radiogroup"
          aria-labelledby="conversation-preset-picker-title"
          aria-describedby="conversation-preset-picker-hint">
          <Flex direction="column" gap="2">
            {props.presets.map((preset, index) => <Card
              key={preset.id}
              asChild
              variant={props.selectedId === preset.id ? 'classic' : 'surface'}>
              <button
                ref={index === 0 ? firstChoice : undefined}
                type="button"
                role="radio"
                aria-checked={props.selectedId === preset.id}
                aria-label={preset.reason
                  ? `${preset.name}. ${preset.reason}`
                  : `${preset.name}. ${preset.legacy ? `${t('chat.presetLegacyBadge')} ` : ''}${preset.description}`}
                disabled={!preset.available || props.busy}
                className={props.selectedId === preset.id ? 'primary-action' : undefined}
                onClick={() => props.onSelect(preset.id)}>
                <Flex direction="column" gap="1" align="start">
                  <Text weight="medium" size="2">
                    {preset.name}
                    {preset.legacy ? <Text size="1" className="preset-badge">
                      {t('chat.presetLegacyBadge')}
                    </Text> : null}
                  </Text>
                  <Text size="1" color="gray">
                    {preset.description}
                  </Text>
                  {preset.reason ? <Text size="1" className="warning" color="red">
                    {preset.reason}
                  </Text> : null}
                </Flex>
              </button>
            </Card>)}
          </Flex>
        </ScrollArea> : null}
        {props.phase === 'ready' && props.error ? <Callout.Root className="warning" color="red" role="alert" size="1">
          <Callout.Text>
            {props.error}
          </Callout.Text>
        </Callout.Root> : null}
        <Flex justify="end" gap="2">
          <Button disabled={props.busy} onClick={props.onCancel}>
            {t('common.cancel')}
          </Button>
          {props.phase === 'list-error' || props.phase === 'loading'
            ? <Button
            ref={retry}
            variant="primary"
            className="primary-action"
            disabled={props.busy || props.phase === 'loading'}
            onClick={props.onRetry}>
            {props.phase === 'loading' ? <Fragment>
              <ActivityDots />
              {t('common.loading')}
            </Fragment> : t('common.retry')}
          </Button>
            : <Button
            ref={confirm}
            variant="primary"
            className="primary-action"
            disabled={props.busy || !canConfirm}
            onClick={props.onConfirm}>
            {props.busy ? <Fragment>
              <ActivityDots />
              {t('common.creating')}
            </Fragment> : t('chat.presetConfirm')}
          </Button>}
        </Flex>
      </Flex>
    </Dialog>
  );
}
