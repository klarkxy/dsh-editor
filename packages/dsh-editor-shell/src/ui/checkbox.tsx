import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { forwardRef, type ReactNode } from 'react'
import { CheckIcon } from './icons.tsx'
import { cx } from './shared.ts'
import './checkbox.styles.ts'

export const Checkbox = forwardRef<HTMLButtonElement, {
  checked?: boolean | 'indeterminate'
  defaultChecked?: boolean
  onCheckedChange?(checked: boolean | 'indeterminate'): void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
  className?: string
  id?: string
}>(function Checkbox(props, ref) {
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
          <CheckIcon size="sm" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span className="dsh-checkbox-row__text">
        <span className="dsh-checkbox-row__label">{props.label}</span>
        {props.description ? <span className="dsh-checkbox-row__desc">{props.description}</span> : null}
      </span>
    </label>
  )
})
