import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Callout, Card, DataList, Flex, Heading, Progress, Text } from '@radix-ui/themes'
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
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
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

  return (
    <section className="about-page" aria-label={t('settings.about')}>
      <Flex className="about-header" direction="column" gap="2">
        <Heading as="h3" size="3" className="about-title">
          {t('about.title')}
        </Heading>
        <DataList.Root size="2">
          <DataList.Item align="center">
            <DataList.Label>
              {t('settings.about')}
            </DataList.Label>
            <DataList.Value>
              <Text weight="medium" className="about-version">
                {versionLabel}
              </Text>
            </DataList.Value>
          </DataList.Item>
        </DataList.Root>
        {!hasBridge ? <Text size="1" color="gray" className="about-note">
          {t('about.browserHint')}
        </Text> : null}
      </Flex>
      <div className="about-status">
        {renderStatus(state)}
      </div>
      {renderResultBody(state, download, appInfo, {
        onOpen: onOpenDownload,
        onDownload: (asset) => void startDownload(asset),
        onCancel: cancelDownload,
        onInstall: (path) => void installDownloaded(path),
      })}
      <Text size="1" color="gray" className="about-note">
        {state.status === 'ready' && state.result.status === 'update-available'
          ? t('about.macHint')
          : t('about.proxyHint')}
      </Text>
      <Flex className="about-actions" gap="2" wrap="wrap">
        <Button
          type="button"
          variant="soft"
          color="gray"
          className="about-button"
          disabled={!canCheck || state.status === 'loading'}
          onClick={() => void runCheck()}>
          {state.status === 'loading' ? <Fragment>
            <ActivityDots />
            {t('about.checking')}
          </Fragment> : t('about.check')}
        </Button>
      </Flex>
    </section>
  );
}

function renderStatus(state: CheckState): ReactNode {
  if (state.status === 'idle') return (
    <Text size="2">
      {t('about.notChecked')}
    </Text>
  );
  if (state.status === 'loading') return (
    <ActivityText>
      {t('about.checkingStatus')}
    </ActivityText>
  );
  const result = state.result
  if (result.status === 'latest') {
    return (
      <Callout.Root color="green" className="about-status-tag latest">
        <Callout.Text>
          {t('about.latest')}
        </Callout.Text>
      </Callout.Root>
    );
  }
  if (result.status === 'update-available' && result.latest) {
    return (
      <Callout.Root color="indigo">
        <Callout.Text>
          <Text className="about-status-tag available">
            {t('about.updateAvailable')}
          </Text>
          {' '}
          {t('about.versionRange', { current: result.currentVersion, latest: result.latest.version })}
        </Callout.Text>
      </Callout.Root>
    );
  }
  return (
    <Callout.Root color="red" className="about-status-tag error">
      <Callout.Text>
        {t('about.checkFailed')}
      </Callout.Text>
    </Callout.Root>
  );
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
    return (
      <Callout.Root color="red" role="alert" className="about-error">
        <Callout.Text>
          {result.error ?? t('about.checkFailedRetry')}
        </Callout.Text>
      </Callout.Root>
    );
  }
  if (result.status === 'update-available' && result.latest) {
    const release = result.latest
    return (
      <Card className="about-release" aria-label={t('about.releaseAria')}>
        <Flex className="about-release-meta" align="baseline" gap="3" wrap="wrap">
          <Text weight="medium" className="about-release-version">
            {release.name || release.version}
          </Text>
          <Text size="1" color="gray" className="about-release-date">
            {formatPublishedAt(release.publishedAt)}
          </Text>
        </Flex>
        <Text as="p" size="2" className="about-release-body">
          {previewBody(release.body)}
        </Text>
        {renderDownloadArea(release, download, appInfo, handlers)}
      </Card>
    );
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
    return (
      <Flex className="about-download" direction="column" gap="2">
        <Progress
          className="about-progress"
          value={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent} />
        <Text size="1" color="gray" className="about-download-meta">
          {download.verifying
            ? <Fragment>
            <ActivityDots />
            {t('about.verifying')}
          </Fragment>
            : `${percent}% · ${formatMB(download.received)} / ${formatMB(download.total)} MB${download.mirror ? ` · ${download.mirror}` : ''}`}
        </Text>
        <Flex className="about-actions" gap="2">
          <Button type="button" variant="soft" color="gray" className="about-button" onClick={handlers.onCancel}>
            {t('about.cancelDownload')}
          </Button>
        </Flex>
      </Flex>
    );
  }
  if (download.status === 'done') {
    return (
      <Flex className="about-download" direction="column" gap="2">
        <Text size="2" className="about-download-meta">
          <SuccessMark />
          {' '}
          {download.revealed
            ? t('about.macRevealed')
            : t('about.downloadReady')}
        </Text>
        {!download.revealed ? <Flex className="about-actions" gap="2">
          <Button
            type="button"
            variant="solid"
            className="about-button about-button-primary"
            onClick={() => handlers.onInstall(download.path)}>
            {installButtonLabel(appInfo)}
          </Button>
        </Flex> : null}
      </Flex>
    );
  }
  return (
    <Fragment>
      {download.status === 'error'
        ? <Callout.Root color="red" role="alert" className="about-error">
        <Callout.Text>
          {t('about.downloadFailed', { message: download.message })}
        </Callout.Text>
      </Callout.Root>
        : null}
      <Flex className="about-actions" gap="2" wrap="wrap">
        {asset
          ? <Button
          type="button"
          variant="solid"
          className="about-button about-button-primary"
          onClick={() => handlers.onDownload(asset)}>
          {t('about.downloadUpdate', { size: formatMB(asset.size) })}
        </Button>
          : null}
        <Button
          type="button"
          variant={asset ? 'soft' : 'solid'}
          color={asset ? 'gray' : undefined}
          className={asset ? 'about-button' : 'about-button about-button-primary'}
          onClick={() => handlers.onOpen(release.url)}>
          {t('about.goDownload')}
        </Button>
      </Flex>
    </Fragment>
  );
}
