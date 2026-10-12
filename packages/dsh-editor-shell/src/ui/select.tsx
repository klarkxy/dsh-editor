import * as SelectPrimitive from '@radix-ui/react-select'
import { forwardRef } from 'react'
import { CheckIcon, ChevronDownIcon } from './icons.tsx'
import { cx, useDshPortalContainer } from './shared.ts'
import './select.styles.ts'

export type SelectOption = { value: string; label: string; description?: string; disabled?: boolean }

export const Select = forwardRef<HTMLButtonElement, {
  value?: string
  onValueChange?(value: string): void
  options: SelectOption[]
  placeholder?: string
  size?: 'sm' | 'md'
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?(open: boolean): void
  'aria-label'?: string
  disabled?: boolean
  className?: string
}>(function Select(props, ref) {
  const container = useDshPortalContainer()
  return (
    <SelectPrimitive.Root
      value={props.value}
      onValueChange={props.onValueChange}
      open={props.open}
      defaultOpen={props.defaultOpen}
      onOpenChange={props.onOpenChange}
      disabled={props.disabled}
    >
      <SelectPrimitive.Trigger
        ref={ref}
        className={cx('dsh-select', props.className)}
        data-size={props.size ?? 'md'}
        aria-label={props['aria-label']}
      >
        <SelectPrimitive.Value placeholder={props.placeholder} />
        <SelectPrimitive.Icon className="dsh-select__icon"><ChevronDownIcon size="sm" /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      {(() => {
        const content = (
          <SelectPrimitive.Content className="dsh-menu" position="popper" sideOffset={4}>
            <SelectPrimitive.Viewport className="dsh-menu__viewport">
              {props.options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="dsh-menu__item"
                >
                  <SelectPrimitive.ItemIndicator className="dsh-menu__check"><CheckIcon size="sm" /></SelectPrimitive.ItemIndicator>
                  <span className="dsh-menu__item-body">
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    {option.description ? <span className="dsh-menu__item-desc">{option.description}</span> : null}
                  </span>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        )
        return container ? <SelectPrimitive.Portal container={container}>{content}</SelectPrimitive.Portal> : content
      })()}
    </SelectPrimitive.Root>
  )
})
