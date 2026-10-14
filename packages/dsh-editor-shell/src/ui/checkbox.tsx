import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { forwardRef, type ReactNode } from 'react'
import { CheckIcon, MinusIcon } from './icons.tsx'
import { cx } from './shared.ts'
import './checkbox.styles.ts'

export const Checkbox = forwardRef<HTMLButtonElement, {
  checked?: boolean | 'indeterminate'
  defaultChecked?: boolean
  onCheckedChange?(checked: boolean | 'indeterminate'): void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
  className?: string
  id?: string
}>(function Checkbox(props, ref) {
  const control = (
    <CheckboxPrimitive.Root
      ref={ref}
      id={props.id}
      className="dsh-checkbox"
      checked={props.checked}
      defaultChecked={props.defaultChecked}
      onCheckedChange={props.onCheckedChange}
      disabled={props.disabled}
    >
      <CheckboxPrimitive.Indicator className="dsh-checkbox__indicator">
        {/* 两种字形都渲染，由根节点 data-state 决定谁可见（半选是横杠）。 */}
        <CheckIcon size="sm" className="dsh-checkbox__glyph dsh-checkbox__glyph--check" />
        <MinusIcon size="sm" className="dsh-checkbox__glyph dsh-checkbox__glyph--minus" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
  if (props.label === undefined && props.description === undefined) {
    return <span className={props.className}>{control}</span>
  }
  return (
    <label className={cx('dsh-checkbox-row', props.className)} data-disabled={props.disabled || undefined} htmlFor={props.id}>
      <CheckboxPrimitive.Root
        ref={ref}
        id={props.id}
        className="dsh-checkbox"
        checked={props.checked}
        defaultChecked={props.defaultChecked}
        onCheckedChange={props.onCheckedChange}
        disabled={props.disabled}
      >
        <CheckboxPrimitive.Indicator className="dsh-checkbox__indicator">
          {/* 两种字形都渲染，由根节点 data-state 决定谁可见（半选是横杠）。 */}
          <CheckIcon size="sm" className="dsh-checkbox__glyph dsh-checkbox__glyph--check" />
          <MinusIcon size="sm" className="dsh-checkbox__glyph dsh-checkbox__glyph--minus" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span className="dsh-checkbox-row__text">
        <span className="dsh-checkbox-row__label">{props.label}</span>
        {props.description ? <span className="dsh-checkbox-row__desc">{props.description}</span> : null}
      </span>
    </label>
  )
})
