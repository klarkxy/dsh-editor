import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useRef, type CSSProperties, type ReactNode } from 'react'
import { pickReturnFocus, scheduleReturnFocus, takeInvokerOnOpen } from './focus-return.ts'
import { IconButton } from './icon-button.tsx'
import { cx, useDshPortalContainer } from './shared.ts'
import './drawer.styles.ts'

/* 视觉隐藏（.shell .sr-only 管不到 Portal 内容，这里内联自带；
   与 command-palette 同一写法）。 */
const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
}

/** 窄窗覆盖栏用的侧滑抽屉（Radix Dialog）。 */
export function Drawer(props: {
  open: boolean
  onOpenChange(open: boolean): void
  /** 非模态（画廊并排演示用）。 */
  modal?: boolean
  side?: 'left' | 'right'
  title: ReactNode
  closeLabel: string
  /** 无标题条模式：标题进 VisuallyHidden，内容第一行（页签条）自己充当
      抽屉顶行，关闭按钮绝对定位压在它的右端。 */
  bare?: boolean
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
              className={cx('dsh-drawer', props.bare ? 'dsh-drawer--bare' : '')}
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
              {props.bare ? (
                <>
                  <DialogPrimitive.Title style={visuallyHidden}>{props.title}</DialogPrimitive.Title>
                  {/* 关闭钮压在页签条右端（抽屉内第一行）；Dialog.Title 只
                      保留可访问名称。 */}
                  <DialogPrimitive.Close asChild>
                    <IconButton className="dsh-drawer__close" size="sm" label={props.closeLabel} />
                  </DialogPrimitive.Close>
                  <div className="dsh-drawer__body">{props.children}</div>
                </>
              ) : (
                <>
                  <div className="dsh-drawer__header">
                    <DialogPrimitive.Title className="dsh-drawer__title">{props.title}</DialogPrimitive.Title>
                    <DialogPrimitive.Close asChild><IconButton label={props.closeLabel} /></DialogPrimitive.Close>
                  </div>
                  <div className="dsh-drawer__body">{props.children}</div>
                </>
              )}
            </DialogPrimitive.Content>
          </>
        )
        return container ? <DialogPrimitive.Portal container={container}>{layer}</DialogPrimitive.Portal> : layer
      })()}
    </DialogPrimitive.Root>
  )
}
