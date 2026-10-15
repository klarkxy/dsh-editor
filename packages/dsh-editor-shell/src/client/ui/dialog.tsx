import type { ReactNode, RefObject } from 'react'
import { Dialog as InternalDialog } from '../../ui/index.ts'

export { DialogDescription, DialogTitle } from '../../ui/index.ts'

export type DialogProps = {
  open: boolean
  onOpenChange(open: boolean): void
  /* 可访问名由 children 里的 DialogTitle/DialogDescription（包住可见标题）
     提供；title/description 仅为兼容保留，不再渲染出任何副本。 */
  title?: string
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

/* C04：宿主对话框委托给内部 Dialog（src/ui/dialog.tsx），props 契约不变；
   titleHidden 模式下壳不渲染标题/描述，调用方在 children 里用
   DialogTitle/DialogDescription 包住可见节点，可访问名即所见。 */
export function Dialog(props: DialogProps) {
  return (
    <InternalDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      description={props.description}
      className={stripOverlayClass(props.className ?? 'file-dialog')}
      overlayClassName={props.overlayClassName}
      dismissible={props.dismissible}
      initialFocusRef={props.initialFocusRef}
      returnFocusRef={props.returnFocusRef}
      onCloseAutoFocus={props.onCloseAutoFocus}
      testid={props.testid}
      titleHidden>
      {props.children}
    </InternalDialog>
  )
}
