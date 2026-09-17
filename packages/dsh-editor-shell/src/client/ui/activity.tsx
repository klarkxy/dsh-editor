import { Skeleton, Spinner } from '@radix-ui/themes'
import type { ReactNode } from 'react'

/* 统一活动反馈原语:加载 / 等待 / 进行中 / 完成。
   ActivityRing / ActivitySkeleton 用 Themes Spinner / Skeleton。
   点、微光、完成勾仍是纯 CSS,配色走 Radix 变量;关键帧在 styles.ts。
   装饰元素一律 aria-hidden,reduced-motion 由全局媒体查询停掉循环。 */

export type ActivityCue = 'dots' | 'typing' | 'ring' | 'none'

/** 三点指示:pulse=呼吸明灭(忙碌/等待),typing=起伏跳动(回复/思考中)。 */
export function ActivityDots(props: { variant?: 'pulse' | 'typing'; className?: string }) {
  const variant = props.variant ?? 'pulse'
  return (
    <span
      className={['activity-dots', `is-${variant}`, props.className].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      <i /><i /><i />
    </span>
  )
}

/** 圆环:确定性检查 / 导入 / 启动等块状等待。Themes Spinner 承担旋转。 */
export function ActivityRing(props: { size?: number; className?: string }) {
  return (
    <Spinner
      className={['activity-ring', props.className].filter(Boolean).join(' ')}
      style={props.size ? { width: props.size, height: props.size } : undefined}
      aria-hidden="true"
    />
  )
}

/** 单行微光扫过:整页/整区等待时给视线一个锚点。 */
export function ActivityShimmer(props: { className?: string }) {
  return (
    <span className={['activity-shimmer', props.className].filter(Boolean).join(' ')} aria-hidden="true">
      <i />
    </span>
  )
}

const SKELETON_WIDTHS = ['100%', '88%', '96%', '72%', '84%', '60%']

/** 稳定骨架行:形状贴合即将出现的内容,替换时不改布局。 */
export function ActivitySkeleton(props: { lines?: number; className?: string }) {
  const lines = Math.max(1, props.lines ?? 3)
  return (
    <span className={['activity-skeleton', props.className].filter(Boolean).join(' ')} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          style={{ width: SKELETON_WIDTHS[index % SKELETON_WIDTHS.length], height: 10 }}
        />
      ))}
    </span>
  )
}

/** 状态句:role=status + aria-live,前置活动暗示,淡入不位移。 */
export function ActivityText(props: {
  cue?: ActivityCue
  role?: 'status' | 'alert'
  className?: string
  children?: ReactNode
}) {
  const cue = props.cue ?? 'dots'
  const role = props.role ?? 'status'
  return (
    <span
      className={['activity-text', props.className].filter(Boolean).join(' ')}
      role={role}
      aria-live={role === 'alert' ? undefined : 'polite'}
    >
      {cue === 'ring' ? <ActivityRing /> : cue === 'typing' ? <ActivityDots variant="typing" /> : cue === 'dots' ? <ActivityDots /> : null}
      <span className="activity-text-label">{props.children}</span>
    </span>
  )
}

/** 完成勾:一次性描边收尾。 */
export function SuccessMark(props: { className?: string }) {
  return (
    <svg className={['success-mark', props.className].filter(Boolean).join(' ')} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M7 17.5 L13.5 24 L25 9.5" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
