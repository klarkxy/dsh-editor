import type { ReactNode } from 'react'
import { cx } from './shared.ts'
import './list-row.styles.ts'

export function ListRow(props: {
  leading?: ReactNode
  label: ReactNode
  meta?: ReactNode
  trailing?: ReactNode
  selected?: boolean
  onSelect?(): void
  density?: 'compact' | 'regular'
  className?: string
  'data-testid'?: string
  'data-warn'?: boolean
}) {
  const interactive = Boolean(props.onSelect)
  return (
    <div
      className={cx('dsh-list-row', props.className)}
      data-density={props.density ?? 'regular'}
      data-selected={props.selected || undefined}
      data-testid={props['data-testid']}
      data-warn={props['data-warn'] || undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-current={props.selected ? 'page' : undefined}
      onClick={props.onSelect}
      onKeyDown={interactive ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          props.onSelect?.()
        }
      } : undefined}
    >
      {props.leading ? <span className="dsh-list-row__leading">{props.leading}</span> : null}
      <span className="dsh-list-row__label">{props.label}</span>
      {props.meta ? <span className="dsh-list-row__meta">{props.meta}</span> : null}
      {props.trailing ? <span className="dsh-list-row__trailing">{props.trailing}</span> : null}
    </div>
  )
}
