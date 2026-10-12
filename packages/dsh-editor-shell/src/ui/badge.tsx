import type { ReactNode } from 'react'
import { cx } from './shared.ts'
import './badge.styles.ts'

export function Badge(props: {
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  children?: ReactNode
  className?: string
}) {
  return <span className={cx('dsh-badge', props.className)} data-tone={props.tone ?? 'neutral'}>{props.children}</span>
}
