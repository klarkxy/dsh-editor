import { Slot } from '@radix-ui/react-slot'
import {
  createElement,
  forwardRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { cx } from './shared.ts'
import './typography.styles.ts'

/*
 * 文本原语（原稿 §3）：替代旧 Radix Themes 的 Text/Heading。
 * size 沿用 Radix 数字档位 → --dsh-ui-text-*；color 归语义 tone
 * （gray→muted、red→danger、indigo/blue/violet→accent、green→success、
 * amber→warning）；weight regular/medium/bold → 字体字重 token。
 */

export type TextTone = 'muted' | 'danger' | 'accent' | 'success' | 'warning' | 'link' | 'faint'

const TONE_BY_COLOR: Record<string, TextTone> = {
  gray: 'muted',
  red: 'danger',
  indigo: 'accent',
  blue: 'accent',
  violet: 'accent',
  iris: 'accent',
  green: 'success',
  teal: 'success',
  amber: 'warning',
  orange: 'warning',
  crimson: 'danger',
}

const SIZE_TOKEN = ['xs', 'base', 'md', 'lg', 'xl', '2xl'] as const

export type TextSize = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | `${number}`

function sizeAttr(size: string | number | undefined): string | undefined {
  if (size === undefined) return undefined
  const n = Number(size)
  if (!Number.isFinite(n)) return undefined
  if (n <= 1) return 'xs'
  if (n === 2) return 'base'
  if (n === 3) return 'md'
  if (n === 4) return 'lg'
  if (n === 5) return 'xl'
  return '2xl'
}

export type TextSpacing = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'

type TypoBase = {
  as?: keyof JSX.IntrinsicElements
  asChild?: boolean
  size?: TextSize
  color?: string
  weight?: 'light' | 'regular' | 'normal' | 'medium' | 'bold'
  align?: 'left' | 'center' | 'right'
  truncate?: boolean
  wrap?: 'balance' | 'pretty' | 'nowrap' | 'wrap'
  highContrast?: boolean
  m?: TextSpacing
  mt?: TextSpacing
  mb?: TextSpacing
  mx?: TextSpacing
  my?: TextSpacing
  ml?: TextSpacing
  mr?: TextSpacing
  style?: CSSProperties
  className?: string
  children?: ReactNode
  /* as="label" 时透传 htmlFor（HTMLAttributes<HTMLElement> 不含该属性）。 */
  htmlFor?: string
}

function typoAttrs(props: TypoBase) {
  const tone = props.color ? (TONE_BY_COLOR[props.color] ?? props.color) : undefined
  return {
    'data-size': sizeAttr(props.size),
    'data-tone': tone,
    'data-weight': props.weight === 'normal' ? 'regular' : props.weight,
    'data-align': props.align,
    'data-truncate': props.truncate ? '' : undefined,
    'data-wrap': props.wrap,
    'data-m': props.m,
    'data-mt': props.mt,
    'data-mb': props.mb,
    'data-mx': props.mx,
    'data-my': props.my,
    'data-ml': props.ml,
    'data-mr': props.mr,
  }
}

function splitTypoProps(props: TypoBase) {
  const {
    as: _as, asChild: _asChild, size: _size, color: _color, weight: _weight,
    align: _align, truncate: _truncate, wrap: _wrap, highContrast: _high,
    m: _m, mt: _mt, mb: _mb, mx: _mx, my: _my, ml: _ml, mr: _mr,
    ...rest
  } = props
  return rest
}

export const Text = forwardRef<HTMLElement, TypoBase & HTMLAttributes<HTMLElement>>(
  function Text(props, ref) {
    const rest = splitTypoProps(props)
    const Tag = (props.as ?? 'span') as 'span'
    return props.asChild
      ? <Slot ref={ref as never} {...rest} className={cx('dsh-text', props.className)} {...typoAttrs(props)} />
      : createElement(Tag, { ref, ...rest, className: cx('dsh-text', props.className), ...typoAttrs(props) }, props.children)
  },
)

export type HeadingProps = TypoBase & HTMLAttributes<HTMLElement> & {
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
}

export const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(function Heading(props, ref) {
  const rest = splitTypoProps(props)
  const Tag = props.as ?? 'h2'
  return props.asChild
    ? <Slot ref={ref as never} {...rest} className={cx('dsh-heading', props.className)} {...typoAttrs(props)} />
    : createElement(Tag, { ref, ...rest, className: cx('dsh-heading', props.className), ...typoAttrs(props) }, props.children)
})
