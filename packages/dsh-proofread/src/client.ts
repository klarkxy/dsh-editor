import type { Context } from '@deepseek-ai/cordis'
import { createElement as e, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  PROOFREAD_MAX_TEXT_BYTES,
  PROOFREAD_RPC_CHANNEL,
  type ProofreadFinding,
  type ProofreadRpcResult,
  type ProofreadSeverity,
  type TextCheckResult,
} from './contracts.ts'
import { createProofreadClientState, type ProofreadClientState } from './client-state.ts'
import { proofreadClientStyles } from './client-styles.ts'

export const name = 'dsh-proofread-client'
export const inject = ['slots', 'connection'] as const

const SLOT_ID = 'proofread'
const SLOT_ORDER = 110
const SLOT_LABEL = '校对'

type RpcCaller = {
  call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>
}

type SlotHandle = {
  inject: (key: string, callback: () => unknown) => unknown
  register: (spec: { name: string; id?: string; order?: number; label?: string }, render: unknown) => unknown
}

type ProofreadClientContext = Context & {
  slots: SlotHandle
  connection: { rpc: RpcCaller }
}

const KIND_LABEL: Record<string, string> = {
  punctuation: '标点',
  sensitive: '敏感词',
  repeat: '重复',
  typo: '错别字',
  habit: '口癖',
  card: '人物卡',
}

const SEVERITY_LABEL: Record<ProofreadSeverity, string> = { error: '错误', warning: '提醒', info: '提示' }

function injectProofreadStyles(): () => void {
  const style = document.createElement('style')
  style.setAttribute('data-dsh-proofread-styles', '')
  style.textContent = proofreadClientStyles
  document.head.appendChild(style)
  return () => style.remove()
}

function byteSize(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function FindingRow(props: { finding: ProofreadFinding }) {
  const { finding } = props
  return e('li', { className: 'dsh-proofread-finding' },
    e('div', { className: 'dsh-proofread-finding-head' },
      e('span', {
        className: `dsh-proofread-severity dsh-proofread-severity-${finding.severity}`,
        'aria-label': SEVERITY_LABEL[finding.severity] ?? finding.severity,
        title: SEVERITY_LABEL[finding.severity] ?? finding.severity,
      }),
      e('span', { className: 'dsh-proofread-finding-kind' }, KIND_LABEL[finding.kind] ?? finding.kind),
      e('span', { className: 'dsh-proofread-finding-pos' }, `行 ${finding.line}`),
    ),
    e('span', { className: 'dsh-proofread-finding-message' }, finding.message),
    finding.excerpt ? e('span', { className: 'dsh-proofread-finding-excerpt', title: finding.excerpt }, finding.excerpt) : null,
    finding.suggestion
      ? e('span', { className: 'dsh-proofread-finding-suggestion' }, `建议：${finding.suggestion}`)
      : null,
  )
}

function ProofreadResult(props: { result: TextCheckResult; stale: boolean }) {
  const { result, stale } = props
  const habits = result.habitStats.slice(0, 8)
  return e('div', { 'data-testid': 'proofread-result', className: 'dsh-proofread-result' },
    stale
      ? e('div', { className: 'dsh-proofread-stale', role: 'status' }, '文本已修改，以下结果对应旧版本，请重新校对。')
      : null,
    e('div', { className: 'dsh-proofread-result-summary', 'aria-live': 'polite' },
      result.findings.length === 0
        ? '未发现问题。'
        : `发现 ${result.findings.length} 项${result.truncated ? '（已达上限，结果有截断）' : ''}`,
    ),
    habits.length > 0 && !stale
      ? e('div', { className: 'dsh-proofread-habits', 'aria-label': '口癖统计' },
        habits.map((stat) => e('span', { key: stat.term, className: 'dsh-proofread-habit' }, `${stat.term} ×${stat.count}`)),
      )
      : null,
    !stale && result.findings.length > 0
      ? e('ul', { className: 'dsh-proofread-findings' },
        result.findings.map((finding, index) =>
          e(FindingRow, { key: `${finding.kind}:${finding.start}:${index}`, finding })),
      )
      : null,
  )
}

function ProofreadDock(props: { rpc: RpcCaller }) {
  const { rpc } = props
  const gateRef = useRef<ProofreadClientState | null>(null)
  if (!gateRef.current) gateRef.current = createProofreadClientState()
  const gate = gateRef.current
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [revision, setRevision] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<TextCheckResult | null>(null)
  const [resultRevision, setResultRevision] = useState(0)
  const [error, setError] = useState('')
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const wasOpen = useRef(false)

  // Focus management: entering the panel lands in the textarea; leaving it
  // (close button or Escape) returns focus to the toggle.
  useEffect(() => {
    if (open) {
      wasOpen.current = true
      inputRef.current?.focus()
    } else if (wasOpen.current) {
      wasOpen.current = false
      toggleRef.current?.focus()
    }
  }, [open])

  // Unmount (slot collapse, plugin unload): cancel the in-flight request.
  useEffect(() => () => gate.cancel(), [gate])

  const runCheck = useCallback(async () => {
    const { ticket, signal } = gate.begin()
    setPhase('loading')
    setError('')
    try {
      const response = await rpc.call(PROOFREAD_RPC_CHANNEL, 'text.check', { text }, signal) as ProofreadRpcResult
      if (!gate.isCurrent(ticket)) return
      if (response.ok) {
        setResult(response.value)
        setResultRevision(ticket.revision)
        setPhase('done')
      } else if (response.error.code === 'cancelled') {
        setPhase('idle')
      } else {
        setError(response.error.message)
        setPhase('error')
      }
    } catch (cause) {
      if (!gate.isCurrent(ticket)) return
      setError(cause instanceof Error ? cause.message : String(cause))
      setPhase('error')
    }
  }, [gate, rpc, text])

  const cancelRequest = useCallback(() => {
    gate.cancel()
    setPhase('idle')
  }, [gate])

  const closePanel = useCallback(() => {
    gate.cancel()
    setPhase('idle')
    setOpen(false)
  }, [gate])

  const onTextChange = (value: string) => {
    setText(value)
    // Editing aborts the in-flight request (noteInput aborts and stales its
    // ticket) and drops the UI back to idle so a rerun is possible; a stale
    // response arriving later is ignored by the ticket check. A completed
    // result stays visible but renders stale via the revision mismatch.
    setRevision(gate.noteInput())
    if (phase === 'loading' || phase === 'error') {
      setPhase('idle')
      setError('')
    }
  }

  const size = byteSize(text)
  const overLimit = size > PROOFREAD_MAX_TEXT_BYTES
  const checkDisabled = phase === 'loading' || !text.trim() || overLimit
  const stale = result !== null && resultRevision !== revision

  const onPanelKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      closePanel()
    }
  }

  const onInputKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !checkDisabled) {
      event.preventDefault()
      void runCheck()
    }
  }

  // The toggle stays mounted as the launcher anchor whether the panel is open
  // or not: a host launcher rail lays out the dock wrapper inline, and the
  // open panel positions itself against that wrapper.
  return e('div', { className: 'dsh-proofread-dock' },
    e('button', {
      type: 'button',
      ref: toggleRef,
      className: 'dsh-proofread-toggle',
      'data-testid': 'proofread-open',
      onClick: () => setOpen(true),
    }, '校对'),
    open ? e('section', {
    className: 'dsh-proofread-panel',
    'data-testid': 'proofread-panel',
    'aria-label': '文本校对',
    onKeyDown: onPanelKeyDown,
  },
    e('header', { className: 'dsh-proofread-panel-header' },
      e('h2', { className: 'dsh-proofread-panel-title' }, '文本校对'),
      e('button', { type: 'button', className: 'dsh-proofread-panel-close', onClick: closePanel }, '关闭'),
    ),
    e('div', { className: 'dsh-proofread-panel-body' },
      e('textarea', {
        ref: inputRef,
        className: 'dsh-proofread-input',
        'data-testid': 'proofread-input',
        'aria-label': '待校对文本',
        placeholder: '粘贴或输入要校对的中文文本…',
        value: text,
        onChange: (event: { target: { value: string } }) => onTextChange(event.target.value),
        onKeyDown: onInputKeyDown,
      }),
      e('div', { className: 'dsh-proofread-panel-footer' },
        e('button', {
          type: 'button',
          className: 'dsh-proofread-check',
          'data-testid': 'proofread-check',
          disabled: checkDisabled,
          onClick: () => void runCheck(),
        }, phase === 'loading' ? '校对中…' : '开始校对'),
        phase === 'loading'
          ? e('button', { type: 'button', className: 'dsh-proofread-cancel', onClick: cancelRequest }, '取消')
          : null,
        e('span', { className: `dsh-proofread-hint${overLimit ? ' dsh-proofread-is-over' : ''}` },
          overLimit ? '超出单篇长度上限' : 'Ctrl+Enter 校对'),
      ),
      phase === 'loading' ? e('div', { className: 'dsh-proofread-status', role: 'status' }, '正在校对…') : null,
      phase === 'error' ? e('div', { className: 'dsh-proofread-error', role: 'alert' }, `校对失败：${error}`) : null,
      phase === 'done' && result ? e(ProofreadResult, { result, stale }) : null,
    ),
  ) : null,
  )
}

export function apply(ctx: Context): void {
  // Styles live and die with the plugin fiber: unload retracts the node, and
  // a reload injects a fresh one instead of trusting a stale global flag.
  if (typeof document !== 'undefined') {
    ctx.effect(() => injectProofreadStyles(), 'dsh-proofread-client.styles')
  }
  const client = ctx as ProofreadClientContext
  const render = () => e(ProofreadDock, { rpc: client.connection.rpc })
  // Official Web declares shell.overlay; the DSH Editor root declares
  // dsh-editor.extensions. inject() waits for the declaration, so each entry
  // goes live only in the host that actually provides the seat, and the
  // caller fiber's unload retracts both the wait and the contribution.
  client.slots.inject('shell.overlay', () =>
    client.slots.register({ name: 'shell.overlay', id: SLOT_ID, order: SLOT_ORDER, label: SLOT_LABEL }, render))
  client.slots.inject('dsh-editor.extensions', () =>
    client.slots.register({ name: 'dsh-editor.extensions', id: SLOT_ID, order: SLOT_ORDER, label: SLOT_LABEL }, render))
}
