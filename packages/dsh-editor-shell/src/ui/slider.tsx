import * as SliderPrimitive from '@radix-ui/react-slider'
import { forwardRef, type ReactNode } from 'react'
import { cx } from './shared.ts'
import './slider.styles.ts'

export const Slider = forwardRef<HTMLSpanElement, {
  value?: number[]
  defaultValue?: number[]
  min?: number
  max?: number
  step?: number
  onValueChange?(value: number[]): void
  label?: ReactNode
  format?(value: number): string
  disabled?: boolean
  className?: string
  'aria-label'?: string
}>(function Slider(props, ref) {
  const value = props.value ?? props.defaultValue
  return (
    <span className={cx('dsh-slider-row', props.className)}>
      {props.label ? <span className="dsh-slider-row__label">{props.label}</span> : null}
      <SliderPrimitive.Root
        ref={ref}
        className="dsh-slider"
        value={props.value}
        defaultValue={props.defaultValue}
        min={props.min}
        max={props.max}
        step={props.step}
        onValueChange={props.onValueChange}
        disabled={props.disabled}
        aria-label={props['aria-label'] ?? (typeof props.label === 'string' ? props.label : undefined)}
      >
        <SliderPrimitive.Track className="dsh-slider__track">
          <SliderPrimitive.Range className="dsh-slider__range" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="dsh-slider__thumb" />
      </SliderPrimitive.Root>
      {props.format && value?.length ? <span className="dsh-slider-row__value">{props.format(value[0])}</span> : null}
    </span>
  )
})
