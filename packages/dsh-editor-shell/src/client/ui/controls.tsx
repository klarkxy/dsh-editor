import { forwardRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { isImeEvent } from './ime.ts'
import { Button as InternalButton, IconButton as InternalIconButton, Input as InternalInput, TextArea as InternalTextArea } from '../../ui/index.ts'

import type { ButtonVariant } from '../../model/controls.ts'

/*
 * C04：宿主控件改在内部原语（src/ui/）上实现，props 契约不变。
 * 变体映射：default/未给 → secondary，primary → primary，danger → danger，
 * icon → IconButton（ghost）。旧的 ui-button / primary-action / danger-action /
 * icon-button 类名保留，面板与 e2e 选择器仍能命中。
 */
const INTERNAL_VARIANT = {
  default: 'secondary',
  primary: 'primary',
  danger: 'danger',
} as const

export const Button = forwardRef<HTMLButtonElement, {
  type?: 'button' | 'submit'
  variant?: ButtonVariant
  className?: string
  disabled?: boolean
  title?: string
  onClick?(event: MouseEvent<HTMLButtonElement>): void
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-pressed'?: boolean
  'aria-expanded'?: boolean
  'aria-selected'?: boolean
  'aria-checked'?: boolean
  'aria-current'?: boolean | 'true' | 'false' | 'page' | 'step' | 'location' | 'date' | 'time'
  'aria-controls'?: string
  'aria-describedby'?: string
  'data-testid'?: string
  role?: string
  tabIndex?: number
  children?: ReactNode
}>(function Button(props, ref) {
  const variant = props.variant ?? 'default'
  const variantClass = variant === 'primary'
    ? 'primary-action'
    : variant === 'danger'
      ? 'danger-action'
      : variant === 'icon'
        ? 'icon-button'
        : ''
  const className = ['ui-button', variantClass, props.className].filter(Boolean).join(' ')
  const shared = {
    ref,
    type: props.type ?? 'button',
    className,
    disabled: props.disabled,
    title: props.title,
    'aria-labelledby': props['aria-labelledby'],
    'aria-pressed': props['aria-pressed'],
    'aria-expanded': props['aria-expanded'],
    'aria-selected': props['aria-selected'],
    'aria-checked': props['aria-checked'],
    'aria-current': props['aria-current'],
    'aria-controls': props['aria-controls'],
    'aria-describedby': props['aria-describedby'],
    'data-testid': props['data-testid'],
    role: props.role,
    tabIndex: props.tabIndex,
    onClick: props.onClick,
  }
  if (variant === 'icon') {
    /* icon 变体沿用原 ghost IconButton 语义；label 同时是 aria-label 与 tooltip。 */
    return <InternalIconButton {...shared} size="sm" label={props['aria-label'] ?? props.title ?? ''}>{props.children}</InternalIconButton>
  }
  return <InternalButton {...shared} aria-label={props['aria-label']} size="sm" variant={INTERNAL_VARIANT[variant]}>{props.children}</InternalButton>
})

export const Input = forwardRef<HTMLInputElement, {
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
}>(function Input(props, ref) {
  return (
    <InternalInput
      ref={ref}
      size="sm"
      type={props.type ?? 'text'}
      className={['ui-input', props.className].filter(Boolean).join(' ')}
      value={props.value}
      maxLength={props.maxLength}
      placeholder={props.placeholder}
      aria-label={props['aria-label']}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
      data-testid={props['data-testid']}
      onChange={props.onChange}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && isImeEvent({ isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) {
          event.preventDefault()
          return
        }
        props.onKeyDown?.(event)
      }}
    />
  )
})

export const TextArea = forwardRef<HTMLTextAreaElement, {
  value: string
  onChange(value: string): void
  disabled?: boolean
  maxLength?: number
  placeholder?: string
  rows?: number
  'aria-label'?: string
  autoFocus?: boolean
  className?: string
  'data-testid'?: string
  onKeyDown?(event: KeyboardEvent<HTMLTextAreaElement>): void
}>(function TextArea(props, ref) {
  return (
    <InternalTextArea
      ref={ref}
      className={['ui-textarea', props.className].filter(Boolean).join(' ')}
      value={props.value}
      maxLength={props.maxLength}
      placeholder={props.placeholder}
      /* rows 给定即固定高度；未给时沿用默认 3 行起、到 8 行自动增高。 */
      minRows={props.rows ?? 3}
      maxRows={props.rows ?? 8}
      aria-label={props['aria-label']}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
      data-testid={props['data-testid']}
      onChange={props.onChange}
      onKeyDown={props.onKeyDown}
    />
  )
})
