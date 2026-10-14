import { forwardRef, type HTMLAttributes } from 'react'
import { cx } from './shared.ts'
import './progress.styles.ts'

/*
 * 进度条（原稿）：语义化 progressbar —— track 用 sunken 底，fill 用 accent。
 * value/max 语义与 Radix Progress 一致（0..max 归一化到百分比宽度）。
 */
export const Progress = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
  value?: number | null
  max?: number
}>(function Progress(props, ref) {
  const { value, max = 100, className, ...rest } = props
  const percent = value == null ? null : Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div
      ref={ref}
      {...rest}
      role="progressbar"
      className={cx('dsh-progress', className)}
      aria-valuemin={props['aria-valuemin'] ?? 0}
      aria-valuemax={props['aria-valuemax'] ?? max}
      aria-valuenow={props['aria-valuenow'] ?? value ?? undefined}
      data-state={percent === null ? 'indeterminate' : 'determinate'}
    >
      <div className="dsh-progress__fill" style={percent === null ? undefined : { width: `${percent}%` }} />
    </div>
  )
})
