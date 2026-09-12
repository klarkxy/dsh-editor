import {
  Root as AlertRoot,
  Portal as AlertPortal,
  Overlay as AlertOverlay,
  Content as AlertContent,
  Title as AlertTitle,
  Description as AlertDescription,
  Cancel as AlertCancel,
} from '@radix-ui/react-alert-dialog'
import { useRef, type ReactElement, type ReactNode, type RefObject } from 'react'
import { pickReturnFocus, scheduleReturnFocus, takeInvokerOnOpen } from './focus-return.ts'

export type ConfirmProps = {
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
}

export function ConfirmCancel(props: { children: ReactElement }) {
  return <AlertCancel asChild>{props.children}</AlertCancel>
}

export function Confirm(props: ConfirmProps) {
  const dismissible = props.dismissible !== false
  const wasOpen = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const restoreGen = useRef(0)
  const captured = takeInvokerOnOpen(props.open, wasOpen)
  if (captured !== undefined) {
    returnFocus.current = pickReturnFocus(props.returnFocusRef?.current, captured)
    restoreGen.current += 1
  }

  return (
    <AlertRoot
      open={props.open}
      onOpenChange={(next: boolean) => {
        if (!next && !dismissible) return
        props.onOpenChange(next)
      }}
    >
      <AlertPortal>
        <AlertOverlay className={['dsh-ui', props.overlayClassName ?? 'file-dialog-overlay'].filter(Boolean).join(' ')} />
        <AlertContent
          className={['dsh-ui', props.className ?? 'file-dialog confirm-dialog'].filter(Boolean).join(' ')}
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault()
            const target = props.initialFocusRef?.current
            globalThis.requestAnimationFrame(() => target?.focus())
          }}
          onCloseAutoFocus={(event: Event) => {
            event.preventDefault()
            scheduleReturnFocus(returnFocus.current, restoreGen)
          }}
          onEscapeKeyDown={(event: { preventDefault(): void }) => {
            if (!dismissible) event.preventDefault()
          }}
        >
          <AlertTitle className="dsh-ui-sr-only">{props.title}</AlertTitle>
          {props.description
            ? <AlertDescription className="dsh-ui-sr-only">{props.description}</AlertDescription>
            : null}
          {props.children}
        </AlertContent>
      </AlertPortal>
    </AlertRoot>
  )
}
