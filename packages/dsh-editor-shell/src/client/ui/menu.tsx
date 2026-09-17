import { Button, DropdownMenu } from '@radix-ui/themes'
import { forwardRef, type ReactNode } from 'react'

export type MenuProps = {
  open?: boolean
  onOpenChange?(open: boolean): void
  children?: ReactNode
  modal?: boolean
}

export function Menu(props: MenuProps) {
  return (
    <DropdownMenu.Root open={props.open} onOpenChange={props.onOpenChange} modal={props.modal !== false}>
      {props.children}
    </DropdownMenu.Root>
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
    <DropdownMenu.Trigger>
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        color="gray"
        className={props.className}
        tabIndex={props.tabIndex}
        disabled={props.disabled}
        title={props.title}
        aria-label={props['aria-label']}
        aria-controls={props['aria-controls']}
        data-testid={props['data-testid']}
      >
        {props.children}
      </Button>
    </DropdownMenu.Trigger>
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
    <DropdownMenu.Content
      id={props.id}
      className={props.className ?? 'menu-content'}
      align={props.align ?? 'start'}
      side={props.side ?? 'bottom'}
      sideOffset={props.sideOffset ?? 4}
      collisionPadding={8}
      aria-label={props['aria-label']}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      {props.children}
    </DropdownMenu.Content>
  )
}

function isDangerItem(props: { className?: string; 'data-danger'?: string }): boolean {
  if (props['data-danger'] === 'true' || props['data-danger'] === '') return true
  return Boolean(props.className?.split(/\s+/).includes('danger'))
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
    <DropdownMenu.Item
      className={props.className}
      disabled={props.disabled}
      title={props.title}
      role={props.role ?? 'menuitem'}
      color={isDangerItem(props) ? 'red' : undefined}
      data-danger={props['data-danger']}
      data-testid={props['data-testid']}
      aria-current={props['aria-current']}
      aria-label={props['aria-label']}
      onSelect={() => { if (!props.disabled) props.onSelect?.() }}
    >
      {props.children}
    </DropdownMenu.Item>
  )
}

export function MenuSeparator(props: { className?: string; 'aria-hidden'?: boolean | 'true' }) {
  return <DropdownMenu.Separator className={props.className} aria-hidden={props['aria-hidden']} />
}

export function MenuSub(props: { children?: ReactNode }) {
  return <DropdownMenu.Sub>{props.children}</DropdownMenu.Sub>
}

export function MenuSubTrigger(props: {
  children?: ReactNode
  disabled?: boolean
  className?: string
  'data-testid'?: string
}) {
  return (
    <DropdownMenu.SubTrigger
      className={props.className}
      disabled={props.disabled}
      data-testid={props['data-testid']}
    >
      {props.children}
    </DropdownMenu.SubTrigger>
  )
}

export function MenuSubContent(props: {
  children?: ReactNode
  className?: string
  'aria-label'?: string
}) {
  return (
    <DropdownMenu.SubContent
      className={props.className ?? 'menu-content'}
      collisionPadding={8}
      aria-label={props['aria-label']}
    >
      {props.children}
    </DropdownMenu.SubContent>
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
    <DropdownMenu.CheckboxItem
      className={props.className}
      checked={Boolean(props.checked)}
      disabled={props.disabled}
      data-testid={props['data-testid']}
      onCheckedChange={(next) => { if (!props.disabled) props.onCheckedChange?.(next === true) }}
    >
      {props.children}
    </DropdownMenu.CheckboxItem>
  )
}

export function MenuLabel(props: { children?: ReactNode; className?: string }) {
  return <DropdownMenu.Label className={props.className}>{props.children}</DropdownMenu.Label>
}
