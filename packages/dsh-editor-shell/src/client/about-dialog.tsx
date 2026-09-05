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
type AppInfo = { name: string; version: string }
type ReleaseInfo = { version: string; tag: string; name: string; publishedAt: string; url: string; body: string }
type CheckResult = { status: UpdateStatus; currentVersion: string; latest?: ReleaseInfo; error?: string }

type CheckState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; result: CheckResult; checkedAt: number }

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
        renderResultBody(state, onOpenDownload),
        e('p', { className: 'about-note' },
          state.status === 'ready' && state.result.status === 'update-available'
            ? '便携版需下载新版 EXE 并手动替换当前可执行文件后重启。'
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

function renderResultBody(state: CheckState, onOpen: (url: string) => void): ReactNode {
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
      e('div', { className: 'about-actions' },
        e('button', {
          type: 'button',
          className: 'about-button about-button-primary',
          onClick: () => onOpen(release.url),
        }, '前往下载'),
      ),
    )
  }
  return null
}
