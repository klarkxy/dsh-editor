import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useRef, type ReactNode } from 'react'
import { pickReturnFocus, scheduleReturnFocus, takeInvokerOnOpen } from './focus-return.ts'
import { IconButton } from './icon-button.tsx'
import { useDshPortalContainer } from './shared.ts'
import './drawer.styles.ts'

/** 窄窗覆盖栏用的侧滑抽屉（Radix Dialog）。 */
export function Drawer(props: {
  open: boolean
  onOpenChange(open: boolean): void
  /** 非模态（画廊并排演示用）。 */
  modal?: boolean
  side?: 'left' | 'right'
  title: ReactNode
  closeLabel: string
  children?: ReactNode
}) {
  const container = useDshPortalContainer()
  const contentRef = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const restoreGen = useRef(0)
  const captured = takeInvokerOnOpen(props.open, wasOpen)
  if (captured !== undefined) {
    returnFocus.current = pickReturnFocus(undefined, captured)
    restoreGen.current += 1
  }
  return (
    <DialogPrimitive.Root open={props.open} modal={props.modal} onOpenChange={props.onOpenChange}>
      {(() => {
        const layer = (
          <>
            <DialogPrimitive.Overlay className="dsh-overlay" />
            {/* 焦点落在抽屉根上而不是关闭按钮：IconButton 的 Tooltip 也是
                DismissableLayer，第一次 Escape 会先被它吃掉。 */}
            <DialogPrimitive.Content
              ref={contentRef}
              className="dsh-drawer"
              data-side={props.side ?? 'right'}
              onOpenAutoFocus={(event) => {
                event.preventDefault()
                contentRef.current?.focus()
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                scheduleReturnFocus(returnFocus.current, restoreGen)
              }}
            >
              <div className="dsh-drawer__header">
                <DialogPrimitive.Title className="dsh-drawer__title">{props.title}</DialogPrimitive.Title>
                <DialogPrimitive.Close asChild><IconButton label={props.closeLabel} /></DialogPrimitive.Close>
              </div>
              <div className="dsh-drawer__body">{props.children}</div>
            </DialogPrimitive.Content>
          </>
        )
        return container ? <DialogPrimitive.Portal container={container}>{layer}</DialogPrimitive.Portal> : layer
      })()}
    </DialogPrimitive.Root>
  )
}
