import { Provider as TooltipProviderRoot } from '@radix-ui/react-tooltip'
import { Tooltip as ThemesTooltip } from '@radix-ui/themes'
import type { ReactElement, ReactNode } from 'react'

/*
 * Themes Tooltip does not render its own Provider (it only wraps Root/Trigger/
 * Content). Keep a real Provider so delayDuration still applies; radix-ui's
 * Tooltip and @radix-ui/react-tooltip@1.2.16 share this context.
 */
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
    <ThemesTooltip
      content={props.content}
      side={props.side ?? 'bottom'}
      sideOffset={6}
      className="tooltip-content"
    >
      {props.children ?? <span />}
    </ThemesTooltip>
  )
}
