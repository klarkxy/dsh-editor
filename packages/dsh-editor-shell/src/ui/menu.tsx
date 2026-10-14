import * as Dropdown from '@radix-ui/react-dropdown-menu'
import * as Context from '@radix-ui/react-context-menu'
import type { ReactNode } from 'react'
import { CheckIcon, ChevronRightIcon } from './icons.tsx'
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
  title?: string
  className?: string
  role?: string
  'data-testid'?: string
  'data-danger'?: string
  'aria-current'?: boolean | 'page' | 'step' | 'location' | 'date' | 'time' | 'true' | 'false'
  'aria-label'?: string
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
  id?: string
  'aria-label'?: string
  className?: string
  onCloseAutoFocus?(event: Event): void
}) {
  const container = useDshPortalContainer()
  const content = (
    <Dropdown.Content
      id={props.id}
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
  const danger = props.tone === 'danger' || props['data-danger'] === 'true' || props['data-danger'] === ''
  return (
    <Dropdown.Item
      className={cx('dsh-menu__item', props.className)}
      data-tone={danger ? 'danger' : undefined}
      disabled={props.disabled}
      title={props.title}
      /* role 只能显式覆盖：传 undefined 会把 Radix Item 默认的 menuitem 抹掉。 */
      {...(props.role ? { role: props.role } : {})}
      data-danger={props['data-danger']}
      data-testid={props['data-testid']}
      aria-current={props['aria-current']}
      aria-label={props['aria-label']}
      onSelect={() => { if (!props.disabled) props.onSelect?.() }}
    >
      {itemMarkup(props)}
    </Dropdown.Item>
  )
}

export function MenuSeparator(props: { className?: string }) {
  return <Dropdown.Separator className={cx('dsh-menu__separator', props.className)} />
}

export function MenuLabel(props: { children?: ReactNode; className?: string }) {
  return <Dropdown.Label className={cx('dsh-menu__label', props.className)}>{props.children}</Dropdown.Label>
}

export function MenuCheckboxItem(props: MenuItemProps & {
  checked?: boolean
  onCheckedChange?(checked: boolean): void
}) {
  return (
    <Dropdown.CheckboxItem
      className={cx('dsh-menu__item', props.className)}
      checked={Boolean(props.checked)}
      disabled={props.disabled}
      title={props.title}
      data-testid={props['data-testid']}
      onCheckedChange={(next) => { if (!props.disabled) props.onCheckedChange?.(next === true) }}
    >
      {itemMarkup(props)}
    </Dropdown.CheckboxItem>
  )
}

export function MenuSub(props: { children?: ReactNode }) {
  return <Dropdown.Sub>{props.children}</Dropdown.Sub>
}

export function MenuSubTrigger(props: MenuItemProps) {
  return (
    <Dropdown.SubTrigger
      className={cx('dsh-menu__item', props.className)}
      disabled={props.disabled}
      title={props.title}
      data-testid={props['data-testid']}
    >
      {itemMarkup(props)}
      <span className="dsh-menu__sub-arrow" aria-hidden="true"><ChevronRightIcon size="sm" /></span>
    </Dropdown.SubTrigger>
  )
}

export function MenuSubContent(props: { children?: ReactNode; 'aria-label'?: string; className?: string }) {
  const container = useDshPortalContainer()
  const content = (
    <Dropdown.SubContent className={cx('dsh-menu', props.className)} collisionPadding={8} aria-label={props['aria-label']}>
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
      className={cx('dsh-menu__item', props.className)}
      data-tone={props.tone === 'danger' ? 'danger' : undefined}
      disabled={props.disabled}
      title={props.title}
      data-testid={props['data-testid']}
      onSelect={props.onSelect}
    >
      {itemMarkup(props)}
    </Context.Item>
  )
}

export function ContextMenuSeparator(props: { className?: string }) {
  return <Context.Separator className={cx('dsh-menu__separator', props.className)} />
}
