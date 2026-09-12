import { createElement as e, type ChangeEvent, type ComponentType } from 'react'
import type { ShellSelectProps } from 'dsh-editor-seats'

export function renderSelect(
  Select: ComponentType<ShellSelectProps> | undefined,
  props: ShellSelectProps,
) {
  if (Select) return e(Select, props)
  return e('select', {
    className: 'overview-status-select',
    value: props.value,
    disabled: props.disabled,
    'aria-label': props['aria-label'],
    onChange: (event: ChangeEvent<HTMLSelectElement>) => props.onChange(event.target.value),
  }, ...props.options.map((option) => e('option', {
    key: option.value === '' ? '__empty' : option.value,
    value: option.value,
  }, option.label)))
}
