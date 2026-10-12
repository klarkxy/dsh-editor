import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cx } from './shared.ts'
import './input.styles.ts'

export type InputProps = {
  size?: 'sm' | 'md'
  invalid?: boolean
  leading?: ReactNode
  trailing?: ReactNode
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'onChange' | 'value'> & {
  value?: string
  onChange?(value: string): void
}

/** 组字事件（onCompositionStart/End 等）随其余 props 原样透传。 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(props, ref) {
  const { size = 'md', invalid, leading, trailing, className, onChange, ...rest } = props
  const input = (
    <input
      ref={ref}
      className="dsh-input__control"
      data-invalid={invalid || undefined}
      aria-invalid={invalid || undefined}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      {...rest}
    />
  )
  if (!leading && !trailing) {
    return (
      <span className={cx('dsh-input', className)} data-size={size} data-invalid={invalid || undefined}>
        {input}
      </span>
    )
  }
  return (
    <span className={cx('dsh-input', className)} data-size={size} data-invalid={invalid || undefined}>
      {leading ? <span className="dsh-input__adorn">{leading}</span> : null}
      {input}
      {trailing ? <span className="dsh-input__adorn">{trailing}</span> : null}
    </span>
  )
})
