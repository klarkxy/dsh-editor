import * as PopoverPrimitive from '@radix-ui/react-popover'
import type { ReactNode } from 'react'
import { useDshPortalContainer } from './shared.ts'
import './popover.styles.ts'

export function Popover(props: {
  trigger: ReactNode
  content: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  'aria-label'?: string
  open?: boolean
  onOpenChange?(open: boolean): void
}) {
  const container = useDshPortalContainer()
  return (
    <PopoverPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{props.trigger}</PopoverPrimitive.Trigger>
      {(() => {
        const content = (
          <PopoverPrimitive.Content
            className="dsh-popover"
            side={props.side ?? 'bottom'}
            align={props.align ?? 'start'}
            sideOffset={4}
            collisionPadding={8}
            aria-label={props['aria-label']}
          >
            {props.content}
          </PopoverPrimitive.Content>
        )
        return container ? <PopoverPrimitive.Portal container={container}>{content}</PopoverPrimitive.Portal> : content
      })()}
    </PopoverPrimitive.Root>
  )
}
