import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
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
  return (
    <DialogPrimitive.Root open={props.open} modal={props.modal} onOpenChange={props.onOpenChange}>
      {(() => {
        const layer = (
          <>
            <DialogPrimitive.Overlay className="dsh-overlay" />
            <DialogPrimitive.Content className="dsh-drawer" data-side={props.side ?? 'right'}>
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
