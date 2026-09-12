import { createElement as e, useEffect, useRef, useState, type ChangeEvent, type ComponentType, type FormEvent, type KeyboardEvent } from 'react'
import type { ShellDialogProps } from 'dsh-editor-seats'
import { guardImeEnter } from './host-ui.ts'
import { t } from './messages.ts'

function useDialogReturnFocus(dialogRef: { current: HTMLElement | null }, firstFocus: () => void) {
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    globalThis.setTimeout(firstFocus, 0)
    return () => {
      const target = returnFocus.current
      globalThis.setTimeout(() => { if (target?.isConnected) target.focus() }, 0)
    }
  }, [])
  return dialogRef
}

function focusableBoundary(dialog: HTMLElement | null, event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab' || !dialog) return
  const controls = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled])')]
  if (!controls.length) return
  const first = controls[0]!
  const last = controls.at(-1)!
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

export function cardsPromptKeyDown(event: {
  key?: string
  preventDefault(): void
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
}): boolean {
  return guardImeEnter(event)
}

export function TextPromptDialog(props: {
  Dialog?: ComponentType<ShellDialogProps>
  id: string
  open: boolean
  title: string
  label: string
  initialValue: string
  confirmLabel: string
  note?: string
  busy?: boolean
  onCancel(): void
  onConfirm(value: string): void
}) {
  const [value, setValue] = useState(props.initialValue)
  const input = useRef<HTMLInputElement | null>(null)
  const shown = useRef({ title: props.title, label: props.label, confirmLabel: props.confirmLabel })
  const wasOpen = useRef(props.open)
  if (props.open) shown.current = { title: props.title, label: props.label, confirmLabel: props.confirmLabel }
  useEffect(() => {
    if (props.open && !wasOpen.current) setValue(props.initialValue)
    wasOpen.current = props.open
  }, [props.open, props.initialValue])
  const display = shown.current

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (value.trim() && !props.busy) props.onConfirm(value.trim())
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    cardsPromptKeyDown(event)
  }

  const children = [
    e('header', { key: 'header' },
      e('h2', { id: `${props.id}-title` }, display.title),
      e('button', {
        className: 'icon-button',
        type: 'button',
        'aria-label': t('common.close'),
        disabled: props.busy,
        onClick: props.onCancel,
      }, '×'),
    ),
    e('form', { key: 'form', onSubmit: submit },
      e('label', null, display.label, e('input', {
        ref: input,
        value,
        maxLength: 80,
        disabled: props.busy,
        onChange: (event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value),
        onKeyDown: onInputKeyDown,
      })),
      props.note ? e('p', { className: 'warning', role: 'alert' }, props.note) : null,
      e('footer', null,
        e('button', { type: 'button', disabled: props.busy, onClick: props.onCancel }, t('common.cancel')),
        e('button', {
          className: 'primary-action',
          type: 'submit',
          disabled: props.busy || !value.trim(),
        }, props.busy ? t('common.saving') : display.confirmLabel),
      ),
    ),
  ]

  if (props.Dialog) {
    return e(props.Dialog, {
      open: props.open,
      onOpenChange: (next: boolean) => { if (!next && !props.busy) props.onCancel() },
      title: display.title,
      className: 'file-dialog prompt-dialog',
      overlayClassName: 'file-dialog-overlay',
      dismissible: !props.busy,
      initialFocusRef: input,
    }, children)
  }

  if (!props.open) return null
  return e(NativePromptFallback, {
    busy: props.busy,
    titleId: `${props.id}-title`,
    input,
    onCancel: props.onCancel,
  }, children)
}

function NativePromptFallback(props: {
  busy?: boolean
  titleId: string
  input: { current: HTMLInputElement | null }
  onCancel(): void
  children?: unknown
}) {
  const dialog = useRef<HTMLDivElement | null>(null)
  useDialogReturnFocus(dialog, () => { props.input.current?.focus(); props.input.current?.select() })
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !props.busy) { event.preventDefault(); props.onCancel(); return }
    focusableBoundary(dialog.current, event)
  }
  return e('div', {
    className: 'dsh-ui file-dialog-overlay',
    onClick: (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
      if (event.target === event.currentTarget && !props.busy) props.onCancel()
    },
  },
    e('div', {
      ref: dialog,
      className: 'dsh-ui file-dialog prompt-dialog',
      role: 'dialog',
      'aria-modal': true,
      'aria-labelledby': props.titleId,
      onKeyDown,
    }, props.children as never),
  )
}
