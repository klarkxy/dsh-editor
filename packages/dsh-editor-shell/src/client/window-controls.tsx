import { createElement as e, useEffect, useState } from 'react'

/*
 * 自绘窗口控制（无框窗口）。preload.cjs 在桌面端暴露 window.dshWindow;
 * 浏览器/dev:web 里不存在,返回 null 不渲染。
 */
type WindowBridge = {
  minimize(): void
  toggleMaximize(): void
  close(): void
  /** 桌面端经主进程白名单校验后用系统浏览器打开;浏览器端无此方法,回退 window.open。 */
  openExternal?(url: string): void
  onMaximizedChange?(listener: (maximized: boolean) => void): () => void
}

export function windowBridge(): WindowBridge | undefined {
  return (globalThis as { dshWindow?: WindowBridge }).dshWindow
}

/** 双击拖拽区（非交互元素）时切换最大化。 */
export function titleBarDoubleClick(event: { target: unknown }): void {
  if (event.target instanceof HTMLElement && event.target.closest('button,summary,a,input,select,[role="listbox"],.select')) return
  windowBridge()?.toggleMaximize()
}

export function WindowControls() {
  const bridge = windowBridge()
  const [maximized, setMaximized] = useState(false)
  useEffect(() => bridge?.onMaximizedChange?.(setMaximized), [bridge])
  if (!bridge) return null
  return e('div', { className: 'window-controls' },
    e('button', { type: 'button', 'aria-label': '最小化', onClick: () => bridge.minimize() }, '–'),
    e('button', { type: 'button', 'aria-label': maximized ? '还原窗口' : '最大化窗口', onClick: () => bridge.toggleMaximize() }, maximized ? '❐' : '▢'),
    e('button', { type: 'button', className: 'window-close', 'aria-label': '关闭窗口', onClick: () => bridge.close() }, '×'),
  )
}
