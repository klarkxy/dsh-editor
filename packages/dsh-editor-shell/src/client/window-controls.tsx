import { useEffect, useState, type ReactNode } from 'react';
import { Flex, IconButton } from '@radix-ui/themes'
import { t } from '../i18n/index.ts'

/*
 * 自绘窗口控制（无框窗口）。preload.cjs 在桌面端暴露 window.dshWindow;
 * 浏览器/dev:web 里不存在,返回 null 不渲染。
 */
/** 主进程代理 GitHub Releases 的更新检查结果:status/当前版本/最新版本信息或错误。 */
export type UpdateAsset = { id: string; name: string; size: number }
export type UpdateCheckResult = {
  status: 'latest' | 'update-available' | 'error'
  currentVersion: string
  latest?: {
    version: string; tag: string; name: string; publishedAt: string; url: string; body: string
    /** 当前平台对应的安装包;为 null 时只能走浏览器「前往下载」。 */
    asset?: UpdateAsset | null
    installBlockedReason?: 'missing-integrity' | 'no-matching-asset'
  }
  error?: string
}
/** 一键下载的进度推送:phase=downloading/verifying/done,mirror 为当前下载源。 */
export type UpdateProgress = { phase: 'downloading' | 'verifying' | 'done'; received: number; total: number; mirror: string; updateId?: string }
/** filePath is display-only. No IPC accepts a renderer-provided path. */
export type DownloadedUpdateInfo = { updateId: string; filePath?: string }

type WindowBridge = {
  minimize(): void
  toggleMaximize(): void
  close(): void
  /** 桌面端退出确认:上报编辑器是否仍有进行中的 AI 任务;浏览器端无此方法。 */
  reportActivity?(activity: { busy: boolean }): void
  /** 桌面端经主进程白名单校验后用系统浏览器打开;浏览器端无此方法,回退 window.open。 */
  openExternal?(url: string): void
  /** 主进程返回当前应用名、版本与平台形态;开发模式或浏览器端无此方法,UI 需走 t('about.devMode') 兜底。 */
  getAppInfo?(): Promise<{ name: string; version: string; platform: string; portable: boolean }>
  /** 主进程代理 GitHub Releases 探活,避开渲染端 CSP。返回 status/最新版本信息或错误。 */
  checkForUpdate?(): Promise<UpdateCheckResult>
  /** 启动时主进程在后台完成的更新检查;渲染端挂载后拉取,仅 update-available 时提示。 */
  getStartupUpdate?(): Promise<UpdateCheckResult>
  /** 按主进程签发的 updateId 下载;渲染端不能指定 URL 或落盘路径。 */
  downloadUpdate?(updateId: string): Promise<DownloadedUpdateInfo>
  getDownloadedUpdate?(updateId: string): Promise<DownloadedUpdateInfo | null>
  revealDownloadedUpdate?(updateId: string): Promise<void>
  openUpdateFolder?(): Promise<void>
  cancelUpdateDownload?(): Promise<void>
  /** 安装已下载并复验过的更新:Windows 退出并替换/运行安装器,mac 仅打开所在文件夹。 */
  installUpdate?(updateId: string): Promise<'restarting' | 'revealed'>
  /** 订阅下载进度;返回退订函数。 */
  onUpdateProgress?(listener: (progress: UpdateProgress) => void): () => void
  onMaximizedChange?(listener: (maximized: boolean) => void): () => void
  clipboard?: {
    readText(): Promise<string>
    writeText(text: string): Promise<void>
  }
}

export function windowBridge(): WindowBridge | undefined {
  return (globalThis as { dshWindow?: WindowBridge }).dshWindow
}

/** 双击拖拽区（非交互元素）时切换最大化。 */
export function titleBarDoubleClick(event: { target: unknown }): void {
  if (event.target instanceof HTMLElement && event.target.closest('button,summary,a,input,select,textarea,[contenteditable],[role="listbox"],.select')) return
  windowBridge()?.toggleMaximize()
}

/** 窗口控制用与 icons.tsx 一致的描边 SVG，替代 Unicode 字形（CJK 字体下 ❐/▢ 有缺字风险）。 */
function WindowGlyph(props: { children?: ReactNode }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false">
      {props.children}
    </svg>
  )
}

export function WindowControls() {
  const bridge = windowBridge()
  const [maximized, setMaximized] = useState(false)
  useEffect(() => bridge?.onMaximizedChange?.(setMaximized), [bridge])
  if (!bridge) return null
  return (
    <Flex className="window-controls" align="center" flexShrink="0">
      <IconButton
        type="button"
        variant="ghost"
        color="gray"
        size="2"
        radius="none"
        aria-label={t('window.minimize')}
        onClick={() => bridge.minimize()}>
        <WindowGlyph>
          <path d="M2 6h8" />
        </WindowGlyph>
      </IconButton>
      <IconButton
        type="button"
        variant="ghost"
        color="gray"
        size="2"
        radius="none"
        aria-label={maximized ? t('window.restore') : t('window.maximize')}
        onClick={() => bridge.toggleMaximize()}>
        {maximized
          ? <WindowGlyph>
            <path d="M2 5h5v5H2z" />
            <path d="M5 5V2h5v5H7" />
          </WindowGlyph>
          : <WindowGlyph>
            <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
          </WindowGlyph>}
      </IconButton>
      <IconButton
        type="button"
        className="window-close"
        variant="ghost"
        color="gray"
        size="2"
        radius="none"
        aria-label={t('window.close')}
        onClick={() => bridge.close()}>
        <WindowGlyph>
          <path d="M3 3l6 6M9 3l-6 6" />
        </WindowGlyph>
      </IconButton>
    </Flex>
  );
}
