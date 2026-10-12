import * as SwitchPrimitive from '@radix-ui/react-switch'
import { forwardRef, type ReactNode } from 'react'
import { Kbd } from './kbd.tsx'
import { cx } from './shared.ts'
import './switch.styles.ts'

/*
 * 整行是 <label>：点击行内任意位置都切换；最小行高 40px 保证命中区。
 * 开关本体 36x20px（styles）。
 */
export const Switch = forwardRef<HTMLButtonElement, {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?(checked: boolean): void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
  shortcut?: ReactNode
  className?: string
  id?: string
}>(function Switch(props, ref) {
  return (
    <label className={cx('dsh-switch-row', props.className)} data-disabled={props.disabled || undefined} htmlFor={props.id}>
      <span className="dsh-switch-row__text">
        <span className="dsh-switch-row__label">{props.label}</span>
        {props.description ? <span className="dsh-switch-row__desc">{props.description}</span> : null}
      </span>
      {props.shortcut ? <Kbd className="dsh-switch-row__kbd">{props.shortcut}</Kbd> : null}
      <SwitchPrimitive.Root
        ref={ref}
        id={props.id}
        className="dsh-switch"
        checked={props.checked}
        defaultChecked={props.defaultChecked}
        onCheckedChange={props.onCheckedChange}
        disabled={props.disabled}
      >
        <SwitchPrimitive.Thumb className="dsh-switch__thumb" />
      </SwitchPrimitive.Root>
    </label>
  )
})
