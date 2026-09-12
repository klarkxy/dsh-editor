import type { ComponentType, ReactNode } from 'react'

/** Structural host Select — no private package import. */
export type HostSelectProps = {
  value: string
  options: readonly { value: string; label: string }[]
  onChange(value: string): void
  disabled?: boolean
  'aria-label': string
  placeholder?: string
}

/** Structural host Dialog — no private package import. */
export type HostDialogProps = {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  description?: string
  children?: ReactNode
  className?: string
  overlayClassName?: string
  dismissible?: boolean
  initialFocusRef?: { current: HTMLElement | null }
  onCloseAutoFocus?(event: Event): void
}

export type HostSelect = ComponentType<HostSelectProps>
export type HostDialog = ComponentType<HostDialogProps>

export const IME_KEYCODE = 229

export type NativeKeyish = { isComposing?: boolean; keyCode?: number }

/** React KeyboardEvent: isComposing/keyCode live on nativeEvent, not the synthetic event. */
export function nativeKeyFlags(event: { nativeEvent?: NativeKeyish }): { isComposing: boolean; keyCode: number } {
  const native = event.nativeEvent
  return {
    isComposing: Boolean(native?.isComposing),
    keyCode: typeof native?.keyCode === 'number' ? native.keyCode : 0,
  }
}

/**
 * IME Enter must not submit. Composing+Enter/keyCode 13 and keyCode 229 are
 * independent. preventDefault only for Enter-like keys so composition continues.
 */
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

export function proofreadInputKeyDown(
  event: {
    key?: string
    ctrlKey?: boolean
    metaKey?: boolean
    preventDefault(): void
    nativeEvent?: NativeKeyish
  },
  run: { disabled: boolean; runCheck(): void },
): void {
  if (guardImeEnter(event)) return
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !run.disabled) {
    event.preventDefault()
    run.runCheck()
  }
}

export function dockEscapeKeyDown(
  event: { key?: string; stopPropagation(): void },
  run: { loading: boolean; close(): void },
): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  if (run.loading) return
  run.close()
}

export function hostComponentsFromRenderProps(props: unknown): { Select?: HostSelect; Dialog?: HostDialog } {
  if (!props || typeof props !== 'object') return {}
  const record = props as Record<string, unknown>
  const sources: Record<string, unknown>[] = [record]
  if (record.owner && typeof record.owner === 'object') sources.push(record.owner as Record<string, unknown>)
  let Select: HostSelect | undefined
  let Dialog: HostDialog | undefined
  for (const source of sources) {
    if (typeof source.Select === 'function') Select = source.Select as HostSelect
    if (typeof source.Dialog === 'function') Dialog = source.Dialog as HostDialog
  }
  return { Select, Dialog }
}
