import {
  Provider as TooltipProviderRoot,
  Root as TooltipRoot,
  Trigger as TooltipTrigger,
  Portal as TooltipPortal,
  Content as TooltipContent,
} from '@radix-ui/react-tooltip'
import type { ReactElement, ReactNode } from 'react'

export function TooltipProvider(props: {
  children?: ReactNode
  delayDuration?: number
  skipDelayDuration?: number
}) {
  return (
    <TooltipProviderRoot delayDuration={props.delayDuration ?? 400} skipDelayDuration={props.skipDelayDuration ?? 200}>
      {props.children}
    </TooltipProviderRoot>
  )
}

export function Tooltip(props: {
  content: string
  children?: ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <TooltipRoot>
      <TooltipTrigger asChild>{props.children ?? <span />}</TooltipTrigger>
      <TooltipPortal>
        <TooltipContent className="dsh-ui tooltip-content" side={props.side ?? 'bottom'} sideOffset={6}>
          {props.content}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  )
}
