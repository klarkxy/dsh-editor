import type { ReactNode } from 'react'
import { ChevronDownIcon } from './icons.tsx'
import { Menu, MenuContent, MenuItem, MenuTrigger } from './menu.tsx'
import { cx } from './shared.ts'
import './split-button.styles.ts'

export type SplitButtonItem = { label: string; onSelect?(): void; shortcut?: string; disabled?: boolean; title?: string }

export function SplitButton(props: {
  label: ReactNode
  onClick(): void
  menuLabel: string
  items: SplitButtonItem[]
  disabled?: boolean
  variant?: 'primary' | 'secondary'
  className?: string
}) {
  return (
    <span className={cx('dsh-split', props.className)} data-variant={props.variant ?? 'primary'}>
      <button type="button" className="dsh-split__main" onClick={props.onClick} disabled={props.disabled}>
        {props.label}
      </button>
      <Menu>
        <MenuTrigger>
          <button type="button" className="dsh-split__trigger" aria-label={props.menuLabel} disabled={props.disabled}>
            <ChevronDownIcon size="sm" />
          </button>
        </MenuTrigger>
        <MenuContent aria-label={props.menuLabel}>
          {props.items.map((item) => (
            <MenuItem key={item.label} shortcut={item.shortcut} disabled={item.disabled} title={item.title} onSelect={item.onSelect}>{item.label}</MenuItem>
          ))}
        </MenuContent>
      </Menu>
    </span>
  )
}
