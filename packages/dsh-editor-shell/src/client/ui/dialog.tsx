import * as DialogPrimitive from '@radix-ui/react-dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { cx, useDshPortalContainer } from '../../ui/shared.ts'
import '../../ui/dialog.styles.ts'
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
  /** §9 钩子：渲染为内容节点的 data-testid。 */
  testid?: string
}

/* 历史上调用方把 overlay 的类名也传进了 className（旧实现忽略 overlayClassName,
   类名落在内容上也无效果）。现在 overlay 类名真的会带 scrim 背景,内容要剥掉它。 */
function stripOverlayClass(className: string): string {
  return className.replace(/\bfile-dialog-overlay\b/g, '').replace(/\s+/g, ' ').trim()
}

/* Phase 4.8：宿主对话框落在内部 Dialog chrome 上（.dsh-dialog / .dsh-overlay）。
   标题仍由调用方在自己的内容里渲染成可见 h2，这里的 Title 只做可访问名。 */
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

  const layer = (
    <>
      <DialogPrimitive.Overlay className={cx('dsh-overlay', props.overlayClassName)} />
      <DialogPrimitive.Content
        aria-modal="true"
        data-testid={props.testid}
        className={cx('dsh-dialog', stripOverlayClass(props.className ?? 'file-dialog'))}
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
        <VisuallyHidden>
          <DialogPrimitive.Title>{props.title}</DialogPrimitive.Title>
        </VisuallyHidden>
        {props.description
          ? <VisuallyHidden><DialogPrimitive.Description>{props.description}</DialogPrimitive.Description></VisuallyHidden>
          : null}
        <div className="dsh-dialog__body">{props.children}</div>
      </DialogPrimitive.Content>
    </>
  )

  return (
    <DialogPrimitive.Root
      open={props.open}
      onOpenChange={(next: boolean) => {
        if (!next && !dismissible) return
        props.onOpenChange(next)
      }}
    >
      {container ? <DialogPrimitive.Portal container={container}>{layer}</DialogPrimitive.Portal> : layer}
    </DialogPrimitive.Root>
  )
}
