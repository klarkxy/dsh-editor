import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from './shared.ts'
import { Spinner } from './spinner.tsx'
import './button.styles.ts'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  iconEnd?: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'>

export const Button = forwardRef<HTMLButtonElement, ButtonProps & { disabled?: boolean }>(
  function Button(props, ref) {
    const { variant = 'primary', size = 'md', loading, icon, iconEnd, className, children, disabled, type, ...rest } = props
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        className={cx('dsh-button', className)}
        data-variant={variant}
        data-size={size}
        disabled={disabled || loading || undefined}
        aria-busy={loading || undefined}
        {...rest}
      >
        {loading ? <Spinner className="dsh-button__spinner" /> : icon ? <span className="dsh-button__icon">{icon}</span> : null}
        {children != null ? <span className="dsh-button__label">{children}</span> : null}
        {iconEnd ? <span className="dsh-button__icon">{iconEnd}</span> : null}
      </button>
    )
  },
)
