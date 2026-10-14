import type { ReactNode } from 'react'
import {
  Tabs as InternalTabs,
  TabList as InternalTabList,
  Tab as InternalTab,
  TabPanel as InternalTabPanel,
} from '../../ui/tabs.tsx'

/*
 * 旧壳层页签包装（client/ui 契约）：名字沿用 Themes 风格（TabsList /
 * TabsTrigger / TabsContent），内部走 src/ui/ 的 dsh-tabs 原语。
 */

export function Tabs(props: {
  value: string
  onValueChange(value: string): void
  children?: ReactNode
  className?: string
  orientation?: 'horizontal' | 'vertical'
}) {
  return (
    <InternalTabs
      value={props.value}
      onValueChange={props.onValueChange}
      className={props.className}
      orientation={props.orientation ?? 'vertical'}
    >
      {props.children}
    </InternalTabs>
  )
}

export function TabsList(props: { children?: ReactNode; className?: string; 'aria-label'?: string }) {
  return <InternalTabList className={props.className} aria-label={props['aria-label']}>{props.children}</InternalTabList>
}

export function TabsTrigger(props: {
  value: string
  children?: ReactNode
  className?: string
  'aria-current'?: boolean | 'page' | 'step' | 'location' | 'date' | 'time' | 'true' | 'false'
}) {
  return (
    <InternalTab value={props.value} className={props.className} aria-current={props['aria-current']}>
      {props.children}
    </InternalTab>
  )
}

export function TabsContent(props: { value: string; children?: ReactNode; className?: string }) {
  return <InternalTabPanel value={props.value} className={props.className}>{props.children}</InternalTabPanel>
}
