import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'
import type { ReactNode } from 'react'
import { ChevronRightIcon } from './icons.tsx'
import { cx } from './shared.ts'
import './disclosure.styles.ts'

export function Disclosure(props: {
  summary: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?(open: boolean): void
  children?: ReactNode
  className?: string
}) {
  return (
    <CollapsiblePrimitive.Root
      className={cx('dsh-disclosure', props.className)}
      open={props.open}
      defaultOpen={props.defaultOpen}
      onOpenChange={props.onOpenChange}
    >
      <CollapsiblePrimitive.Trigger className="dsh-disclosure__summary">
        <span className="dsh-disclosure__chevron"><ChevronRightIcon size="sm" /></span>
        {props.summary}
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className="dsh-disclosure__content">
        {props.children}
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  )
}
