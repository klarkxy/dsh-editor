import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import { forwardRef, type ReactNode } from 'react'
import { cx } from './shared.ts'
import './segmented-control.styles.ts'

export type SegmentedOption = { value: string; label: ReactNode; icon?: ReactNode; disabled?: boolean; className?: string; 'aria-label'?: string }

export const SegmentedControl = forwardRef<HTMLDivElement, {
  value?: string
  defaultValue?: string
  onValueChange?(value: string): void
  options: SegmentedOption[]
  'aria-label': string
  disabled?: boolean
  className?: string
}>(function SegmentedControl(props, ref) {
  return (
    <ToggleGroupPrimitive.Root
      ref={ref}
      type="single"
      className={cx('dsh-segmented', props.className)}
      value={props.value}
      defaultValue={props.defaultValue}
      onValueChange={(v) => { if (v) props.onValueChange?.(v) }}
      disabled={props.disabled}
      aria-label={props['aria-label']}
    >
      {props.options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cx('dsh-segmented__item', option.className)}
          aria-label={option['aria-label']}
        >
          {option.icon ? <span className="dsh-segmented__icon">{option.icon}</span> : null}
          {option.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  )
})
