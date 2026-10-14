import { Slot } from '@radix-ui/react-slot'
import {
  forwardRef,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { cx } from './shared.ts'
import './card.styles.ts'

/*
 * 卡片原语（原稿 §4）：平面卡片 = raised 表面 + 0.5px 描边 + radius-md，
 * 无阴影。size 沿用 Radix 档位：1→space-3、2→space-4、3→space-6 内边距。
 * 语义化 className（如 .settings-block）仍可覆写内边距与配色。
 */

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  as?: keyof JSX.IntrinsicElements
  asChild?: boolean
  size?: '1' | '2' | '3'
  variant?: 'surface' | 'classic' | 'ghost'
  style?: CSSProperties
  children?: ReactNode
}

export const Card = forwardRef<HTMLElement, CardProps>(function Card(props, ref) {
  const { as, asChild, size, variant: _variant, className, ...rest } = props
  const Tag = (asChild ? Slot : (as ?? 'div')) as ElementType
  return (
    <Tag
      ref={ref as never}
      {...rest}
      className={cx('dsh-card', className)}
      data-size={size ?? '2'}
    />
  )
})
