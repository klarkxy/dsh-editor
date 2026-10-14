import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { useRef, type ReactElement, type ReactNode, type RefObject } from 'react'
import { cx, useDshPortalContainer } from '../../ui/shared.ts'
import '../../ui/dialog.styles.ts'
import '../../ui/confirm-dialog.styles.ts'
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
  return <AlertDialogPrimitive.Cancel asChild>{props.children}</AlertDialogPrimitive.Cancel>
}

/* 与 ./dialog.tsx 同理：调用方历史上把 overlay 类名混在 className 里。 */
function stripOverlayClass(className: string): string {
  return className.replace(/\bfile-dialog-overlay\b/g, '').replace(/\s+/g, ' ').trim()
}

/* Phase 4.8：宿主确认框落在内部 ConfirmDialog chrome 上（.dsh-dialog .dsh-confirm）。
   调用方仍在 children 里渲染可见标题/正文/按钮，Title/Description 只做可访问名。 */
export function Confirm(props: ConfirmProps) {
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

  const layer = (
    <>
      <AlertDialogPrimitive.Overlay className={cx('dsh-overlay', props.overlayClassName)} />
      <AlertDialogPrimitive.Content
        className={cx('dsh-dialog', 'dsh-confirm', stripOverlayClass(props.className ?? 'file-dialog confirm-dialog'))}
        onOpenAutoFocus={(event: Event) => {
          event.preventDefault()
          const target = props.initialFocusRef?.current
          globalThis.requestAnimationFrame(() => target?.focus())
        }}
        onCloseAutoFocus={(event: Event) => {
          event.preventDefault()
          scheduleReturnFocus(returnFocus.current, restoreGen)
        }}
        onEscapeKeyDown={(event: { preventDefault(): void; target: EventTarget | null }) => {
          if (!dismissible) {
            event.preventDefault()
            return
          }
          const node = event.target instanceof Element ? event.target : null
          if (node?.closest('[role="listbox"], .select-list, [data-radix-select-content]')) event.preventDefault()
        }}
      >
        <VisuallyHidden>
          <AlertDialogPrimitive.Title>{props.title}</AlertDialogPrimitive.Title>
        </VisuallyHidden>
        {props.description
          ? <VisuallyHidden><AlertDialogPrimitive.Description>{props.description}</AlertDialogPrimitive.Description></VisuallyHidden>
          : null}
        {props.children}
      </AlertDialogPrimitive.Content>
    </>
  )

  return (
    <AlertDialogPrimitive.Root
      open={props.open}
      onOpenChange={(next: boolean) => {
        if (!next && !dismissible) return
        props.onOpenChange(next)
      }}
    >
      {container ? <AlertDialogPrimitive.Portal container={container}>{layer}</AlertDialogPrimitive.Portal> : layer}
    </AlertDialogPrimitive.Root>
  )
}
