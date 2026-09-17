import { AlertDialog, VisuallyHidden } from '@radix-ui/themes'
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
  return <AlertDialog.Cancel>{props.children}</AlertDialog.Cancel>
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
    <AlertDialog.Root
      open={props.open}
      onOpenChange={(next: boolean) => {
        if (!next && !dismissible) return
        props.onOpenChange(next)
      }}
    >
      {/* Themes AlertDialog.Content owns the overlay; overlayClassName is kept for the seat API and ignored. */}
      <AlertDialog.Content
        className={props.className ?? 'file-dialog confirm-dialog'}
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
        <VisuallyHidden>
          <AlertDialog.Title>{props.title}</AlertDialog.Title>
        </VisuallyHidden>
        {props.description
          ? <VisuallyHidden><AlertDialog.Description>{props.description}</AlertDialog.Description></VisuallyHidden>
          : null}
        {props.children}
      </AlertDialog.Content>
    </AlertDialog.Root>
  )
}
