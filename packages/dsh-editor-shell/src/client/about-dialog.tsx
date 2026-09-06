import {
  createElement as e,
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useDialogReturnFocus } from './dialogs.ts'
import { windowBridge } from './window-controls.tsx'

type UpdateStatus = 'latest' | 'update-available' | 'error'
type AppInfo = { name: string; version: string; platform: string; portable: boolean }
type Asset = { name: string; url: string; size: number }
type ReleaseInfo = { version: string; tag: string; name: string; publishedAt: string; url: string; body: string; asset?: Asset | null }
type CheckResult = { status: UpdateStatus; currentVersion: string; latest?: ReleaseInfo; error?: string }

type CheckState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; result: CheckResult; checkedAt: number }

/** 一键下载状态机:idle → downloading → done(待安装)/error(保留浏览器兜底)。 */
type DownloadState =
  | { status: 'idle' }
  | { status: 'downloading'; received: number; total: number; mirror: string; verifying: boolean }
  | { status: 'done'; path: string; revealed: boolean }
  | { status: 'error'; message: string }

const BODY_PREVIEW_CHARS = 500
const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeStyle: 'short' })

function formatPublishedAt(iso: string): string {
  const stamp = Date.parse(iso)
  if (!Number.isFinite(stamp)) return iso
  return DATE_FORMATTER.format(new Date(stamp))
}

function previewBody(body: string): string {
  if (body.length <= BODY_PREVIEW_CHARS) return body
  return `${body.slice(0, BODY_PREVIEW_CHARS)}…`
}

/** IPC 错误带着 "Error invoking remote method …" 包装,剥掉再显示。 */
function cleanIpcError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

/**
 * "关于 DSH Editor" + 检查更新 弹窗。
 *
 * 依赖 `window.dshWindow.getAppInfo` / `window.dshWindow.checkForUpdate` 由桌面端
 * preload 暴露(并行 agent 在改 preload.cjs),浏览器开发模式不存在,自动回退为
 * "开发模式" 标记并禁用检查按钮。
 *
 * useEffect 内的检查请求与对话框 onClose 抢跑:每次发起前记录 token,卸载/关闭
 * 时清理,然后在 setState 之前再核对一次,避免组件已卸载后晚到的结果污染状态。
 */
export function AboutUpdateDialog(props: { onClose(): void }): ReactNode {
  const bridge = windowBridge()
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [state, setState] = useState<CheckState>({ status: 'idle' })
  const [download, setDownload] = useState<DownloadState>({ status: 'idle' })
  const dialog = useRef<HTMLDivElement | null>(null)
  const liveToken = useRef(0)
  useDialogReturnFocus(dialog, () => dialog.current?.querySelector<HTMLButtonElement>('.about-close')?.focus())

  useEffect(() => {
    const token = ++liveToken.current
    const info = bridge?.getAppInfo
    if (!info) { setAppInfo(null); return }
    void info().then((value) => {
      if (liveToken.current !== token) return
      setAppInfo(value)
    }).catch(() => {
      if (liveToken.current !== token) return
      setAppInfo(null)
    })
  }, [bridge])

  const runCheck = async () => {
    const check = bridge?.checkForUpdate
    if (!check) return
    const token = ++liveToken.current
    setState({ status: 'loading' })
    try {
      const result = await check()
      if (liveToken.current !== token) return
      setState({ status: 'ready', result, checkedAt: Date.now() })
    } catch (error) {
      if (liveToken.current !== token) return
      const message = error instanceof Error ? error.message : '检查更新失败'
      setState({
        status: 'ready',
        result: { status: 'error', currentVersion: appInfo?.version ?? '', error: message },
        checkedAt: Date.now(),
      })
    }
  }

  // 打开时自动跑一次;没有桥就不跑(开发模式)。
  useEffect(() => {
    if (!bridge?.checkForUpdate) return
    void runCheck()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge])

  // 下载进度由主进程推送;只在下载进行中消费,晚到的 done 事件以 invoke 结果为准。
  useEffect(() => {
    const onProgress = bridge?.onUpdateProgress
    if (!onProgress) return
    return onProgress((progress) => {
      setDownload((prev) => prev.status === 'downloading'
        ? {
            status: 'downloading',
            received: progress.received,
            total: progress.total,
            mirror: progress.mirror,
            verifying: progress.phase === 'verifying',
          }
        : prev)
    })
  }, [bridge])

  const startDownload = async (asset: Asset) => {
    const downloadUpdate = bridge?.downloadUpdate
    if (!downloadUpdate) return
    const token = ++liveToken.current
    setDownload({ status: 'downloading', received: 0, total: asset.size, mirror: '', verifying: false })
    try {
      const result = await downloadUpdate(asset)
      if (liveToken.current !== token) return
      setDownload({ status: 'done', path: result.path, revealed: false })
    } catch (error) {
      if (liveToken.current !== token) return
      const message = cleanIpcError(error)
      if (message.includes('下载已取消')) { setDownload({ status: 'idle' }); return }
      setDownload({ status: 'error', message })
    }
  }

  const cancelDownload = () => {
    void bridge?.cancelUpdateDownload?.()
  }

  const installDownloaded = async (path: string) => {
    const install = bridge?.installUpdate
    if (!install) return
    try {
      const result = await install(path)
      // 'restarting' 时应用随即退出,无需更新状态;'revealed' 展示手动替换说明。
      if (result === 'revealed') {
        setDownload((prev) => (prev.status === 'done' ? { ...prev, revealed: true } : prev))
      }
    } catch (error) {
      setDownload({ status: 'error', message: cleanIpcError(error) })
    }
  }

  const onOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) props.onClose()
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); props.onClose() }
  }
  const onOpenDownload = (url: string) => {
    if (bridge?.openExternal) { bridge.openExternal(url); return }
    globalThis.open(url, '_blank', 'noopener,noreferrer')
  }

  const hasBridge = Boolean(bridge?.checkForUpdate)
  const versionLabel = appInfo ? `${appInfo.name} ${appInfo.version}` : '开发模式'
  const canCheck = hasBridge

  return e('div', { className: 'file-dialog-overlay', onMouseDown: onOverlayMouseDown },
    e('div', {
      ref: dialog,
      className: 'file-dialog about-dialog',
      role: 'dialog',
      'aria-modal': true,
      'aria-labelledby': 'about-dialog-title',
      onKeyDown,
    },
      e('header', null,
        e('h2', { id: 'about-dialog-title' }, '关于 DSH Editor'),
        e('button', {
          className: 'icon-button about-close',
          type: 'button',
          'aria-label': '关闭',
          onClick: props.onClose,
        }, '×'),
      ),
      e('section', { className: 'about-page' },
        e('div', { className: 'about-header' },
          e('p', { className: 'about-version' },
            e('strong', null, versionLabel),
          ),
          !hasBridge ? e('p', { className: 'about-note' },
            '当前在浏览器开发模式,无法检查更新;请在桌面客户端中打开此窗口。',
          ) : null,
        ),
        e('div', { className: 'about-status' },
          renderStatus(state),
        ),
        renderResultBody(state, download, appInfo, {
          onOpen: onOpenDownload,
          onDownload: (asset) => void startDownload(asset),
          onCancel: cancelDownload,
          onInstall: (path) => void installDownloaded(path),
        }),
        e('p', { className: 'about-note' },
          state.status === 'ready' && state.result.status === 'update-available'
            ? '应用内下载优先走 GitHub 镜像,失败自动回退直连;macOS 下载后需手动替换「应用程序」中的应用。'
            : '更新检查由主进程代理 GitHub Releases,渲染端不直接访问外网。',
        ),
        e('div', { className: 'about-actions' },
          e('button', {
            type: 'button',
            className: 'about-button',
            disabled: !canCheck || state.status === 'loading',
            onClick: () => void runCheck(),
          }, state.status === 'loading' ? '检查中…' : '检查更新'),
          e('button', {
            type: 'button',
            className: 'about-button',
            onClick: props.onClose,
          }, '关闭'),
        ),
      ),
    ),
  )
}

function renderStatus(state: CheckState): ReactNode {
  if (state.status === 'idle') return e('span', null, '尚未检查更新。')
  if (state.status === 'loading') return e('span', null, '正在检查更新…')
  const result = state.result
  if (result.status === 'latest') {
    return e('span', { className: 'about-status-tag latest' }, '已是最新版本')
  }
  if (result.status === 'update-available' && result.latest) {
    return e(Fragment, null,
      e('span', { className: 'about-status-tag available' }, '发现新版本'),
      e('span', null, `当前 ${result.currentVersion} → 最新 ${result.latest.version}`),
    )
  }
  return e('span', { className: 'about-status-tag error' }, '检查更新失败')
}

interface ResultBodyHandlers {
  onOpen(url: string): void
  onDownload(asset: Asset): void
  onCancel(): void
  onInstall(path: string): void
}

function installButtonLabel(appInfo: AppInfo | null): string {
  if (appInfo?.platform === 'darwin') return '打开所在文件夹'
  if (appInfo?.portable) return '重启并替换'
  return '退出并安装'
}

function renderResultBody(
  state: CheckState,
  download: DownloadState,
  appInfo: AppInfo | null,
  handlers: ResultBodyHandlers,
): ReactNode {
  if (state.status !== 'ready') return null
  const result = state.result
  if (result.status === 'error') {
    return e('p', { className: 'about-error', role: 'alert' },
      result.error ?? '检查更新失败,请稍后重试。',
    )
  }
  if (result.status === 'update-available' && result.latest) {
    const release = result.latest
    return e('div', { className: 'about-release', 'aria-label': '新版本信息' },
      e('div', { className: 'about-release-meta' },
        e('span', { className: 'about-release-version' }, release.name || release.version),
        e('span', { className: 'about-release-date' }, formatPublishedAt(release.publishedAt)),
      ),
      e('p', { className: 'about-release-body' }, previewBody(release.body)),
      renderDownloadArea(release, download, appInfo, handlers),
    )
  }
  return null
}

function renderDownloadArea(
  release: ReleaseInfo,
  download: DownloadState,
  appInfo: AppInfo | null,
  handlers: ResultBodyHandlers,
): ReactNode {
  const asset = release.asset
  if (download.status === 'downloading') {
    const percent = download.total > 0 ? Math.min(100, Math.round((download.received / download.total) * 100)) : 0
    return e('div', { className: 'about-download' },
      e('div', {
        className: 'about-progress',
        role: 'progressbar',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': percent,
      },
        e('div', { className: 'about-progress-fill', style: { width: `${percent}%` } }),
      ),
      e('p', { className: 'about-download-meta' },
        download.verifying
          ? '正在校验文件完整性…'
          : `${percent}% · ${formatMB(download.received)} / ${formatMB(download.total)} MB${download.mirror ? ` · ${download.mirror}` : ''}`,
      ),
      e('div', { className: 'about-actions' },
        e('button', { type: 'button', className: 'about-button', onClick: handlers.onCancel }, '取消下载'),
      ),
    )
  }
  if (download.status === 'done') {
    return e('div', { className: 'about-download' },
      e('p', { className: 'about-download-meta' },
        download.revealed
          ? '已打开下载文件所在位置:请退出当前应用,用新版本替换「应用程序」中的 DSH Editor。'
          : '下载完成,校验通过。',
      ),
      !download.revealed ? e('div', { className: 'about-actions' },
        e('button', {
          type: 'button',
          className: 'about-button about-button-primary',
          onClick: () => handlers.onInstall(download.path),
        }, installButtonLabel(appInfo)),
      ) : null,
    )
  }
  return e(Fragment, null,
    download.status === 'error'
      ? e('p', { className: 'about-error', role: 'alert' }, `应用内下载失败:\n${download.message}`)
      : null,
    e('div', { className: 'about-actions' },
      asset
        ? e('button', {
            type: 'button',
            className: 'about-button about-button-primary',
            onClick: () => handlers.onDownload(asset),
          }, `下载更新(${formatMB(asset.size)} MB)`)
        : null,
      e('button', {
        type: 'button',
        className: asset ? 'about-button' : 'about-button about-button-primary',
        onClick: () => handlers.onOpen(release.url),
      }, '前往下载'),
    ),
  )
}
