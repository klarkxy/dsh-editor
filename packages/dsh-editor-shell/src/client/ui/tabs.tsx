import {
  Root as TabsRoot,
  List as TabsListRoot,
  Trigger as TabsTriggerRoot,
  Content as TabsContentRoot,
} from '@radix-ui/react-tabs'
import type { CSSProperties, ReactNode } from 'react'

export function Tabs(props: {
  value: string
  onValueChange(value: string): void
  children?: ReactNode
  className?: string
  orientation?: 'horizontal' | 'vertical'
}) {
  return (
    <TabsRoot
      value={props.value}
      onValueChange={props.onValueChange}
      className={props.className}
      orientation={props.orientation ?? 'vertical'}
    >
      {props.children}
    </TabsRoot>
  )
}

export function TabsList(props: { children?: ReactNode; className?: string; 'aria-label'?: string }) {
  return (
    <TabsListRoot className={props.className} aria-label={props['aria-label']}>
      {props.children}
    </TabsListRoot>
  )
}

export function TabsTrigger(props: {
  value: string
  children?: ReactNode
  className?: string
  'aria-current'?: boolean | 'page' | 'step' | 'location' | 'date' | 'time' | 'true' | 'false'
}) {
  return (
    <TabsTriggerRoot value={props.value} className={props.className} aria-current={props['aria-current']}>
      {props.children}
    </TabsTriggerRoot>
  )
}

export function TabsContent(props: {
  value: string
  children?: ReactNode
  className?: string
  forceMount?: true
  hidden?: boolean
  style?: CSSProperties
}) {
  return (
    <TabsContentRoot
      value={props.value}
      className={props.className}
      forceMount={props.forceMount}
      hidden={props.hidden}
      aria-hidden={props.hidden || undefined}
      style={props.style}
    >
      {props.children}
    </TabsContentRoot>
  )
}
