import type { ReactNode } from 'react'
import { cx } from './shared.ts'
import './empty-state.styles.ts'

export function EmptyState(props: {
  title: ReactNode
  body?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('dsh-empty-state', props.className)}>
      <span className="dsh-empty-state__title">{props.title}</span>
      {props.body ? <span className="dsh-empty-state__body">{props.body}</span> : null}
      {props.actions ? <span className="dsh-empty-state__actions">{props.actions}</span> : null}
    </div>
  )
}
