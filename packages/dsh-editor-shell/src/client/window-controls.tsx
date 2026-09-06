import { createElement as e, useEffect, useState } from 'react'

/*
 * 自绘窗口控制（无框窗口）。preload.cjs 在桌面端暴露 window.dshWindow;
 * 浏览器/dev:web 里不存在,返回 null 不渲染。
 */
/** 主进程代理 GitHub Releases 的更新检查结果:status/当前版本/最新版本信息或错误。 */
export type UpdateAsset = { name: string; url: string; size: number }
export type UpdateCheckResult = {
  status: 'latest' | 'update-available' | 'error'
  currentVersion: string
  latest?: {
    version: string; tag: string; name: string; publishedAt: string; url: string; body: string
    /** 当前平台对应的安装包;为 null 时只能走浏览器「前往下载」。 */
    asset?: UpdateAsset | null
  }
  error?: string
}
/** 一键下载的进度推送:phase=downloading/verifying/done,mirror 为当前下载源。 */
export type UpdateProgress = { phase: 'downloading' | 'verifying' | 'done'; received: number; total: number; mirror: string }

type WindowBridge = {
  minimize(): void
  toggleMaximize(): void
  close(): void
  /** 桌面端经主进程白名单校验后用系统浏览器打开;浏览器端无此方法,回退 window.open。 */
  openExternal?(url: string): void
  /** 主进程返回当前应用名、版本与平台形态;开发模式或浏览器端无此方法,UI 需走 "开发模式" 兜底。 */
  getAppInfo?(): Promise<{ name: string; version: string; platform: string; portable: boolean }>
  /** 主进程代理 GitHub Releases 探活,避开渲染端 CSP。返回 status/最新版本信息或错误。 */
  checkForUpdate?(): Promise<UpdateCheckResult>
  /** 启动时主进程在后台完成的更新检查;渲染端挂载后拉取,仅 update-available 时提示。 */
  getStartupUpdate?(): Promise<UpdateCheckResult>
  /** 一键下载更新(镜像优先、直连兜底),完成后返回本地文件路径;失败抛出汇总错误。 */
  downloadUpdate?(asset: UpdateAsset): Promise<{ path: string }>
  cancelUpdateDownload?(): Promise<void>
  /** 安装已下载的更新:Windows 退出并替换/运行安装器,mac 仅打开所在文件夹。 */
  installUpdate?(path: string): Promise<'restarting' | 'revealed'>
  /** 订阅下载进度;返回退订函数。 */
  onUpdateProgress?(listener: (progress: UpdateProgress) => void): () => void
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
