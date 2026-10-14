import type { CSSProperties } from 'react'
import { cx } from './shared.ts'
import './spinner.styles.ts'

/** 减少动态效果时静止（styles 内 media 查询关闭动画）。 */
export function Spinner(props: { className?: string; style?: CSSProperties }) {
  return <span className={cx('dsh-spinner', props.className)} style={props.style} role="progressbar" aria-hidden="true" />
}

/** 移植自旧 ActivityDots：三点加载提示。 */
export function ActivityDots(props: { className?: string }) {
  return (
    <span className={cx('dsh-activity-dots', props.className)} aria-hidden="true">
      <i /><i /><i />
    </span>
  )
}
