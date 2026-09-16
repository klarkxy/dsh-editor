import { forwardRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { isImeEvent } from './ime.ts'

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'icon'

export const Button = forwardRef<HTMLButtonElement, {
  type?: 'button' | 'submit'
  variant?: ButtonVariant
  className?: string
  disabled?: boolean
  title?: string
  onClick?(event: MouseEvent<HTMLButtonElement>): void
  'aria-label'?: string
  'aria-pressed'?: boolean
  'aria-expanded'?: boolean
  'aria-selected'?: boolean
  'aria-current'?: boolean | 'true' | 'false' | 'page' | 'step' | 'location' | 'date' | 'time'
  'aria-controls'?: string
  'aria-describedby'?: string
  role?: string
  tabIndex?: number
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
      title={props.title}
      aria-label={props['aria-label']}
      aria-pressed={props['aria-pressed']}
      aria-expanded={props['aria-expanded']}
      aria-selected={props['aria-selected']}
      aria-current={props['aria-current']}
      aria-controls={props['aria-controls']}
      aria-describedby={props['aria-describedby']}
      role={props.role}
      tabIndex={props.tabIndex}
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
