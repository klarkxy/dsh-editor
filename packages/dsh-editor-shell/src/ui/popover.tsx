import * as PopoverPrimitive from '@radix-ui/react-popover'
import type { ReactNode } from 'react'
import { useDshPortalContainer } from './shared.ts'
import './popover.styles.ts'

/* 虚拟锚点：稿纸选区等没有真实触发器的浮层，由调用方提供
   getBoundingClientRect()（如 CodeMirror coordsAtPos）。 */
export type PopoverVirtualAnchor = {
  getBoundingClientRect(): DOMRect
}

export function Popover(props: {
  /** 触发器；提供 anchor 时可省略（浮层锚定虚拟元素）。 */
  trigger?: ReactNode
  /** 虚拟锚点；提供时忽略 trigger。 */
  anchor?: PopoverVirtualAnchor | null
  content: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  'aria-label'?: string
  open?: boolean
  onOpenChange?(open: boolean): void
  onOpenAutoFocus?(event: Event): void
  onCloseAutoFocus?(event: Event): void
}) {
  const container = useDshPortalContainer()
  return (
    <PopoverPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      {props.anchor
        ? <PopoverPrimitive.Anchor virtualRef={{ current: props.anchor }} />
        : <PopoverPrimitive.Trigger asChild>{props.trigger}</PopoverPrimitive.Trigger>}
      {(() => {
        const content = (
          <PopoverPrimitive.Content
            className="dsh-popover"
            side={props.side ?? 'bottom'}
            align={props.align ?? 'start'}
            sideOffset={4}
            collisionPadding={8}
            aria-label={props['aria-label']}
            onOpenAutoFocus={props.onOpenAutoFocus}
            onCloseAutoFocus={props.onCloseAutoFocus}
          >
            {props.content}
          </PopoverPrimitive.Content>
        )
        return container ? <PopoverPrimitive.Portal container={container}>{content}</PopoverPrimitive.Portal> : content
      })()}
    </PopoverPrimitive.Root>
  )
}
