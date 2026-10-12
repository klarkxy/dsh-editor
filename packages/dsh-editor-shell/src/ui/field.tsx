import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import { cx } from './shared.ts'
import './field.styles.ts'

/** label/htmlFor + description/error 的 aria-describedby 关联；error 用 role="alert"。 */
export function Field(props: {
  label: ReactNode
  description?: ReactNode
  error?: ReactNode
  children: ReactElement
  className?: string
}) {
  const id = useId()
  const descId = `${id}-desc`
  const errId = `${id}-err`
  const describedBy = [props.description ? descId : null, props.error ? errId : null].filter(Boolean).join(' ') || undefined
  const child = isValidElement(props.children)
    ? cloneElement(props.children, {
      id,
      'aria-describedby': describedBy,
      'aria-invalid': props.error ? true : undefined,
    } as Record<string, unknown>)
    : props.children
  return (
    <div className={cx('dsh-field', props.className)}>
      <label className="dsh-field__label" htmlFor={id}>{props.label}</label>
      {props.description ? <span className="dsh-field__desc" id={descId}>{props.description}</span> : null}
      {child}
      {props.error ? <span className="dsh-field__error" id={errId} role="alert">{props.error}</span> : null}
    </div>
  )
}
