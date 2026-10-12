import { forwardRef, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'
import { cx } from './shared.ts'
import './textarea.styles.ts'

const LINE = 21 // 14px × 1.5

export type TextAreaProps = {
  minRows?: number
  maxRows?: number
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value' | 'rows'> & {
  value?: string
  onChange?(value: string): void
}

/** minRows/maxRows 之间随内容自动增高。 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(props, ref) {
  const { minRows = 2, maxRows = 8, className, onChange, value, ...rest } = props
  const inner = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    el.style.height = 'auto'
    const min = minRows * LINE
    const max = maxRows * LINE
    el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [value, minRows, maxRows])
  return (
    <textarea
      ref={(node) => {
        inner.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) (ref as { current: HTMLTextAreaElement | null }).current = node
      }}
      className={cx('dsh-textarea', className)}
      rows={minRows}
      value={value}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      {...rest}
    />
  )
})
