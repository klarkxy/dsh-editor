import type { ReactNode } from 'react'
import { cx } from './shared.ts'
import './kbd.styles.ts'

/** 12px 快捷键提示，`line-strong` 描边。 */
export function Kbd(props: { children?: ReactNode; className?: string }) {
  return <kbd className={cx('dsh-kbd', props.className)}>{props.children}</kbd>
}
