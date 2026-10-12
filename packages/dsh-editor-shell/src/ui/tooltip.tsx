import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { useDshPortalContainer } from './shared.ts'
import './tooltip.styles.ts'

export const TooltipProvider = TooltipPrimitive.Provider

/** 12px 提示内容；默认挂到 UiRoot 的 portal 容器。 */
export function Tooltip(props: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  disabled?: boolean
}) {
  const container = useDshPortalContainer()
  if (props.disabled) return <>{props.children}</>
  const content = (
    <TooltipPrimitive.Content className="dsh-tooltip" side={props.side ?? 'top'} sideOffset={4} collisionPadding={8}>
      {props.content}
    </TooltipPrimitive.Content>
  )
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{props.children}</TooltipPrimitive.Trigger>
      {container ? <TooltipPrimitive.Portal container={container}>{content}</TooltipPrimitive.Portal> : content}
    </TooltipPrimitive.Root>
  )
}
