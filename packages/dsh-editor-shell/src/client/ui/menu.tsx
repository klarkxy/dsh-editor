import {
  Root as MenuRoot,
  Trigger as MenuTriggerRoot,
  Portal as MenuPortal,
  Content as MenuContentRoot,
  Item as MenuItemRoot,
  Separator as MenuSeparatorRoot,
  Sub as MenuSubRoot,
  SubTrigger as MenuSubTriggerRoot,
  SubContent as MenuSubContentRoot,
  CheckboxItem as MenuCheckboxItemRoot,
  Label as MenuLabelRoot,
  ItemIndicator as MenuItemIndicatorRoot,
} from '@radix-ui/react-dropdown-menu'
import { forwardRef, type ReactNode } from 'react'

export type MenuProps = {
  open?: boolean
  onOpenChange?(open: boolean): void
  children?: ReactNode
  modal?: boolean
}

export function Menu(props: MenuProps) {
  return (
    <MenuRoot open={props.open} onOpenChange={props.onOpenChange} modal={props.modal !== false}>
      {props.children}
    </MenuRoot>
  )
}

export const MenuTrigger = forwardRef<HTMLButtonElement, {
  className?: string
  children?: ReactNode
  tabIndex?: number
  disabled?: boolean
  title?: string
  'aria-label'?: string
  'aria-controls'?: string
  'data-testid'?: string
}>(function MenuTrigger(props, ref) {
  return (
    <MenuTriggerRoot
      ref={ref}
      className={props.className}
      tabIndex={props.tabIndex}
      disabled={props.disabled}
      title={props.title}
      aria-label={props['aria-label']}
      aria-controls={props['aria-controls']}
      data-testid={props['data-testid']}
    >
      {props.children}
    </MenuTriggerRoot>
  )
})

export function MenuContent(props: {
  className?: string
  children?: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  id?: string
  'aria-label'?: string
  onCloseAutoFocus?(event: Event): void
}) {
  return (
    <MenuPortal>
      <MenuContentRoot
        id={props.id}
        className={['dsh-ui', props.className ?? 'menu-content'].filter(Boolean).join(' ')}
        align={props.align ?? 'start'}
        side={props.side ?? 'bottom'}
        sideOffset={props.sideOffset ?? 4}
        collisionPadding={8}
        aria-label={props['aria-label']}
        onCloseAutoFocus={props.onCloseAutoFocus}
      >
        {props.children}
      </MenuContentRoot>
    </MenuPortal>
  )
}

export function MenuItem(props: {
  children?: ReactNode
  disabled?: boolean
  className?: string
  title?: string
  role?: string
  'data-danger'?: string
  'aria-current'?: boolean | 'true' | 'false' | 'page' | 'step' | 'location' | 'date' | 'time'
  'aria-label'?: string
  'data-testid'?: string
  onSelect?(): void
}) {
  return (
    <MenuItemRoot
      className={props.className}
      disabled={props.disabled}
      title={props.title}
      role={props.role ?? 'menuitem'}
      data-danger={props['data-danger']}
      data-testid={props['data-testid']}
      aria-current={props['aria-current']}
      aria-label={props['aria-label']}
      onSelect={() => { if (!props.disabled) props.onSelect?.() }}
    >
      {props.children}
    </MenuItemRoot>
  )
}

export function MenuSeparator(props: { className?: string; 'aria-hidden'?: boolean | 'true' }) {
  return <MenuSeparatorRoot className={props.className} aria-hidden={props['aria-hidden']} />
}

export function MenuSub(props: { children?: ReactNode }) {
  return <MenuSubRoot>{props.children}</MenuSubRoot>
}

export function MenuSubTrigger(props: {
  children?: ReactNode
  disabled?: boolean
  className?: string
  'data-testid'?: string
}) {
  return (
    <MenuSubTriggerRoot
      className={props.className}
      disabled={props.disabled}
      data-testid={props['data-testid']}
    >
      {props.children}<span className="editor-menu-sub-arrow" aria-hidden="true">›</span>
    </MenuSubTriggerRoot>
  )
}

export function MenuSubContent(props: {
  children?: ReactNode
  className?: string
  'aria-label'?: string
}) {
  return (
    <MenuPortal>
      <MenuSubContentRoot
        className={['dsh-ui', props.className ?? 'menu-content'].filter(Boolean).join(' ')}
        collisionPadding={8}
        aria-label={props['aria-label']}
      >
        {props.children}
      </MenuSubContentRoot>
    </MenuPortal>
  )
}

export function MenuCheckboxItem(props: {
  children?: ReactNode
  checked?: boolean
  disabled?: boolean
  className?: string
  'data-testid'?: string
  onCheckedChange?(checked: boolean): void
}) {
  return (
    <MenuCheckboxItemRoot
      className={props.className}
      checked={Boolean(props.checked)}
      disabled={props.disabled}
      data-testid={props['data-testid']}
      onCheckedChange={(next) => { if (!props.disabled) props.onCheckedChange?.(next === true) }}
    >
      <MenuItemIndicatorRoot className="editor-menu-check">✓</MenuItemIndicatorRoot>
      {props.children}
    </MenuCheckboxItemRoot>
  )
}

export function MenuLabel(props: { children?: ReactNode; className?: string }) {
  return <MenuLabelRoot className={props.className}>{props.children}</MenuLabelRoot>
}
