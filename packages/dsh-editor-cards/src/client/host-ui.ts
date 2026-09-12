import { createElement as e, type ChangeEvent, type ComponentType } from 'react'
import type { ShellSelectProps } from 'dsh-editor-seats'

/** IME composition keyCode used by Chromium/WebKit while composing. */
export const IME_KEYCODE = 229

export type NativeKeyish = { isComposing?: boolean; keyCode?: number }

export function nativeKeyFlags(event: { nativeEvent?: NativeKeyish }): { isComposing: boolean; keyCode: number } {
  const native = event.nativeEvent
  return {
    isComposing: Boolean(native?.isComposing),
    keyCode: typeof native?.keyCode === 'number' ? native.keyCode : 0,
  }
}

export function guardImeEnter(event: {
  key?: string
  preventDefault(): void
  nativeEvent?: NativeKeyish
}): boolean {
  const { isComposing, keyCode } = nativeKeyFlags(event)
  const enter = event.key === 'Enter' || keyCode === 13
  const ime = (isComposing && enter) || keyCode === IME_KEYCODE
  if (!ime) return false
  if (enter) event.preventDefault()
  return true
}

/** Host Select when the seat provides one; otherwise a native control. Not a layer registry. */
export function renderSelect(
  Select: ComponentType<ShellSelectProps> | undefined,
  props: ShellSelectProps,
) {
  if (Select) return e(Select, props)
  return e('select', {
    value: props.value,
    disabled: props.disabled,
    'aria-label': props['aria-label'],
    onChange: (event: ChangeEvent<HTMLSelectElement>) => props.onChange(event.target.value),
  }, props.placeholder && !props.value
    ? e('option', { value: '', disabled: true }, props.placeholder)
    : null,
  ...props.options.map((option) => e('option', {
    key: option.value === '' ? '__empty' : option.value,
    value: option.value,
  }, option.label)))
}
