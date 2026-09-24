import type { Context } from '@deepseek-ai/cordis'
import { useFeatureRefresh, useNativeSeat, type NativeSurfaceClient } from '@klarkxy/dsh-ai-services/client-utils'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  MEMORY_RPC_CHANNEL,
  type DreamPlan, type MemoryRecord, type MemorySettings, type MemoryStatus, type RpcResult,
} from './contracts.ts'
import {
  beginMemoryRequest, createMemoryGeneration, disposeMemoryRequest, loadMemoryStatus, memoryRequestStillCurrent,
  peekMemoryStatus, shouldSkipMemoryRefresh, unwrapMemoryResult,
} from './view-lifetime.ts'

export const name = 'dsh-memory-client'
export const inject = ['slots', 'connection', 'sessions', 'locale', 'uiWorkspace', 'uiSession'] as const
export {
  beginMemoryRequest, createMemoryGeneration, disposeMemoryRequest, loadMemoryStatus, memoryRequestStillCurrent,
  peekMemoryStatus, shouldSkipMemoryRefresh, unwrapMemoryResult,
} from './view-lifetime.ts'

type Client = NativeSurfaceClient & {
  connection: {
    rpc: { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> }
    generation?: { subscribe(listener: () => void): () => void }
  }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: { name: string; id: string; label: string; order: number }, render: unknown): () => void
  }
}

export type Locale = 'zh' | 'en'
export type SeatProps = { sessionId: string; locale: Locale; hidden: boolean }

export function parseSeatProps(props: unknown): SeatProps {
  const row = props && typeof props === 'object' ? props as Record<string, unknown> : {}
  const nested = row.owner && typeof row.owner === 'object' ? row.owner as Record<string, unknown> : undefined
  const sessionId = typeof row.sessionId === 'string' && row.sessionId
    ? row.sessionId
    : typeof nested?.sessionId === 'string' ? nested.sessionId : ''
  const locale = row.locale === 'en' || nested?.locale === 'en' ? 'en' : 'zh'
  const hidden = row.hidden === true || nested?.hidden === true
  return { sessionId, locale, hidden }
}

export function memoryPanelKey(sessionId: string, locale: Locale): string {
  return `${sessionId}:${locale}`
}

export function chatSummaryTitle(locale: Locale): string {
  return locale === 'en' ? 'Memory' : '记忆'
}

export function candidateAvailabilityLabel(count: number, locale: Locale): string {
  if (count > 0) return locale === 'en' ? `${count} to review` : `${count} 条候选`
  return locale === 'en' ? 'No candidates' : '暂无候选'
}

export function kindLabel(kind: MemoryRecord['kind'], locale: Locale): string {
  const labels: Record<MemoryRecord['kind'], [string, string]> = {
    preference: ['偏好', 'Preference'], 'project-fact': ['项目事实', 'Project fact'], decision: ['决策', 'Decision'],
    vocabulary: ['用语释义', 'Vocabulary'], activity: ['近期状态', 'Recent activity'], lesson: ['行动经验', 'Method'],
  }
  return labels[kind][locale === 'en' ? 1 : 0]
}

export function statusLabel(status: MemoryRecord['status'], locale: Locale): string {
  const zh: Record<MemoryRecord['status'], string> = {
    candidate: '候选', active: '已生效', rejected: '已拒绝', superseded: '已替代', revoked: '已撤销', deleted: '已删除',
  }
  const en: Record<MemoryRecord['status'], string> = {
    candidate: 'Candidate', active: 'Active', rejected: 'Rejected', superseded: 'Superseded', revoked: 'Revoked', deleted: 'Deleted',
  }
  return locale === 'en' ? en[status] : zh[status]
}

export function canAccept(record: MemoryRecord): boolean { return record.status === 'candidate' }
export function canReject(record: MemoryRecord): boolean { return record.status === 'candidate' }
export function canRevoke(record: MemoryRecord): boolean { return record.status === 'active' }

function t(locale: Locale, zh: string, en: string): string {
  return locale === 'en' ? en : zh
}

export function MemoryChatShell(props: { locale: Locale; candidateCount: number; children?: ReactNode }) {
  return <details className="dsh-memory-chat" data-testid="memory-chat">
    <summary>
      <span>{chatSummaryTitle(props.locale)}</span>
      <span className="dsh-memory-meta">{candidateAvailabilityLabel(props.candidateCount, props.locale)}</span>
    </summary>
    <div className="dsh-memory-chat-body">{props.children}</div>
  </details>
}

function MemorySettingsPanel({ client, sessionId, locale }: { client: Client; sessionId: string; locale: Locale }) {
  const gate = useRef(createMemoryGeneration())
  const sessionRef = useRef(sessionId)
  const workRef = useRef<AbortController | null>(null)
  sessionRef.current = sessionId
  const [status, setStatus] = useState<MemoryStatus>()
  const [draft, setDraft] = useState<MemorySettings>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const busyRef = useRef(false)
  const settingsDirty = useRef(false)
  busyRef.current = busy

  async function rpc(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    const result = await client.connection.rpc.call(MEMORY_RPC_CHANNEL, endpoint, payload, signal)
    unwrapMemoryResult(result as RpcResult<unknown>)
    return result
  }

  useEffect(() => {
    const request = beginMemoryRequest(gate.current, sessionId, workRef.current)
    workRef.current = request.controller
    setError('')
    setNote('')
    void loadMemoryStatus({
      rpc, sessionId: request.sessionId, token: request.token, gate: gate.current, signal: request.signal,
      viewSessionId: () => sessionRef.current,
    }).then(next => {
      if (!next) return
      setStatus(next)
      setDraft(next.settings)
      settingsDirty.current = false
    }).catch(cause => {
      if (!memoryRequestStillCurrent({
        token: request.token, gate: gate.current, signal: request.signal,
        sessionId: request.sessionId, viewSessionId: sessionRef.current,
      })) return
      setError(cause instanceof Error ? cause.message : t(locale, '无法读取记忆设置。', 'Unable to load memory settings.'))
    })
    return () => disposeMemoryRequest(gate.current, workRef.current ?? request.controller)
  }, [client, sessionId, locale])

  useFeatureRefresh(client, sessionId, () => {
    void peekMemoryStatus({
      rpc, sessionId: sessionRef.current, token: gate.current.current(), gate: gate.current,
      viewSessionId: () => sessionRef.current, busy: () => busyRef.current, editing: () => settingsDirty.current,
    }).then(next => {
      if (next) { setStatus(next); setDraft(next.settings) }
    }).catch(() => {})
  }, false, true)

  async function action(run: (sessionId: string) => Promise<void>) {
    const request = beginMemoryRequest(gate.current, sessionId, workRef.current)
    workRef.current = request.controller
    setBusy(true); setNote(''); setError('')
    const still = () => memoryRequestStillCurrent({
      token: request.token, gate: gate.current, signal: request.signal,
      sessionId: request.sessionId, viewSessionId: sessionRef.current,
    })
    try {
      await run(request.sessionId)
      const next = await loadMemoryStatus({
        rpc, sessionId: request.sessionId, token: request.token, gate: gate.current, signal: request.signal,
        viewSessionId: () => sessionRef.current,
      })
      if (!next || !still()) return
      setStatus(next)
      setDraft(next.settings)
      settingsDirty.current = false
      setNote(t(locale, '已保存。', 'Saved.'))
    } catch (cause) {
      if (!still()) return
      setError(cause instanceof Error ? cause.message : t(locale, '操作失败。', 'Failed.'))
      const next = await loadMemoryStatus({
        rpc, sessionId: request.sessionId, token: request.token, gate: gate.current, signal: request.signal,
        viewSessionId: () => sessionRef.current,
      }).catch(() => undefined)
      if (next && still()) {
        setStatus(next)
        setDraft(next.settings)
        settingsDirty.current = false
      }
    } finally {
      if (still()) setBusy(false)
    }
  }

  if (!status || !draft) {
    return <section className="dsh-memory-settings">
      <p role="status">{error || t(locale, '正在读取设置…', 'Loading settings…')}</p>
      <button type="button" onClick={() => void action(async () => {})}>{t(locale, '重新连接', 'Reconnect')}</button>
    </section>
  }

  return <section className="dsh-memory-settings" data-testid="memory-settings">
    {error && <p role="alert" className="dsh-memory-error">{error}</p>}
    {note && <p role="status">{note}</p>}
    {status.storageFailed && <p role="alert">{t(locale, '保存失败，已保留原内容。', 'Save failed; previous content was kept.')}</p>}
    {!status.aiAvailable && <p className="dsh-memory-meta">{t(locale, '梦境整理需要单独加载 @klarkxy/dsh-ai-services。', 'Dream needs @klarkxy/dsh-ai-services loaded separately.')}</p>}
    <article className="dsh-memory-card">
      <header>
        <div>
          <h3>{t(locale, '写入提示', 'Prompt injection')}</h3>
          <p className="dsh-memory-meta">{t(locale, '关闭后不再注入记忆；存储保留。', 'Turns off injection; stored records remain.')}</p>
        </div>
        <button type="button" role="switch" className={`dsh-memory-switch${draft.injectEnabled ? ' is-on' : ''}`}
          aria-checked={draft.injectEnabled} aria-label={draft.injectEnabled ? t(locale, '关闭记忆注入', 'Disable memory injection') : t(locale, '启用记忆注入', 'Enable memory injection')}
          disabled={busy}
          onClick={() => void action(async () => {
            await rpc('settings.update', {
              expectedRevision: draft.revision,
              settings: { ...editable(draft), injectEnabled: !draft.injectEnabled },
            })
          })}>
          <span className="dsh-memory-switch-thumb" aria-hidden="true" />
        </button>
      </header>
    </article>
    <article className="dsh-memory-card">
      <header>
        <div>
          <h3>{t(locale, 'Dream 语境记忆', 'Dream context memory')}</h3>
          <p className="dsh-memory-meta">{t(locale, '从原始用户消息记录用语与近期状态，闲时整理已有语境。行动方法由自我改进负责。', 'Records vocabulary and recent activity from original user messages, then consolidates context while idle. Self Improve owns methods.')}</p>
        </div>
        <button type="button" role="switch" className={`dsh-memory-switch${draft.dreamIdleEnabled ? ' is-on' : ''}`}
          aria-checked={draft.dreamIdleEnabled} aria-label={draft.dreamIdleEnabled ? t(locale, '关闭 Dream 观察与整理', 'Disable Dream observation and consolidation') : t(locale, '启用 Dream 观察与整理', 'Enable Dream observation and consolidation')}
          disabled={busy}
          onClick={() => void action(async () => {
            await rpc('settings.update', {
              expectedRevision: draft.revision,
              settings: { ...editable(draft), dreamIdleEnabled: !draft.dreamIdleEnabled },
            })
          })}>
          <span className="dsh-memory-switch-thumb" aria-hidden="true" />
        </button>
      </header>
      <p className="dsh-memory-meta">{t(locale, '闲时整理在会话空闲约 15 分钟后尝试。', 'Idle organization waits about 15 minutes of inactivity.')}</p>
    </article>
  </section>
}

function editable(settings: MemorySettings): Omit<MemorySettings, 'revision'> {
  const { revision: _revision, ...rest } = settings
  return rest
}

function MemoryChatPanel({ client, sessionId, locale }: { client: Client; sessionId: string; locale: Locale }) {
  const formId = useId()
  const gate = useRef(createMemoryGeneration())
  const sessionRef = useRef(sessionId)
  const workRef = useRef<AbortController | null>(null)
  sessionRef.current = sessionId
  const [status, setStatus] = useState<MemoryStatus>()
  const [query, setQuery] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [kind, setKind] = useState<MemoryRecord['kind']>('preference')
  const [global, setGlobal] = useState(false)
  const [evidence, setEvidence] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(false)
  const busyRef = useRef(false)
  const editingRef = useRef(false)
  busyRef.current = busy
  editingRef.current = editing

  async function rpc(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    const result = await client.connection.rpc.call(MEMORY_RPC_CHANNEL, endpoint, payload, signal)
    unwrapMemoryResult(result as RpcResult<unknown>)
    return result
  }

  useEffect(() => {
    const request = beginMemoryRequest(gate.current, sessionId, workRef.current)
    workRef.current = request.controller
    setError('')
    setNote('')
    void loadMemoryStatus({
      rpc, sessionId: request.sessionId, token: request.token, gate: gate.current, signal: request.signal,
      viewSessionId: () => sessionRef.current,
    }).then(next => {
      if (!next) return
      setStatus(next)
    }).catch(cause => {
      if (!memoryRequestStillCurrent({
        token: request.token, gate: gate.current, signal: request.signal,
        sessionId: request.sessionId, viewSessionId: sessionRef.current,
      })) return
      setError(cause instanceof Error ? cause.message : t(locale, '无法读取记忆。', 'Unable to load memory.'))
    })
    return () => disposeMemoryRequest(gate.current, workRef.current ?? request.controller)
  }, [client, sessionId, locale])

  useFeatureRefresh(client, sessionId, () => {
    void peekMemoryStatus({
      rpc, sessionId: sessionRef.current, token: gate.current.current(), gate: gate.current,
      viewSessionId: () => sessionRef.current, busy: () => busyRef.current, editing: () => editingRef.current,
    }).then(next => { if (next) setStatus(next) }).catch(() => {})
  }, Boolean(status?.runningDreams?.length), Boolean(sessionId))

  async function action(run: (sessionId: string) => Promise<void>) {
    const request = beginMemoryRequest(gate.current, sessionId, workRef.current)
    workRef.current = request.controller
    setBusy(true); setNote(''); setError('')
    const still = () => memoryRequestStillCurrent({
      token: request.token, gate: gate.current, signal: request.signal,
      sessionId: request.sessionId, viewSessionId: sessionRef.current,
    })
    try {
      await run(request.sessionId)
      const next = await loadMemoryStatus({
        rpc, sessionId: request.sessionId, token: request.token, gate: gate.current, signal: request.signal,
        viewSessionId: () => sessionRef.current,
      })
      if (!next || !still()) return
      setStatus(next)
    } catch (cause) {
      if (!still()) return
      setError(cause instanceof Error ? cause.message : t(locale, '操作失败。', 'Failed.'))
      const next = await loadMemoryStatus({
        rpc, sessionId: request.sessionId, token: request.token, gate: gate.current, signal: request.signal,
        viewSessionId: () => sessionRef.current,
      }).catch(() => undefined)
      if (next && still()) setStatus(next)
    } finally {
      if (still()) setBusy(false)
    }
  }

  const records = (status?.records ?? []).filter(record => {
    if (!query.trim()) return true
    return `${record.title}\n${record.content}`.toLowerCase().includes(query.trim().toLowerCase())
  })
  const dreams = (status?.dreams ?? []).slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8)
  const candidateCount = (status?.records ?? []).filter(record => record.status === 'candidate').length

  const body = <>
    <header>
      <p className="dsh-memory-meta">{status?.projectId
        ? t(locale, '当前项目', 'This project')
        : t(locale, '无项目目录；全局写入需勾选。', 'No project path; global write must be explicit.')}</p>
    </header>
    {error && <p role="alert" className="dsh-memory-error">{error}</p>}
    {note && <p role="status">{note}</p>}
    <label className="dsh-memory-search">{t(locale, '搜索', 'Search')}
      <input value={query} onChange={event => setQuery(event.target.value)} disabled={busy}
        aria-label={t(locale, '搜索记忆', 'Search memory')} />
    </label>
    <ul className="dsh-memory-list">
      {records.length === 0 ? <li className="dsh-memory-meta">{query.trim() ? t(locale, '没有匹配的条目。', 'No matching records.') : t(locale, '暂无条目。', 'No records.')}</li> : records.map(record => (
        <MemoryRow key={record.id} record={record} locale={locale} busy={busy}
          onEditingChange={setEditing}
          onAccept={() => void action(captured => rpc('records.accept', { sessionId: captured, id: record.id, expectedRevision: record.revision }).then(() => { if (sessionRef.current === captured) setNote(t(locale, '已采纳。', 'Accepted.')) }))}
          onReject={() => void action(captured => rpc('records.reject', { sessionId: captured, id: record.id, expectedRevision: record.revision }).then(() => { if (sessionRef.current === captured) setNote(t(locale, '已拒绝。', 'Rejected.')) }))}
          onRevoke={() => void action(captured => rpc('records.revoke', { sessionId: captured, id: record.id, expectedRevision: record.revision }).then(() => { if (sessionRef.current === captured) setNote(t(locale, '已撤销。', 'Revoked.')) }))}
          onDelete={() => void action(captured => rpc('records.remove', { sessionId: captured, id: record.id, expectedRevision: record.revision }).then(() => { if (sessionRef.current === captured) setNote(t(locale, '已删除。', 'Deleted.')) }))}
          onSave={(nextTitle, nextContent) => void action(captured => rpc('records.update', { sessionId: captured, id: record.id, expectedRevision: record.revision, title: nextTitle, content: nextContent }).then(() => { if (sessionRef.current === captured) setNote(t(locale, '已更新。', 'Updated.')) }))}
        />
      ))}
    </ul>
    <form className="dsh-memory-add" onSubmit={event => {
      event.preventDefault()
      void action(async captured => {
        await rpc('records.create', {
          sessionId: captured, title, content, kind, global,
          evidence: evidence.trim() ? [{ sessionId: captured, seq: 0, kind: 'manual', excerpt: evidence.trim().slice(0, 400) }] : [],
        })
        if (sessionRef.current !== captured) return
        setTitle(''); setContent(''); setEvidence(''); setNote(t(locale, '已添加。', 'Added.'))
      })
    }}>
      <h4>{t(locale, '手动添加', 'Add')}</h4>
      <label htmlFor={formId + '-title'}>{t(locale, '标题', 'Title')}
        <input id={formId + '-title'} value={title} required maxLength={160} disabled={busy}
          onChange={event => setTitle(event.target.value)} />
      </label>
      <label htmlFor={formId + '-body'}>{t(locale, '内容', 'Content')}
        <textarea id={formId + '-body'} value={content} required maxLength={4000} disabled={busy} rows={3}
          onChange={event => setContent(event.target.value)} />
      </label>
      <label>{t(locale, '类型', 'Kind')}
        <select value={kind} disabled={busy} onChange={event => setKind(event.target.value as MemoryRecord['kind'])}>
          <option value="preference">{kindLabel('preference', locale)}</option>
          <option value="project-fact">{kindLabel('project-fact', locale)}</option>
          <option value="decision">{kindLabel('decision', locale)}</option>
          <option value="vocabulary">{kindLabel('vocabulary', locale)}</option>
          <option value="activity">{kindLabel('activity', locale)}</option>
        </select>
      </label>
      <label htmlFor={formId + '-evidence'}>{t(locale, '依据（可选）', 'Evidence (optional)')}
        <input id={formId + '-evidence'} value={evidence} maxLength={400} disabled={busy}
          onChange={event => setEvidence(event.target.value)} />
      </label>
      <label className="dsh-memory-check">
        <input type="checkbox" checked={global} disabled={busy} onChange={event => setGlobal(event.target.checked)} />
        {t(locale, '写入全局（跨项目）', 'Write as global')}
      </label>
      <button type="submit" disabled={busy}>{t(locale, '添加', 'Add')}</button>
    </form>
    <DreamPanel locale={locale} busy={busy} dreams={dreams} running={Boolean(status?.runningDreams?.length)}
      aiAvailable={status?.aiAvailable === true} action={action} rpc={rpc} />
  </>

  return <MemoryChatShell locale={locale} candidateCount={candidateCount}>{body}</MemoryChatShell>
}

function MemoryRow(props: {
  record: MemoryRecord; locale: Locale; busy: boolean
  onEditingChange?: (editing: boolean) => void
  onAccept(): void; onReject(): void; onRevoke(): void; onDelete(): void
  onSave(title: string, content: string): void
}) {
  const { record, locale } = props
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(record.title)
  const [content, setContent] = useState(record.content)
  const scope = record.scope.kind === 'global' ? t(locale, '全局', 'Global') : t(locale, '项目', 'Project')
  function setRowEditing(next: boolean) {
    setEditing(next)
    props.onEditingChange?.(next)
  }
  if (editing) {
    return <li>
      <label>{t(locale, '标题', 'Title')}
        <input value={title} disabled={props.busy} onChange={event => setTitle(event.target.value)} />
      </label>
      <label>{t(locale, '内容', 'Content')}
        <textarea value={content} disabled={props.busy} rows={3} maxLength={4000} onChange={event => setContent(event.target.value)} />
      </label>
      <div className="dsh-memory-row-actions">
        <button type="button" disabled={props.busy} onClick={() => { props.onSave(title, content); setRowEditing(false) }}>{t(locale, '保存', 'Save')}</button>
        <button type="button" disabled={props.busy} onClick={() => setRowEditing(false)}>{t(locale, '取消', 'Cancel')}</button>
      </div>
    </li>
  }
  return <li>
    <strong>{record.title}</strong>
    <p className="dsh-memory-meta">{kindLabel(record.kind, locale)} · {statusLabel(record.status, locale)} · {scope}</p>
    {record.context && <p className="dsh-memory-meta">{record.context.subject} · {record.context.domain} · {record.context.key}
      {' · '}{t(locale, '记录于', 'Observed')} {new Date(record.context.observedAt).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN')}
      {record.context.activityStatus && ` · ${record.context.activityStatus}`}
      {record.context.eventTime && ` · ${record.context.eventTime}`}
    </p>}
    {record.kind === 'activity' && <p className="dsh-memory-meta">{t(locale, '仅表示上次报告的状态；到期不代表任务已完成。', 'Last reported state only; expiry never means completion.')}</p>}
    <p>{record.content}</p>
    {record.evidence.length > 0 && <p className="dsh-memory-meta">{t(locale, '依据', 'Evidence')}：{record.evidence.map(item => item.excerpt ?? `${item.kind}#${item.seq}`).join('；')}</p>}
    <div className="dsh-memory-row-actions">
      {record.status !== 'deleted' && <button type="button" disabled={props.busy} onClick={() => { setTitle(record.title); setContent(record.content); setRowEditing(true) }}>{t(locale, '编辑', 'Edit')}</button>}
      {canAccept(record) && <button type="button" disabled={props.busy} onClick={props.onAccept}>{t(locale, '采纳', 'Accept')}</button>}
      {canReject(record) && <button type="button" disabled={props.busy} onClick={props.onReject}>{t(locale, '拒绝', 'Reject')}</button>}
      {canRevoke(record) && <button type="button" disabled={props.busy} onClick={props.onRevoke}>{t(locale, '撤销', 'Revoke')}</button>}
      <ConfirmButton disabled={props.busy} label={t(locale, '删除', 'Delete')} confirmLabel={t(locale, '确认删除？', 'Confirm delete?')} onConfirm={props.onDelete} />
    </div>
  </li>
}

function ConfirmButton(props: { label: string; confirmLabel: string; disabled?: boolean; onConfirm(): void }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  function disarm() {
    clearTimeout(timer.current)
    setArmed(false)
  }
  return <button type="button" className="dsh-memory-danger" disabled={props.disabled}
    onClick={() => {
      if (!armed) {
        setArmed(true)
        timer.current = setTimeout(() => setArmed(false), 3000)
        return
      }
      disarm()
      props.onConfirm()
    }}
    onBlur={disarm}>{armed ? props.confirmLabel : props.label}</button>
}

export function dreamStatusLabel(plan: DreamPlan, locale: Locale): string {
  if (plan.status === 'applied') return t(locale, '已应用', 'Applied')
  if (plan.status === 'noop') return t(locale, '无变化', 'No change')
  if (plan.status === 'failed' || plan.status === 'stale') return t(locale, '失败', 'Failed')
  if (plan.status === 'cancelled') return t(locale, '已取消', 'Cancelled')
  return plan.proposals.length ? t(locale, '未应用', 'Not applied') : t(locale, '无变化', 'No change')
}

function DreamPanel(props: {
  running: boolean
  locale: Locale; busy: boolean; dreams: DreamPlan[]; aiAvailable: boolean
  action(run: (sessionId: string) => Promise<void>): Promise<void>
  rpc(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}) {
  const locale = props.locale
  return <article className="dsh-memory-dream">
    <h4>{t(locale, '梦境整理', 'Dream')}</h4>
    <p className="dsh-memory-meta">{t(locale, '每天至多闲时整理一次；不把候选升级为事实，不延长近期状态的有效期。', 'Consolidates at most once a day while idle, without confirming candidates or extending activity freshness.')}</p>
    <div className="dsh-memory-row-actions">
      <button type="button" disabled={props.busy || props.running || !props.aiAvailable} onClick={() => void props.action(async captured => {
        await props.rpc('dream.run', { sessionId: captured })
      })}>{t(locale, '立即整理', 'Organize now')}</button>
      {props.running && <span className="dsh-memory-meta">{t(locale, '整理中…', 'Organizing…')}</span>}
    </div>
    {props.dreams.length > 0 && <ul>
      {props.dreams.map(plan => (
        <li key={plan.id}>
          <strong>{dreamStatusLabel(plan, locale)}</strong>{' '}
          <span className="dsh-memory-meta">{new Date(plan.createdAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</span>
          {plan.proposals.length > 0 && <p className="dsh-memory-meta">{plan.proposals.map(proposal => proposal.title).join('、')}</p>}
          {plan.error && <p className="dsh-memory-error">{plan.error}</p>}
        </li>
      ))}
    </ul>}
  </article>
}

function readSelfImprovementReview(host: unknown): { render(props: unknown): ReactNode } | undefined {
  if (!host || typeof host !== 'object') return undefined
  const context = host as { get?: (name: string) => unknown }
  if (typeof context.get !== 'function') return undefined
  let row: unknown
  try { row = context.get('dshSelfImprovementReview') } catch { return undefined }
  if (!row || typeof row !== 'object') return undefined
  const render = (row as { render?: unknown }).render
  if (typeof render !== 'function') return undefined
  return { render: render as (props: unknown) => ReactNode }
}

export function MemorySettings({ client, host, props }: { client: Client; host?: unknown; props: unknown }) {
  const seat = useNativeSeat(client, props)
  const review = readSelfImprovementReview(host)
  return <div className="dsh-memory-settings-root" data-testid="memory-settings-root">
    <MemorySettingsPanel key={`settings:${memoryPanelKey(seat.sessionId, seat.locale)}`} client={client} sessionId={seat.sessionId} locale={seat.locale} />
    {review && seat.sessionId && !seat.hidden
      ? <details className="dsh-memory-si" data-testid="self-improvement-entry">
        <summary>{t(seat.locale, '自我改进', 'Self-improvement')}</summary>
        <div className="dsh-memory-si-body">{review.render({ sessionId: seat.sessionId, locale: seat.locale })}</div>
      </details>
      : null}
    {seat.sessionId && !seat.hidden
      ? <MemoryChatPanel key={`manage:${memoryPanelKey(seat.sessionId, seat.locale)}`} client={client} sessionId={seat.sessionId} locale={seat.locale} />
      : <p className="dsh-memory-meta">{t(seat.locale, '选择一个会话后可以管理该会话的记忆。', 'Select a session to manage its memory.')}</p>}
  </div>
}

const styles = `
.dsh-memory-settings-root,.dsh-memory-settings,.dsh-memory-chat{max-width:760px;color:inherit;font:400 var(--font-size-2,14px)/1.5 var(--default-font-family,system-ui,sans-serif)}
.dsh-memory-settings-root,.dsh-memory-settings{display:grid;gap:16px}
.dsh-memory-chat-body{display:grid;gap:12px;margin-top:8px}
.dsh-memory-settings p,.dsh-memory-chat p{margin:0;line-height:1.5}
.dsh-memory-meta,.dsh-memory-chat small{font-size:var(--font-size-1,13px);color:var(--gray-11,inherit)}
.dsh-memory-error{color:var(--red-11,#b42318)}
.dsh-memory-card,.dsh-memory-dream,.dsh-memory-add,.dsh-memory-si{display:grid;gap:10px;padding:14px 16px;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent));border-radius:12px}
.dsh-memory-card header,.dsh-memory-chat-body header{display:flex;justify-content:space-between;gap:12px;align-items:center}
.dsh-memory-card h3,.dsh-memory-add h4,.dsh-memory-dream h4{margin:0;font-size:var(--font-size-3,16px);font-weight:600}
.dsh-memory-settings input,.dsh-memory-chat input,.dsh-memory-chat textarea,.dsh-memory-chat select{box-sizing:border-box;width:100%;min-width:0;padding:8px 10px;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 22%,transparent));border-radius:8px;background:var(--color-surface,transparent);color:inherit;font:inherit;transition:border-color 150ms ease,box-shadow 150ms ease}
.dsh-memory-settings input:focus,.dsh-memory-chat input:focus,.dsh-memory-chat textarea:focus,.dsh-memory-chat select:focus{border-color:var(--accent-9,#3b82f6);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent-9,#3b82f6) 25%,transparent)}
.dsh-memory-settings button:not([role="switch"]),.dsh-memory-chat button:not([role="switch"]){min-height:34px;padding:6px 12px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:8px;background:transparent;color:inherit;cursor:pointer;font:inherit;justify-self:start;transition:background-color 150ms ease,color 150ms ease,border-color 150ms ease,box-shadow 150ms ease,transform 150ms ease}
.dsh-memory-settings button:not([role="switch"]):hover:not(:disabled),.dsh-memory-chat button:not([role="switch"]):hover:not(:disabled){background:var(--gray-3,color-mix(in srgb,currentColor 6%,transparent));border-color:color-mix(in srgb,currentColor 35%,transparent)}
.dsh-memory-settings button:not([role="switch"]):active:not(:disabled),.dsh-memory-chat button:not([role="switch"]):active:not(:disabled){transform:scale(.97)}
.dsh-memory-danger:hover:not(:disabled){border-color:var(--red-11,#b42318);color:var(--red-11,#b42318);background:color-mix(in srgb,var(--red-11,#b42318) 8%,transparent)}
.dsh-memory-settings button:disabled,.dsh-memory-chat button:disabled{opacity:.45;cursor:not-allowed}
.dsh-memory-settings .dsh-memory-switch,.dsh-memory-chat .dsh-memory-switch{all:unset;box-sizing:border-box;position:relative;display:inline-block;width:36px;height:20px;flex:none;border-radius:999px;background:var(--gray-7,color-mix(in srgb,currentColor 28%,transparent));cursor:pointer}
.dsh-memory-switch.is-on{background:var(--accent-9,#3b82f6)}
.dsh-memory-switch-thumb{position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:999px;background:#fff;transition:transform 150ms ease}
.dsh-memory-switch.is-on .dsh-memory-switch-thumb{transform:translateX(16px)}
.dsh-memory-settings :focus-visible,.dsh-memory-chat :focus-visible{outline:2px solid var(--accent-9,currentColor);outline-offset:3px}
.dsh-memory-list{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.dsh-memory-list li{display:grid;gap:6px;padding:10px 4px;border-top:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent));border-radius:10px;overflow-wrap:anywhere}
.dsh-memory-row-actions{display:flex;flex-wrap:wrap;gap:8px}
.dsh-memory-check{display:flex;gap:8px;align-items:center}
.dsh-memory-check input{width:auto}
.dsh-memory-chat>summary,.dsh-memory-si>summary{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:baseline;cursor:pointer;min-height:34px;list-style:revert}
.dsh-memory-si-body{margin-top:8px}
@media(prefers-reduced-motion:reduce){.dsh-memory-switch-thumb{transition:none}.dsh-memory-settings button:not([role="switch"]),.dsh-memory-chat button:not([role="switch"]),.dsh-memory-settings input,.dsh-memory-chat input,.dsh-memory-chat textarea,.dsh-memory-chat select{transition:none}}
`

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@klarkxy/dsh-memory')
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-memory.styles')
  ctx.effect(() => client.slots.inject('settings.section', () => client.slots.register({
    name: 'settings.section', id: 'memory', order: 65, label: '记忆',
  }, (props: unknown) => <MemorySettings client={client} host={ctx} props={props} />)), 'dsh-memory.settings')
}
