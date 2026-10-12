import type { ReactNode } from 'react'
import { cx } from './shared.ts'
import { CheckIcon, CrossIcon, InfoIcon, WarningIcon } from './icons.tsx'
import './notice.styles.ts'

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger'

const ICONS: Record<NoticeTone, ReactNode> = {
  info: <InfoIcon />,
  success: <CheckIcon />,
  warning: <WarningIcon />,
  danger: <CrossIcon />,
}

/** danger / warning 用 role="alert"，其余 role="status"；图标与文字同时呈现。 */
export function Notice(props: {
  tone?: NoticeTone
  title?: ReactNode
  action?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const tone = props.tone ?? 'info'
  const role = tone === 'danger' || tone === 'warning' ? 'alert' : 'status'
  return (
    <div className={cx('dsh-notice', props.className)} data-tone={tone} role={role}>
      <span className="dsh-notice__icon">{ICONS[tone]}</span>
      <span className="dsh-notice__body">
        {props.title ? <span className="dsh-notice__title">{props.title}</span> : null}
        {props.children ? <span className="dsh-notice__text">{props.children}</span> : null}
      </span>
      {props.action ? <span className="dsh-notice__action">{props.action}</span> : null}
    </div>
  )
}
