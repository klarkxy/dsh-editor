import { createElement as e, useEffect, useRef, useState } from 'react'
import {
  WORKBENCH_RPC_CHANNEL,
  type MemoryChange,
  type MemoryChangeSummary,
  type MemoryUpdateReceipt,
} from 'dsh-editor-workbench/contracts'
import type { ShellToolSeatContext } from 'dsh-editor-seats'
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
    return e('article', { className: 'proposal-card expired', 'aria-label': t('memory.title') },
      e('header', null, e('strong', null, props.fallback?.summary ?? props.id), props.fallback ? e('code', null, props.fallback.path) : null),
      e('footer', null,
        e('span', { role: 'alert' }, failed),
        e('button', { type: 'button', onClick: () => { setFailed(''); void load(props.id) } }, t('memory.retry')),
      ),
    )
  }
  if (!record) {
    return e('article', { className: 'proposal-card checking', 'aria-label': t('memory.title') },
      e('header', null, e('strong', null, props.fallback?.summary ?? props.id), props.fallback ? e('code', null, props.fallback.path) : null),
      e('footer', null, e('span', { role: 'status' }, t('memory.loading'))),
    )
  }
  const update = record.update
  /* 共用主体：聊天卡与侧栏只有外壳（details/summary vs article/header）不同。 */
  const metaRow = e('section', { className: 'memory-change-meta' },
    props.chatCard ? null : e('em', { className: 'cards-badge' }, t(STATUS_LABEL[record.status])),
    e('span', { className: 'muted' }, t(update.category === 'rule' ? 'memory.category.rule' : 'memory.category.fact')),
    e('span', { className: 'muted' }, t(update.certainty === 'explicit' ? 'memory.certainty.explicit' : 'memory.certainty.uncertain')),
    e('small', { className: 'muted' }, createdLabel(record.createdAt)),
  )
  const contentBody = record.before === null
    ? e('section', null, e('small', null, t('memory.newContent')), e('pre', null, record.after))
    : e('div', { className: 'proposal-diff' },
      e('section', null, e('small', null, t('memory.before')), e('pre', null, record.before)),
      e('section', null, e('small', null, t('memory.after')), e('pre', null, record.after)),
    )
  const evidenceBody = update.evidence.length ? e('section', { className: 'memory-reason' },
    e('small', null, t('memory.evidence')),
    e('ul', null, update.evidence.map((item, index) => e('li', { key: index },
      item.kind === 'file' ? e('code', null, item.path) : e('small', null, t('memory.evidenceUser')),
      ` ${item.quote}`,
    ))),
  ) : null
  const failedMessage = record.status === 'failed' && record.message ? e('p', { className: 'warning', role: 'alert' }, record.message) : null
  const footerRow = e('footer', null,
    e('span', { role: 'status' }, note),
    record.status === 'pending' ? e('button', { type: 'button', disabled: Boolean(busy), onClick: () => void apply() }, busy === 'apply' ? t('memory.applying') : t('memory.confirm')) : null,
    record.status === 'applied' ? e('button', { type: 'button', disabled: Boolean(busy), onClick: () => void undo() }, busy === 'undo' ? t('memory.undoing') : t('memory.undo')) : null,
    props.onBack ? e('button', { type: 'button', disabled: Boolean(busy), onClick: props.onBack }, t('memory.back')) : null,
  )
  /* 聊天卡：已应用/已撤销默认收起差异与引用，摘要状态留在 summary；pending/failed/stale 需要作者注意，默认展开。 */
  if (props.chatCard) {
    const needsAttention = record.status === 'pending' || record.status === 'failed' || record.status === 'stale'
    return e('details', { className: `proposal-card memory-change memory-change-chat ${record.status}`, open: needsAttention || undefined, 'aria-label': t('memory.title') },
      e('summary', null,
        e('strong', null, record.summary),
        e('code', null, record.path),
        e('em', { className: 'cards-badge' }, t(STATUS_LABEL[record.status])),
      ),
      metaRow,
      contentBody,
      evidenceBody,
      failedMessage,
      footerRow,
    )
  }
  return e('article', { className: `proposal-card memory-change ${record.status}`, 'aria-label': t('memory.title') },
    e('header', null, e('strong', null, record.summary), e('code', null, record.path)),
    metaRow,
    contentBody,
    evidenceBody,
    failedMessage,
    footerRow,
  )
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

  return e('section', { className: 'memory-panel', 'data-testid': 'memory-panel', 'aria-label': t('memory.title') },
    e('header', { className: 'memory-panel-header' },
      e('div', null,
        e('h2', null, t('memory.title')),
      ),
      e('button', { className: 'icon-button', type: 'button', 'aria-label': t('memory.close'), onClick: props.onClose }, '×'),
    ),
    e('div', { className: 'memory-filters', role: 'group', 'aria-label': t('memory.filter') },
      STATUS_FILTERS.map((status) => e('button', {
        key: status,
        type: 'button',
        'aria-pressed': statusFilter === status,
        onClick: () => setStatusFilter((current) => current === status ? null : status),
      }, t(STATUS_LABEL[status]))),
    ),
    note ? e('p', { className: 'memory-status warning', role: 'alert' },
      note,
      items === null ? e('button', { type: 'button', onClick: () => void load() }, t('memory.retryList')) : null,
    ) : null,
    items === null && !note ? e('p', { className: 'memory-status', role: 'status' }, t('memory.loading')) : null,
    items !== null && items.length === 0 ? e('p', { className: 'memory-status' }, t('memory.empty')) : null,
    items !== null && items.length > 0 && visible.length === 0 ? e('p', { className: 'memory-status' }, t('memory.noMatch')) : null,
    visible.length ? e('ul', { className: 'memory-list' }, visible.map((item) => e('li', { key: item.id },
      e('button', {
        type: 'button',
        className: 'memory-row-main',
        'aria-expanded': openId === item.id,
        onClick: () => setOpenId((current) => current === item.id ? null : item.id),
      },
        e('span', { className: 'memory-label' }, item.summary),
        e('span', { className: 'memory-meta' }, `${t(STATUS_LABEL[item.status])} · ${createdLabel(item.createdAt)}`),
      ),
      openId === item.id ? e(MemoryChangeDetail, {
        rpc: props.rpc,
        sessionId: props.sessionId,
        id: item.id,
        onApplied: refreshWritten,
        onRefresh: refreshWritten,
        onChanged: () => void load(),
        onBack: () => setOpenId(null),
      }) : null,
    ))) : null,
  )
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
  return e(MemoryPanel, { ...props, request, onClose: () => setOpen(false) })
}
