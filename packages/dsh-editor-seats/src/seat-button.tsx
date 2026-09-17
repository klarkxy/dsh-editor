import { forwardRef, type ComponentType, type MouseEvent, type ReactNode, type Ref } from 'react'
import type { ShellButtonProps, ShellToolSeatContext } from './index.ts'

/*
 * 座位按钮：优先使用宿主（shell）提供的 Button，独立运行（无 shell）时
 * 降级为带相同变体类的原生 <button>。变体类名与 shell 的 ui/controls
 * 保持一致，插件样式只按类名命中，两种路径观感一致。
 */
export const SeatButton = forwardRef<HTMLButtonElement, {
  host?: ShellToolSeatContext['Button']
  variant?: ShellButtonProps['variant']
  type?: 'button' | 'submit'
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
  'aria-current'?: ShellButtonProps['aria-current']
  'aria-controls'?: string
  'aria-describedby'?: string
  'data-testid'?: string
  role?: string
  tabIndex?: number
  children?: ReactNode
}>(function SeatButton(props, ref) {
  const { host, variant, className, ...rest } = props
  if (host) {
    /* 合同类型是 ComponentType；宿主实现（shell 的 ui Button）是 forwardRef，
       结构类型的宿主若不接受 ref 只是被 React 忽略，不影响行为。 */
    const Host = host as ComponentType<ShellButtonProps & { ref?: Ref<HTMLButtonElement> }>
    return <Host ref={ref} variant={variant} className={className} {...rest} />
  }
  const variantClass = variant === 'primary'
    ? 'primary-action'
    : variant === 'danger'
      ? 'danger-action'
      : variant === 'icon'
        ? 'icon-button'
        : ''
  return (
    <button
      ref={ref}
      type="button"
      className={[variantClass, className].filter(Boolean).join(' ')}
      {...rest}
    />
  )
})
