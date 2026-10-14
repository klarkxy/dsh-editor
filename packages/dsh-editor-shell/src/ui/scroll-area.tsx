import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode, type UIEvent } from 'react'
import { cx } from './shared.ts'
import './scroll-area.styles.ts'

/*
 * 滚动容器（原稿）：替代 Radix Themes ScrollArea —— 一个 overflow:auto 的
 * div，滚动条样式沿用全局 ::-webkit-scrollbar 规则。scrollbars 只决定方向。
 */

export const ScrollArea = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
  scrollbars?: 'vertical' | 'horizontal' | 'both'
  size?: string
  type?: string
  children?: ReactNode
  onScroll?(event: UIEvent<HTMLDivElement>): void
  style?: CSSProperties
}>(function ScrollArea(props, ref) {
  const { scrollbars, size: _size, type: _type, className, ...rest } = props
  return (
    <div
      ref={ref}
      {...rest}
      className={cx('dsh-scroll-area', className)}
      data-scrollbars={scrollbars ?? 'both'}
    />
  )
})
