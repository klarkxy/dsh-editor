import { Slot } from '@radix-ui/react-slot'
import {
  forwardRef,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { cx } from './shared.ts'
import './layout.styles.ts'

/*
 * 布局原语（原稿 §4）：替代旧 Radix Themes 的 Flex/Box。排版语义照旧由
 * 调用方的语义化 className 承担，这里只映射 direction/gap/对齐/间距档位。
 * 间距档位沿用 Radix 数字刻度 → --dsh-ui-space-*（5→space-6，6→space-8）。
 */

export type SpaceScale = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'

export type LayoutProps = HTMLAttributes<HTMLDivElement> & {
  asChild?: boolean
  direction?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  align?: 'start' | 'center' | 'end' | 'baseline' | 'stretch'
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'
  wrap?: 'nowrap' | 'wrap' | 'wrap-reverse'
  gap?: SpaceScale | `${number}` | (string & {})
  m?: SpaceScale
  mt?: SpaceScale
  mb?: SpaceScale
  mx?: SpaceScale
  my?: SpaceScale
  ml?: SpaceScale
  mr?: SpaceScale
  p?: SpaceScale
  px?: SpaceScale
  py?: SpaceScale
  pt?: SpaceScale
  pb?: SpaceScale
  minWidth?: '0' | (string & {})
  minHeight?: '0' | (string & {})
  flexGrow?: '0' | '1' | (string & {})
  flexShrink?: '0' | '1' | (string & {})
  height?: '100%' | (string & {})
  width?: '100%' | (string & {})
  overflow?: 'hidden' | 'auto' | 'scroll' | 'visible'
  style?: CSSProperties
  children?: ReactNode
}

function layoutDataAttrs(props: LayoutProps) {
  return {
    'data-direction': props.direction,
    'data-align': props.align,
    'data-justify': props.justify,
    'data-wrap': props.wrap,
    'data-gap': props.gap,
    'data-m': props.m,
    'data-mt': props.mt,
    'data-mb': props.mb,
    'data-mx': props.mx,
    'data-my': props.my,
    'data-ml': props.ml,
    'data-mr': props.mr,
    'data-p': props.p,
    'data-px': props.px,
    'data-py': props.py,
    'data-pt': props.pt,
    'data-pb': props.pb,
    'data-min-width': props.minWidth,
    'data-min-height': props.minHeight,
    'data-flex-grow': props.flexGrow,
    'data-flex-shrink': props.flexShrink,
    'data-w': props.width,
    'data-h': props.height,
    'data-overflow': props.overflow,
  }
}

function splitLayoutProps(props: LayoutProps) {
  const {
    asChild, direction, align, justify, wrap, gap,
    m, mt, mb, mx, my, ml, mr, p, px, py, pt, pb,
    minWidth, minHeight, flexGrow, flexShrink, height, width,
    overflow,
    ...rest
  } = props
  return rest
}

export const Flex = forwardRef<HTMLDivElement, LayoutProps>(function Flex(props, ref) {
  const rest = splitLayoutProps(props)
  const Tag = props.asChild ? Slot : 'div'
  return (
    <Tag
      ref={ref}
      {...rest}
      className={cx('dsh-flex', props.className)}
      {...layoutDataAttrs(props)}
    />
  )
})

export type BoxProps = LayoutProps & {
  /** 元素标签；默认 div。 */
  as?: keyof JSX.IntrinsicElements
}

export const Box = forwardRef<HTMLElement, BoxProps>(function Box(props, ref) {
  const { as, asChild, ...rest } = props
  const Tag = (asChild ? Slot : (as ?? 'div')) as ElementType
  return (
    <Tag
      ref={ref as never}
      {...splitLayoutProps(rest as LayoutProps)}
      className={cx('dsh-box', props.className)}
      {...layoutDataAttrs(rest as LayoutProps)}
    />
  )
})

/** 分割线：0.5px 规则，orientation 决定横向/纵向。 */
export function Separator(props: {
  orientation?: 'horizontal' | 'vertical'
  /** Radix size 刻度：1..4 → 25/50/75/100% 长度。 */
  size?: '1' | '2' | '3' | '4'
  className?: string
  style?: CSSProperties
  decorative?: boolean
}) {
  return (
    <div
      role="separator"
      aria-orientation={props.orientation === 'vertical' ? 'vertical' : 'horizontal'}
      className={cx('dsh-separator', props.className)}
      data-orientation={props.orientation === 'vertical' ? 'vertical' : 'horizontal'}
      data-size={props.size}
      style={props.style}
    />
  )
}
