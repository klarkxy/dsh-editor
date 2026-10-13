import * as Dropdown from '@radix-ui/react-dropdown-menu'
import * as Context from '@radix-ui/react-context-menu'
import type { ReactNode } from 'react'
import { CheckIcon } from './icons.tsx'
import { Kbd } from './kbd.tsx'
import { cx, useDshPortalContainer } from './shared.ts'
import './menu.styles.ts'

/* §5 Menu：DropdownMenu 与 ContextMenu 两套。菜单面板 menu-fill +
   elevation-panel、border: 0、不模糊。 */

export type MenuItemProps = {
  icon?: ReactNode
  shortcut?: ReactNode
  tone?: 'default' | 'danger'
  disabled?: boolean
  checked?: boolean
  onSelect?(): void
  children?: ReactNode
}

function itemMarkup(props: MenuItemProps) {
  return (
    <>
      {props.checked ? <span className="dsh-menu__check"><CheckIcon size="sm" /></span> : null}
      {props.icon ? <span className="dsh-menu__icon">{props.icon}</span> : null}
      <span className="dsh-menu__item-body">{props.children}</span>
      {props.shortcut ? <Kbd className="dsh-menu__shortcut">{props.shortcut}</Kbd> : null}
    </>
  )
}

export function Menu(props: { open?: boolean; onOpenChange?(open: boolean): void; modal?: boolean; children?: ReactNode }) {
  return <Dropdown.Root open={props.open} onOpenChange={props.onOpenChange} modal={props.modal}>{props.children}</Dropdown.Root>
}

export function MenuTrigger(props: { children: ReactNode }) {
  return <Dropdown.Trigger asChild>{props.children}</Dropdown.Trigger>
}

export function MenuContent(props: {
  children?: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  'aria-label'?: string
  className?: string
  onCloseAutoFocus?(event: Event): void
}) {
  const container = useDshPortalContainer()
  const content = (
    <Dropdown.Content
      className={cx('dsh-menu', props.className)}
      align={props.align ?? 'start'}
      side={props.side ?? 'bottom'}
      sideOffset={props.sideOffset ?? 4}
      collisionPadding={8}
      aria-label={props['aria-label']}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      {props.children}
    </Dropdown.Content>
  )
  return container ? <Dropdown.Portal container={container}>{content}</Dropdown.Portal> : content
}

export function MenuItem(props: MenuItemProps) {
  return (
    <Dropdown.Item
      className="dsh-menu__item"
      data-tone={props.tone === 'danger' ? 'danger' : undefined}
      disabled={props.disabled}
      onSelect={props.onSelect}
    >
      {itemMarkup(props)}
    </Dropdown.Item>
  )
}

export function MenuSeparator() {
  return <Dropdown.Separator className="dsh-menu__separator" />
}

export function MenuLabel(props: { children?: ReactNode }) {
  return <Dropdown.Label className="dsh-menu__label">{props.children}</Dropdown.Label>
}

export function MenuSub(props: { children?: ReactNode }) {
  return <Dropdown.Sub>{props.children}</Dropdown.Sub>
}

export function MenuSubTrigger(props: MenuItemProps) {
  return (
    <Dropdown.SubTrigger className="dsh-menu__item" disabled={props.disabled}>
      {itemMarkup(props)}
    </Dropdown.SubTrigger>
  )
}

export function MenuSubContent(props: { children?: ReactNode; 'aria-label'?: string }) {
  const container = useDshPortalContainer()
  const content = (
    <Dropdown.SubContent className="dsh-menu" collisionPadding={8} aria-label={props['aria-label']}>
      {props.children}
    </Dropdown.SubContent>
  )
  return container ? <Dropdown.Portal container={container}>{content}</Dropdown.Portal> : content
}

export function ContextMenu(props: { children?: ReactNode; modal?: boolean }) {
  return <Context.Root modal={props.modal}>{props.children}</Context.Root>
}

export function ContextMenuTrigger(props: { children: ReactNode; className?: string }) {
  return <Context.Trigger className={props.className} asChild>{props.children}</Context.Trigger>
}

export function ContextMenuContent(props: { children?: ReactNode; 'aria-label'?: string }) {
  const container = useDshPortalContainer()
  const content = (
    <Context.Content className="dsh-menu" collisionPadding={8} aria-label={props['aria-label']}>
      {props.children}
    </Context.Content>
  )
  return container ? <Context.Portal container={container}>{content}</Context.Portal> : content
}

export function ContextMenuItem(props: MenuItemProps) {
  return (
    <Context.Item
      className="dsh-menu__item"
      data-tone={props.tone === 'danger' ? 'danger' : undefined}
      disabled={props.disabled}
      onSelect={props.onSelect}
    >
      {itemMarkup(props)}
    </Context.Item>
  )
}

export function ContextMenuSeparator() {
  return <Context.Separator className="dsh-menu__separator" />
}
