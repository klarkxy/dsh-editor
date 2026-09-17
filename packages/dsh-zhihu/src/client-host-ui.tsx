import { type ChangeEvent, type ComponentType, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref } from 'react';

/** Structural host Select — no private package import. */
export type HostSelectProps = {
  value: string
  options: readonly { value: string; label: string }[]
  onChange(value: string): void
  disabled?: boolean
  'aria-label': string
  placeholder?: string
}

/** Structural host Button — no private package import. */
export type HostButtonProps = {
  type?: 'button' | 'submit'
  variant?: 'default' | 'primary' | 'danger' | 'icon'
  className?: string
  disabled?: boolean
  title?: string
  onClick?(event: MouseEvent<HTMLButtonElement>): void
  'aria-label'?: string
  'aria-pressed'?: boolean
  'aria-expanded'?: boolean
  'aria-selected'?: boolean
  'aria-checked'?: boolean
  'data-testid'?: string
  role?: string
  tabIndex?: number
  children?: ReactNode
}

/** Structural host Input — no private package import. */
export type HostInputProps = {
  value: string
  onChange(value: string): void
  disabled?: boolean
  maxLength?: number
  placeholder?: string
  type?: 'text' | 'search' | 'password'
  'aria-label'?: string
  autoFocus?: boolean
  className?: string
  'data-testid'?: string
  onKeyDown?(event: KeyboardEvent<HTMLInputElement>): void
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
}

export type HostSelect = ComponentType<HostSelectProps>
export type HostButton = ComponentType<HostButtonProps>
export type HostDialog = ComponentType<HostDialogProps>
export type HostInput = ComponentType<HostInputProps>

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

export function zhihuQueryKeyDown(
  event: {
    key?: string
    preventDefault(): void
    nativeEvent?: NativeKeyish
  },
  run: { disabled: boolean; search(): void },
): void {
  if (guardImeEnter(event)) return
  if (event.key === 'Enter' && !run.disabled) {
    event.preventDefault()
    run.search()
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

export function hostComponentsFromRenderProps(props: unknown): {
  Select?: HostSelect
  Dialog?: HostDialog
  Button?: HostButton
  Input?: HostInput
} {
  if (!props || typeof props !== 'object') return {}
  const record = props as Record<string, unknown>
  const sources: Record<string, unknown>[] = [record]
  if (record.owner && typeof record.owner === 'object') sources.push(record.owner as Record<string, unknown>)
  let Select: HostSelect | undefined
  let Dialog: HostDialog | undefined
  let Button: HostButton | undefined
  let Input: HostInput | undefined
  for (const source of sources) {
    if (typeof source.Select === 'function') Select = source.Select as HostSelect
    if (typeof source.Dialog === 'function') Dialog = source.Dialog as HostDialog
    if (typeof source.Button === 'function') Button = source.Button as HostButton
    if (typeof source.Input === 'function') Input = source.Input as HostInput
  }
  return { Select, Dialog, Button, Input }
}

export type RenderInputProps = HostInputProps & { ref?: Ref<HTMLInputElement> }

export function renderInput(Input: HostInput | undefined, props: RenderInputProps) {
  if (Input) {
    const Host = Input as ComponentType<RenderInputProps>
    return <Host {...props} />;
  }
  const { onChange, ...rest } = props
  return (
    <input
      {...rest}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} />
  );
}

export function renderSelect(Select: HostSelect | undefined, props: HostSelectProps, className?: string) {
  if (Select) return <Select {...props} />;
  return (
    <select
      className={className}
      value={props.value}
      disabled={props.disabled}
      aria-label={props['aria-label']}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => props.onChange(event.target.value)}>
      {props.options.map((option) => <option key={option.value === '' ? '__empty' : option.value} value={option.value}>
        {option.label}
      </option>)}
    </select>
  );
}
