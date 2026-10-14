import { forwardRef, type ReactNode } from 'react'
import {
  Menu as InternalMenu,
  MenuCheckboxItem as InternalMenuCheckboxItem,
  MenuContent as InternalMenuContent,
  MenuItem as InternalMenuItem,
  MenuLabel as InternalMenuLabel,
  MenuSeparator as InternalMenuSeparator,
  MenuSub as InternalMenuSub,
  MenuSubContent as InternalMenuSubContent,
  MenuSubTrigger as InternalMenuSubTrigger,
  MenuTrigger as InternalMenuTrigger,
} from '../../ui/menu.tsx'
import { Button } from '../../ui/button.tsx'

/*
 * 旧壳层菜单包装（client/ui 契约）：行为与可访问性不变，内部改走
 * src/ui/ 的 dsh-menu 原语。dsh-menu__item 已含图标/快捷键排版，
 * 这里的 props 原样透传，data-danger → tone="danger"。
 */

export type MenuProps = {
  open?: boolean
  onOpenChange?(open: boolean): void
  children?: ReactNode
  modal?: boolean
}

export function Menu(props: MenuProps) {
  return <InternalMenu open={props.open} onOpenChange={props.onOpenChange} modal={props.modal}>{props.children}</InternalMenu>
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
    <InternalMenuTrigger>
      <Button
        ref={ref}
        type="button"
        variant="ghost"
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
    </InternalMenuTrigger>
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
    <InternalMenuContent
      id={props.id}
      className={props.className ?? 'menu-content'}
      align={props.align}
      side={props.side}
      sideOffset={props.sideOffset}
      aria-label={props['aria-label']}
      onCloseAutoFocus={props.onCloseAutoFocus}
    >
      {props.children}
    </InternalMenuContent>
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
  checked?: boolean
  onSelect?(): void
}) {
  return (
    <InternalMenuItem
      className={props.className}
      disabled={props.disabled}
      title={props.title}
      role={props.role}
      tone={props['data-danger'] === 'true' || props['data-danger'] === '' || props.className?.split(/\s+/).includes('danger') ? 'danger' : undefined}
      data-danger={props['data-danger']}
      data-testid={props['data-testid']}
      aria-current={props['aria-current']}
      aria-label={props['aria-label']}
      checked={props.checked}
      onSelect={props.onSelect}
    >
      {props.children}
    </InternalMenuItem>
  )
}

export function MenuSeparator(props: { className?: string; 'aria-hidden'?: boolean | 'true' }) {
  return <InternalMenuSeparator className={props.className} />
}

export function MenuSub(props: { children?: ReactNode }) {
  return <InternalMenuSub>{props.children}</InternalMenuSub>
}

export function MenuSubTrigger(props: {
  children?: ReactNode
  disabled?: boolean
  className?: string
  'data-testid'?: string
}) {
  return (
    <InternalMenuSubTrigger className={props.className} disabled={props.disabled} data-testid={props['data-testid']}>
      {props.children}
    </InternalMenuSubTrigger>
  )
}

export function MenuSubContent(props: {
  children?: ReactNode
  className?: string
  'aria-label'?: string
}) {
  return <InternalMenuSubContent className={props.className} aria-label={props['aria-label']}>{props.children}</InternalMenuSubContent>
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
    <InternalMenuCheckboxItem
      className={props.className}
      checked={props.checked}
      disabled={props.disabled}
      data-testid={props['data-testid']}
      onCheckedChange={props.onCheckedChange}
    >
      {props.children}
    </InternalMenuCheckboxItem>
  )
}

export function MenuLabel(props: { children?: ReactNode; className?: string }) {
  return <InternalMenuLabel className={props.className}>{props.children}</InternalMenuLabel>
}
