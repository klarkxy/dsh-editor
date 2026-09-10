import { createElement as e, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
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

export function TextPromptDialog(props: {
  id: string
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
  const dialog = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  useDialogReturnFocus(dialog, () => { input.current?.focus(); input.current?.select() })
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !props.busy) { event.preventDefault(); props.onCancel(); return }
    focusableBoundary(dialog.current, event)
  }
  return e('div', { className: 'file-dialog-overlay' },
    e('div', { ref: dialog, className: 'file-dialog prompt-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': `${props.id}-title`, onKeyDown },
      e('header', null,
        e('h2', { id: `${props.id}-title` }, props.title),
        e('button', { className: 'icon-button', type: 'button', 'aria-label': t('common.close'), disabled: props.busy, onClick: props.onCancel }, '×'),
      ),
      e('form', { onSubmit: (event: FormEvent) => { event.preventDefault(); if (value.trim() && !props.busy) props.onConfirm(value.trim()) } },
        e('label', null, props.label, e('input', { ref: input, value, maxLength: 80, disabled: props.busy, onChange: (event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value) })),
        props.note ? e('p', { className: 'warning', role: 'alert' }, props.note) : null,
        e('footer', null,
          e('button', { type: 'button', disabled: props.busy, onClick: props.onCancel }, t('common.cancel')),
          e('button', { className: 'primary-action', type: 'submit', disabled: props.busy || !value.trim() }, props.busy ? t('common.saving') : props.confirmLabel),
        ),
      ),
    ),
  )
}
