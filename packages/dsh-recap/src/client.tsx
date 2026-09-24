import type { Context } from '@deepseek-ai/cordis'
import { CHAT_EVENTS_SLOT } from '@klarkxy/dsh-ai-services/contracts'
import { useFeatureRefresh, useNativeSeat, type NativeSurfaceClient } from '@klarkxy/dsh-ai-services/client-utils'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import {
  RECAP_RPC_CHANNEL, defaultSettings,
  type RecapCard, type RecapSettings, type RecapStatus, type RpcResult, type TaskCheckpoint,
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

function minutesOf(ms: number): number {
  return Math.round(ms / 60_000)
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
.dsh-recap-settings,.dsh-recap-card{font:inherit;color:inherit}
.dsh-recap-settings{display:grid;gap:16px;max-width:42rem}
.dsh-recap-settings h3{margin:0;font-size:var(--font-size-3,16px);font-weight:600}
.dsh-recap-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start;padding:12px 0;border-top:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent))}
.dsh-recap-row p{margin:4px 0 0;font-size:var(--font-size-1,13px);opacity:.75}
.dsh-recap-settings button,.dsh-recap-card button{font:inherit}
.dsh-recap-settings button:not([role="switch"]):not([role="tab"]),.dsh-recap-card button:not([role="switch"]):not([role="tab"]){min-height:34px;padding:6px 12px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:8px;background:transparent;color:inherit;cursor:pointer;justify-self:start;transition:background-color 150ms ease,color 150ms ease,border-color 150ms ease,box-shadow 150ms ease,transform 150ms ease}
.dsh-recap-settings button:not([role="switch"]):not([role="tab"]):hover:not(:disabled),.dsh-recap-card button:not([role="switch"]):not([role="tab"]):hover:not(:disabled){background:var(--gray-3,color-mix(in srgb,currentColor 6%,transparent));border-color:color-mix(in srgb,currentColor 35%,transparent)}
.dsh-recap-settings button:not([role="switch"]):not([role="tab"]):active:not(:disabled),.dsh-recap-card button:not([role="switch"]):not([role="tab"]):active:not(:disabled){transform:scale(.97)}
.dsh-recap-settings button:disabled,.dsh-recap-card button:disabled{opacity:.45;cursor:not-allowed}
.dsh-recap-settings [role="tablist"]{display:flex;gap:20px;border-bottom:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent))}
.dsh-recap-settings button[role="tab"]{padding:8px 0;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--gray-11,inherit);cursor:pointer;transition:color 150ms ease,border-color 150ms ease}
.dsh-recap-settings button[role="tab"]:hover:not(:disabled){color:inherit}
.dsh-recap-settings button[role="tab"][aria-selected="true"]{border-bottom-color:var(--accent-9,#3b82f6);color:var(--accent-11,inherit);font-weight:600}
.dsh-recap-settings [role="tabpanel"]{border-radius:12px}
.dsh-recap-settings input{box-sizing:border-box;width:100%;min-width:0;padding:8px 10px;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 22%,transparent));border-radius:8px;background:var(--color-surface,transparent);color:inherit;font:inherit;transition:border-color 150ms ease,box-shadow 150ms ease}
.dsh-recap-settings input:focus{border-color:var(--accent-9,#3b82f6);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent-9,#3b82f6) 25%,transparent)}
.dsh-recap-settings :focus-visible,.dsh-recap-card :focus-visible{outline:2px solid var(--accent-9,currentColor);outline-offset:3px}
.dsh-recap-switch{width:40px;height:24px;border:0;border-radius:999px;background:var(--gray-7,color-mix(in srgb,currentColor 22%,transparent));position:relative}
.dsh-recap-switch[aria-checked="true"]{background:var(--accent-9,#3b82f6)}
.dsh-recap-switch::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s}
.dsh-recap-switch[aria-checked="true"]::after{transform:translateX(16px)}
.dsh-recap-history{margin:0;padding:0;list-style:none;display:grid;gap:8px}
.dsh-recap-history li,.dsh-recap-card details{padding:10px 4px;border-top:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent));border-radius:10px}
.dsh-recap-card{max-width:42rem}
.dsh-recap-card pre{margin:8px 0 0;white-space:pre-wrap;font:inherit}
.dsh-recap-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.dsh-recap-error{color:var(--red-9,#b91c1c)}
@media(prefers-reduced-motion:reduce){.dsh-recap-switch::after{transition:none}.dsh-recap-settings button,.dsh-recap-card button,.dsh-recap-settings input{transition:none}}
`

function Switch({ pressed, label, disabled, onToggle }: { pressed: boolean; label: string; disabled?: boolean; onToggle(): void }) {
  return <button type="button" role="switch" className="dsh-recap-switch" aria-checked={pressed} aria-label={label} disabled={disabled}
    onClick={onToggle} />
}

function IdleMinutesInput({ minutes, disabled, onCommit }: { minutes: number; disabled?: boolean; onCommit(minutes: number): void }) {
  const [draft, setDraft] = useState<string>()
  function commit() {
    if (draft === undefined) return
    const next = Number(draft)
    setDraft(undefined)
    if (!Number.isInteger(next) || next < 1 || next > 180 || next === minutes) return
    onCommit(next)
  }
  return <input type="number" min={1} max={180} step={1} disabled={disabled}
    value={draft ?? String(minutes)} aria-label="闲置返回分钟"
    onChange={event => setDraft(event.target.value)}
    onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') commit() }} />
}

export function RecapSettingsPanel({ client, sessionId, locale }: { client: RecapClient; sessionId: string; locale?: string }) {
  const rpc = client.connection.rpc
  const tabsId = useId()
  const [tab, setTab] = useState<'options' | 'history'>('options')
  const [status, setStatus] = useState<RecapStatus>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const workRef = useRef<RecapClientWork>(undefined)
  if (!workRef.current) workRef.current = createRecapClientWork()
  const work = workRef.current

  useEffect(() => () => { work.dispose() }, [work])

  useEffect(() => {
    const generation = work.beginLoad()
    setError('')
    void runRecapStatusLoad({
      rpc,
      isCurrent: () => work.isLoad(generation),
      failedMessage: '无法读取回顾设置。',
      onStatus: setStatus,
      onError: setError,
    })
    return () => { if (work.isLoad(generation)) work.beginLoad() }
  }, [rpc, work])

  async function save(patch: Partial<Omit<RecapSettings, 'revision'>>) {
    if (!status) return
    const token = work.beginRequest()
    const isCurrent = () => work.isRequest(token)
    setBusy(true); setError('')
    try {
      const { revision, ...rest } = status.settings
      const next = await recapCall<RecapStatus>(rpc, 'update', { expectedRevision: revision, settings: { ...rest, ...patch } })
      if (!isCurrent()) return
      setStatus(next)
    } catch (cause) {
      if (!isCurrent()) return
      setError(cause instanceof Error ? cause.message : '保存失败。')
      try {
        const next = await recapCall<RecapStatus>(rpc, 'status')
        if (!isCurrent()) return
        setStatus(next)
      } catch { /* keep the save error */ }
    } finally {
      if (!isCurrent()) return
      setBusy(false)
    }
  }

  if (!status) {
    return <section className="dsh-recap-settings"><p role="status">{error || '正在读取设置…'}</p></section>
  }
  const settings = status.settings
  return <section className="dsh-recap-settings">
    <div role="tablist" aria-label="回顾设置" onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      const index = buttons.indexOf(event.target as HTMLButtonElement)
      if (index < 0) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
      buttons[next]?.click()
    }}>
      {([['options', '能力'], ['history', '记录']] as const).map(([key, label]) => (
        <button key={key} type="button" role="tab" id={`${tabsId}-${key}-tab`} aria-selected={tab === key}
          aria-controls={`${tabsId}-${key}-panel`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)}>{label}</button>
      ))}
    </div>
    {error ? <p role="alert" className="dsh-recap-error">{error}</p> : null}
    {status.storageFailed ? <p role="alert" className="dsh-recap-error">保存失败，仍显示上次成功写入的内容。</p> : null}
    {sessionId ? <RecapEventsCard client={client} sessionId={sessionId} locale={locale} idle={false} /> : null}
    <div role="tabpanel" id={`${tabsId}-options-panel`} hidden={tab !== 'options'} aria-labelledby={`${tabsId}-options-tab`} tabIndex={0}>
      <div className="dsh-recap-row">
        <div>
          <h3>回顾卡片</h3>
          <p>插件本身可整体关闭。启用后默认显示折叠回顾。闲置返回默认 15 分钟；助手输出不算活动。</p>
        </div>
        <Switch pressed={settings.cardsEnabled} disabled={busy} label="回顾卡片" onToggle={() => void save({ cardsEnabled: !settings.cardsEnabled })} />
      </div>
      <label className="dsh-recap-row">
        <span>闲置返回（分钟）</span>
        <IdleMinutesInput minutes={minutesOf(settings.idleReturnMs)} disabled={busy || !settings.cardsEnabled}
          onCommit={minutes => void save({ idleReturnMs: minutes * 60_000 })} />
      </label>
      <div className="dsh-recap-row">
        <div>
          <h3>检查点</h3>
          <p>默认开启，维持搭档跨步的连贯性。在下一步前交出，有界检查点不会变成每次工具调用都注入；可在此关闭。</p>
        </div>
        <Switch pressed={settings.checkpointsEnabled} disabled={busy} label="检查点"
          onToggle={() => void save({ checkpointsEnabled: !settings.checkpointsEnabled, semanticCheckpointsEnabled: settings.checkpointsEnabled ? false : settings.semanticCheckpointsEnabled })} />
      </div>
      <div className="dsh-recap-row">
        <div>
          <h3>语义检查点</h3>
          <p>默认开启。仅在有意义的边界额外调用模型；关闭检查点时此项无效。</p>
        </div>
        <Switch pressed={settings.checkpointsEnabled && settings.semanticCheckpointsEnabled} disabled={busy || !settings.checkpointsEnabled} label="语义检查点"
          onToggle={() => void save({ semanticCheckpointsEnabled: !settings.semanticCheckpointsEnabled })} />
      </div>
    </div>
    <div role="tabpanel" id={`${tabsId}-history-panel`} hidden={tab !== 'history'} aria-labelledby={`${tabsId}-history-tab`} tabIndex={0}>
      <HistoryList cards={status.cards} checkpoints={status.checkpoints} busy={busy} rpc={rpc} work={work}
        onChange={next => setStatus(next)} onError={setError} onBusy={setBusy} />
    </div>
  </section>
}

function HistoryList({
  cards, checkpoints, busy, rpc, work, onChange, onError, onBusy,
}: {
  cards: RecapCard[]
  checkpoints: TaskCheckpoint[]
  busy: boolean
  rpc: RpcCaller
  work: RecapClientWork
  onChange(status: RecapStatus): void
  onError(message: string): void
  onBusy(busy: boolean): void
}) {
  function act(endpoint: 'cancel' | 'retry', cardId: string) {
    const token = work.beginRequest()
    void runRecapAct({
      rpc,
      sessionId: cards.find(card => card.id === cardId)?.sessionId ?? '',
      endpoint,
      cardId,
      isCurrent: () => work.isRequest(token),
      failedMessage: '操作失败。',
      onBusy,
      onStatus: onChange,
      onError,
    })
  }
  return <>
    <h3>回顾</h3>
    {cards.length === 0 ? <p>还没有回顾。</p> : <ul className="dsh-recap-history">
      {cards.map(card => <li key={card.id}>
        <strong>{card.title}</strong>
        <p>{card.sessionId} · {card.sourceStatus} · {card.kind}</p>
        <div className="dsh-recap-actions">
          {card.generation === 'running' ? <button type="button" disabled={busy} onClick={() => act('cancel', card.id)}>取消</button> : null}
          <button type="button" disabled={busy || card.generation === 'running'} onClick={() => act('retry', card.id)}>重试</button>
        </div>
      </li>)}
    </ul>}
    <h3>检查点</h3>
    {checkpoints.length === 0 ? <p>还没有检查点。</p> : <ul className="dsh-recap-history">
      {checkpoints.map(row => <li key={row.id}>
        <strong>{row.fromSeq}–{row.toSeq}</strong>
        <p>{row.status} · {row.nextAction}</p>
      </li>)}
    </ul>}
  </>
}

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

function RecapSettingsSeat({ client }: { client: RecapClient }) {
  const seat = useNativeSeat(client, {})
  return <RecapSettingsPanel client={client} sessionId={seat.sessionId} locale={seat.locale} />
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
