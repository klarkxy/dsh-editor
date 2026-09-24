import type { Context } from '@deepseek-ai/cordis'
import { CHAT_EVENTS_SLOT } from '@klarkxy/dsh-ai-services/contracts'
import { useNativeSeat, type NativeSurfaceClient } from '@klarkxy/dsh-ai-services/client-utils'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { FUSION_RPC_CHANNEL, type FusionCandidate, type FusionCandidateAction, type FusionPreview,
  type FusionStatus, type FusionTask, type RpcResult } from './contracts.ts'
import { acceptedCandidate, actionIdentity, activityLabel, canAdopt, currentTask, isCurrentAction, notifyAppliedReceipt, reconciledReceipt, taskAnchorTurn, type ObservedPendingApplication, type TurnEntry } from './client-projection.ts'
import { FusionClientStore, type FusionClientSources, type FusionEventSource } from './client-store.ts'
import { taskView, type FusionLocale } from './presentation.ts'
import { fusionClientStyles } from './client-styles.ts'

export const name = 'dsh-fusion-client'
export const inject = ['slots', 'connection', 'sessions', 'locale', 'uiWorkspace', 'uiSession'] as const
export const NATIVE_TURN_TAIL_SLOT = 'conversation.chat.turnTail'

type FusionClient = Omit<NativeSurfaceClient, 'sessions' | 'connection'> & {
  connection: FusionClientSources['connection']
  slots: {
    inject(key: string, register: () => unknown): () => void
    register(spec: { name: string; id: string; order: number; label: string }, render: unknown): () => void
  }
  sidebarRight?: { openResource(address: string, options?: { kind?: string; preferNewPane?: boolean }): void }
  sessions: {
    binding?(sessionId: string): { eventSource: FusionEventSource & { getSnapshot(): { entries: readonly TurnEntry[] } } } | undefined
  }
}

function label(locale: FusionLocale, zh: string, en: string): string { return locale === 'zh' ? zh : en }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }

export function candidateAction(sessionId: string, task: FusionTask, candidate: FusionCandidate): FusionCandidateAction {
  return { sessionId, taskId: task.id, taskRevision: task.revision, candidateId: candidate.id, hash: candidate.hash }
}

export function canRecover(task: FusionTask): boolean {
  return ['interrupted', 'review', 'decision'].includes(task.state)
    && Boolean(task.reportIds.at(-1)?.startsWith(`${task.revision}:`))
}

export function canResume(task: FusionTask): boolean {
  return ['decision', 'interrupted', 'failed'].includes(task.state) && task.delivery !== 'pending' && task.cleanup !== 'pending'
}

function useStatus(store: FusionClientStore, sessionId: string) {
  const subscribe = useCallback((listener: () => void) => sessionId ? store.subscribe(sessionId, listener) : () => {}, [store, sessionId])
  const snapshot = useCallback(() => store.snapshot(sessionId), [store, sessionId])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

function ExactPreview({ preview, locale }: { preview: FusionPreview; locale: FusionLocale }) {
  return <div className="dsh-fusion-preview-content">
    <p className="dsh-fusion-path" title={preview.path}>{preview.path}</p>
    <div className="dsh-fusion-compare">
      <section><h4>{label(locale, '当前原文', 'Current file')}</h4><pre>{preview.before}</pre></section>
      <section><h4>{label(locale, '采用后全文', 'Exact result')}</h4><pre>{preview.after}</pre></section>
    </div>
  </div>
}

function PreviewDialog(props: {
  preview: FusionPreview; locale: FusionLocale; busy: boolean; onClose(): void; onApply(): void; returnTo: HTMLElement | null
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close(); props.returnTo?.focus() }
  }, [props.returnTo])
  return <dialog ref={ref} className="dsh-fusion-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!props.busy) props.onClose() }}
    onClose={() => { if (!props.busy) props.onClose() }}>
    <div className="dsh-fusion-dialog-head">
      <h3 id={titleId}>{label(props.locale, '审阅写入内容', 'Review exact change')}</h3>
      <button type="button" onClick={props.onClose} disabled={props.busy} aria-label={label(props.locale, '关闭预览', 'Close preview')}>×</button>
    </div>
    <ExactPreview preview={props.preview} locale={props.locale} />
    <p className="dsh-fusion-hint">{label(props.locale, '确认后将按当前文件版本写入；原文变化会阻止应用。', 'Confirming writes against this file version; changes to the source will block application.')}</p>
    <div className="dsh-fusion-actions">
      <button type="button" onClick={props.onClose} disabled={props.busy}>{label(props.locale, '返回', 'Back')}</button>
      <button type="button" className="dsh-fusion-primary" onClick={props.onApply} disabled={props.busy}>
        {props.busy ? label(props.locale, '正在应用…', 'Applying…') : label(props.locale, '确认采用', 'Apply change')}
      </button>
    </div>
  </dialog>
}

function FusionTaskCard(props: {
  client: FusionClient; store: FusionClientStore; status: FusionStatus; sessionId: string; locale: FusionLocale; native: boolean; loadError?: string; onApplied?: (path: string) => void
}) {
  const { client, store, status, sessionId, locale, native } = props
  const pair = status.pair
  const task = currentTask(pair)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<FusionPreview>()
  const [feedback, setFeedback] = useState('')
  const returnTo = useRef<HTMLElement | null>(null)
  const mounted = useRef(true)
  const current = useRef('')
  const busyRef = useRef(false)
  const candidate = task?.candidates.at(-1)
  current.current = task ? actionIdentity(sessionId, task, candidate) : ''
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setError(''); setPreview(undefined); setFeedback(''); setBusy(''); busyRef.current = false }, [sessionId, task?.id, task?.revision, task?.state, task?.updatedAt, task?.adoption, candidate?.hash])
  useEffect(() => {
    if (!task || !candidate || !preview) return
    if (preview.candidateId !== candidate.id || preview.hash !== candidate.hash || !pair || !canAdopt(pair, task) || props.loadError || status.error) setPreview(undefined)
  }, [task, candidate, pair, preview, props.loadError, status.error])
  if (!pair || !task || pair.leadSessionId !== sessionId) return null
  const view = taskView(pair, task, locale)
  const staleStatus = Boolean(props.loadError || status.error)
  const allowed = !staleStatus && canAdopt(pair, task)
  const accepted = acceptedCandidate(task)
  const key = actionIdentity(sessionId, task, candidate)
  const isCurrent = () => isCurrentAction(mounted.current, key, current.current)
  const identity = { sessionId, taskId: task.id, taskRevision: task.revision }

  async function call(endpoint: string, payload: unknown): Promise<unknown> {
    const result = await client.connection.rpc.call(FUSION_RPC_CHANNEL, endpoint, payload) as RpcResult
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  async function act(endpoint: string, payload: unknown, success?: (value: unknown) => void): Promise<void> {
    if (!isCurrent() || busyRef.current || staleStatus) return
    busyRef.current = true; setBusy(endpoint); setError('')
    store.invalidate(sessionId)
    try {
      const value = await call(endpoint, payload)
      if (isCurrent()) success?.(value)
    } catch (cause) {
      if (isCurrent()) setError(errorText(cause))
    } finally {
      if (isCurrent()) { busyRef.current = false; setBusy('') }
      await store.refresh(sessionId)
    }
  }

  // Preview is a read, but must retain the exact Host version returned by the command.
  async function loadPreview(event: React.MouseEvent<HTMLButtonElement>): Promise<void> {
    if (!allowed || !candidate || candidate.id !== accepted?.id || busyRef.current || !isCurrent()) return
    returnTo.current = event.currentTarget
    busyRef.current = true; setBusy('preview'); setError('')
    try {
      const value = await call('preview', candidateAction(sessionId, task!, candidate)) as FusionPreview
      if (isCurrent() && value.candidateId === candidate.id && value.hash === candidate.hash) setPreview(value)
    } catch (cause) {
      if (isCurrent()) setError(errorText(cause))
    } finally {
      if (isCurrent()) { busyRef.current = false; setBusy('') }
    }
  }

  async function applyPreview(): Promise<void> {
    if (!preview || staleStatus || !allowed || !candidate || preview.candidateId !== candidate.id || preview.hash !== candidate.hash) return
    const exactPreview = preview
    await act('apply', { ...candidateAction(sessionId, task!, candidate), expectedVersion: exactPreview.version }, value => {
      const confirmed = notifyAppliedReceipt({ value, task: task!, candidate, preview: exactPreview, isCurrent,
        notify: receipt => { if (props.onApplied) store.announceApplied(sessionId, receipt.id, receipt.path, props.onApplied) },
      })
      if (!confirmed) throw new Error(label(locale, '宿主未确认当前预览已应用，请刷新状态核对。',
        'The Host did not confirm this exact preview. Refresh status to inspect the result.'))
      setPreview(undefined)
    })
  }

  function openChild(): void {
    try { if (!client.sidebarRight) throw new Error(label(locale, '原生侧栏不可用。', 'Native sidebar unavailable.'))
      client.sidebarRight.openResource(view.executionAddress, { kind: 'subagentchat', preferNewPane: true }) }
    catch (cause) { setError(errorText(cause)) }
  }

  function onFeedbackKey(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Escape') { setFeedback(''); event.currentTarget.blur() }
  }

  const recoverable = !staleStatus && canRecover(task) && (task.delivery === 'uncertain' || task.state === 'interrupted' || !task.notifiedReportId)
  const resumable = !staleStatus && canResume(task)
  const latestReview = task.reviews.at(-1)
  return <section className={`dsh-fusion-card${native ? ' is-native' : ''}`} data-session={sessionId} aria-label={label(locale, '协作任务', 'Collaboration task')}>
    <div className="dsh-fusion-head">
      <span className="dsh-fusion-kicker">{label(locale, '协作', 'Collaboration')}</span>
      <strong title={task.brief.title}>{task.brief.title}</strong>
      <span className="dsh-fusion-state" role="status">{view.status}</span>
      <button type="button" className="dsh-fusion-details" aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}>{expanded ? label(locale, '收起', 'Collapse') : label(locale, '详情', 'Details')}</button>
    </div>
    {view.detail ? <p className="dsh-fusion-detail">{view.detail}</p> : null}
    {status.activity ? <p className="dsh-fusion-activity">
      {label(locale, '统筹', 'Lead')}: {activityLabel(status.activity.lead, locale)} · {label(locale, pair.profile === 'writing' ? '执笔' : '搭档', 'Sidekick')}: {activityLabel(status.activity.sidekick, locale)}
    </p> : null}
    {status.usage && (status.usage.leadTokens !== null || status.usage.sidekickTokens !== null) ?
      <p className="dsh-fusion-usage">{label(locale, '原生会话累计 token', 'Native session tokens')} ·
        {status.usage.leadTokens !== null ? ` ${label(locale, '统筹', 'Lead')} ${status.usage.leadTokens.toLocaleString()}` : ''}
        {status.usage.sidekickTokens !== null ? ` ${label(locale, pair.profile === 'writing' ? '执笔' : '搭档', 'Sidekick')} ${status.usage.sidekickTokens.toLocaleString()}` : ''}
      </p> : null}
    {error || props.loadError ? <p className="dsh-fusion-error" role="alert">{error || props.loadError}</p> : null}
    {props.loadError ? <button type="button" onClick={() => void store.refresh(sessionId)}>{label(locale, '重试读取', 'Retry status')}</button> : null}
    {expanded ? <div className="dsh-fusion-body">
      <p className="dsh-fusion-goal">{task.brief.goal}</p>
      <p className="dsh-fusion-route">{label(locale, '搭档模型', 'Sidekick model')}: {pair.route.provider} / {pair.route.model}{pair.route.reasoningEffort ? ` · ${pair.route.reasoningEffort}` : ''}</p>
      {task.brief.acceptance.length ? <details><summary>{label(locale, '验收要求', 'Acceptance')}</summary><ul>
        {task.brief.acceptance.map((item, index) => <li key={index}>{item}</li>)}
      </ul></details> : null}
      {candidate ? <details><summary>{view.candidateLabel ?? label(locale, '候选', 'Candidate')}</summary>
        <p className="dsh-fusion-report">{candidate.report}</p>
        <pre className="dsh-fusion-candidate">{candidate.text}</pre>
      </details> : task.decision ? <p>{task.decision}</p> : null}
      {latestReview ? <p className="dsh-fusion-review">
        {label(locale, '统筹审查', 'Lead review')}: {latestReview.verdict === 'accept' ? label(locale, '通过', 'Accepted')
          : latestReview.verdict === 'revise' ? label(locale, '要求修改', 'Revision requested') : label(locale, '未通过', 'Rejected')}
        {latestReview.feedback ? ` · ${latestReview.feedback}` : ''}
      </p> : null}
      {task.delivery === 'uncertain' ? <p className="dsh-fusion-warning" role="status">{task.reportIds.length
        ? label(locale, '报告通知结果不确定。请核对原生记录，再明确重送已保存的报告。',
          'Report notification is uncertain. Inspect native history, then explicitly re-notify the Lead of the saved report.')
        : label(locale, '初次交接结果不确定。请核对搭档会话，勿直接重发同一任务。',
          'Initial admission is uncertain. Inspect the Sidekick session before starting another task.')}</p> : null}
      {task.application?.state === 'pending' ? <p className="dsh-fusion-warning">{label(locale,
        '写入结果待宿主核对，请刷新状态后再操作。', 'The Host is reconciling the write. Refresh status before acting.')}</p> : null}
      {native ? <button type="button" onClick={openChild}>{label(locale, pair.profile === 'writing' ? '查看执笔会话' : '查看搭档会话', 'Open Sidekick session')}</button> : null}
    </div> : null}
    <div className="dsh-fusion-actions">
      {allowed ? <button type="button" disabled={Boolean(busy)} onClick={event => void loadPreview(event)}>
        {label(locale, '预览采用', 'Preview adoption')}</button> : null}
      {allowed && candidate ? <button type="button" disabled={Boolean(busy)}
        onClick={() => void act('dismiss', candidateAction(sessionId, task!, candidate))}>
        {label(locale, '放弃候选', 'Dismiss candidate')}</button> : null}
      {view.canStop ? <button type="button" disabled={Boolean(busy) || staleStatus}
        onClick={() => void act('cancel', identity)}>{label(locale, '停止协作任务', 'Stop task')}</button> : null}
      {recoverable ? <button type="button" disabled={Boolean(busy)}
        onClick={() => void act('recover', identity)}>{label(locale, '重送已保存报告', 'Re-notify saved report')}</button> : null}
      {task.cleanup === 'failed' || task.adoption === 'conflict' ? <button type="button" disabled={Boolean(busy)}
        onClick={() => void store.refresh(sessionId)}>{label(locale, '刷新状态', 'Refresh status')}</button> : null}
    </div>
    {resumable ? <div className="dsh-fusion-resume">
      <label htmlFor={`dsh-fusion-feedback-${task.id}`}>{label(locale, '给统筹的后续要求', 'Feedback to Lead')}</label>
      <textarea id={`dsh-fusion-feedback-${task.id}`} value={feedback} onChange={event => setFeedback(event.target.value)}
        onKeyDown={onFeedbackKey} rows={2} maxLength={4000} />
      <button type="button" disabled={Boolean(busy) || !feedback.trim()}
        onClick={() => void act('resume', { ...identity, feedback: feedback.trim() }, () => setFeedback(''))}>
        {label(locale, '继续协作', 'Continue collaboration')}</button>
    </div> : null}
    {preview ? <PreviewDialog preview={preview} locale={locale} busy={busy === 'apply'}
      returnTo={returnTo.current} onClose={() => setPreview(undefined)} onApply={() => void applyPreview()} /> : null}
  </section>
}

function appliedOwnerCallback(owner: unknown): ((path: string) => void) | undefined {
  if (!owner || typeof owner !== 'object') return undefined
  const row = owner as Record<string, unknown>
  const nested = row.owner && typeof row.owner === 'object' ? row.owner as Record<string, unknown> : undefined
  const callback = row.onApplied ?? nested?.onApplied
  return typeof callback === 'function' ? callback as (path: string) => void : undefined
}

function FusionSeat(props: { client: FusionClient; store: FusionClientStore; native: boolean; owner: unknown }) {
  const { client, store, native, owner } = props
  const seat = useNativeSeat(client, owner)
  const snapshot = useStatus(store, seat.sessionId)
  const task = currentTask(snapshot.status?.pair)
  const onApplied = native ? undefined : appliedOwnerCallback(owner)
  const observedPending = useRef<ObservedPendingApplication>()
  useEffect(() => {
    if (!onApplied || !seat.sessionId || seat.hidden || snapshot.error) { observedPending.current = undefined; return }
    const application = task?.application
    if (application?.state === 'pending' && task) {
      observedPending.current = { sessionId: seat.sessionId, taskId: task.id, id: application.id,
        path: application.path, candidateId: application.candidateId, candidateHash: application.candidateHash }
      return
    }
    const receipt = reconciledReceipt(observedPending.current, seat.sessionId, task)
    observedPending.current = undefined
    if (receipt) store.announceApplied(seat.sessionId, receipt.id, receipt.path, onApplied)
  }, [onApplied, seat.sessionId, seat.hidden, snapshot.error, task?.id, task?.adoption, task?.application, store])
  if (!seat.sessionId || seat.hidden) return null
  if (native && client.uiWorkspace.current) return null
  if (!native && !client.uiWorkspace.current) return null
  if (native) {
    const row = owner && typeof owner === 'object' ? owner as Record<string, unknown> : {}
    const turn = row.turn && typeof row.turn === 'object' ? (row.turn as { turn?: number }).turn : undefined
    const entries = client.sessions.binding?.(seat.sessionId)?.eventSource.getSnapshot().entries ?? []
    const anchor = task ? taskAnchorTurn(task, entries) : entries.map(item => item.event.data?.turn).filter(value => typeof value === 'number').at(-1)
    if (turn === undefined || anchor !== turn) return null
  }
  if (!snapshot.status) return snapshot.error ? <section className="dsh-fusion-card" role="alert">
    <strong>{label(seat.locale, '协作状态读取失败', 'Collaboration status unavailable')}</strong><p>{snapshot.error}</p>
    <button type="button" onClick={() => void store.refresh(seat.sessionId)}>{label(seat.locale, '重试', 'Retry')}</button>
  </section> : null
  if (!snapshot.status.available) return <section className="dsh-fusion-card" role="status">
    <strong>{label(seat.locale, '协作暂不可用', 'Collaboration unavailable')}</strong>
    <p>{snapshot.status.error ?? label(seat.locale, '检查插件或模型配置后刷新。', 'Check plugin or model configuration, then refresh.')}</p>
    <button type="button" onClick={() => void store.refresh(seat.sessionId)}>{label(seat.locale, '刷新状态', 'Refresh status')}</button>
  </section>
  if (!task) return native ? null : <section className="dsh-fusion-card" aria-label={label(seat.locale, '协作', 'Collaboration')}>
    <strong>{label(seat.locale, '协作', 'Collaboration')}</strong><p className="dsh-fusion-detail">{snapshot.status.error ?? (snapshot.status.configured
      ? label(seat.locale, '与统筹继续对话；需要执笔时由统筹交接。', 'Continue with the Lead; the Lead delegates writing when needed.')
      : label(seat.locale, '协作模型尚未配置，请在模型设置中完成配置。', 'Configure the collaboration model in model settings.'))}</p>
    {snapshot.status.error ? <button type="button" onClick={() => void store.refresh(seat.sessionId)}>{label(seat.locale, '刷新状态', 'Refresh status')}</button> : null}
  </section>
  return <FusionTaskCard client={client} store={store} status={snapshot.status} loadError={snapshot.error} onApplied={onApplied}
    sessionId={seat.sessionId} locale={seat.locale} native={native} />
}

/** The native turn-tail slot is session scoped. Its own SessionSnapshot identifies subagent children. */
function NativeFusionSeat(props: { client: FusionClient; store: FusionClientStore; owner: unknown }) {
  const row = props.owner && typeof props.owner === 'object' ? props.owner as Record<string, unknown> : {}
  const useSession = row.useSession as ((select: (snapshot: { subagent: unknown }) => boolean) => boolean) | undefined
  // The pinned native slot always injects useSession. Without it, fail closed before any Lead RPC.
  if (!useSession) return null
  const isChild = useSession(snapshot => Boolean(snapshot.subagent))
  if (isChild) return null
  return <FusionSeat client={props.client} store={props.store} native owner={props.owner} />
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as FusionClient
  const store = new FusionClientStore(client)
  ctx.effect(() => () => store.dispose(), 'dsh-fusion-client.store')
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@klarkxy/dsh-fusion')
    style.textContent = fusionClientStyles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-fusion-client.styles')
  ctx.effect(() => client.slots.inject(CHAT_EVENTS_SLOT, () => client.slots.register({
    name: CHAT_EVENTS_SLOT, id: 'fusion', order: 30, label: '协作',
  }, (owner: unknown) => <FusionSeat key={seatKey(owner)} client={client} store={store} native={false} owner={owner} />)),
  'dsh-fusion-client.editor')
  // The Editor shell has no native right sidebar; register this seat only in native Web.
  ctx.inject(['sidebarRight'], scope => {
    const nativeClient = scope as unknown as FusionClient
    return nativeClient.slots.inject(NATIVE_TURN_TAIL_SLOT, () => nativeClient.slots.register({
      name: NATIVE_TURN_TAIL_SLOT, id: 'fusion', order: 30, label: 'Collaboration',
    }, (owner: unknown) => <NativeFusionSeat client={nativeClient} store={store} owner={owner} />))
  })
}

function seatKey(owner: unknown): string {
  if (!owner || typeof owner !== 'object') return ''
  const row = owner as Record<string, unknown>
  const source = row.owner && typeof row.owner === 'object' ? row.owner as Record<string, unknown> : row
  return typeof source.sessionId === 'string' ? source.sessionId : ''
}
