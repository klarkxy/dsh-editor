import { m, useReducedMotion } from 'motion/react'

export { m }

export type ChromeMotionKind = 'card' | 'panel' | 'page'
/* Panel 入场方向:侧栏从左、聊天下拉从右、设置/首页内容从下。 */
export type PanelDirection = 'left' | 'right' | 'up' | 'down'

/*
 * 统一的 chrome 入场词汇表。位移给足(卡片 24px / 面板 24px / 页面 16px),
 * 卡片与页面带 scale + blur,spring 阻尼刻意放低让回弹肉眼可见。
 * prefers-reduced-motion 时返回静止最终态(initial: false,零时长),
 * hover/tap 反馈一并关闭。
 * 聊天条目入场不走这里:用 styles.ts 的 .chat-row-enter / shell-message-in。
 */
export function useChromeMotion(kind: ChromeMotionKind, delay = 0, direction: PanelDirection = 'up') {
  const reduce = useReducedMotion()
  if (reduce) {
    return {
      initial: false as const,
      animate: { opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)' },
      transition: { duration: 0 },
      whileHover: undefined,
      whileTap: undefined,
    }
  }
  if (kind === 'card') {
    return {
      initial: { opacity: 0, y: 24, scale: 0.96, filter: 'blur(4px)' },
      animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' },
      whileHover: { y: -3, scale: 1.015 },
      whileTap: { scale: 0.97, y: -1 },
      /* blur 不走弹簧：欠阻尼回弹会把 filter 插值成负数，Chromium 会报
         invalid keyframe console error;blur 用单调 tween,观感不变。 */
      transition: {
        type: 'spring' as const, stiffness: 340, damping: 21, mass: 0.85, delay,
        filter: { type: 'tween' as const, duration: 0.45, ease: 'easeOut', delay },
      },
    }
  }
  if (kind === 'panel') {
    const offset = direction === 'left' ? { x: -24, y: 0 }
      : direction === 'right' ? { x: 24, y: 0 }
        : direction === 'down' ? { x: 0, y: -24 }
          : { x: 0, y: 24 }
    return {
      initial: { opacity: 0, ...offset, filter: 'blur(3px)' },
      animate: { opacity: 1, x: 0, y: 0, filter: 'blur(0px)' },
      whileHover: undefined,
      whileTap: undefined,
      /* 同 card:blur 走 tween,避免弹簧过冲出负值。 */
      transition: {
        type: 'spring' as const, stiffness: 320, damping: 24, mass: 0.9, delay,
        filter: { type: 'tween' as const, duration: 0.4, ease: 'easeOut', delay },
      },
    }
  }
  if (kind === 'page') {
    /* 设置页/首页内容:16px 纵向位移 + crossfade + 轻 blur。 */
    return {
      initial: { opacity: 0, y: 16, filter: 'blur(3px)' },
      animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
      whileHover: undefined,
      whileTap: undefined,
      /* 同 card:blur 走 tween,避免弹簧过冲出负值。 */
      transition: {
        type: 'spring' as const, stiffness: 360, damping: 26, mass: 0.85, delay,
        filter: { type: 'tween' as const, duration: 0.4, ease: 'easeOut', delay },
      },
    }
  }
  throw new Error(`unknown chrome motion kind: ${String(kind)}`)
}
