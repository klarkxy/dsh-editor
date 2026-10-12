import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import type { ReactNode } from 'react'
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
  return (
    <AlertDialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
      {(() => {
        const layer = (
          <>
            <AlertDialogPrimitive.Overlay className="dsh-overlay" />
            <AlertDialogPrimitive.Content className="dsh-dialog dsh-confirm" data-size="sm">
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
