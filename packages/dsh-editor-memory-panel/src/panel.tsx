import React, { Fragment, useEffect, useRef, useState } from 'react';
import {
  WORKBENCH_RPC_CHANNEL,
  type MemoryChange,
  type MemoryChangeSummary,
  type MemoryUpdateReceipt,
} from 'dsh-editor-workbench/contracts'
import type { ShellToolSeatContext } from 'dsh-editor-seats'
import { SeatButton } from 'dsh-editor-seats/seat-button'
import { errorMessage, LatestRequestGate, safeRpcCall, snapshotTimeLabel } from './rpc.ts'
import { setMemoryLocale, t, type MessageKey } from './messages.ts'
import { consumeMemoryRequest, pendingMemoryRequest, subscribeMemoryRequest, type MemoryRequest } from './requests.ts'

export type RpcCaller = {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}

export type MemorySeatProps = ShellToolSeatContext & { rpc: RpcCaller }

type MemoryStatus = MemoryChangeSummary['status']

const STATUS_LABEL: Record<MemoryStatus, MessageKey> = {
  pending: 'memory.status.pending',
  applied: 'memory.status.applied',
  stale: 'memory.status.stale',
  failed: 'memory.status.failed',
  undone: 'memory.status.undone',
}

const STATUS_FILTERS: MemoryStatus[] = ['pending', 'applied', 'stale', 'failed', 'undone']

/* 活动暗示:三点呼吸与骨架行,参数改写自 Amicro(MIT)pulse-dots / fluid-skeleton;
   装饰性 aria-hidden,关键帧在 styles.ts,reduced-motion 停循环后保留静态可读态。 */
const activityDots = () => <span className="panel-activity-dots" aria-hidden="true">
  <i />
  <i />
  <i />
</span>
const skeletonRows = (widths: readonly string[]) => <span className="panel-skeleton" aria-hidden="true">
  {widths.map((width, index) => <i key={index} style={{ width }} />)}
</span>

function createdLabel(createdAt: string): string {
  const time = Date.parse(createdAt)
  return Number.isFinite(time) ? snapshotTimeLabel(time) : createdAt
}

export function MemoryChangeDetail(props: {
  rpc: RpcCaller
  sessionId: string
  id: string
  fallback?: MemoryUpdateReceipt
  /* 聊天卡形态：已应用的记录默认收起差异与引用，只留摘要状态；需要作者注意的 pending/failed/stale 默认展开。侧栏完整详情不传此属性。 */
  chatCard?: boolean
  onApplied(path: string): void
  onRefresh?(path: string): void
  onChanged?(): void
  onBack?(): void
  hostButton?: ShellToolSeatContext['Button']
}) {
  const [record, setRecord] = useState<MemoryChange | null>(null)
  const [note, setNote] = useState('')
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState<'' | 'apply' | 'undo'>('')
  const generation = useRef(0)

  const load = async (id: string) => {
    const gen = ++generation.current
    const result = await safeRpcCall<{ record: MemoryChange }>(() => props.rpc.call(WORKBENCH_RPC_CHANNEL, 'memory.get', {
      sessionId: props.sessionId,
      id,
    }))
    if (generation.current !== gen) return
    if (!result.ok) { setRecord(null); setFailed(errorMessage(result)); return }
    setFailed('')
    setRecord(result.value.record)
  }

  useEffect(() => {
    setRecord(null)
    setNote('')
    setFailed('')
    setBusy('')
    void load(props.id)
    return () => { generation.current += 1 }
  }, [props.sessionId, props.id])

  const apply = async () => {
    const current = record
    if (!current || busy || current.status !== 'pending') return
    const gen = ++generation.current
    setBusy('apply')
    setNote(t('memory.applying'))
    const result = await safeRpcCall<MemoryUpdateReceipt>(() => props.rpc.call(WORKBENCH_RPC_CHANNEL, 'memory.apply', {
      sessionId: props.sessionId,
      id: current.id,
    }))
    if (generation.current !== gen) return
    setBusy('')
    if (!result.ok) {
      setNote(errorMessage(result))
      await load(current.id)
      return
    }
    setNote(result.value.message ?? t('memory.applied'))
    props.onApplied(current.update.path)
    props.onChanged?.()
    await load(current.id)
  }

  const undo = async () => {
    const current = record
    if (!current || busy || current.status !== 'applied') return
    const gen = ++generation.current
    setBusy('undo')
    setNote(t('memory.undoing'))
    const result = await safeRpcCall<MemoryUpdateReceipt>(() => props.rpc.call(WORKBENCH_RPC_CHANNEL, 'memory.undo', {
      sessionId: props.sessionId,
      id: current.id,
    }))
    if (generation.current !== gen) return
    setBusy('')
    if (!result.ok) {
      setNote(errorMessage(result))
      await load(current.id)
      return
    }
    props.onApplied(current.update.path)
    props.onChanged?.()
    if (result.value.id !== current.id && result.value.status === 'pending') {
      setNote(t('memory.staleUndoPending'))
      await load(result.value.id)
      return
    }
    setNote(result.value.message ?? t('memory.undone'))
    await load(current.id)
  }

  const autoRefreshRef = useRef('')
  useEffect(() => {
    if (!record || record.status !== 'applied') return
    if (autoRefreshRef.current === record.id) return
    autoRefreshRef.current = record.id
    props.onRefresh?.(record.update.path)
  }, [record])

  if (failed) {
    return (
      <article className="proposal-card expired" aria-label={t('memory.title')}>
        <header>
          <strong>
            {props.fallback?.summary ?? props.id}
          </strong>
          {props.fallback ? <code>
            {props.fallback.path}
          </code> : null}
        </header>
        <footer>
          <span role="alert">
            {failed}
          </span>
          <SeatButton host={props.hostButton} onClick={() => { setFailed(''); void load(props.id) }}>
            {t('memory.retry')}
          </SeatButton>
        </footer>
      </article>
    );
  }
  if (!record) {
    return (
      <article className="proposal-card checking" aria-label={t('memory.title')}>
        <header>
          <strong>
            {props.fallback?.summary ?? props.id}
          </strong>
          {props.fallback ? <code>
            {props.fallback.path}
          </code> : null}
        </header>
        <footer>
          <span role="status">
            {activityDots()}
            {t('memory.loading')}
          </span>
        </footer>
      </article>
    );
  }
  const update = record.update
  /* 共用主体：聊天卡与侧栏只有外壳（details/summary vs article/header）不同。 */
  const metaRow = <section className="memory-change-meta">
    {props.chatCard ? null : <em className="cards-badge">
      {t(STATUS_LABEL[record.status])}
    </em>}
    <span className="muted">
      {t(update.category === 'rule' ? 'memory.category.rule' : 'memory.category.fact')}
    </span>
    <span className="muted">
      {t(update.certainty === 'explicit' ? 'memory.certainty.explicit' : 'memory.certainty.uncertain')}
    </span>
    <small className="muted">
      {createdLabel(record.createdAt)}
    </small>
  </section>
  const contentBody = record.before === null
    ? <section>
    <small>
      {t('memory.newContent')}
    </small>
    <pre>
      {record.after}
    </pre>
  </section>
    : <div className="proposal-diff">
    <section>
      <small>
        {t('memory.before')}
      </small>
      <pre>
        {record.before}
      </pre>
    </section>
    <section>
      <small>
        {t('memory.after')}
      </small>
      <pre>
        {record.after}
      </pre>
    </section>
  </div>
  const evidenceBody = update.evidence.length ? <section className="memory-reason">
    <small>
      {t('memory.evidence')}
    </small>
    <ul>
      {update.evidence.map((item, index) => <li key={index}>
        {item.kind === 'file' ? <code>
          {item.path}
        </code> : <small>
          {t('memory.evidenceUser')}
        </small>}
        {` ${item.quote}`}
      </li>)}
    </ul>
  </section> : null
  const failedMessage = record.status === 'failed' && record.message ? <p className="warning" role="alert">
    {record.message}
  </p> : null
  const footerRow = <footer>
    <span role="status">
      {busy ? activityDots() : null}
      {note}
    </span>
    {record.status === 'pending' ? <SeatButton host={props.hostButton} disabled={Boolean(busy)} onClick={() => void apply()}>
      {busy === 'apply' ? <Fragment>
        {activityDots()}
        {t('memory.applying')}
      </Fragment> : t('memory.confirm')}
    </SeatButton> : null}
    {record.status === 'applied' ? <SeatButton host={props.hostButton} disabled={Boolean(busy)} onClick={() => void undo()}>
      {busy === 'undo' ? <Fragment>
        {activityDots()}
        {t('memory.undoing')}
      </Fragment> : t('memory.undo')}
    </SeatButton> : null}
    {props.onBack ? <SeatButton host={props.hostButton} disabled={Boolean(busy)} onClick={props.onBack}>
      {t('memory.back')}
    </SeatButton> : null}
  </footer>
  /* 聊天卡：已应用/已撤销默认收起差异与引用，摘要状态留在 summary；pending/failed/stale 需要作者注意，默认展开。 */
  if (props.chatCard) {
    const needsAttention = record.status === 'pending' || record.status === 'failed' || record.status === 'stale'
    return (
      <details
        className={`proposal-card memory-change memory-change-chat ${record.status}`}
        open={needsAttention || undefined}
        aria-label={t('memory.title')}>
        <summary>
          <strong>
            {record.summary}
          </strong>
          <code>
            {record.path}
          </code>
          <em className="cards-badge">
            {t(STATUS_LABEL[record.status])}
          </em>
        </summary>
        {metaRow}
        {contentBody}
        {evidenceBody}
        {failedMessage}
        {footerRow}
      </details>
    );
  }
  return (
    <article
      className={`proposal-card memory-change ${record.status}`}
      aria-label={t('memory.title')}>
      <header>
        <strong>
          {record.summary}
        </strong>
        <code>
          {record.path}
        </code>
      </header>
      {metaRow}
      {contentBody}
      {evidenceBody}
      {failedMessage}
      {footerRow}
    </article>
  );
}

function MemoryPanel(props: MemorySeatProps & { request?: MemoryRequest | null; onClose(): void }) {
  setMemoryLocale(props.locale)
  const [items, setItems] = useState<MemoryChangeSummary[] | null>(null)
  const [note, setNote] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<MemoryStatus | null>(null)
  const requestGate = useRef(new LatestRequestGate()).current
  const requestScope = `${props.sessionId}\u0000${props.treeRevision}`
  requestGate.setScope(requestScope)

  const load = async () => {
    const ticket = requestGate.begin(requestScope)
    const result = await safeRpcCall<{ items: MemoryChangeSummary[] }>(() => props.rpc.call(WORKBENCH_RPC_CHANNEL, 'memory.list', {
      sessionId: props.sessionId,
    }))
    if (!requestGate.isCurrent(ticket)) return
    if (!result.ok) { setItems(null); setNote(errorMessage(result, props.locale)); return }
    const listed = result.value.items
    setNote('')
    setItems(listed)
    setOpenId((current) => current != null && listed.some((item) => item.id === current) ? current : null)
  }

  useEffect(() => {
    setOpenId(null)
    setStatusFilter(null)
  }, [props.sessionId])

  useEffect(() => {
    void load()
  }, [props.sessionId, props.treeRevision])

  useEffect(() => {
    if (!props.request) return
    consumeMemoryRequest(props.request)
  }, [props.request?.nonce])

  const refreshWritten = (path: string) => {
    props.refresh('tree')
    if (path === props.activePath && !props.editorDirty) props.refresh('content')
  }

  const visible = items?.filter((item) => !statusFilter || item.status === statusFilter) ?? []

  return (
    <section
      className="memory-panel"
      data-testid="memory-panel"
      aria-label={t('memory.title')}>
      <header className="memory-panel-header">
        <div>
          <h2>
            {t('memory.title')}
          </h2>
        </div>
        <SeatButton
          host={props.Button}
          variant="icon"
          className="icon-button"
          aria-label={t('memory.close')}
          onClick={props.onClose}>
          ×
        </SeatButton>
      </header>
      <div className="memory-filters" role="group" aria-label={t('memory.filter')}>
        {STATUS_FILTERS.map((status) => <SeatButton
          host={props.Button}
          key={status}
          aria-pressed={statusFilter === status}
          onClick={() => setStatusFilter((current) => current === status ? null : status)}>
          {t(STATUS_LABEL[status])}
        </SeatButton>)}
      </div>
      {note ? <p className="memory-status warning" role="alert">
        {note}
        {items === null ? <SeatButton host={props.Button} onClick={() => void load()}>
          {t('memory.retryList')}
        </SeatButton> : null}
      </p> : null}
      {items === null && !note ? <div className="memory-status" role="status">
        {skeletonRows(['100%', '88%', '96%'])}
        <span className="sr-only">
          {t('memory.loading')}
        </span>
      </div> : null}
      {items !== null && items.length === 0 ? <p className="memory-status">
        {t('memory.empty')}
      </p> : null}
      {items !== null && items.length > 0 && visible.length === 0 ? <p className="memory-status">
        {t('memory.noMatch')}
      </p> : null}
      {visible.length ? <ul className="memory-list">
        {visible.map((item) => <li key={item.id}>
          <SeatButton
            host={props.Button}
            className="memory-row-main"
            aria-expanded={openId === item.id}
            onClick={() => setOpenId((current) => current === item.id ? null : item.id)}>
            <span className="memory-label">
              {item.summary}
            </span>
            <span className="memory-meta">
              {`${t(STATUS_LABEL[item.status])} · ${createdLabel(item.createdAt)}`}
            </span>
          </SeatButton>
          {openId === item.id ? <MemoryChangeDetail
            hostButton={props.Button}
            rpc={props.rpc}
            sessionId={props.sessionId}
            id={item.id}
            onApplied={refreshWritten}
            onRefresh={refreshWritten}
            onChanged={() => void load()}
            onBack={() => setOpenId(null)} /> : null}
        </li>)}
      </ul> : null}
    </section>
  );
}

export function MemorySeat(props: MemorySeatProps) {
  const initial = pendingMemoryRequest()
  const [open, setOpen] = useState(() => initial !== null)
  const [request, setRequest] = useState<MemoryRequest | null>(() => initial)
  useEffect(() => subscribeMemoryRequest((next) => {
    setOpen(true)
    setRequest(next)
  }), [])
  const sessionRef = useRef(props.sessionId)
  useEffect(() => {
    if (sessionRef.current === props.sessionId) return
    sessionRef.current = props.sessionId
    setOpen(false)
    setRequest(null)
  }, [props.sessionId])
  if (!open) return null
  return <MemoryPanel {...props} request={request} onClose={() => setOpen(false)} />;
}
