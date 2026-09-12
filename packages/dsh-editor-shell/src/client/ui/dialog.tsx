import {
  Root as DialogRoot,
  Portal as DialogPortal,
  Overlay as DialogOverlay,
  Content as DialogContent,
  Title as DialogTitle,
  Description as DialogDescription,
} from '@radix-ui/react-dialog'
import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { pickReturnFocus, scheduleReturnFocus, takeInvokerOnOpen } from './focus-return.ts'

export type DialogProps = {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  description?: string
  children?: ReactNode
  className?: string
  overlayClassName?: string
  dismissible?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Internal: restore this stable invoker (e.g. tree row) instead of the focused menuitem. */
  returnFocusRef?: RefObject<HTMLElement | null>
  onCloseAutoFocus?(event: Event): void
}

export function Dialog(props: DialogProps) {
  const dismissible = props.dismissible !== false
  const wasOpen = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const restoreGen = useRef(0)
  const captured = takeInvokerOnOpen(props.open, wasOpen)
  if (captured !== undefined) {
    returnFocus.current = pickReturnFocus(props.returnFocusRef?.current, captured)
    restoreGen.current += 1
  }

  const blockDismiss = (event: { preventDefault(): void }) => {
    if (!dismissible) event.preventDefault()
  }

  return (
    <DialogRoot
      open={props.open}
      onOpenChange={(next: boolean) => {
        if (!next && !dismissible) return
        props.onOpenChange(next)
      }}
    >
      <DialogPortal>
        <DialogOverlay className={['dsh-ui', props.overlayClassName ?? 'file-dialog-overlay'].filter(Boolean).join(' ')} />
        <DialogContent
          className={['dsh-ui', props.className ?? 'file-dialog'].filter(Boolean).join(' ')}
          {...(props.description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={(event: Event) => {
            const target = props.initialFocusRef?.current
            if (!target) return
            event.preventDefault()
            globalThis.requestAnimationFrame(() => target.focus())
          }}
          onCloseAutoFocus={(event: Event) => {
            props.onCloseAutoFocus?.(event)
            if (event.defaultPrevented) return
            event.preventDefault()
            scheduleReturnFocus(returnFocus.current, restoreGen)
          }}
          onPointerDownOutside={blockDismiss}
          onInteractOutside={blockDismiss}
          onEscapeKeyDown={(event: { preventDefault(): void; target: EventTarget | null }) => {
            if (!dismissible) {
              event.preventDefault()
              return
            }
            const node = event.target instanceof Element ? event.target : null
            if (node?.closest('[role="listbox"], .select-list, [data-radix-select-content]')) event.preventDefault()
          }}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key !== 'Escape') return
            if (!dismissible || event.defaultPrevented) {
              event.preventDefault()
              event.stopPropagation()
            }
          }}
        >
          <DialogTitle className="dsh-ui-sr-only">{props.title}</DialogTitle>
          {props.description
            ? <DialogDescription className="dsh-ui-sr-only">{props.description}</DialogDescription>
            : null}
          {props.children}
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  )
}
