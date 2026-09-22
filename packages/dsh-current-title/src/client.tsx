import type { Context } from '@deepseek-ai/cordis'
import type { NativeSurfaceClient } from '@klarkxy/dsh-ai-services/client-utils'
import { useFeatureRefresh, useNativeSeat } from '@klarkxy/dsh-ai-services/client-utils'
import { useCallback, useEffect, useRef, useState } from 'react'
import { RPC_CHANNEL, TITLE_CLIENT_SERVICE, type RpcResult, type TitleLocaleMode, type TitleStatus } from './contracts.ts'
import {
  createTitleClientWork, runTitleRegenerateFlow, runTitleSettingsSave, runTitleStatusLoad,
  shouldSkipTitleRefresh, titleCopy, type TitleClientCall, type TitleClientWork,
} from './client-work.ts'
import { applyMarkerFromStatus, createTitleClientMarker, disposeTitleClientMarker } from './marker.ts'

export const name = 'dsh-current-title-client'
export const inject = ['slots', 'connection', 'sessions', 'locale'] as const
export { createTitleClientMarker, disposeTitleClientMarker, applyMarkerFromStatus }

type Client = NativeSurfaceClient & {
  connection: NonNullable<NativeSurfaceClient['connection']> & {
    rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }
  }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; id: string; label: string; order: number }, render: unknown): () => void
  }
}

export function TitleSettings(props: {
  client: Client
  marker: { active: boolean }
  owner?: unknown
}) {
  const seat = useNativeSeat(props.client, props.owner)
  const sessionId = seat.sessionId
  const text = titleCopy[seat.locale]
  const [status, setStatus] = useState<TitleStatus>()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const workRef = useRef<TitleClientWork>(undefined)
  if (!workRef.current) workRef.current = createTitleClientWork()
  const work = workRef.current
  const busyRef = useRef(busy)
  busyRef.current = busy

  const call: TitleClientCall = (endpoint, payload = {}) => (
    props.client.connection.rpc.call(RPC_CHANNEL, endpoint, payload)
  )

  function commitMarker(next: TitleStatus | undefined) {
    applyMarkerFromStatus(props.marker, next, true)
  }

  useEffect(() => () => { work.dispose() }, [work])

  useEffect(() => {
    const generation = work.beginLoad()
    const isCurrent = () => work.isLoad(generation)
    setBusy(false)
    setError('')
    setNote('')
    void runTitleStatusLoad({
      call,
      sessionId: sessionId || undefined,
      isCurrent,
      failedMessage: text.failed,
      onStatus: setStatus,
      onError: setError,
      onMarker: commitMarker,
    })
    return () => { if (work.isLoad(generation)) work.beginLoad() }
  }, [props.client, props.marker, sessionId, text.failed, work])

  const refreshStatus = useCallback(() => {
    if (shouldSkipTitleRefresh({ busy: busyRef.current }) || work.disposed) return
    const generation = work.captureLoad()
    void runTitleStatusLoad({
      call,
      sessionId: sessionId || undefined,
      isCurrent: () => work.isLoad(generation) && !shouldSkipTitleRefresh({ busy: busyRef.current }),
      failedMessage: text.failed,
      onStatus: next => {
        if (shouldSkipTitleRefresh({ busy: busyRef.current })) return
        setStatus(next)
      },
      onError: () => {},
      onMarker: next => {
        if (shouldSkipTitleRefresh({ busy: busyRef.current })) return
        commitMarker(next)
      },
    })
  }, [props.client, props.marker, sessionId, text.failed, work])

  useFeatureRefresh(
    props.client,
    sessionId,
    refreshStatus,
    status?.session?.generating === true && !busy,
    Boolean(sessionId),
  )

  const locale = status?.settings.locale ?? 'auto'
  const modes: Array<{ id: TitleLocaleMode; label: string }> = [
    { id: 'auto', label: text.auto },
    { id: 'zh', label: '中文' },
    { id: 'en', label: 'English' },
  ]
  const title = status?.session?.title
  const pinned = status?.session?.pinned === true
  const weOwn = status?.support.weOwn === true
  const canRegenerate = Boolean(sessionId) && weOwn && !busy

  return <section className="current-title-settings" data-testid="current-title-settings">
    {title ? <p>{title}</p> : null}
    {pinned ? <p className="current-title-meta">{text.pinned}</p> : null}
    {status?.session?.generating ? <p role="status">{text.generating}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {note ? <p role="status">{note}</p> : null}
    {sessionId ? <button type="button" disabled={!canRegenerate} aria-label={text.regenerate}
      onClick={() => {
        if (!sessionId) return
        const token = work.beginRequest()
        setError('')
        setNote('')
        void runTitleRegenerateFlow({
          call,
          sessionId,
          isCurrent: () => work.isRequest(token),
          failedMessage: text.failed,
          onBusy: setBusy,
          onStatus: setStatus,
          onError: setError,
          onMarker: commitMarker,
        })
      }}>{text.regenerate}</button> : null}
    <fieldset disabled={busy || !status} aria-label={text.locale}>
      <legend>{text.locale}</legend>
      {modes.map(mode => (
        <label key={mode.id}>
          <input type="radio" name="current-title-locale" value={mode.id} checked={locale === mode.id}
            onChange={() => {
              if (!status) return
              const token = work.beginRequest()
              setError('')
              setNote('')
              void runTitleSettingsSave({
                call,
                locale: mode.id,
                expectedRevision: status.settings.revision,
                isCurrent: () => work.isRequest(token),
                savedMessage: text.saved,
                failedMessage: text.failed,
                onBusy: setBusy,
                onSettings: settings => setStatus({ ...status, settings }),
                onNote: setNote,
                onError: setError,
              })
            }} />
          {mode.label}
        </label>
      ))}
    </fieldset>
  </section>
}

const styles = `
.current-title-settings{display:grid;gap:8px;color:inherit;font:400 var(--font-size-2,14px)/1.5 var(--default-font-family,system-ui,sans-serif)}
.current-title-settings p{margin:0}
.current-title-meta{font-size:var(--font-size-1,13px);color:var(--gray-11,inherit)}
.current-title-settings button{min-height:34px;padding:6px 12px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:6px;background:transparent;color:inherit;cursor:pointer;font:inherit;justify-self:start}
.current-title-settings button:disabled{opacity:.45;cursor:not-allowed}
.current-title-settings fieldset{margin:0;border:0;padding:0;display:grid;gap:8px}
.current-title-settings label{display:flex;gap:8px;align-items:center}
.current-title-settings :focus-visible{outline:2px solid currentColor;outline-offset:3px}
`

declare module '@deepseek-ai/cordis' {
  interface Context { dshCurrentTitleClient: { active: boolean } }
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  const marker = createTitleClientMarker()
  ctx.provide(TITLE_CLIENT_SERVICE, marker)
  ctx.effect(() => {
    let live = true
    void client.connection.rpc.call(RPC_CHANNEL, 'status', {}).then(result => {
      const row = result as RpcResult<TitleStatus>
      if (!live) return
      applyMarkerFromStatus(marker, row?.ok ? row.value : undefined, live)
    }).catch(() => { if (live) applyMarkerFromStatus(marker, undefined, live) })
    return () => { live = false; disposeTitleClientMarker(marker) }
  }, 'current-title.marker')
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@klarkxy/dsh-current-title')
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'current-title.styles')
  ctx.effect(() => client.slots.inject('settings.section', () => client.slots.register({
    name: 'settings.section', id: 'current-title', order: 80, label: '当前标题',
  }, (props: unknown) => <TitleSettings client={client} marker={marker} owner={props} />)), 'current-title.settings')
}
