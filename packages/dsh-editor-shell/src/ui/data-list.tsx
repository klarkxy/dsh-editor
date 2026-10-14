import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { cx } from './shared.ts'
import './data-list.styles.ts'

/*
 * 键值列表（原稿）：语义化 dl/dt/dd —— 替代 Radix DataList。
 * Item 允许 align 覆盖行内对齐；Label 为 dt、Value 为 dd。
 */
export type DataListAlign = 'start' | 'center' | 'baseline' | 'stretch' | 'end'

export const DataListRoot = forwardRef<HTMLDListElement, HTMLAttributes<HTMLDListElement> & {
  size?: '1' | '2' | '3'
}>(function DataListRoot(props, ref) {
  const { size, className, ...rest } = props
  return <dl ref={ref} {...rest} className={cx('dsh-data-list', className)} data-size={size ?? '2'} />
})

export const DataListItem = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
  align?: DataListAlign
}>(function DataListItem(props, ref) {
  const { align, className, ...rest } = props
  return <div ref={ref} {...rest} className={cx('dsh-data-list__item', className)} data-align={align} />
})

export const DataListLabel = forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & {
  children?: ReactNode
}>(function DataListLabel(props, ref) {
  const { className, ...rest } = props
  return <dt ref={ref as never} {...rest} className={cx('dsh-data-list__label', className)} />
})

export const DataListValue = forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & {
  children?: ReactNode
}>(function DataListValue(props, ref) {
  const { className, ...rest } = props
  return <dd ref={ref as never} {...rest} className={cx('dsh-data-list__value', className)} />
})

export const DataList = {
  Root: DataListRoot,
  Item: DataListItem,
  Label: DataListLabel,
  Value: DataListValue,
}
