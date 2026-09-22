import type { Context } from '@deepseek-ai/cordis'
import { useFeatureRefresh, useNativeSeat, type NativeSurfaceClient } from '@klarkxy/dsh-ai-services/client-utils'
import { useEffect, useId, useRef, useState } from 'react'
import {
  CHAT_EVENTS_SLOT, MOOD_RPC_CHANNEL, defaultSettings, type ClarificationItem, type MoodLocale, type MoodMode,
  type MoodStatus, type RpcResult, type TaskContract,
} from './contracts.ts'
import { readinessLabel } from './contracts.ts'

export const name = 'dsh-mood-client'
export const inject = ['slots', 'connection', 'sessions', 'locale'] as const

type Client = NativeSurfaceClient & {
  connection: {
    rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }
    generation?: { subscribe(listener: () => void): () => void }
  }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; id: string; label: string; order: number }, render: unknown): () => void
  }
}

export interface MoodSeatProps {
  sessionId?: string
  locale?: MoodLocale
  hidden?: boolean
}

function unwrap<T>(result: RpcResult<T> | unknown): T {
  const row = result as RpcResult<T>
  if (!row || typeof row !== 'object' || !('ok' in row)) throw new Error('请求失败。')
  if (!row.ok) throw new Error(row.error.message)
  return row.value
}

export function copy(locale: MoodLocale) {
  if (locale === 'en') {
    return {
      settings: 'Requirements',
      auto: 'Auto',
      manual: 'Manual',
      strict: 'Strict',
      hint: 'Clear requests skip analysis. Confirmation is not file or publish approval.',
      card: 'Task contract',
      amend: 'Amend',
      reanalyze: 'Reanalyze',
      retry: 'Retry original',
      save: 'Save',
      loading: 'Loading…',
      empty: 'No contract yet.',
      goal: 'Goal',
      evidence: 'Evidence',
      questions: 'Questions',
      recovery: 'The original request is waiting. Retry or reanalyze it; it has not been executed.',
      sessionHint: 'Select a session to view its task contract.',
    }
  }
  return {
    settings: '需求澄清',
    auto: '自动',
    manual: '手动',
    strict: '严格',
    hint: '表述清楚的请求不调用分析。确认需求不能代替文件或发布审批。',
    card: '任务约定',
    amend: '修订',
    reanalyze: '重新分析',
    retry: '按原请求重试',
    save: '保存',
    loading: '正在读取…',
    empty: '还没有任务约定。',
    goal: '目标',
    evidence: '证据',
    questions: '澄清',
    recovery: '原请求尚未执行。可重试或手动分析，不会另造一条提问。',
    sessionHint: '选择一个会话后可以查看该会话的任务约定。',
  }
}

export function modeFromKey(current: MoodMode, key: string): MoodMode | undefined {
  const order: MoodMode[] = ['auto', 'manual', 'strict']
  const index = order.indexOf(current)
  if (key === 'Home') return 'auto'
  if (key === 'End') return 'strict'
  if (key === 'ArrowRight' || key === 'ArrowDown') return order[(index + 1) % order.length]
  if (key === 'ArrowLeft' || key === 'ArrowUp') return order[(index + order.length - 1) % order.length]
  return undefined
}

export function shouldShowCard(
  hidden: boolean,
  contract: TaskContract | undefined,
  pendingManual: boolean,
  recovery = false,
): boolean {
  if (hidden) return false
  return Boolean(contract) || pendingManual || recovery
}

export function isCurrentMoodRequest(input: {
  mounted: boolean
  sessionId: string
  viewSessionId: string
  requestId: number
  latestRequestId: number
}): boolean {
  return input.mounted && input.sessionId === input.viewSessionId && input.requestId === input.latestRequestId
}

export function shouldSkipMoodRefresh(input: { busy: boolean; editing?: boolean }): boolean {
  return input.busy || input.editing === true
}

/** Read-only status peek; does not bump request generation or abort an in-flight edit. */
export async function peekMoodStatus(input: {
  call: (endpoint: string, payload: unknown) => Promise<unknown>
  sessionId: string
  requestId: number
  latestRequestId: () => number
  viewSessionId: () => string
  mounted: () => boolean
  busy: () => boolean
  editing?: () => boolean
}): Promise<MoodStatus | undefined> {
  if (shouldSkipMoodRefresh({ busy: input.busy(), editing: input.editing?.() === true })) return undefined
  if (!input.sessionId || input.requestId === 0) return undefined
  try {
    const next = unwrap<MoodStatus>(await input.call('status', { sessionId: input.sessionId }) as RpcResult<MoodStatus>)
    if (shouldSkipMoodRefresh({ busy: input.busy(), editing: input.editing?.() === true })) return undefined
    if (!isCurrentMoodRequest({
      mounted: input.mounted(),
      sessionId: input.sessionId,
      viewSessionId: input.viewSessionId(),
      requestId: input.requestId,
      latestRequestId: input.latestRequestId(),
    })) return undefined
    return next
  } catch {
    return undefined
  }
}

export function shouldOfferRecovery(status: MoodStatus | undefined): boolean {
  const session = status?.session
  if (!session) return false
  if (session.held || session.pendingManual) return true
  const readiness = session.contract?.readiness
  if (readiness === 'pending' || readiness === 'cancelled') return true
  return session.clarification.some(item => item.status === 'pending' || item.status === 'cancelled')
}

function MoodModePanel({ client, locale }: { client: Client; locale: MoodLocale }) {
  const text = copy(locale)
  const groupId = useId()
  const [status, setStatus] = useState<MoodStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const requestId = useRef(0)

  async function call<T>(endpoint: string, payload: unknown = {}): Promise<T> {
    return unwrap(await client.connection.rpc.call(MOOD_RPC_CHANNEL, endpoint, payload) as RpcResult<T>)
  }
  useEffect(() => {
    const id = ++requestId.current
    let mounted = true
    void call<MoodStatus>('status').then(next => {
      if (!isCurrentMoodRequest({ mounted, sessionId: '', viewSessionId: '', requestId: id, latestRequestId: requestId.current })) return
      setStatus(next)
    }).catch(() => {
      if (mounted && id === requestId.current) setError('无法读取需求澄清设置。')
    })
    return () => { mounted = false }
  }, [client])

  async function action(run: () => Promise<void>) {
    setBusy(true); setNote(''); setError('')
    try { await run() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败。') }
    finally { setBusy(false) }
  }

  const mode = status?.settings.mode ?? defaultSettings().mode
  return <section className="mood-settings" data-testid="mood-settings">
    <h3>{text.settings}</h3>
    {error ? <p role="alert">{error}</p> : null}
    {note ? <p role="status">{note}</p> : null}
    {!status ? <p role="status">{text.loading}</p> : null}
    <div role="radiogroup" aria-label={text.settings} onKeyDown={event => {
      const next = modeFromKey(mode, event.key)
      if (!next || busy || !status) return
      event.preventDefault()
      void action(async () => {
        const updated = await call<MoodStatus>('mode', { mode: next, expectedRevision: status.settings.revision })
        setStatus(updated)
        setNote('已保存。')
      })
    }}>
      {([['auto', text.auto], ['manual', text.manual], ['strict', text.strict]] as const).map(([value, label]) => (
        <label key={value}>
          <input id={`${groupId}-${value}`} type="radio" name={groupId} value={value}
            checked={mode === value} disabled={busy || !status}
            onChange={() => {
              if (!status) return
              void action(async () => {
                const updated = await call<MoodStatus>('mode', { mode: value, expectedRevision: status.settings.revision })
                setStatus(updated)
                setNote('已保存。')
              })
            }} />
          {label}
        </label>
      ))}
    </div>
    <p className="mood-meta">{text.hint}</p>
  </section>
}

function MoodContractCard({ client, sessionId, locale, hidden, surface = 'chat' }: MoodSeatProps & {
  client: Client
  surface?: 'chat' | 'settings'
}) {
  const text = copy(locale === 'en' ? 'en' : 'zh')
  const [status, setStatus] = useState<MoodStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [goal, setGoal] = useState('')
  const requestId = useRef(0)
  const viewSession = useRef(sessionId ?? '')
  const liveRef = useRef(true)
  const busyRef = useRef(false)
  const editingRef = useRef(false)
  busyRef.current = busy
  editingRef.current = editing

  async function call<T>(endpoint: string, payload: unknown): Promise<T> {
    return unwrap(await client.connection.rpc.call(MOOD_RPC_CHANNEL, endpoint, payload) as RpcResult<T>)
  }
  useEffect(() => {
    liveRef.current = true
    return () => { liveRef.current = false }
  }, [])
  useEffect(() => {
    viewSession.current = sessionId ?? ''
    const id = ++requestId.current
    setStatus(undefined)
    setEditing(false)
    setError('')
    if (!sessionId) return
    let mounted = true
    void call<MoodStatus>('status', { sessionId }).then(next => {
      if (!isCurrentMoodRequest({
        mounted,
        sessionId,
        viewSessionId: viewSession.current,
        requestId: id,
        latestRequestId: requestId.current,
      })) return
      setStatus(next)
      setGoal(next.session?.contract?.goal ?? '')
    }).catch(() => {
      if (!isCurrentMoodRequest({
        mounted,
        sessionId,
        viewSessionId: viewSession.current,
        requestId: id,
        latestRequestId: requestId.current,
      })) return
      setError('无法读取任务约定。')
    })
    return () => { mounted = false }
  }, [client, sessionId])

  useFeatureRefresh(client, sessionId ?? '', () => {
    void peekMoodStatus({
      call: (endpoint, payload) => client.connection.rpc.call(MOOD_RPC_CHANNEL, endpoint, payload),
      sessionId: viewSession.current,
      requestId: requestId.current,
      latestRequestId: () => requestId.current,
      viewSessionId: () => viewSession.current,
      mounted: () => liveRef.current,
      busy: () => busyRef.current,
      editing: () => editingRef.current,
    }).then(next => {
      if (!next) return
      setStatus(next)
      if (!editingRef.current) setGoal(next.session?.contract?.goal ?? '')
    })
  }, Boolean(status?.session?.pendingManual) && !busy, Boolean(sessionId) && (surface === 'settings' || !hidden))

  const contract = status?.session?.contract
  const pendingManual = Boolean(status?.session?.pendingManual)
  const recovery = shouldOfferRecovery(status)
  if (surface !== 'settings' && !shouldShowCard(Boolean(hidden), contract, pendingManual, recovery)) return null

  async function action(run: () => Promise<void>) {
    const id = requestId.current
    const view = viewSession.current
    setBusy(true); setError('')
    try {
      await run()
    } catch (cause) {
      if (!isCurrentMoodRequest({
        mounted: true,
        sessionId: view,
        viewSessionId: viewSession.current,
        requestId: id,
        latestRequestId: requestId.current,
      })) return
      setError(cause instanceof Error ? cause.message : '操作失败。')
    } finally {
      if (isCurrentMoodRequest({
        mounted: true,
        sessionId: view,
        viewSessionId: viewSession.current,
        requestId: id,
        latestRequestId: requestId.current,
      })) setBusy(false)
    }
  }

  return <article className="mood-card" data-testid="mood-contract-card" data-session={sessionId || undefined}>
    <header>
      <h3>{text.card}</h3>
      {contract ? <span className="mood-meta">{readinessLabel(contract.readiness)}</span> : null}
    </header>
    {error ? <p role="alert">{error}</p> : null}
    {recovery ? <p role="status">{text.recovery}</p> : null}
    {contract ? <p>{text.goal}：{contract.goal || text.empty}</p> : <p>{text.empty}</p>}
    {contract?.evidence.length ? <ul aria-label={text.evidence}>
      {contract.evidence.map((item: { kind: string; seq: number; excerpt?: string }) => (
        <li key={`${item.kind}-${item.seq}`}>{item.excerpt ?? `#${item.seq}`}</li>
      ))}
    </ul> : null}
    {(status?.session?.clarification ?? []).length ? <ul aria-label={text.questions}>
      {(status?.session?.clarification ?? []).map((item: ClarificationItem) => (
        <li key={item.id}>[{item.status}] {item.question}{item.answer ? ` → ${item.answer}` : ''}</li>
      ))}
    </ul> : null}
    {editing ? <label>{text.goal}
      <textarea aria-label={text.goal} rows={3} value={goal} disabled={busy}
        onChange={event => setGoal(event.target.value)} />
    </label> : null}
    <div className="mood-actions">
      <button type="button" disabled={busy || !contract} onClick={() => {
        if (editing && contract && sessionId) {
          const view = sessionId
          const id = requestId.current
          void action(async () => {
            const next = await call<MoodStatus>('edit', {
              sessionId: view, expectedRevision: contract.revision, patch: { goal },
            })
            if (!isCurrentMoodRequest({
              mounted: true, sessionId: view, viewSessionId: viewSession.current, requestId: id, latestRequestId: requestId.current,
            })) return
            setStatus(next)
            setEditing(false)
          })
          return
        }
        setEditing(true)
      }}>{editing ? text.save : text.amend}</button>
      <button type="button" disabled={busy || !sessionId} onClick={() => {
        const view = sessionId
        if (!view) return
        const id = requestId.current
        void action(async () => {
          const next = await call<MoodStatus>('manual', { sessionId: view })
          if (!isCurrentMoodRequest({
            mounted: true, sessionId: view, viewSessionId: viewSession.current, requestId: id, latestRequestId: requestId.current,
          })) return
          setStatus(next)
        })
      }}>{text.reanalyze}</button>
      {recovery ? <button type="button" disabled={busy || !sessionId || !status?.session?.held} onClick={() => {
        const view = sessionId
        if (!view) return
        const id = requestId.current
        void action(async () => {
          const next = await call<MoodStatus>('retry', { sessionId: view })
          if (!isCurrentMoodRequest({
            mounted: true, sessionId: view, viewSessionId: viewSession.current, requestId: id, latestRequestId: requestId.current,
          })) return
          setStatus(next)
        })
      }}>{text.retry}</button> : null}
    </div>
  </article>
}

export function moodPanelKey(sessionId: string, locale: MoodLocale): string {
  return `${sessionId}:${locale}`
}

export function MoodSettings({ client, props }: { client: Client; props: unknown }) {
  const seat = useNativeSeat(client, props)
  const text = copy(seat.locale)
  return <div className="mood-settings-root" data-testid="mood-settings-root" data-session={seat.sessionId || undefined}>
    <MoodModePanel client={client} locale={seat.locale} />
    {seat.sessionId
      ? <MoodContractCard key={`contract:${moodPanelKey(seat.sessionId, seat.locale)}`} client={client}
          sessionId={seat.sessionId} locale={seat.locale} surface="settings" />
      : <p className="mood-meta">{text.sessionHint}</p>}
  </div>
}

export function MoodChatCard({ client, props }: { client: Client; props: unknown }) {
  const seat = useNativeSeat(client, props)
  if (seat.hidden || !seat.sessionId) return null
  return <MoodContractCard key={moodPanelKey(seat.sessionId, seat.locale)} client={client}
    sessionId={seat.sessionId} locale={seat.locale} hidden={seat.hidden} />
}

const styles = `
.mood-settings-root,.mood-settings,.mood-card{max-width:760px;display:grid;gap:12px;color:inherit;font:400 var(--font-size-2,14px)/1.5 var(--default-font-family,system-ui,sans-serif)}
.mood-settings-root{gap:16px}
.mood-settings h3,.mood-card h3{margin:0;font-size:var(--font-size-3,16px);font-weight:600}
.mood-settings p,.mood-card p,.mood-settings-root p{margin:0;line-height:1.5}
.mood-meta{font-size:var(--font-size-1,13px);color:var(--gray-11,inherit)}
.mood-settings [role="radiogroup"]{display:flex;flex-wrap:wrap;gap:12px 20px}
.mood-settings label{display:flex;gap:8px;align-items:center;min-height:32px}
.mood-card header{display:flex;justify-content:space-between;gap:12px;align-items:center}
.mood-card ul{margin:0;padding-left:1.2em}
.mood-card textarea{box-sizing:border-box;width:100%;min-width:0;padding:8px 10px;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 22%,transparent));border-radius:6px;background:var(--color-surface,transparent);color:inherit;font:inherit}
.mood-actions{display:flex;flex-wrap:wrap;gap:8px}
.mood-settings button,.mood-card button{min-height:34px;padding:6px 12px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:6px;background:transparent;color:inherit;cursor:pointer;font:inherit}
.mood-settings button:disabled,.mood-card button:disabled{opacity:.45;cursor:not-allowed}
.mood-settings :focus-visible,.mood-card :focus-visible,.mood-settings-root :focus-visible{outline:2px solid currentColor;outline-offset:3px}
`

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@klarkxy/dsh-mood')
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-mood.styles')
  ctx.effect(() => client.slots.inject('settings.section', () => client.slots.register({
    name: 'settings.section', id: 'mood', order: 55, label: '需求澄清',
  }, (props: unknown) => <MoodSettings client={client} props={props} />)), 'dsh-mood.settings')
  ctx.effect(() => client.slots.inject(CHAT_EVENTS_SLOT, () => client.slots.register({
    name: CHAT_EVENTS_SLOT, id: 'mood', order: 10, label: '需求约定',
  }, (props: unknown) => <MoodChatCard client={client} props={props} />)), 'dsh-mood.card')
}
