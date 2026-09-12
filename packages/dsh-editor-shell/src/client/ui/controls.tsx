import { forwardRef, type KeyboardEvent, type ReactNode } from 'react'
import { isImeEvent } from './ime.ts'

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'icon'

export const Button = forwardRef<HTMLButtonElement, {
  type?: 'button' | 'submit'
  variant?: ButtonVariant
  className?: string
  disabled?: boolean
  onClick?(): void
  'aria-label'?: string
  children?: ReactNode
}>(function Button(props, ref) {
  const variantClass = props.variant === 'primary'
    ? 'primary-action'
    : props.variant === 'danger'
      ? 'danger-action'
      : props.variant === 'icon'
        ? 'icon-button'
        : ''
  const className = ['ui-button', variantClass, props.className].filter(Boolean).join(' ')
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      className={className}
      disabled={props.disabled}
      aria-label={props['aria-label']}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
})

export const Input = forwardRef<HTMLInputElement, {
  value: string
  onChange(value: string): void
  disabled?: boolean
  maxLength?: number
  placeholder?: string
  'aria-label'?: string
  autoFocus?: boolean
  className?: string
  onKeyDown?(event: KeyboardEvent<HTMLInputElement>): void
}>(function Input(props, ref) {
  return (
    <input
      ref={ref}
      className={['ui-input', props.className].filter(Boolean).join(' ')}
      value={props.value}
      maxLength={props.maxLength}
      placeholder={props.placeholder}
      aria-label={props['aria-label']}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
      onChange={(event) => props.onChange(event.target.value)}
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
