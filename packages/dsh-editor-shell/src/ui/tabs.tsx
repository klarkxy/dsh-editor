import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'
import { cx } from './shared.ts'
import './tabs.styles.ts'

/** 文字页签；当前页签 2px accent 下划线；高 36px。 */
export function Tabs(props: {
  value?: string
  defaultValue?: string
  onValueChange?(value: string): void
  children?: ReactNode
  className?: string
  orientation?: 'horizontal' | 'vertical'
}) {
  return (
    <TabsPrimitive.Root
      className={cx('dsh-tabs', props.className)}
      value={props.value}
      defaultValue={props.defaultValue}
      onValueChange={props.onValueChange}
      orientation={props.orientation}
    >
      {props.children}
    </TabsPrimitive.Root>
  )
}

export function TabList(props: { children?: ReactNode; 'aria-label'?: string; className?: string }) {
  return <TabsPrimitive.List className={cx('dsh-tabs__list', props.className)} aria-label={props['aria-label']}>{props.children}</TabsPrimitive.List>
}

export function Tab(props: {
  value: string
  children?: ReactNode
  disabled?: boolean
  className?: string
  'aria-current'?: boolean | 'page' | 'step' | 'location' | 'date' | 'time' | 'true' | 'false'
}) {
  return (
    <TabsPrimitive.Trigger
      className={cx('dsh-tabs__tab', props.className)}
      value={props.value}
      disabled={props.disabled}
      aria-current={props['aria-current']}
    >
      {props.children}
    </TabsPrimitive.Trigger>
  )
}

export function TabPanel(props: { value: string; children?: ReactNode; className?: string; forceMount?: true }) {
  return <TabsPrimitive.Content className={cx('dsh-tabs__panel', props.className)} value={props.value} forceMount={props.forceMount}>{props.children}</TabsPrimitive.Content>
}
