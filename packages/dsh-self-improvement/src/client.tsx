import type { Context } from '@deepseek-ai/cordis'
import { useFeatureRefresh, useNativeSeat, type NativeSurfaceClient } from '@klarkxy/dsh-ai-services/client-utils'
import { useEffect, useId, useRef, useState } from 'react'
import {
  MEMORY_UNAVAILABLE_MESSAGE, MEMORY_UNAVAILABLE_MESSAGE_EN,
  SELF_IMPROVEMENT_REVIEW_SERVICE, SELF_IMPROVEMENT_RPC_CHANNEL, type MemoryRecord, type ReviewSnapshot, type RpcResult, type SkillRecord,
} from './contracts.ts'
import {
  beginReviewRequest, createReviewGeneration, disposeReviewRequest, exportSkillIfCurrent,
  loadReviewSnapshot, peekReviewSnapshot, reviewRequestStillCurrent,
} from './review-lifetime.ts'
import { unwrap } from './rpc-result.ts'
import { exportRevocationCopy, skillExportStateLabel } from './skills.ts'

export const name = 'dsh-self-improvement-client'
export const inject = ['slots', 'connection', 'sessions', 'locale', 'uiWorkspace', 'uiSession'] as const
export { unwrap }
export {
  beginReviewRequest, createReviewGeneration, disposeReviewRequest, exportSkillIfCurrent,
  loadReviewSnapshot, peekReviewSnapshot, reviewRequestStillCurrent, shouldSkipReviewRefresh,
} from './review-lifetime.ts'

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

export type SeatProps = { sessionId: string; locale: 'zh' | 'en'; hidden: boolean }

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

export function memoryUnavailableCopy(locale: 'zh' | 'en'): string {
  return locale === 'en' ? MEMORY_UNAVAILABLE_MESSAGE_EN : MEMORY_UNAVAILABLE_MESSAGE
}

function statusLabel(status: MemoryRecord['status'], locale: 'zh' | 'en'): string {
  const zh = { candidate: '候选', active: '已生效', rejected: '已拒绝', superseded: '已替代', revoked: '已撤回', deleted: '已删除' }
  const en = { candidate: 'Candidate', active: 'Active', rejected: 'Rejected', superseded: 'Superseded', revoked: 'Revoked', deleted: 'Deleted' }
  return (locale === 'en' ? en : zh)[status]
}

const emptySnapshot = (): ReviewSnapshot => ({
  memoryAvailable: false, memoryMessage: MEMORY_UNAVAILABLE_MESSAGE,
  generation: 0, storageFailed: false, lessons: [], skills: [],
})

function LessonEvidence({ record, locale }: { record: MemoryRecord; locale: 'zh' | 'en' }) {
  return record.evidence.length === 0
    ? <p className="si-meta">{locale === 'en' ? 'No evidence refs.' : '没有依据引用。'}</p>
    : <ul className="si-evidence">
      {record.evidence.map(ref => (
        <li key={`${ref.sessionId}:${ref.seq}:${ref.kind}`}>
          {ref.kind} · {ref.sessionId}#{ref.seq}{ref.excerpt ? ` — ${ref.excerpt}` : ''}
        </li>
      ))}
    </ul>
}

function ConfirmButton(props: { label: string; confirmLabel: string; disabled?: boolean; onConfirm(): void }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  function disarm() {
    clearTimeout(timer.current)
    setArmed(false)
  }
  return <button type="button" className="si-danger" disabled={props.disabled}
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

function LessonList(props: {
  lessons: MemoryRecord[]
  locale: 'zh' | 'en'
  busy: boolean
  projectId?: string
  onAccept(record: MemoryRecord): void
  onPromote(record: MemoryRecord): void
  onReject(record: MemoryRecord): void
  onRevoke(record: MemoryRecord): void
}) {
  const { lessons, locale, busy, projectId, onAccept, onPromote, onReject, onRevoke } = props
  if (lessons.length === 0) {
    return <p className="si-empty">{locale === 'en' ? 'No lessons yet.' : '还没有教训。'}</p>
  }
  return <ol className="si-list">
    {lessons.map(record => {
      const candidate = record.status === 'candidate'
      const active = record.status === 'active'
      const foreignProject = record.scope.kind === 'project' && Boolean(projectId) && record.scope.projectId !== projectId
      const scope = record.scope.kind === 'global' ? (locale === 'en' ? 'global' : '全局') : record.scope.projectId
      return <li key={record.id} className="si-card" data-status={record.status}>
        <header>
          <h3>{record.title}</h3>
          <span className="si-meta">{statusLabel(record.status, locale)} · {scope}</span>
        </header>
        <p>{record.content}</p>
        <LessonEvidence record={record} locale={locale} />
        <div className="si-actions">
          {candidate && !foreignProject ? <button type="button" disabled={busy} onClick={() => onAccept(record)}>
            {locale === 'en' ? 'Accept in this scope' : '按当前范围采纳'}
          </button> : null}
          {active && record.scope.kind === 'project' && !foreignProject ? <button type="button" disabled={busy} onClick={() => onPromote(record)}>
            {locale === 'en' ? 'Promote to global' : '提升为全局'}
          </button> : null}
          {candidate ? <ConfirmButton disabled={busy}
            label={locale === 'en' ? 'Reject' : '拒绝'}
            confirmLabel={locale === 'en' ? 'Confirm reject?' : '确认拒绝？'}
            onConfirm={() => onReject(record)} /> : null}
          {active ? <ConfirmButton disabled={busy}
            label={locale === 'en' ? 'Revoke' : '撤回'}
            confirmLabel={locale === 'en' ? 'Confirm revoke?' : '确认撤回？'}
            onConfirm={() => onRevoke(record)} /> : null}
          {foreignProject
            ? <p className="si-meta">{locale === 'en' ? 'Other project — promotion is blocked here.' : '其他项目的教训，此处不能提升。'}</p>
            : null}
        </div>
      </li>
    })}
  </ol>
}

function SkillList(props: {
  skills: SkillRecord[]
  locale: 'zh' | 'en'
  busy: boolean
  onAccept(record: SkillRecord): void
  onReject(record: SkillRecord): void
  onRevoke(record: SkillRecord): void
  onExport(record: SkillRecord): void
  onUnexport(record: SkillRecord): void
}) {
  const { skills, locale, busy } = props
  if (skills.length === 0) {
    return <p className="si-empty">{locale === 'en' ? 'No skill drafts.' : '没有技能草稿。'}</p>
  }
  return <ol className="si-list">
    {skills.map(record => (
      <li key={record.id} className="si-card" data-skill-status={record.status} data-export={record.exportState}>
        <header>
          <h3>{record.title}</h3>
          <span className="si-meta">{record.status} · {skillExportStateLabel(record, locale)}</span>
        </header>
        <pre className="si-preview">{record.markdown}</pre>
        <div className="si-actions">
          {record.status === 'preview' ? <button type="button" disabled={busy} onClick={() => props.onAccept(record)}>
            {locale === 'en' ? 'Accept draft' : '接受草稿'}
          </button> : null}
          {record.status === 'preview' ? <button type="button" disabled={busy} onClick={() => props.onReject(record)}>
            {locale === 'en' ? 'Reject draft' : '拒绝草稿'}
          </button> : null}
          {record.status === 'accepted' || record.status === 'preview' ? <button type="button" disabled={busy} onClick={() => props.onExport(record)}>
            {locale === 'en' ? 'Download Markdown' : '下载 Markdown'}
          </button> : null}
          {record.exportState === 'recorded' ? <ConfirmButton disabled={busy}
            label={locale === 'en' ? 'Revoke export record' : '撤回导出记录'}
            confirmLabel={locale === 'en' ? 'Confirm revoke export record?' : '确认撤回导出记录？'}
            onConfirm={() => props.onUnexport(record)} /> : null}
          {record.status === 'accepted' ? <ConfirmButton disabled={busy}
            label={locale === 'en' ? 'Revoke skill' : '撤回技能'}
            confirmLabel={locale === 'en' ? 'Confirm revoke skill?' : '确认撤回技能？'}
            onConfirm={() => props.onRevoke(record)} /> : null}
        </div>
      </li>
    ))}
  </ol>
}

export function ReviewPanel({ client, sessionId, locale }: {
  client: Client
  sessionId: string
  locale: 'zh' | 'en'
}) {
  const tabsId = useId()
  const gate = useRef(createReviewGeneration())
  const sessionRef = useRef(sessionId)
  const workRef = useRef<AbortController | null>(null)
  sessionRef.current = sessionId
  const [tab, setTab] = useState<'lessons' | 'skills'>('lessons')
  const [snapshot, setSnapshot] = useState<ReviewSnapshot>()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const busyRef = useRef(false)
  busyRef.current = busy

  function rpc(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    return client.connection.rpc.call(SELF_IMPROVEMENT_RPC_CHANNEL, endpoint, payload, signal)
  }
  async function call<T>(endpoint: string, payload: unknown = {}): Promise<T> {
    return unwrap(await rpc(endpoint, payload) as RpcResult<T>)
  }

  useEffect(() => {
    const request = beginReviewRequest(gate.current, sessionId, workRef.current)
    workRef.current = request.controller
    setError('')
    setNote('')
    void loadReviewSnapshot({
      rpc,
      sessionId: request.sessionId,
      token: request.token,
      gate: gate.current,
      signal: request.signal,
      viewSessionId: () => sessionRef.current,
    }).then(next => {
      if (next === undefined) return
      setSnapshot(next)
    }).catch(cause => {
      if (!reviewRequestStillCurrent({
        token: request.token,
        gate: gate.current,
        signal: request.signal,
        sessionId: request.sessionId,
        viewSessionId: sessionRef.current,
      })) return
      setError(cause instanceof Error ? cause.message : (locale === 'en' ? 'Unable to read self-improvement state.' : '无法读取自我改进状态。'))
    })
    return () => disposeReviewRequest(gate.current, workRef.current ?? request.controller)
  }, [client, sessionId, locale])

  useFeatureRefresh(client, sessionId, () => {
    void peekReviewSnapshot({
      rpc, sessionId: sessionRef.current, token: gate.current.current(), gate: gate.current,
      viewSessionId: () => sessionRef.current, busy: () => busyRef.current, editing: () => false,
    }).then(next => { if (next) setSnapshot(next) }).catch(() => {})
  }, snapshot?.extracting === true, true)

  async function action(run: (ctx: { sessionId: string; token: number; signal: AbortSignal }) => Promise<void>) {
    const request = beginReviewRequest(gate.current, sessionId, workRef.current)
    workRef.current = request.controller
    setBusy(true); setNote(''); setError('')
    const still = () => reviewRequestStillCurrent({
      token: request.token,
      gate: gate.current,
      signal: request.signal,
      sessionId: request.sessionId,
      viewSessionId: sessionRef.current,
    })
    try {
      await run({ sessionId: request.sessionId, token: request.token, signal: request.signal })
    } catch (cause) {
      if (!still()) return
      setError(cause instanceof Error ? cause.message : (locale === 'en' ? 'Action failed.' : '操作失败。'))
      const next = await loadReviewSnapshot({
        rpc,
        sessionId: request.sessionId,
        token: request.token,
        gate: gate.current,
        signal: request.signal,
        viewSessionId: () => sessionRef.current,
      }).catch(() => undefined)
      if (next) setSnapshot(next)
    } finally {
      if (still()) setBusy(false)
    }
  }

  const data = snapshot ?? emptySnapshot()
  const visibleLessons = data.lessons

  const body = <>
    {error ? <p role="alert" className="si-error">{error}</p> : null}
    {note ? <p role="status">{note}</p> : null}
    {data.storageFailed ? <p role="alert">{locale === 'en' ? 'Save failed; previous state was kept.' : '保存失败，已保留上一次成功的状态。'}</p> : null}
    {data.memoryAvailable ? null : <p role="alert" className="si-error">{memoryUnavailableCopy(locale)}</p>}
    <div className="si-tabs" role="tablist" aria-label={locale === 'en' ? 'Self-improvement' : '自我改进'} onKeyDown={event => {
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
      {([['lessons', locale === 'en' ? 'Methods' : '行动经验'], ['skills', locale === 'en' ? 'Skills' : '技能草稿']] as const).map(([key, label]) => (
        <button key={key} type="button" role="tab" id={`${tabsId}-${key}-tab`}
          aria-controls={`${tabsId}-${key}-panel`} aria-selected={tab === key}
          tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)}>{label}</button>
      ))}
    </div>
    <div role="tabpanel" id={`${tabsId}-lessons-panel`}
      aria-labelledby={`${tabsId}-lessons-tab`} hidden={tab !== 'lessons'} tabIndex={0}>
      <p className="si-meta">{locale === 'en'
        ? 'Explicit method requirements can take effect directly. Outcome observations remain candidates until accepted. Vocabulary and recent activity belong to Dream.'
        : '明确的方法要求可直接生效；结果观察保留为候选，采纳后才参与行动。用语与近期状态由 Dream 管理。'}</p>
      {sessionId ? <button type="button" disabled={busy || !data.memoryAvailable} onClick={() => void action(async ctx => {
        if (!reviewRequestStillCurrent({
          token: ctx.token, gate: gate.current, signal: ctx.signal, sessionId: ctx.sessionId, viewSessionId: sessionRef.current,
        })) return
        await call('extract', { sessionId: ctx.sessionId })
        const next = await loadReviewSnapshot({
          rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
        })
        if (!next) return
        setSnapshot(next)
        setNote(locale === 'en' ? 'Extracted from this session when evidence was sufficient.' : '已按明确依据尝试摘录。')
      })}>{locale === 'en' ? 'Extract from this session' : '从本会话摘录'}</button> : null}
      <LessonList
        lessons={visibleLessons}
        locale={locale}
        busy={busy || !data.memoryAvailable}
        projectId={data.projectId}
        onAccept={record => void action(async ctx => {
          await call('accept', { id: record.id, expectedRevision: record.revision, scope: 'project', sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (next) setSnapshot(next)
        })}
        onPromote={record => void action(async ctx => {
          await call('accept', { id: record.id, expectedRevision: record.revision, scope: 'global', sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (next) setSnapshot(next)
        })}
        onReject={record => void action(async ctx => {
          await call('reject', { id: record.id, expectedRevision: record.revision, sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (next) setSnapshot(next)
        })}
        onRevoke={record => void action(async ctx => {
          await call('revoke', { id: record.id, expectedRevision: record.revision, sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (next) setSnapshot(next)
        })}
      />
    </div>
    <div role="tabpanel" id={`${tabsId}-skills-panel`} aria-labelledby={`${tabsId}-skills-tab`} hidden={tab !== 'skills'} tabIndex={0}>
      {skillManagement()}
    </div>
  </>

  function skillManagement() {
    return <>
      <fieldset className="si-select" disabled={busy || !data.memoryAvailable}>
        <legend>{locale === 'en' ? 'Active lessons for a skill draft' : '从已生效的教训生成草稿'}</legend>
        {data.lessons.filter(record => record.status === 'active').map(record => (
          <label key={record.id}>
            <input type="checkbox" checked={selected.includes(record.id)}
              onChange={event => setSelected(current => event.target.checked ? [...current, record.id] : current.filter(id => id !== record.id))} />
            {record.title}
          </label>
        ))}
        {data.lessons.some(record => record.status === 'active') ? null
          : <p className="si-meta">{locale === 'en' ? 'No active lessons yet.' : '还没有已生效的教训。'}</p>}
      </fieldset>
      <button type="button" disabled={busy || selected.length === 0 || !data.memoryAvailable} onClick={() => void action(async ctx => {
        await call('skill.preview', { lessonIds: selected, sessionId: ctx.sessionId })
        const next = await loadReviewSnapshot({
          rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
        })
        if (!next) return
        setSnapshot(next)
        setTab('skills')
      })}>{locale === 'en' ? 'Preview skill Markdown' : '预览技能 Markdown'}</button>
      <SkillList
        skills={data.skills}
        locale={locale}
        busy={busy}
        onAccept={record => void action(async ctx => {
          await call('skill.accept', { id: record.id, expectedRevision: record.revision, sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (next) setSnapshot(next)
        })}
        onReject={record => void action(async ctx => {
          await call('skill.reject', { id: record.id, expectedRevision: record.revision, sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (next) setSnapshot(next)
        })}
        onRevoke={record => void action(async ctx => {
          await call('skill.revoke', { id: record.id, expectedRevision: record.revision, sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (next) setSnapshot(next)
        })}
        onExport={record => void action(async ctx => {
          const result = await exportSkillIfCurrent({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal,
            viewSessionId: () => sessionRef.current, record,
          })
          if (result !== 'recorded') return
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (!next) return
          setSnapshot(next)
          setNote(locale === 'en' ? 'Browser download started. Destination is chosen in the save dialog.' : '已开始浏览器下载，保存位置由系统对话框决定。')
        })}
        onUnexport={record => void action(async ctx => {
          await call('skill.unexport', { id: record.id, expectedRevision: record.revision, sessionId: ctx.sessionId })
          const next = await loadReviewSnapshot({
            rpc, sessionId: ctx.sessionId, token: ctx.token, gate: gate.current, signal: ctx.signal, viewSessionId: () => sessionRef.current,
          })
          if (!next) return
          setSnapshot(next)
          setNote(exportRevocationCopy(locale))
        })}
      />
    </>
  }

  return <section className="si-settings" data-testid="self-improvement-settings" data-session={sessionId || undefined}>
    {sessionId ? null : <p className="si-meta">{locale === 'en'
      ? 'Select a session to view lessons for the current project.'
      : '选择一个会话后可查看当前项目的教训。'}</p>}
    {body}
  </section>
}

const styles = `
.si-settings{max-width:760px;color:inherit;font:400 var(--font-size-2,14px)/1.5 var(--default-font-family,system-ui,sans-serif)}
.si-settings{display:grid;gap:16px}
.si-settings p{margin:0;line-height:1.5}
.si-meta,.si-empty{font-size:var(--font-size-1,13px);color:var(--gray-11,inherit)}
.si-error{color:var(--red-11,#b42318)}
.si-card{display:grid;gap:8px;padding:12px 14px;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent));border-radius:12px}
.si-card h3{margin:0;font-size:var(--font-size-3,16px);font-weight:600}
.si-list{margin:0;padding:0;list-style:none}
.si-evidence{margin:0;padding-left:1.2em;font-size:var(--font-size-1,13px)}
.si-actions{display:flex;flex-wrap:wrap;gap:8px}
.si-settings button:not([role="tab"]){min-height:34px;padding:6px 12px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:8px;background:transparent;color:inherit;cursor:pointer;font:inherit;justify-self:start;transition:background-color 150ms ease,color 150ms ease,border-color 150ms ease,box-shadow 150ms ease,transform 150ms ease}
.si-settings button:not([role="tab"]):hover:not(:disabled){background:var(--gray-3,color-mix(in srgb,currentColor 6%,transparent));border-color:color-mix(in srgb,currentColor 35%,transparent)}
.si-settings button:not([role="tab"]):active:not(:disabled){transform:scale(.97)}
.si-danger:hover:not(:disabled){border-color:var(--red-11,#b42318);color:var(--red-11,#b42318);background:color-mix(in srgb,var(--red-11,#b42318) 8%,transparent)}
.si-settings button:disabled{opacity:.45;cursor:not-allowed}
.si-tabs{display:flex;gap:20px;border-bottom:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent))}
.si-tabs button[role="tab"]{padding:8px 0;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--gray-11,inherit);cursor:pointer;font:inherit;transition:color 150ms ease,border-color 150ms ease}
.si-tabs button[role="tab"]:hover{color:inherit}
.si-tabs button[aria-selected="true"]{border-bottom-color:var(--accent-9,#3b82f6);color:var(--accent-11,inherit);font-weight:600}
.si-settings [role="tabpanel"]{border-radius:12px}
.si-settings :focus-visible{outline:2px solid var(--accent-9,currentColor);outline-offset:3px}
.si-preview{margin:0;padding:8px 10px;border-radius:8px;background:var(--gray-2,color-mix(in srgb,currentColor 4%,transparent));white-space:pre-wrap;overflow:auto;max-height:240px;font:400 var(--font-size-1,13px)/1.45 var(--code-font-family,ui-monospace,monospace)}
.si-select{margin:0;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent));border-radius:10px;padding:8px 12px;display:grid;gap:6px}
.si-select label{display:flex;gap:8px;align-items:flex-start}
@media(prefers-reduced-motion:reduce){.si-settings button{transition:none}}
`

export function reviewPanelKey(sessionId: string, locale: 'zh' | 'en'): string {
  return `${sessionId}:${locale}`
}

export function SelfImprovementSettings({ client, props }: { client: Client; props: unknown }) {
  const seat = useNativeSeat(client, props)
  return <ReviewPanel key={reviewPanelKey(seat.sessionId, seat.locale)} client={client} sessionId={seat.sessionId} locale={seat.locale} />
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshSelfImprovementReview: { render(props: unknown): unknown }
  }
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as Client
  ctx.provide(SELF_IMPROVEMENT_REVIEW_SERVICE, {
    render: (props: unknown) => <SelfImprovementSettings client={client} props={props} />,
  })
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@klarkxy/dsh-self-improvement')
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'self-improvement.styles')
}
