import type { MouseEvent, ReactNode } from 'react'
import type { ShellButtonProps, ShellToolSeatContext } from './index.ts'

/*
 * 座位按钮：优先使用宿主（shell）提供的 Button，独立运行（无 shell）时
 * 降级为带相同变体类的原生 <button>。变体类名与 shell 的 ui/controls
 * 保持一致，插件样式只按类名命中，两种路径观感一致。
 */
export function SeatButton(props: {
  host?: ShellToolSeatContext['Button']
  variant?: ShellButtonProps['variant']
  type?: 'button' | 'submit'
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
}) {
  const { host: Host, variant, className, ...rest } = props
  if (Host) return <Host variant={variant} className={className} {...rest} />
  const variantClass = variant === 'primary'
    ? 'primary-action'
    : variant === 'danger'
      ? 'danger-action'
      : variant === 'icon'
        ? 'icon-button'
        : ''
  return (
    <button
      type="button"
      className={[variantClass, className].filter(Boolean).join(' ')}
      {...rest}
    />
  )
}
