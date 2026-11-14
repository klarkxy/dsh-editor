import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { useRef, type ReactNode } from 'react'
import { scheduleReturnFocus, takeInvokerOnOpen } from './focus-return.ts'
import { Button } from './button.tsx'
import { useDshPortalContainer } from './shared.ts'
import './confirm-dialog.styles.ts'

export function ConfirmDialog(props: {
  open: boolean
  onOpenChange?(open: boolean): void
  title: ReactNode
  message?: ReactNode
  confirmLabel: string
  cancelLabel: string
  tone?: 'default' | 'danger'
  busy?: boolean
  onConfirm(): void
  onCancel?(): void
}) {
  const container = useDshPortalContainer()
  const wasOpen = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const restoreGen = useRef(0)
  const captured = takeInvokerOnOpen(props.open, wasOpen)
  if (captured !== undefined) {
    returnFocus.current = captured
    restoreGen.current += 1
  }
  return (
    <AlertDialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      {(() => {
        const layer = (
          <>
            <AlertDialogPrimitive.Overlay className="dsh-overlay" />
            <AlertDialogPrimitive.Content
              className="dsh-dialog dsh-confirm"
              data-size="sm"
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                scheduleReturnFocus(returnFocus.current, restoreGen)
              }}>
              <AlertDialogPrimitive.Title className="dsh-dialog__title">{props.title}</AlertDialogPrimitive.Title>
              {props.message
                ? <AlertDialogPrimitive.Description className="dsh-dialog__desc dsh-confirm__message">{props.message}</AlertDialogPrimitive.Description>
                : null}
              <div className="dsh-dialog__footer">
                <AlertDialogPrimitive.Cancel asChild>
                  <Button variant="secondary" onClick={props.onCancel} disabled={props.busy}>{props.cancelLabel}</Button>
                </AlertDialogPrimitive.Cancel>
                <AlertDialogPrimitive.Action asChild>
                  <Button
                    variant={props.tone === 'danger' ? 'danger' : 'primary'}
                    loading={props.busy}
                    onClick={props.onConfirm}
                  >
                    {props.confirmLabel}
                  </Button>
                </AlertDialogPrimitive.Action>
              </div>
            </AlertDialogPrimitive.Content>
          </>
        )
        return container ? <AlertDialogPrimitive.Portal container={container}>{layer}</AlertDialogPrimitive.Portal> : layer
      })()}
    </AlertDialogPrimitive.Root>
  )
}
