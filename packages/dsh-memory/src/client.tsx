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
  if (locale === 'en') {
    return kind === 'preference' ? 'Preference' : kind === 'project-fact' ? 'Project fact' : kind === 'decision' ? 'Decision' : 'Lesson'
  }
  return kind === 'preference' ? '偏好' : kind === 'project-fact' ? '项目事实' : kind === 'decision' ? '决策' : '教训'
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
          <h3>{t(locale, '闲时梦境', 'Idle Dream')}</h3>
          <p className="dsh-memory-meta">{t(locale, '空闲后做一次整理预览，不会轮询模型。应用前须确认。', 'One idle preview; no polling. Apply remains explicit.')}</p>
        </div>
        <button type="button" role="switch" className={`dsh-memory-switch${draft.dreamIdleEnabled ? ' is-on' : ''}`}
          aria-checked={draft.dreamIdleEnabled} aria-label={draft.dreamIdleEnabled ? t(locale, '关闭闲时整理', 'Disable idle Dream') : t(locale, '启用闲时整理', 'Enable idle Dream')}
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
      <label>{t(locale, '空闲间隔（分钟）', 'Idle interval (minutes)')}
        <input type="number" min={1} max={180} step={1} disabled={busy}
          value={Math.round(draft.idleMs / 60_000)}
          onChange={event => { settingsDirty.current = true; setDraft({ ...draft, idleMs: Math.round(Number(event.target.value) * 60_000) }) }} />
      </label>
      <button type="button" disabled={busy} onClick={() => void action(async () => {
        await rpc('settings.update', {
          expectedRevision: draft.revision,
          settings: editable(draft),
        })
      })}>{t(locale, '保存', 'Save')}</button>
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
  const dream = status?.dreams.filter(plan => plan.status === 'preview').sort((a, b) => b.updatedAt - a.updatedAt)[0]
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
      {records.length === 0 ? <li className="dsh-memory-meta">{t(locale, '暂无条目。', 'No records.')}</li> : records.map(record => (
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
    <DreamPanel locale={locale} busy={busy} dream={dream} running={Boolean(status?.runningDreams?.length)}
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
        <textarea value={content} disabled={props.busy} rows={3} onChange={event => setContent(event.target.value)} />
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
    <p>{record.content}</p>
    {record.evidence.length > 0 && <p className="dsh-memory-meta">{t(locale, '依据', 'Evidence')}：{record.evidence.map(item => item.excerpt ?? `${item.kind}#${item.seq}`).join('；')}</p>}
    <div className="dsh-memory-row-actions">
      {record.status !== 'deleted' && <button type="button" disabled={props.busy} onClick={() => { setTitle(record.title); setContent(record.content); setRowEditing(true) }}>{t(locale, '编辑', 'Edit')}</button>}
      {canAccept(record) && <button type="button" disabled={props.busy} onClick={props.onAccept}>{t(locale, '采纳', 'Accept')}</button>}
      {canReject(record) && <button type="button" disabled={props.busy} onClick={props.onReject}>{t(locale, '拒绝', 'Reject')}</button>}
      {canRevoke(record) && <button type="button" disabled={props.busy} onClick={props.onRevoke}>{t(locale, '撤销', 'Revoke')}</button>}
      <button type="button" disabled={props.busy} onClick={props.onDelete}>{t(locale, '删除', 'Delete')}</button>
    </div>
  </li>
}

function DreamPanel(props: {
  running: boolean
  locale: Locale; busy: boolean; dream?: DreamPlan; aiAvailable: boolean
  action(run: (sessionId: string) => Promise<void>): Promise<void>
  rpc(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}) {
  const locale = props.locale
  return <article className="dsh-memory-dream">
    <h4>{t(locale, '梦境整理', 'Dream')}</h4>
    <p className="dsh-memory-meta">{t(locale, '生成候选预览，不会覆盖已生效条目。', 'Preview only; active records are not overwritten.')}</p>
    <div className="dsh-memory-row-actions">
      <button type="button" disabled={props.busy || props.running || !props.aiAvailable} onClick={() => void props.action(async captured => {
        await props.rpc('dream.preview', { sessionId: captured })
      })}>{t(locale, '预览', 'Preview')}</button>
      {props.dream && <button type="button" disabled={props.busy || props.running} onClick={() => void props.action(async captured => {
        await props.rpc('dream.apply', { sessionId: captured, planId: props.dream!.id, expectedRevision: props.dream!.revision })
      })}>{t(locale, '应用', 'Apply')}</button>}
      {props.dream && <button type="button" disabled={props.busy} onClick={() => void props.action(async captured => {
        await props.rpc('dream.cancel', { sessionId: captured, planId: props.dream!.id, expectedRevision: props.dream!.revision })
      })}>{t(locale, '取消', 'Cancel')}</button>}
    </div>
    {props.dream?.error && <p role="alert" className="dsh-memory-error">{props.dream.error}</p>}
    {props.dream && props.dream.proposals.length > 0 && <ul>
      {props.dream.proposals.map((proposal, index) => (
        <li key={index}><strong>{proposal.title}</strong><p>{proposal.content}</p></li>
      ))}
    </ul>}
  </article>
}

export function MemorySettings({ client, props }: { client: Client; props: unknown }) {
  const seat = useNativeSeat(client, props)
  return <div className="dsh-memory-settings-root" data-testid="memory-settings-root">
    <MemorySettingsPanel key={`settings:${memoryPanelKey(seat.sessionId, seat.locale)}`} client={client} sessionId={seat.sessionId} locale={seat.locale} />
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
.dsh-memory-card,.dsh-memory-dream,.dsh-memory-add{display:grid;gap:10px}
.dsh-memory-card header,.dsh-memory-chat-body header{display:flex;justify-content:space-between;gap:12px;align-items:center}
.dsh-memory-card h3,.dsh-memory-add h4,.dsh-memory-dream h4{margin:0;font-size:var(--font-size-3,16px);font-weight:600}
.dsh-memory-settings input,.dsh-memory-chat input,.dsh-memory-chat textarea,.dsh-memory-chat select{box-sizing:border-box;width:100%;min-width:0;padding:8px 10px;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 22%,transparent));border-radius:6px;background:var(--color-surface,transparent);color:inherit;font:inherit}
.dsh-memory-settings button:not([role="switch"]),.dsh-memory-chat button:not([role="switch"]){min-height:34px;padding:6px 12px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:6px;background:transparent;color:inherit;cursor:pointer;font:inherit;justify-self:start}
.dsh-memory-settings button:disabled,.dsh-memory-chat button:disabled{opacity:.45;cursor:not-allowed}
.dsh-memory-settings .dsh-memory-switch,.dsh-memory-chat .dsh-memory-switch{all:unset;box-sizing:border-box;position:relative;display:inline-block;width:36px;height:20px;flex:none;border-radius:999px;background:var(--gray-7,color-mix(in srgb,currentColor 28%,transparent));cursor:pointer}
.dsh-memory-switch.is-on{background:var(--accent-9,#3b82f6)}
.dsh-memory-switch-thumb{position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:999px;background:#fff;transition:transform 150ms ease}
.dsh-memory-switch.is-on .dsh-memory-switch-thumb{transform:translateX(16px)}
.dsh-memory-settings :focus-visible,.dsh-memory-chat :focus-visible{outline:2px solid currentColor;outline-offset:3px}
.dsh-memory-list{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.dsh-memory-list li{display:grid;gap:6px;padding:10px 0;border-top:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent))}
.dsh-memory-row-actions{display:flex;flex-wrap:wrap;gap:8px}
.dsh-memory-check{display:flex;gap:8px;align-items:center}
.dsh-memory-check input{width:auto}
.dsh-memory-chat>summary{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:baseline;cursor:pointer;min-height:34px;list-style:revert}
@media(prefers-reduced-motion:reduce){.dsh-memory-switch-thumb{transition:none}}
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
  }, (props: unknown) => <MemorySettings client={client} props={props} />)), 'dsh-memory.settings')
}
