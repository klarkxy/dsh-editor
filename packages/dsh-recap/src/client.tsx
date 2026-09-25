import type { Context } from '@deepseek-ai/cordis'
import { CHAT_EVENTS_SLOT } from '@klarkxy/dsh-ai-services/contracts'
import { useFeatureRefresh, useNativeSeat, type NativeSurfaceClient } from '@klarkxy/dsh-ai-services/client-utils'
import { useEffect, useRef, useState } from 'react'
import {
  RECAP_RPC_CHANNEL, defaultSettings,
  type RecapCard, type RecapStatus, type RpcResult,
} from './contracts.ts'
import {
  createRecapClientWork, shouldRequestIdleReturn, shouldSkipRecapAutoRefresh, type RecapClientWork,
} from './idle.ts'

export const name = 'dsh-recap-client'
export const inject = ['slots', 'connection', 'sessions', 'locale', 'uiWorkspace', 'uiSession'] as const
export {
  createRecapClientWork, isCurrentRecapRequest, shouldRequestIdleReturn, shouldSkipRecapAutoRefresh,
  nextActivityTimestamp,
} from './idle.ts'
export { CHAT_EVENTS_SLOT }

type RpcCaller = { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }
type SlotHandle = {
  inject(key: string, callback: () => unknown): () => void
  register(spec: { name: string; id: string; label: string; order: number }, render: unknown): () => void
}
type RecapClient = Context & NativeSurfaceClient & {
  connection: { rpc: RpcCaller; generation?: { subscribe(listener: () => void): () => void } }
  slots: SlotHandle
}

export function recapHasRunningGeneration(cards: readonly RecapCard[]): boolean {
  return cards.some(card => card.generation === 'running')
}

export function recapSeatProps(props: unknown): { sessionId: string; locale?: string; hidden: boolean } | undefined {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return undefined
  const record = props as Record<string, unknown>
  const nested = record.owner && typeof record.owner === 'object' ? record.owner as Record<string, unknown> : undefined
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : typeof nested?.sessionId === 'string' ? nested.sessionId : undefined
  if (!sessionId) return undefined
  const locale = typeof record.locale === 'string' ? record.locale : typeof nested?.locale === 'string' ? nested.locale : undefined
  const hidden = record.hidden === true || nested?.hidden === true
  return locale ? { sessionId, locale, hidden } : { sessionId, hidden }
}

export function recapCardKey(seat: { sessionId: string; locale?: string }): string {
  return `${seat.sessionId}:${seat.locale ?? ''}`
}

function unwrap<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

export async function recapCall<T>(rpc: RpcCaller, endpoint: string, payload: unknown = {}): Promise<T> {
  return unwrap(await rpc.call(RECAP_RPC_CHANNEL, endpoint, payload) as RpcResult<T>)
}

function copy(locale: string | undefined, zh: string, en: string): string {
  return locale === 'en' ? en : zh
}

export async function runRecapStatusLoad(input: {
  rpc: RpcCaller
  sessionId?: string
  isCurrent: () => boolean
  failedMessage: string
  onStatus: (status: RecapStatus) => void
  onError: (message: string) => void
}): Promise<void> {
  try {
    const status = await recapCall<RecapStatus>(input.rpc, 'status', input.sessionId ? { sessionId: input.sessionId } : {})
    if (!input.isCurrent()) return
    input.onStatus(status)
  } catch {
    if (!input.isCurrent()) return
    input.onError(input.failedMessage)
  }
}

export async function runRecapAct(input: {
  rpc: RpcCaller
  sessionId: string
  endpoint: 'cancel' | 'retry' | 'refresh'
  cardId?: string
  isCurrent: () => boolean
  failedMessage: string
  onBusy: (busy: boolean) => void
  onStatus: (status: RecapStatus) => void
  onError: (message: string) => void
}): Promise<void> {
  if (!input.isCurrent()) return
  input.onBusy(true)
  try {
    const payload = input.endpoint === 'refresh'
      ? { sessionId: input.sessionId }
      : { cardId: input.cardId, sessionId: input.sessionId }
    await recapCall(input.rpc, input.endpoint, payload)
    if (!input.isCurrent()) return
    const status = await recapCall<RecapStatus>(input.rpc, 'status', { sessionId: input.sessionId })
    if (!input.isCurrent()) return
    input.onStatus(status)
  } catch (cause) {
    if (!input.isCurrent()) return
    input.onError(cause instanceof Error ? cause.message : input.failedMessage)
  } finally {
    if (!input.isCurrent()) return
    input.onBusy(false)
  }
}

export async function runRecapIdleReturn(input: {
  rpc: RpcCaller
  sessionId: string
  isCurrent: () => boolean
  failedMessage: string
  onStatus: (status: RecapStatus) => void
  onError: (message: string) => void
  onActivity: () => void
}): Promise<void> {
  if (!input.isCurrent()) return
  try {
    await recapCall(input.rpc, 'idle.return', { sessionId: input.sessionId })
    if (!input.isCurrent()) return
    const status = await recapCall<RecapStatus>(input.rpc, 'status', { sessionId: input.sessionId })
    if (!input.isCurrent()) return
    input.onActivity()
    input.onStatus(status)
  } catch {
    if (!input.isCurrent()) return
    input.onError(input.failedMessage)
  }
}

const styles = `
.dsh-recap-card{font:inherit;color:inherit;max-width:42rem}
.dsh-recap-card button{font:inherit;min-height:34px;padding:6px 12px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:8px;background:transparent;color:inherit;cursor:pointer;justify-self:start;transition:background-color 150ms ease,color 150ms ease,border-color 150ms ease,box-shadow 150ms ease,transform 150ms ease}
.dsh-recap-card button:hover:not(:disabled){background:var(--gray-3,color-mix(in srgb,currentColor 6%,transparent));border-color:color-mix(in srgb,currentColor 35%,transparent)}
.dsh-recap-card button:active:not(:disabled){transform:scale(.97)}
.dsh-recap-card button:disabled{opacity:.45;cursor:not-allowed}
.dsh-recap-card :focus-visible{outline:2px solid var(--accent-9,currentColor);outline-offset:3px}
.dsh-recap-card details{padding:10px 4px;border-top:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent));border-radius:10px}
.dsh-recap-card pre{margin:8px 0 0;white-space:pre-wrap;font:inherit}
.dsh-recap-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.dsh-recap-error{color:var(--red-9,#b91c1c)}
@media(prefers-reduced-motion:reduce){.dsh-recap-card button{transition:none}}
`

export function RecapEventsCard({
  client, sessionId, locale, hidden, idle = true, quiet = false,
}: {
  client: RecapClient
  sessionId: string
  locale?: string
  hidden?: boolean
  idle?: boolean
  quiet?: boolean
}) {
  const rpc = client.connection.rpc
  const [cards, setCards] = useState<RecapCard[]>([])
  const [error, setError] = useState('')
  const [cardsOn, setCardsOn] = useState(true)
  const [busy, setBusy] = useState(false)
  const lastActivityAt = useRef(Date.now())
  const idleMs = useRef(defaultSettings().idleReturnMs)
  const cardsEnabled = useRef(true)
  const busyRef = useRef(false)
  const workRef = useRef<RecapClientWork>(undefined)
  if (!workRef.current) workRef.current = createRecapClientWork()
  const work = workRef.current

  function markBusy(value: boolean) {
    busyRef.current = value
    setBusy(value)
  }

  function applyStatus(status: RecapStatus) {
    idleMs.current = status.settings.idleReturnMs
    cardsEnabled.current = status.settings.cardsEnabled
    setCardsOn(status.settings.cardsEnabled)
    setCards(status.cards)
    setError('')
  }

  useEffect(() => () => { work.dispose() }, [work])

  useEffect(() => {
    const generation = work.beginLoad()
    lastActivityAt.current = Date.now()
    busyRef.current = false
    setBusy(false)
    setError('')
    setCards([])
    void runRecapStatusLoad({
      rpc,
      sessionId,
      isCurrent: () => work.isLoad(generation),
      failedMessage: copy(locale, '无法读取回顾。', 'Could not load recap.'),
      onStatus: applyStatus,
      onError: setError,
    })
    return () => { if (work.isLoad(generation)) work.beginLoad() }
  }, [rpc, sessionId, locale, work])

  useEffect(() => {
    if (hidden || !idle || typeof document === 'undefined') return undefined
    const requestIdle = () => {
      const token = work.beginRequest()
      void runRecapIdleReturn({
        rpc,
        sessionId,
        isCurrent: () => work.isRequest(token),
        failedMessage: copy(locale, '闲置回顾失败。', 'Idle recap failed.'),
        onStatus: applyStatus,
        onError: setError,
        onActivity: () => { lastActivityAt.current = Date.now() },
      })
    }
    const maybeIdleReturn = () => {
      if (!shouldRequestIdleReturn({
        now: Date.now(),
        lastUserActivityAt: lastActivityAt.current,
        idleReturnMs: idleMs.current,
        cardsEnabled: cardsEnabled.current,
        visible: document.visibilityState === 'visible',
        hidden: false,
        focused: document.hasFocus(),
      })) return
      requestIdle()
    }
    const onPointer = () => { lastActivityAt.current = Date.now() }
    const onKey = () => { lastActivityAt.current = Date.now() }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('focus', maybeIdleReturn)
    document.addEventListener('visibilitychange', maybeIdleReturn)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('focus', maybeIdleReturn)
      document.removeEventListener('visibilitychange', maybeIdleReturn)
    }
  }, [rpc, sessionId, locale, hidden, idle, work])

  function refreshCards() {
    if (shouldSkipRecapAutoRefresh({ busy: busyRef.current, disposed: work.disposed })) return
    const token = work.snapshot()
    void runRecapStatusLoad({
      rpc,
      sessionId,
      isCurrent: () => work.isRequest(token) && !busyRef.current,
      failedMessage: copy(locale, '无法读取回顾。', 'Could not load recap.'),
      onStatus: applyStatus,
      onError: setError,
    })
  }

  useFeatureRefresh(
    client,
    sessionId,
    refreshCards,
    recapHasRunningGeneration(cards),
    Boolean(sessionId) && hidden !== true,
  )

  function act(endpoint: 'cancel' | 'retry' | 'refresh', cardId?: string) {
    const token = work.beginRequest()
    void runRecapAct({
      rpc,
      sessionId,
      endpoint,
      cardId,
      isCurrent: () => work.isRequest(token),
      failedMessage: copy(locale, '操作失败。', 'Action failed.'),
      onBusy: markBusy,
      onStatus: applyStatus,
      onError: setError,
    })
  }

  if (hidden || quiet) return null
  if (!cardsOn && cards.length === 0 && !error) return null
  return <section className="dsh-recap-card" data-session={sessionId}>
    {error ? <p role="alert" className="dsh-recap-error">{error}</p> : null}
    {cardsOn ? <div className="dsh-recap-actions">
      <button type="button" disabled={busy || recapHasRunningGeneration(cards)}
        onClick={() => act('refresh')}>{copy(locale, '生成回顾', 'Generate recap')}</button>
    </div> : null}
    {cards.map(card => (
      <details key={card.id}>
        <summary>{card.title}</summary>
        <pre>{card.body}</pre>
        <div className="dsh-recap-actions">
          {card.generation === 'running' ? <button type="button" onClick={() => act('cancel', card.id)}>{copy(locale, '取消', 'Cancel')}</button> : null}
          <button type="button" disabled={card.generation === 'running'} onClick={() => act('retry', card.id)}>{copy(locale, '重试', 'Retry')}</button>
        </div>
      </details>
    ))}
  </section>
}

function RecapBackgroundSeat({ client, ...props }: { client: RecapClient } & Record<string, unknown>) {
  const seat = useNativeSeat(client, props)
  if (!seat.sessionId) return null
  return <RecapEventsCard key={recapCardKey(seat)} client={client} sessionId={seat.sessionId} locale={seat.locale} hidden={seat.hidden} quiet />
}

export function apply(ctx: Context): void {
  const client = ctx as RecapClient
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@klarkxy/dsh-recap')
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-recap.styles')
  ctx.effect(() => client.slots.inject(CHAT_EVENTS_SLOT, () => client.slots.register({
    name: CHAT_EVENTS_SLOT, id: 'recap', order: 40, label: '回顾',
  }, (props: unknown) => <RecapBackgroundSeat client={client} {...(props as object)} />)), 'dsh-recap.background')
}
