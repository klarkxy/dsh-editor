import { createElement as e, useEffect, useRef, useState } from 'react'
import {
  WORKBENCH_RPC_CHANNEL,
  type MemoryChange,
  type MemoryChangeSummary,
  type MemoryUpdateReceipt,
} from 'dsh-editor-workbench/contracts'
import { errorMessage, LatestRequestGate, safeRpcCall, snapshotTimeLabel, type ShellContext } from './shared.ts'
import { t, type MessageKey } from '../i18n/index.ts'

type MemoryStatus = MemoryChangeSummary['status']

const STATUS_LABEL: Record<MemoryStatus, MessageKey> = {
  pending: 'memory.status.pending',
  applied: 'memory.status.applied',
  stale: 'memory.status.stale',
  failed: 'memory.status.failed',
  undone: 'memory.status.undone',
}

function createdLabel(createdAt: string): string {
  const time = Date.parse(createdAt)
  return Number.isFinite(time) ? snapshotTimeLabel(time) : createdAt
}

/**
 * 单条项目记忆更新的查看/确认/撤销卡。聊天记录里的 novel_memory_update 回执
 * 和侧栏历史列表共用：都先按 id 拉取最新 record，再按 status 渲染操作按钮。
 * 所有异步动作走 generation 守卫，切换会话或卡片重挂载后旧响应直接丢弃。
 */
export function MemoryChangeDetail(props: {
  ctx: ShellContext
  sessionId: string
  id: string
  /** 聊天回执带来的加载前占位信息；历史列表里没有。 */
  fallback?: MemoryUpdateReceipt
  onApplied(path: string): void
  /** 记录载入即为 applied（自动写入）时的轻量刷新：只刷新树/内容，不跳转编辑器。 */
  onRefresh?(path: string): void
  /** 列表容器在状态变化后刷新条目。 */
  onChanged?(): void
}) {
  const [record, setRecord] = useState<MemoryChange | null>(null)
  const [note, setNote] = useState('')
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState<'' | 'apply' | 'undo'>('')
  const generation = useRef(0)

  const load = async (id: string) => {
    const gen = ++generation.current
    const result = await safeRpcCall<{ record: MemoryChange }>(() => props.ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'memory.get', {
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
    const result = await safeRpcCall<MemoryUpdateReceipt>(() => props.ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'memory.apply', {
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
    /* 写入成功后走既有回调刷新文件树/卡片；自动写入（落卡即 applied）同理。 */
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
    const result = await safeRpcCall<MemoryUpdateReceipt>(() => props.ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'memory.undo', {
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
    /* 过期撤销会换成一条新的 pending 记录：加载它，展示新 diff 并等待确认。 */
    if (result.value.id !== current.id && result.value.status === 'pending') {
      setNote(t('memory.staleUndoPending'))
      await load(result.value.id)
      return
    }
    setNote(result.value.message ?? t('memory.undone'))
    await load(current.id)
  }

  /* 自动写入（回执落卡即 applied）时后台已落盘：只做无跳转的树/内容刷新，
     重放历史记录时同样安全（不打开文件、不打扰当前编辑）。 */
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
  return e('article', { className: `proposal-card memory-change ${record.status}`, 'aria-label': t('memory.title') },
    e('header', null, e('strong', null, record.summary), e('code', null, record.path)),
    e('section', { className: 'memory-change-meta' },
      e('em', { className: 'cards-badge' }, t(STATUS_LABEL[record.status])),
      e('span', { className: 'muted' }, t(update.category === 'rule' ? 'memory.category.rule' : 'memory.category.fact')),
      e('span', { className: 'muted' }, t(update.certainty === 'explicit' ? 'memory.certainty.explicit' : 'memory.certainty.uncertain')),
      e('small', { className: 'muted' }, createdLabel(record.createdAt)),
    ),
    record.before === null
      ? e('section', null, e('small', null, t('memory.newContent')), e('pre', null, record.after))
      : e('div', { className: 'proposal-diff' },
        e('section', null, e('small', null, t('memory.before')), e('pre', null, record.before)),
        e('section', null, e('small', null, t('memory.after')), e('pre', null, record.after)),
      ),
    update.evidence.length ? e('section', { className: 'memory-reason' },
      e('small', null, t('memory.evidence')),
      e('ul', null, update.evidence.map((item, index) => e('li', { key: index },
        item.kind === 'file' ? e('code', null, item.path) : e('small', null, t('memory.evidenceUser')),
        ` ${item.quote}`,
      ))),
    ) : null,
    record.status === 'failed' && record.message ? e('p', { className: 'warning', role: 'alert' }, record.message) : null,
    e('footer', null,
      e('span', { role: 'status' }, note),
      record.status === 'pending' ? e('button', { type: 'button', disabled: Boolean(busy), onClick: () => void apply() }, busy === 'apply' ? t('memory.applying') : t('memory.confirm')) : null,
      record.status === 'applied' ? e('button', { type: 'button', disabled: Boolean(busy), onClick: () => void undo() }, busy === 'undo' ? t('memory.undoing') : t('memory.undo')) : null,
    ),
  )
}

/** 聊天记录里 novel_memory_update 工具结果渲染成的确认卡。 */
export function MemoryUpdateCard(props: {
  ctx: ShellContext
  sessionId: string
  receipt: MemoryUpdateReceipt
  onApplied(path: string): void
  onRefresh?(path: string): void
}) {
  return e(MemoryChangeDetail, {
    ctx: props.ctx,
    sessionId: props.sessionId,
    id: props.receipt.id,
    fallback: props.receipt,
    onApplied: props.onApplied,
    onRefresh: props.onRefresh,
  })
}

/** 侧栏的项目记忆更新历史：重启后仍可由 memory.list 恢复，可查看/确认/撤销。 */
export function MemoryPanel(props: {
  ctx: ShellContext
  sessionId: string
  revision: number
  onApplied(path: string): void
  onRefresh?(path: string): void
}) {
  const [items, setItems] = useState<MemoryChangeSummary[] | null>(null)
  const [note, setNote] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const requestGate = useRef(new LatestRequestGate()).current
  const requestScope = `${props.sessionId}`
  requestGate.setScope(requestScope)

  const load = async () => {
    const ticket = requestGate.begin(requestScope)
    const result = await safeRpcCall<{ items: MemoryChangeSummary[] }>(() => props.ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'memory.list', {
      sessionId: props.sessionId,
    }))
    if (!requestGate.isCurrent(ticket)) return
    if (!result.ok) { setItems(null); setNote(errorMessage(result)); return }
    setNote('')
    setItems(result.value.items)
  }

  useEffect(() => {
    setOpenId(null)
    void load()
  }, [props.sessionId, props.revision])

  return e('section', { className: 'snapshot-panel memory-panel', 'aria-label': t('memory.title') },
    note ? e('p', { className: 'warning', role: 'alert' }, note) : null,
    items === null && !note ? e('p', { className: 'snapshot-empty' }, t('memory.loading')) : null,
    items !== null && items.length === 0 ? e('p', { className: 'snapshot-empty' }, t('memory.empty')) : null,
    items?.length ? e('ul', { className: 'memory-list' }, items.map((item) => e('li', { key: item.id },
      e('div', { className: 'snapshot-row' },
        e('button', {
          type: 'button',
          className: 'memory-row-main',
          'aria-expanded': openId === item.id,
          onClick: () => setOpenId((current) => current === item.id ? null : item.id),
        },
          e('span', { className: 'snapshot-label' }, item.summary),
          e('span', { className: 'snapshot-meta' }, `${t(STATUS_LABEL[item.status])} · ${createdLabel(item.createdAt)}`),
        ),
      ),
      openId === item.id ? e(MemoryChangeDetail, {
        ctx: props.ctx,
        sessionId: props.sessionId,
        id: item.id,
        onApplied: props.onApplied,
        onRefresh: props.onRefresh,
        onChanged: () => void load(),
      }) : null,
    ))) : null,
  )
}
