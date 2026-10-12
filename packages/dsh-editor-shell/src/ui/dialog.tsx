import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useRef, type ReactNode, type RefObject } from 'react'
import { pickReturnFocus, scheduleReturnFocus, takeInvokerOnOpen } from './focus-return.ts'
import { IconButton } from './icon-button.tsx'
import { cx, useDshPortalContainer } from './shared.ts'
import './dialog.styles.ts'

export type DialogProps = {
  open: boolean
  onOpenChange(open: boolean): void
  title: ReactNode
  description?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  initialFocusRef?: RefObject<HTMLElement | null>
  returnFocusRef?: RefObject<HTMLElement | null>
  dismissible?: boolean
  /** 非模态：不锁滚动、不隐藏兄弟内容（画廊并排演示用）。 */
  modal?: boolean
  footer?: ReactNode
  closeLabel?: string
  children?: ReactNode
  className?: string
}

export function Dialog(props: DialogProps) {
  const dismissible = props.dismissible !== false
  const container = useDshPortalContainer()
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
    <DialogPrimitive.Root
      open={props.open}
      modal={props.modal}
      onOpenChange={(next) => {
        if (!next && !dismissible) return
        props.onOpenChange(next)
      }}
    >
      {(() => {
        const layer = (
          <>
            <DialogPrimitive.Overlay className="dsh-overlay" />
            <DialogPrimitive.Content
          className={cx('dsh-dialog', props.className)}
          data-size={props.size ?? 'md'}
          aria-describedby={props.description ? undefined : undefined}
          onOpenAutoFocus={(event) => {
            const target = props.initialFocusRef?.current
            if (!target) return
            event.preventDefault()
            globalThis.requestAnimationFrame(() => target.focus())
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            scheduleReturnFocus(returnFocus.current, restoreGen)
          }}
          onPointerDownOutside={blockDismiss}
          onInteractOutside={blockDismiss}
          onEscapeKeyDown={blockDismiss}
        >
          <div className="dsh-dialog__header">
            <DialogPrimitive.Title className="dsh-dialog__title">{props.title}</DialogPrimitive.Title>
            {props.closeLabel
              ? <DialogPrimitive.Close asChild><IconButton label={props.closeLabel} /></DialogPrimitive.Close>
              : null}
          </div>
          {props.description
            ? <DialogPrimitive.Description className="dsh-dialog__desc">{props.description}</DialogPrimitive.Description>
            : null}
          <div className="dsh-dialog__body">{props.children}</div>
          {props.footer ? <div className="dsh-dialog__footer">{props.footer}</div> : null}
            </DialogPrimitive.Content>
          </>
        )
        return container ? <DialogPrimitive.Portal container={container}>{layer}</DialogPrimitive.Portal> : layer
      })()}
    </DialogPrimitive.Root>
  )
}
