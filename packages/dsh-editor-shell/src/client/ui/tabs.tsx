import { Tabs as ThemesTabs } from '@radix-ui/themes'
import type { CSSProperties, ReactNode } from 'react'

export function Tabs(props: {
  value: string
  onValueChange(value: string): void
  children?: ReactNode
  className?: string
  orientation?: 'horizontal' | 'vertical'
}) {
  return (
    <ThemesTabs.Root
      value={props.value}
      onValueChange={props.onValueChange}
      className={props.className}
      orientation={props.orientation ?? 'vertical'}
    >
      {props.children}
    </ThemesTabs.Root>
  )
}

export function TabsList(props: { children?: ReactNode; className?: string; 'aria-label'?: string }) {
  return (
    <ThemesTabs.List className={props.className} aria-label={props['aria-label']}>
      {props.children}
    </ThemesTabs.List>
  )
}

export function TabsTrigger(props: {
  value: string
  children?: ReactNode
  className?: string
  'aria-current'?: boolean | 'page' | 'step' | 'location' | 'date' | 'time' | 'true' | 'false'
}) {
  return (
    <ThemesTabs.Trigger value={props.value} className={props.className} aria-current={props['aria-current']}>
      {props.children}
    </ThemesTabs.Trigger>
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
    <ThemesTabs.Content
      value={props.value}
      className={props.className}
      forceMount={props.forceMount}
      hidden={props.hidden}
      aria-hidden={props.hidden || undefined}
      style={props.style}
    >
      {props.children}
    </ThemesTabs.Content>
  )
}
