import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Callout, Card, DataList, Flex, Heading, Progress, Text } from '@radix-ui/themes'
import { windowBridge, type DownloadedUpdateInfo } from './window-controls.tsx'
import { AppMascot } from './mascot.tsx'
import { ActivityDots, ActivityText, SuccessMark } from './ui/index.ts'
import { intlLocale, t, useLocale } from '../i18n/index.ts'

type UpdateStatus = 'latest' | 'update-available' | 'error'
type AppInfo = { name: string; version: string; platform: string; portable: boolean }
type Asset = { id: string; name: string; size: number }
type ReleaseInfo = {
  version: string
  tag: string
  name: string
  publishedAt: string
  url: string
  body: string
  asset?: Asset | null
  installBlockedReason?: 'missing-integrity' | 'no-matching-asset'
}
type CheckResult = { status: UpdateStatus; currentVersion: string; latest?: ReleaseInfo; error?: string }

type CheckState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; result: CheckResult; checkedAt: number }

type DownloadState =
  | { status: 'idle' }
  | { status: 'downloading'; updateId: string; received: number; total: number; mirror: string; verifying: boolean }
  | ({ status: 'done'; revealed: boolean } & DownloadedUpdateInfo)
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

/** About / update, with the main process as the sole download authority. */
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
  const downloadToken = useRef(0)
  const operationBusy = useRef(false)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState('')
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
    if (!check || operationBusy.current) return
    const token = ++liveToken.current
    setState({ status: 'loading' })
    setInstallError('')
    try {
      const result = await check()
      if (liveToken.current !== token) return
      let restored: DownloadedUpdateInfo | null = null
      const id = result.latest?.asset?.id
      if (id && bridge?.getDownloadedUpdate) {
        try { restored = await bridge.getDownloadedUpdate(id) }
        catch (error) { if (liveToken.current === token) setInstallError(cleanIpcError(error)) }
      }
      if (liveToken.current !== token) return
      setDownload((previous) => {
        if (result.status === 'error') return previous
        if (restored) return { status: 'done', ...restored, revealed: false }
        return previous.status === 'done' && previous.updateId === id && !bridge?.getDownloadedUpdate
          ? previous : { status: 'idle' }
      })
      setState({ status: 'ready', result, checkedAt: Date.now() })
    } catch (error) {
      if (liveToken.current !== token) return
      setState({ status: 'ready', result: { status: 'error', currentVersion: appInfo?.version ?? '', error: cleanIpcError(error) }, checkedAt: Date.now() })
    }
  }

  useEffect(() => {
    if (!active || !bridge?.checkForUpdate) return
    void runCheck()
    return () => { liveToken.current += 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, active])

  // Ignore progress for another transaction, and keep verification visible until
  // the invoke confirms that the main process recorded a complete download.
  useEffect(() => {
    const onProgress = bridge?.onUpdateProgress
    if (!onProgress) return
    return onProgress((progress) => {
      setDownload((prev) => prev.status === 'downloading' && (!progress.updateId || progress.updateId === prev.updateId)
        ? { ...prev, received: progress.received, total: progress.total, mirror: progress.mirror, verifying: progress.phase !== 'downloading' }
        : prev)
    })
  }, [bridge])

  useEffect(() => {
    onBusyChange?.(download.status === 'downloading' || installing)
  }, [download.status, installing, onBusyChange])
  useEffect(() => () => onBusyChange?.(false), [onBusyChange])
  useEffect(() => () => { downloadToken.current += 1 }, [])

  const startDownload = async (asset: Asset) => {
    const downloadUpdate = bridge?.downloadUpdate
    if (!downloadUpdate || operationBusy.current) return
    operationBusy.current = true
    setInstallError('')
    const token = ++downloadToken.current
    setDownload({ status: 'downloading', updateId: asset.id, received: 0, total: asset.size, mirror: '', verifying: false })
    try {
      const result = await downloadUpdate(asset.id)
      if (downloadToken.current !== token) return
      setDownload({ status: 'done', ...result, revealed: false })
    } catch (error) {
      if (downloadToken.current !== token) return
      const message = cleanIpcError(error)
      if (message.includes('下载已取消') || /cancelled|canceled/i.test(message)) { setDownload({ status: 'idle' }); return }
      setDownload({ status: 'error', message })
    } finally { operationBusy.current = false }
  }

  const cancelDownload = () => {
    void bridge?.cancelUpdateDownload?.().catch((error: unknown) => setInstallError(cleanIpcError(error)))
  }

  const installDownloaded = async (updateId: string) => {
    const install = bridge?.installUpdate
    if (!install || operationBusy.current || state.status === 'loading') return
    operationBusy.current = true
    setInstalling(true)
    setInstallError('')
    const token = ++downloadToken.current
    try {
      const result = await install(updateId)
      if (downloadToken.current !== token) return
      if (result === 'revealed') setDownload((prev) => prev.status === 'done' ? { ...prev, revealed: true } : prev)
    } catch (error) {
      if (downloadToken.current === token) setInstallError(cleanIpcError(error))
    } finally {
      operationBusy.current = false
      if (downloadToken.current === token) setInstalling(false)
    }
  }

  const openFolder = async (updateId?: string) => {
    try {
      if (updateId && bridge?.revealDownloadedUpdate) await bridge.revealDownloadedUpdate(updateId)
      else await bridge?.openUpdateFolder?.()
    } catch (error) { setInstallError(cleanIpcError(error)) }
  }
  const onOpenDownload = (url: string) => {
    if (bridge?.openExternal) { bridge.openExternal(url); return }
    globalThis.open(url, '_blank', 'noopener,noreferrer')
  }
  const hasBridge = Boolean(bridge?.checkForUpdate)
  const versionLabel = appInfo ? `${appInfo.name} ${appInfo.version}` : t('about.devMode')
  const canCheck = hasBridge && download.status !== 'downloading' && !installing
  const handlers: ResultBodyHandlers = {
    installing: installing || state.status === 'loading', onOpen: onOpenDownload,
    onDownload: (asset) => void startDownload(asset), onCancel: cancelDownload,
    onInstall: (updateId) => void installDownloaded(updateId),
    onReveal: bridge?.revealDownloadedUpdate ? (updateId) => void openFolder(updateId) : undefined,
  }

  return (
    <section className="about-page" aria-label={t('settings.about')}>
      <Flex className="about-copy" direction="column" gap="4" minWidth="0">
        <Flex className="about-header" justify="between" align="start" gap="4">
          <Flex direction="column" gap="2" minWidth="0">
            <Heading as="h3" size="3" className="about-title">{t('about.title')}</Heading>
            <DataList.Root size="2">
              <DataList.Item align="center">
                <DataList.Label>{t('settings.about')}</DataList.Label>
                <DataList.Value><Text weight="medium" className="about-version">{versionLabel}</Text></DataList.Value>
              </DataList.Item>
            </DataList.Root>
            {!hasBridge ? <Text size="1" color="gray" className="about-note">{t('about.browserHint')}</Text> : null}
          </Flex>
          <AppMascot size="about" decorative />
        </Flex>
        <div className="about-status">{renderStatus(state)}</div>
        {installError ? <Callout.Root color="red" role="alert" className="about-error"><Callout.Text>{installError}</Callout.Text></Callout.Root> : null}
        {renderResultBody(state, download, appInfo, handlers)}
        {/* Recovery stays visible even when a later check fails or returns latest. */}
        {download.status === 'done' ? <CompletedUpdateActions download={download} appInfo={appInfo} handlers={handlers} /> : null}
        {appInfo?.platform === 'darwin' && state.status === 'ready' && state.result.status === 'update-available' ? <Text size="1" color="gray" className="about-note">{t('about.macHint')}</Text> : null}
        <Flex className="about-actions" gap="2" wrap="wrap">
          <Button type="button" variant="soft" color="gray" className="about-button" disabled={!canCheck || state.status === 'loading'} onClick={() => void runCheck()}>
            {state.status === 'loading' ? <Fragment><ActivityDots />{t('about.checking')}</Fragment> : t('about.check')}
          </Button>
          {bridge?.openUpdateFolder ? <Button type="button" variant="soft" color="gray" className="about-button" onClick={() => void openFolder()}>
            {t('about.openFolder')}
          </Button> : null}
        </Flex>
      </Flex>
    </section>
  );
}

function renderStatus(state: CheckState): ReactNode {
  if (state.status === 'idle') return <Text size="2">{t('about.notChecked')}</Text>
  if (state.status === 'loading') return <ActivityText>{t('about.checkingStatus')}</ActivityText>
  const result = state.result
  if (result.status === 'latest') return <Callout.Root color="green" className="about-status-tag latest"><Callout.Text>{t('about.latest')}</Callout.Text></Callout.Root>
  if (result.status === 'update-available' && result.latest) return (
    <Callout.Root color="indigo"><Callout.Text>
      <Text className="about-status-tag available">{t('about.updateAvailable')}</Text>{' '}
      {t('about.versionRange', { current: result.currentVersion, latest: result.latest.version })}
    </Callout.Text></Callout.Root>
  )
  return <Callout.Root color="red" className="about-status-tag error"><Callout.Text>{t('about.checkFailed')}</Callout.Text></Callout.Root>
}

interface ResultBodyHandlers {
  installing: boolean
  onOpen(url: string): void
  onDownload(asset: Asset): void
  onCancel(): void
  onInstall(updateId: string): void
  onReveal?(updateId: string): void
}
function installButtonLabel(appInfo: AppInfo | null): string {
  if (appInfo?.platform === 'darwin') return t('about.openFolder')
  if (appInfo?.portable) return t('about.restartReplace')
  return t('about.quitInstall')
}

export function CompletedUpdateActions(props: {
  download: Extract<DownloadState, { status: 'done' }>; appInfo: AppInfo | null; handlers: ResultBodyHandlers
}): ReactNode {
  const { download, appInfo, handlers } = props
  return <Flex className="about-download" direction="column" gap="2" minWidth="0">
    <Text size="2" className="about-download-meta"><SuccessMark />{' '}{download.revealed ? t('about.macRevealed') : t('about.downloadReady')}</Text>
    {download.filePath ? <Text as="p" size="1" color="gray" className="about-download-meta" title={download.filePath} style={{ overflowWrap: 'anywhere' }}>{download.filePath}</Text> : null}
    <Flex className="about-actions" gap="2" wrap="wrap">
      {!download.revealed ? <Button type="button" variant="solid" className="about-button about-button-primary" disabled={handlers.installing} onClick={() => handlers.onInstall(download.updateId)}>
        {handlers.installing ? <ActivityDots /> : null}{installButtonLabel(appInfo)}
      </Button> : null}
      {handlers.onReveal ? <Button type="button" variant="soft" color="gray" className="about-button" onClick={() => handlers.onReveal?.(download.updateId)}>
        {t('about.openFolder')}
      </Button> : null}
    </Flex>
  </Flex>
}

function renderResultBody(state: CheckState, download: DownloadState, appInfo: AppInfo | null, handlers: ResultBodyHandlers): ReactNode {
  if (state.status !== 'ready') return null
  const result = state.result
  if (result.status === 'error') return <Callout.Root color="red" role="alert" className="about-error"><Callout.Text>{result.error ?? t('about.checkFailedRetry')}</Callout.Text></Callout.Root>
  if (result.status === 'update-available' && result.latest) {
    const release = result.latest
    return <Card className="about-release" aria-label={t('about.releaseAria')}>
      <Flex className="about-release-meta" align="baseline" gap="3" wrap="wrap">
        <Text weight="medium" className="about-release-version">{release.name || release.version}</Text>
        <Text size="1" color="gray" className="about-release-date">{formatPublishedAt(release.publishedAt)}</Text>
      </Flex>
      <Text as="p" size="2" className="about-release-body">{previewBody(release.body)}</Text>
      {renderDownloadArea(release, download, appInfo, handlers)}
    </Card>
  }
  return null
}

function renderDownloadArea(release: ReleaseInfo, download: DownloadState, _appInfo: AppInfo | null, handlers: ResultBodyHandlers): ReactNode {
  const asset = release.asset
  if (download.status === 'downloading') {
    const percent = download.total > 0 ? Math.min(100, Math.max(0, Math.round((download.received / download.total) * 100))) : undefined
    return <Flex className="about-download" direction="column" gap="2">
      <Progress className="about-progress" value={percent} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} />
      <Text size="1" color="gray" className="about-download-meta">
        {download.verifying ? <Fragment><ActivityDots />{t('about.verifying')}</Fragment>
          : `${percent === undefined ? formatMB(download.received) + ' MB' : `${percent}% · ${formatMB(download.received)} / ${formatMB(download.total)} MB`}${download.mirror ? ` · ${download.mirror}` : ''}`}
      </Text>
      <Flex className="about-actions" gap="2"><Button type="button" variant="soft" color="gray" className="about-button" onClick={handlers.onCancel}>{t('about.cancelDownload')}</Button></Flex>
    </Flex>
  }
  if (download.status === 'done') return null
  return <Fragment>
    {download.status === 'error' ? <Callout.Root color="red" role="alert" className="about-error"><Callout.Text>{t('about.downloadFailed', { message: download.message })}</Callout.Text></Callout.Root> : null}
    {!asset && release.installBlockedReason === 'missing-integrity'
      ? <Text size="1" color="gray" className="about-note">{t('about.missingIntegrity')}</Text>
      : !asset ? <Text size="1" color="gray" className="about-note">{t('about.manualDownloadOnly')}</Text> : null}
    <Flex className="about-actions" gap="2" wrap="wrap">
      {asset ? <Button type="button" variant="solid" className="about-button about-button-primary" onClick={() => handlers.onDownload(asset)}>{t('about.downloadUpdate', { size: formatMB(asset.size) })}</Button> : null}
      <Button type="button" variant={asset ? 'soft' : 'solid'} color={asset ? 'gray' : undefined} className={asset ? 'about-button' : 'about-button about-button-primary'} onClick={() => handlers.onOpen(release.url)}>{t('about.goDownload')}</Button>
    </Flex>
  </Fragment>
}
