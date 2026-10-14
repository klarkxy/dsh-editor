import type { ReactElement, ReactNode } from 'react'
import {
  Tooltip as InternalTooltip,
  TooltipProvider as InternalTooltipProvider,
} from '../../ui/tooltip.tsx'

/*
 * 旧壳层提示包装（client/ui 契约）：内部走 src/ui/ 的 dsh-tooltip。
 * Provider 默认 delayDuration 400 / skipDelay 200 保持不变。
 */

export function TooltipProvider(props: {
  children?: ReactNode
  delayDuration?: number
  skipDelayDuration?: number
}) {
  return (
    <InternalTooltipProvider delayDuration={props.delayDuration ?? 400} skipDelayDuration={props.skipDelayDuration ?? 200}>
      {props.children}
    </InternalTooltipProvider>
  )
}

export function Tooltip(props: {
  content: string
  children?: ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <InternalTooltip content={props.content} side={props.side ?? 'bottom'}>
      {props.children ?? <span />}
    </InternalTooltip>
  )
}
