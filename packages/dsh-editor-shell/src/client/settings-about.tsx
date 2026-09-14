import {
  createElement as e,
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { windowBridge } from './window-controls.tsx'
import { ActivityDots, ActivityText, SuccessMark } from './ui/index.ts'
import { intlLocale, t, useLocale } from '../i18n/index.ts'

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
function formatPublishedAt(iso: string): string {
  const stamp = Date.parse(iso)
  if (!Number.isFinite(stamp)) return iso
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'long', timeStyle: 'short' }).format(new Date(stamp))
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
 * 设置里的关于 / 检查更新页。
 *
 * 依赖 `window.dshWindow.getAppInfo` / `window.dshWindow.checkForUpdate` 由桌面端
 * preload 暴露,浏览器开发模式不存在,自动回退为 t('about.devMode') 并禁用检查按钮。
 *
 * useEffect 内的检查请求与切走分类抢跑:每次发起前记录 token,卸载或停用
 * 时清理,然后在 setState 之前再核对一次,避免晚到的结果污染状态。
 */
export function AboutSettingsSection(props: {
  active?: boolean
  onBusyChange?(busy: boolean): void
}): ReactNode {
  useLocale()
  const active = props.active ?? true
  const bridge = windowBridge()
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [state, setState] = useState<CheckState>({ status: 'idle' })
  const [download, setDownload] = useState<DownloadState>({ status: 'idle' })
  const liveToken = useRef(0)
  const onBusyChange = props.onBusyChange

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const info = bridge?.getAppInfo
    if (!info) { setAppInfo(null); return }
    void info().then((value) => {
      if (!cancelled) setAppInfo(value)
    }).catch(() => {
      if (!cancelled) setAppInfo(null)
    })
    return () => { cancelled = true }
  }, [bridge, active])

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
      const message = error instanceof Error ? error.message : t('about.checkFailed')
      setState({
        status: 'ready',
        result: { status: 'error', currentVersion: appInfo?.version ?? '', error: message },
        checkedAt: Date.now(),
      })
    }
  }

  // 打开本分类时自动跑一次;没有桥就不跑(开发模式)。
  useEffect(() => {
    if (!active || !bridge?.checkForUpdate) return
    void runCheck()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, active])

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

  useEffect(() => {
    onBusyChange?.(download.status === 'downloading')
  }, [download.status, onBusyChange])
  useEffect(() => () => onBusyChange?.(false), [onBusyChange])

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
      if (message.includes('下载已取消') || /cancelled|canceled/i.test(message)) { setDownload({ status: 'idle' }); return }
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

  const onOpenDownload = (url: string) => {
    if (bridge?.openExternal) { bridge.openExternal(url); return }
    globalThis.open(url, '_blank', 'noopener,noreferrer')
  }

  const hasBridge = Boolean(bridge?.checkForUpdate)
  const versionLabel = appInfo ? `${appInfo.name} ${appInfo.version}` : t('about.devMode')
  const canCheck = hasBridge

  return e('section', { className: 'about-page', 'aria-label': t('settings.about') },
    e('div', { className: 'about-header' },
      e('h3', { className: 'about-title' }, t('about.title')),
      e('p', { className: 'about-version' },
        e('strong', null, versionLabel),
      ),
      !hasBridge ? e('p', { className: 'about-note' },
        t('about.browserHint'),
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
        ? t('about.macHint')
        : t('about.proxyHint'),
    ),
    e('div', { className: 'about-actions' },
      e('button', {
        type: 'button',
        className: 'about-button',
        disabled: !canCheck || state.status === 'loading',
        onClick: () => void runCheck(),
      }, state.status === 'loading' ? e(Fragment, null, e(ActivityDots, null), t('about.checking')) : t('about.check')),
    ),
  )
}

function renderStatus(state: CheckState): ReactNode {
  if (state.status === 'idle') return e('span', null, t('about.notChecked'))
  if (state.status === 'loading') return e(ActivityText, null, t('about.checkingStatus'))
  const result = state.result
  if (result.status === 'latest') {
    return e('span', { className: 'about-status-tag latest' }, t('about.latest'))
  }
  if (result.status === 'update-available' && result.latest) {
    return e(Fragment, null,
      e('span', { className: 'about-status-tag available' }, t('about.updateAvailable')),
      e('span', null, t('about.versionRange', { current: result.currentVersion, latest: result.latest.version })),
    )
  }
  return e('span', { className: 'about-status-tag error' }, t('about.checkFailed'))
}

interface ResultBodyHandlers {
  onOpen(url: string): void
  onDownload(asset: Asset): void
  onCancel(): void
  onInstall(path: string): void
}

function installButtonLabel(appInfo: AppInfo | null): string {
  if (appInfo?.platform === 'darwin') return t('about.openFolder')
  if (appInfo?.portable) return t('about.restartReplace')
  return t('about.quitInstall')
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
      result.error ?? t('about.checkFailedRetry'),
    )
  }
  if (result.status === 'update-available' && result.latest) {
    const release = result.latest
    return e('div', { className: 'about-release', 'aria-label': t('about.releaseAria') },
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
          ? e(Fragment, null, e(ActivityDots, null), t('about.verifying'))
          : `${percent}% · ${formatMB(download.received)} / ${formatMB(download.total)} MB${download.mirror ? ` · ${download.mirror}` : ''}`,
      ),
      e('div', { className: 'about-actions' },
        e('button', { type: 'button', className: 'about-button', onClick: handlers.onCancel }, t('about.cancelDownload')),
      ),
    )
  }
  if (download.status === 'done') {
    return e('div', { className: 'about-download' },
      e('p', { className: 'about-download-meta' },
        e(SuccessMark, null),
        ' ',
        download.revealed
          ? t('about.macRevealed')
          : t('about.downloadReady'),
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
      ? e('p', { className: 'about-error', role: 'alert' }, t('about.downloadFailed', { message: download.message }))
      : null,
    e('div', { className: 'about-actions' },
      asset
        ? e('button', {
            type: 'button',
            className: 'about-button about-button-primary',
            onClick: () => handlers.onDownload(asset),
          }, t('about.downloadUpdate', { size: formatMB(asset.size) }))
        : null,
      e('button', {
        type: 'button',
        className: asset ? 'about-button' : 'about-button about-button-primary',
        onClick: () => handlers.onOpen(release.url),
      }, t('about.goDownload')),
    ),
  )
}
