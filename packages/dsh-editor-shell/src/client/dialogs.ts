import { createElement as e, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { t } from '../i18n/index.ts'
import { Button, Confirm, ConfirmCancel, Dialog, Input } from './ui/index.ts'

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
  return e(Confirm, {
    open,
    onOpenChange: (next: boolean) => { if (!next) props.onCancel() },
    title: display.title,
    description: display.message,
    className: 'file-dialog confirm-dialog',
    overlayClassName: 'file-dialog-overlay confirm-overlay',
    initialFocusRef: cancel,
    returnFocusRef: props.returnFocusRef,
  },
    e('header', null, e('h2', { id: `${props.id}-title` }, display.title)),
    e('p', { id: `${props.id}-message` }, display.message),
    e('footer', null,
      e(ConfirmCancel, { children: e(Button, { ref: cancel }, t('common.cancel')) }),
      e(Button, { variant: 'danger', className: 'danger-action', onClick: props.onConfirm }, display.confirmLabel),
    ),
  )
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
  return e(Dialog, {
    open,
    onOpenChange: (next: boolean) => { if (!next && !props.busy) props.onCancel() },
    title: display.title,
    className: 'file-dialog prompt-dialog',
    overlayClassName: 'file-dialog-overlay',
    dismissible: !props.busy,
    initialFocusRef: input,
    returnFocusRef: props.returnFocusRef,
  },
    e('header', null,
      e('h2', { id: `${props.id}-title` }, display.title),
      e(Button, { variant: 'icon', className: 'icon-button', 'aria-label': t('common.close'), disabled: props.busy, onClick: props.onCancel }, '×'),
    ),
    e('form', {
      onSubmit: (event: FormEvent) => {
        event.preventDefault()
        if (value.trim() && !props.busy) props.onConfirm(value.trim())
      },
    },
      e('label', null, display.label, e(Input, { ref: input, value, maxLength: 80, disabled: props.busy, onChange: setValue })),
      props.note ? e('p', { className: 'warning', role: 'alert' }, props.note) : null,
      e('footer', null,
        e(Button, { disabled: props.busy, onClick: props.onCancel }, t('common.cancel')),
        e(Button, { variant: 'primary', type: 'submit', className: 'primary-action', disabled: props.busy || !value.trim() }, props.busy ? t('common.saving') : display.confirmLabel),
      ),
    ),
  )
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
  return e(Dialog, {
    open,
    onOpenChange: (next: boolean) => { if (!next && !props.busy) props.onClose() },
    title: t('dialog.newProject'),
    description: t('dialog.newProjectHint'),
    className: 'file-dialog create-dialog',
    overlayClassName: 'file-dialog-overlay',
    dismissible: !props.busy,
    initialFocusRef: input,
    returnFocusRef: props.returnFocusRef,
  },
    e('header', null,
      e('div', null,
        e('h2', { id: 'new-project-dialog-title' }, t('dialog.newProject')),
        e('small', null, t('dialog.newProjectHint')),
      ),
      e(Button, { variant: 'icon', className: 'icon-button', 'aria-label': t('common.close'), disabled: props.busy, onClick: props.onClose }, '×'),
    ),
    e('form', {
      onSubmit: (event: FormEvent) => {
        event.preventDefault()
        if (title.trim() && !props.busy) props.onCreate(title.trim())
      },
    },
      e('label', null, t('dialog.workName'),
        e(Input, {
          ref: input,
          value: title,
          maxLength: 80,
          placeholder: t('dialog.workNamePlaceholder'),
          disabled: props.busy,
          onChange: setTitle,
        }),
      ),
      props.note ? e('p', { className: 'warning', role: 'alert' }, props.note) : null,
      e('footer', null,
        e(Button, { disabled: props.busy, onClick: props.onClose }, t('common.cancel')),
        e(Button, { variant: 'primary', type: 'submit', className: 'primary-action', disabled: props.busy || !title.trim() }, props.busy ? t('common.creating') : t('common.create')),
      ),
    ),
  )
}
