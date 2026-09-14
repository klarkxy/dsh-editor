import type { ReactNode } from 'react'

/* 统一活动反馈原语:加载 / 等待 / 进行中 / 完成。
   运动参数改写自 Amicro — Micro Transitions(MIT License,
   Copyright (c) 2026 Syed Subhan Uddin):pulse-dots(opacity .2→1→.2,1.4s,
   i×0.2s 交错)、typing-indicator(translateY 0→-4px→0,0.6s ease-in-out,
   i×0.15s 交错)、smooth-ring(r=14 弧 dasharray 38 80,1s linear 旋转)、
   shimmer-line(1/3 宽扫过 -100%→300%,1.5s ease-in-out)、
   fluid-skeleton(光泽扫过 -100%→200%,1.5s linear)。
   配色改用 paper/ink 令牌(currentColor / --accent / --hairline-strong),
   关键帧在 styles.ts(shell-activity-*);装饰元素一律 aria-hidden,
   reduced-motion 由全局媒体查询停掉循环并保留静态可读态。 */

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

/** 圆环弧:确定性检查 / 导入 / 启动等块状等待。 */
export function ActivityRing(props: { size?: number; className?: string }) {
  return (
    <svg
      className={['activity-ring', props.className].filter(Boolean).join(' ')}
      style={props.size ? { width: props.size, height: props.size } : undefined}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <circle className="activity-ring-track" cx="16" cy="16" r="14" fill="none" strokeWidth="3" />
      <circle className="activity-ring-arc" cx="16" cy="16" r="14" fill="none" strokeWidth="3" strokeDasharray="38 80" strokeLinecap="round" />
    </svg>
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
        <i key={index} style={{ width: SKELETON_WIDTHS[index % SKELETON_WIDTHS.length] }} />
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
