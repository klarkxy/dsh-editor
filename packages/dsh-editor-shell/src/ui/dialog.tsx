import * as DialogPrimitive from '@radix-ui/react-dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
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
  /** 覆盖层附加类名（宿主调用方可能带自己的 scrim 类）。 */
  overlayClassName?: string
  /** §9 钩子：渲染为内容节点的 data-testid。 */
  testid?: string
  /** 宿主契约：标题/描述只做可访问名，可见头部由 children 自绘。 */
  titleHidden?: boolean
  /** 关闭自动聚焦前的拦截口；preventDefault 之后不再恢复焦点。 */
  onCloseAutoFocus?(event: Event): void
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
            <DialogPrimitive.Overlay className={cx('dsh-overlay', props.overlayClassName)} />
            <DialogPrimitive.Content
          className={cx('dsh-dialog', props.className)}
          data-size={props.size ?? 'md'}
          data-testid={props.testid}
          onOpenAutoFocus={(event) => {
            const target = props.initialFocusRef?.current
            if (!target) return
            event.preventDefault()
            globalThis.requestAnimationFrame(() => target.focus())
          }}
          onCloseAutoFocus={(event) => {
            props.onCloseAutoFocus?.(event)
            if (event.defaultPrevented) return
            event.preventDefault()
            scheduleReturnFocus(returnFocus.current, restoreGen)
          }}
          onPointerDownOutside={blockDismiss}
          onInteractOutside={blockDismiss}
          /* Escape 落在嵌套弹层（listbox/菜单）里时只关内层，不关对话框。 */
          onEscapeKeyDown={(event) => {
            if (!dismissible) {
              event.preventDefault()
              return
            }
            const node = event.target instanceof Element ? event.target : null
            if (node?.closest('[role="listbox"], .select-list, .dsh-menu, [data-radix-select-content], [role="menu"]')) {
              event.preventDefault()
            }
          }}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key !== 'Escape') return
            if (!dismissible || event.defaultPrevented) {
              event.preventDefault()
              event.stopPropagation()
            }
          }}
        >
          {props.titleHidden ? (
            <>
              <VisuallyHidden><DialogPrimitive.Title>{props.title}</DialogPrimitive.Title></VisuallyHidden>
              {props.description
                ? <VisuallyHidden><DialogPrimitive.Description>{props.description}</DialogPrimitive.Description></VisuallyHidden>
                : null}
            </>
          ) : (
            <>
              <div className="dsh-dialog__header">
                <DialogPrimitive.Title className="dsh-dialog__title">{props.title}</DialogPrimitive.Title>
                {props.closeLabel
                  ? <DialogPrimitive.Close asChild><IconButton label={props.closeLabel} /></DialogPrimitive.Close>
                  : null}
              </div>
              {props.description
                ? <DialogPrimitive.Description className="dsh-dialog__desc">{props.description}</DialogPrimitive.Description>
                : null}
            </>
          )}
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
