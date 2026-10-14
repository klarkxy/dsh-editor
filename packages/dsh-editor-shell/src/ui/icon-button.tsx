import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from './shared.ts'
import { Tooltip } from './tooltip.tsx'
import './icon-button.styles.ts'

export type IconButtonProps = {
  /** 必填：同时作为 aria-label 和默认提示文案。 */
  label: string
  /** 覆盖提示文案；aria-label 仍用 label。 */
  tooltip?: ReactNode
  variant?: 'ghost' | 'secondary' | 'primary'
  size?: 'sm' | 'md'
  /** 映射 aria-pressed；按下态文字用 accent。 */
  pressed?: boolean
  children?: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'disabled'>

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps & { disabled?: boolean }>(
  function IconButton(props, ref) {
    const { label, tooltip, variant = 'ghost', size = 'md', pressed, className, children, disabled, type, ...rest } = props
    const button = (
      <button
        ref={ref}
        type={type ?? 'button'}
        className={cx('dsh-icon-button', className)}
        data-variant={variant}
        data-size={size}
        aria-label={label}
        aria-pressed={pressed || undefined}
        disabled={disabled || undefined}
        {...rest}
      >
        {children}
      </button>
    )
    return <Tooltip content={tooltip ?? label}>{button}</Tooltip>
  },
)
