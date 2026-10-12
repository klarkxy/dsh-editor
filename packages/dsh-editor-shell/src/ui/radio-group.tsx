import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { forwardRef } from 'react'
import { cx } from './shared.ts'
import './radio-group.styles.ts'

export type RadioOption = { value: string; label: string; description?: string; disabled?: boolean }

export const RadioGroup = forwardRef<HTMLDivElement, {
  value?: string
  defaultValue?: string
  onValueChange?(value: string): void
  options: RadioOption[]
  'aria-label'?: string
  disabled?: boolean
  className?: string
  name?: string
}>(function RadioGroup(props, ref) {
  return (
    <RadioGroupPrimitive.Root
      ref={ref}
      className={cx('dsh-radio-group', props.className)}
      value={props.value}
      defaultValue={props.defaultValue}
      onValueChange={props.onValueChange}
      disabled={props.disabled}
      aria-label={props['aria-label']}
      name={props.name}
    >
      {props.options.map((option) => (
        <label key={option.value} className="dsh-radio-row" data-disabled={(props.disabled || option.disabled) || undefined}>
          <RadioGroupPrimitive.Item
            className="dsh-radio"
            value={option.value}
            disabled={props.disabled || option.disabled}
            id={`${props.name ?? 'radio'}-${option.value}`}
          >
            <RadioGroupPrimitive.Indicator className="dsh-radio__indicator" />
          </RadioGroupPrimitive.Item>
          <span className="dsh-radio-row__text">
            <span className="dsh-radio-row__label">{option.label}</span>
            {option.description ? <span className="dsh-radio-row__desc">{option.description}</span> : null}
          </span>
        </label>
      ))}
    </RadioGroupPrimitive.Root>
  )
})
