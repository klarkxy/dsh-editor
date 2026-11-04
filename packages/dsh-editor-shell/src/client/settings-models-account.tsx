/** DeepSeek account sign-in on the models provider row (browser PKCE via `remote.account`). */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AccountClientMetadata, AccountProfileResult, AccountProfileView, AccountSignInAttempt, AccountView } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'
import { t, useLocale } from '../i18n/index.ts'
import { Button, Flex, Notice, Text } from '../ui/index.ts'
import { ConfirmDialog } from './dialogs.tsx'
import { editorClipboardBridge } from './editor-clipboard.ts'
import { windowBridge } from '../model/window-controls.ts'
import type { AccountPresence } from './settings-models-store.ts'

/** Snapshot the models page needs from the `remote.account` namespace. */
export type DeepseekAccountStatus = {
  /** False when the host composition has no account controller. */
  available: boolean
  /** Latest streamed view; undefined until the first state answer arrives. */
  view: AccountView | undefined
}

export function accountPresence(account: DeepseekAccountStatus): AccountPresence {
  if (!account.available || account.view === undefined) return undefined
  return account.view.status === 'credential-stored' ? 'signed-in' : 'signed-out'
}

/**
 * Stream the account controller's state into React. `watch()` replays the
 * full state on open and pushes every change; when it ends or fails (carrier
 * loss), the next `connection/reset` reopens it, and each (re)open issues one
 * `getState()` so the page never waits on the stream's first frame.
 */
export function useDeepseekAccount(ctx: ShellContext): DeepseekAccountStatus {
  const account = ctx.remote.account
  const [view, setView] = useState<AccountView | undefined>(undefined)
  useEffect(() => {
    if (!account) return
    let live = true
    let generation = 0
    let retryPending = false
    let stream: { dispose(): void } | undefined
    const disposeStream = () => {
      const current = stream
      stream = undefined
      try { current?.dispose() } catch { /* carrier already gone */ }
    }
    const open = () => {
      if (!live) return
      const ticket = ++generation
      disposeStream()
      void account.getState().then((result) => {
        if (live && ticket === generation && result.ok) setView(result.value)
      }).catch(() => { /* the stream still owns the fresh answer */ })
      try {
        const handle = account.watch()
        stream = handle
        void (async () => {
          try {
            for await (const next of handle) {
              if (!live || ticket !== generation) break
              setView(next)
            }
          } catch { /* carrier error: reopen on the next connection/reset */ }
          if (live && ticket === generation) retryPending = true
        })()
      } catch {
        retryPending = true
      }
    }
    open()
    const disposers: unknown[] = []
    const ctxAny = ctx as unknown as { on?: (event: string, listener: () => void) => unknown }
    if (typeof ctxAny.on === 'function') {
      try {
        disposers.push(ctxAny.on('connection/reset', () => {
          if (!retryPending) return
          retryPending = false
          open()
        }))
      } catch { /* host may not forward the event */ }
    }
    return () => {
      live = false
      generation++
      disposeStream()
      for (const handle of disposers) {
        if (typeof handle === 'function') try { (handle as () => void)() } catch { /* ignore */ }
      }
    }
  }, [ctx, account])
  return { available: account !== undefined, view }
}

const PENDING_PHASES: ReadonlySet<AccountSignInAttempt['phase']> = new Set(['initializing', 'waiting-browser', 'exchanging', 'committing'])

function pendingAttempt(view: AccountView | undefined): AccountSignInAttempt | null {
  const attempt = view?.attempt ?? null
  return attempt !== null && PENDING_PHASES.has(attempt.phase) ? attempt : null
}

/** The actionable failure a settled attempt leaves under the row head; 'cancelled' and 'succeeded' show nothing. */
function attemptFailure(view: AccountView | undefined): string | null {
  if (view === undefined || view.status !== 'signed-out' || view.attempt === null) return null
  const { phase, errorCode } = view.attempt
  if (errorCode === 'no-response') return t('models.accountSignInNoResponse')
  if (phase === 'expired' || errorCode === 'expired') return t('models.accountSignInExpired')
  if (phase === 'failed') return t('models.accountSignInFailed')
  return null
}

function profileLabelOf(result: AccountProfileResult | AccountProfileView | null): string | null {
  if (result === null) return null
  /* The wire answer wraps the profile in a ready/failed envelope; tolerate a
     bare profile too so an older controller still yields a label. */
  const profile = 'status' in result ? (result.status === 'ready' ? result.value : null) : result
  return profile?.name ?? profile?.contact ?? null
}

function openSignInPage(url: string): void {
  const openExternal = windowBridge()?.openExternal
  if (openExternal) { openExternal(url); return }
  globalThis.open(url, '_blank', 'noopener,noreferrer')
}

export type DeepseekAccountControls = {
  /** Button cluster for `.models-row-actions`. */
  actions: ReactNode
  /** Status line and notices under the row head. */
  detail: ReactNode
}

type AccountAction = 'signin' | 'signout' | 'cancel'

/**
 * The account row's interactive state: sign-in/cancel/sign-out requests, the
 * one-shot auto-open of the authorize page (only for attempts this page
 * started), the copied feedback, the profile label, and the sign-out confirm
 * dialog. `enabled` keeps the hook inert on non-account rows so RowHead can
 * call it unconditionally.
 */
export function useDeepseekAccountControls(ctx: ShellContext, account: DeepseekAccountStatus, enabled: boolean): DeepseekAccountControls {
  const locale = useLocale()
  const remote = ctx.remote.account
  const view = account.view
  const attempt = view?.attempt ?? null
  const pending = pendingAttempt(view)
  const presence = accountPresence(account)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [tasksRunning, setTasksRunning] = useState(false)
  const [busy, setBusy] = useState<AccountAction | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [failure, setFailure] = useState<string | null>(null)
  const [profileLabel, setProfileLabel] = useState<string | null>(null)

  /* Attempt this page's sign-in click started, with the authorizeUrl the
     answer already carried if any. State (not a ref) so a start answer
     landing after the waiting-browser frame still re-runs the auto-open
     effect; openedAttemptIds stays the once-guard so watch replays and
     reconnects never re-open, and attempts started elsewhere are never
     auto-opened. */
  const [startedAttempt, setStartedAttempt] = useState<{ id: string; authorizeUrl?: string } | null>(null)
  const openedAttemptIds = useRef(new Set<string>())
  const metadataRequest = useRef<Promise<AccountClientMetadata> | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const metadata = (): Promise<AccountClientMetadata> => {
    metadataRequest.current ??= (async () => {
      let version = '0.0.0-dev'
      try { version = (await windowBridge()?.getAppInfo?.())?.version ?? version } catch { /* dev/browser host */ }
      return {
        version,
        locale: locale === 'zh' ? 'zh-CN' : 'en',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      }
    })()
    return metadataRequest.current
  }

  /* Open the authorize URL exactly once: whichever of the live attempt or the
     start answer first shows the started attempt's URL wins. */
  useEffect(() => {
    if (!enabled || startedAttempt === null) return
    const url = (attempt?.id === startedAttempt.id ? attempt.authorizeUrl : undefined) ?? startedAttempt.authorizeUrl
    if (url === undefined || openedAttemptIds.current.has(startedAttempt.id)) return
    openedAttemptIds.current.add(startedAttempt.id)
    openSignInPage(url)
  }, [enabled, startedAttempt, attempt?.id, attempt?.authorizeUrl])

  /* Drop the pending copied/copy-failed timer when the row unmounts. */
  useEffect(() => () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])

  /* Fetch the profile label whenever presence becomes signed-in; failure just
     falls back to the plain "signed in" text. */
  useEffect(() => {
    if (!enabled || presence !== 'signed-in' || !remote) return
    let live = true
    void metadata()
      .then((client) => remote.getProfile(client))
      .then((result) => { if (live) setProfileLabel(result.ok ? profileLabelOf(result.value) : null) })
      .catch(() => { if (live) setProfileLabel(null) })
    return () => { live = false }
  }, [enabled, presence, remote])

  const signIn = async () => {
    if (!remote || busy !== null) return
    setBusy('signin')
    setFailure(null)
    try {
      const result = await remote.startSignIn(await metadata(), window.location.origin, 'web')
      if (result.ok) {
        const attempt = result.value.attempt
        setStartedAttempt(attempt === null ? null : { id: attempt.id, authorizeUrl: attempt.authorizeUrl })
      } else setFailure(t('models.accountSignInFailed'))
    } catch {
      setFailure(t('models.accountSignInFailed'))
    } finally {
      setBusy(null)
    }
  }

  const cancel = async () => {
    const id = attempt?.id
    if (!remote || id === undefined || busy !== null) return
    setBusy('cancel')
    try { await remote.cancelSignIn(id) } catch { /* the stream reports the settled view */ }
    finally { setBusy(null) }
  }

  const copyLink = async () => {
    const url = attempt?.authorizeUrl
    const clipboard = editorClipboardBridge()
    let ok = false
    if (url !== undefined && clipboard) {
      try { await clipboard.writeText(url); ok = true } catch { /* reported below */ }
    }
    setCopyState(ok ? 'copied' : 'failed')
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopyState('idle'), 2000)
  }

  const requestSignOut = async () => {
    if (!remote || busy !== null) return
    setBusy('signout')
    try {
      const result = await remote.hasRunningAccountTasks().catch(() => null)
      setTasksRunning(result?.ok === true && result.value === true)
      setConfirmOpen(true)
    } finally {
      setBusy(null)
    }
  }

  const confirmSignOut = async () => {
    setConfirmOpen(false)
    if (!remote) return
    setBusy('signout')
    try {
      const result = await remote.signOut(await metadata())
      if (!result.ok) setFailure(t('models.accountSignOutFailed'))
    } catch {
      setFailure(t('models.accountSignOutFailed'))
    } finally {
      setBusy(null)
    }
  }

  if (!enabled) return { actions: null, detail: null }

  const statusText = pending !== null
    ? t('models.accountWaiting')
    : presence === 'signed-in'
      ? profileLabel ?? t('models.accountSignedIn')
      : null
  const failureText = attemptFailure(view)
  const dialog = (
    <ConfirmDialog
      open={confirmOpen}
      id="models-account-signout"
      title={t('models.accountSignOutTitle')}
      message={tasksRunning ? `${t('models.accountSignOutMessage')}${t('models.accountSignOutRunning')}` : t('models.accountSignOutMessage')}
      confirmLabel={t('models.accountSignOut')}
      onCancel={() => setConfirmOpen(false)}
      onConfirm={() => void confirmSignOut()} />
  )
  const detail = statusText === null && failureText === null && failure === null
    ? dialog
    : (
      <Flex direction="column" gap="2" mt="2" className="models-account-detail">
        {statusText === null ? null : <Text size="1" color="gray" className="models-account-status">{statusText}</Text>}
        {failureText === null ? null : <Notice tone="danger" className="models-account-error">{failureText}</Notice>}
        {failure === null ? null : <Notice tone="danger" className="models-account-error">{failure}</Notice>}
        {dialog}
      </Flex>
    )

  if (!account.available) {
    return {
      actions: null,
      detail: (
        <Flex direction="column" gap="2" mt="2" className="models-account-detail">
          <Text size="1" color="gray" className="models-account-status">{t('models.accountUnavailable')}</Text>
        </Flex>
      ),
    }
  }

  if (pending !== null) {
    const url = pending.authorizeUrl
    return {
      actions: <>
        {url !== undefined
          ? <Button variant="secondary" className="models-button" data-testid="dsh-models-account-open" onClick={() => openSignInPage(url)}>{t('models.accountOpenPage')}</Button>
          : null}
        {url !== undefined
          ? <Button variant="secondary" className="models-button" data-testid="dsh-models-account-copy" onClick={() => void copyLink()}>{copyState === 'copied' ? t('models.accountCopied') : copyState === 'failed' ? t('models.accountCopyFailed') : t('models.accountCopyLink')}</Button>
          : null}
        <Button variant="secondary" className="models-button" data-testid="dsh-models-account-cancel" disabled={busy !== null} onClick={() => void cancel()}>{t('common.cancel')}</Button>
      </>,
      detail,
    }
  }

  if (presence === 'signed-in') {
    return {
      actions: <Button variant="secondary" className="models-button" data-testid="dsh-models-account-signout" disabled={busy !== null} onClick={() => void requestSignOut()}>{t('models.accountSignOut')}</Button>,
      detail,
    }
  }

  return {
    actions: <Button variant="secondary" className="models-button" data-testid="dsh-models-account-signin" aria-label={t('models.accountSignInAria')} disabled={view === undefined || busy !== null} onClick={() => void signIn()}>{t('models.accountSignIn')}</Button>,
    detail: view === undefined ? null : detail,
  }
}
