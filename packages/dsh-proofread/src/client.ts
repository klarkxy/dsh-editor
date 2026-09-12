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
import { dockEscapeKeyDown, hostComponentsFromRenderProps, proofreadInputKeyDown, type HostDialog } from './client-host-ui.ts'

export const name = 'dsh-proofread-client'
export const inject = ['slots', 'connection'] as const

const SLOT_ID = 'proofread'
const SLOT_ORDER = 110
const SLOT_LABEL = '校对'
const PROOFREAD_TEXT_EVENT = 'dsh-proofread:open-text'

export type ProofreadOpenDetail = {
  text: string
  sourceLabel?: string
  onLocate?(start: number, end: number): boolean
}

export function applyProofreadLocateResult(ok: boolean, close: () => void, note: (message: string) => void): void {
  if (ok) close()
  else note('原文已变化，请重新校对后再定位。')
}

export function parseProofreadOpenDetail(value: unknown): ProofreadOpenDetail | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.text !== 'string') return undefined
  return {
    text: row.text,
    ...(typeof row.sourceLabel === 'string' && row.sourceLabel.trim() ? { sourceLabel: row.sourceLabel.trim() } : {}),
    ...(typeof row.onLocate === 'function' ? { onLocate: row.onLocate as (start: number, end: number) => boolean } : {}),
  }
}

function findingKey(finding: ProofreadFinding): string {
  return `${finding.kind}:${finding.start}:${finding.end}:${finding.message}`
}

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

function FindingRow(props: {
  finding: ProofreadFinding
  canLocate: boolean
  onLocate(): void
  onIgnore(): void
}) {
  const { finding } = props
  const kind = finding.kind === 'repeat' && finding.severity === 'info' ? '叠词' : (KIND_LABEL[finding.kind] ?? finding.kind)
  return e('li', { className: 'dsh-proofread-finding' },
    e('div', { className: 'dsh-proofread-finding-head' },
      e('span', {
        className: `dsh-proofread-severity dsh-proofread-severity-${finding.severity}`,
        'aria-label': SEVERITY_LABEL[finding.severity] ?? finding.severity,
        title: SEVERITY_LABEL[finding.severity] ?? finding.severity,
      }),
      e('span', { className: 'dsh-proofread-finding-kind' }, kind),
      e('span', { className: 'dsh-proofread-finding-pos' }, `行 ${finding.line}`),
    ),
    e('span', { className: 'dsh-proofread-finding-message' }, finding.message),
    finding.excerpt ? e('span', { className: 'dsh-proofread-finding-excerpt', title: finding.excerpt }, finding.excerpt) : null,
    finding.suggestion
      ? e('span', { className: 'dsh-proofread-finding-suggestion' }, `建议：${finding.suggestion}`)
      : null,
    e('div', { className: 'dsh-proofread-finding-actions' },
      props.canLocate
        ? e('button', { type: 'button', className: 'dsh-proofread-locate', onClick: props.onLocate }, '定位原稿')
        : null,
      e('button', { type: 'button', className: 'dsh-proofread-ignore', onClick: props.onIgnore }, '忽略'),
    ),
  )
}

function ProofreadResult(props: {
  result: TextCheckResult
  stale: boolean
  scopeLabel?: string
  locateNote?: string
  ignored: ReadonlySet<string>
  canLocate: boolean
  onLocate(finding: ProofreadFinding): void
  onIgnore(finding: ProofreadFinding): void
}) {
  const { result, stale } = props
  const habits = result.habitStats.slice(0, 8)
  const visible = result.findings.filter((finding) => !props.ignored.has(findingKey(finding)))
  return e('div', { 'data-testid': 'proofread-result', className: 'dsh-proofread-result' },
    stale
      ? e('div', { className: 'dsh-proofread-stale', role: 'status' }, '文本已修改，以下结果对应旧版本，请重新校对。')
      : null,
    props.scopeLabel ? e('div', { className: 'dsh-proofread-scope' }, `检查范围：${props.scopeLabel}`) : null,
    props.locateNote ? e('div', { className: 'dsh-proofread-stale', role: 'status' }, props.locateNote) : null,
    e('div', { className: 'dsh-proofread-result-summary', 'aria-live': 'polite' },
      visible.length === 0
        ? (result.findings.length === 0 ? '未发现问题。' : '本轮提示已全部忽略。')
        : `发现 ${visible.length} 项${result.truncated ? '（已达上限，结果有截断）' : ''}`,
    ),
    habits.length > 0 && !stale
      ? e('div', { className: 'dsh-proofread-habits', 'aria-label': '口癖统计' },
        habits.map((stat) => e('span', { key: stat.term, className: 'dsh-proofread-habit' }, `${stat.term} ×${stat.count}`)),
      )
      : null,
    !stale && visible.length > 0
      ? e('ul', { className: 'dsh-proofread-findings' },
        visible.map((finding, index) =>
          e(FindingRow, {
            key: `${finding.kind}:${finding.start}:${index}`,
            finding,
            canLocate: props.canLocate,
            onLocate: () => props.onLocate(finding),
            onIgnore: () => props.onIgnore(finding),
          })),
      )
      : null,
  )
}

function ProofreadDock(props: { rpc: RpcCaller; Dialog?: HostDialog }) {
  const { rpc, Dialog } = props
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
  const [sourceLabel, setSourceLabel] = useState('')
  const [checkScope, setCheckScope] = useState('')
  const [locateNote, setLocateNote] = useState('')
  const [ignored, setIgnored] = useState<Set<string>>(() => new Set())
  const locateRef = useRef<((start: number, end: number) => boolean) | null>(null)
  const pendingLocateFocus = useRef<(() => boolean) | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const wasOpen = useRef(false)

  // Standalone dock owns focus return. Host Dialog restores the invoker itself.
  useEffect(() => {
    if (Dialog) return
    if (open) {
      wasOpen.current = true
      inputRef.current?.focus()
    } else if (wasOpen.current) {
      wasOpen.current = false
      const restore = pendingLocateFocus.current
      pendingLocateFocus.current = null
      if (!restore?.()) toggleRef.current?.focus()
    }
  }, [open, Dialog])

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = parseProofreadOpenDetail((event as CustomEvent<{ text?: unknown }>).detail)
      if (!detail) return
      event.preventDefault()
      setText(detail.text)
      setSourceLabel(detail.sourceLabel ?? '')
      locateRef.current = detail.onLocate ?? null
      pendingLocateFocus.current = null
      setLocateNote('')
      setIgnored(new Set())
      setRevision(gate.noteInput())
      setPhase('idle')
      setError('')
      setOpen(true)
    }
    globalThis.addEventListener(PROOFREAD_TEXT_EVENT, onOpen)
    return () => globalThis.removeEventListener(PROOFREAD_TEXT_EVENT, onOpen)
  }, [gate])

  // Unmount (slot collapse, plugin unload): cancel the in-flight request.
  useEffect(() => () => gate.cancel(), [gate])

  const runCheck = useCallback(async () => {
    const { ticket, signal } = gate.begin()
    setPhase('loading')
    setError('')
    setLocateNote('')
    setIgnored(new Set())
    setCheckScope(sourceLabel)
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
  }, [gate, rpc, text, sourceLabel])

  const cancelRequest = useCallback(() => {
    gate.cancel()
    setPhase('idle')
  }, [gate])

  const closePanel = useCallback(() => {
    gate.cancel()
    setPhase('idle')
    locateRef.current = null
    setSourceLabel('')
    setLocateNote('')
    setOpen(false)
  }, [gate])

  const onTextChange = (value: string) => {
    setText(value)
    // Editing aborts the in-flight request (noteInput aborts and stales its
    // ticket) and drops the UI back to idle so a rerun is possible; a stale
    // response arriving later is ignored by the ticket check. A completed
    // result stays visible but renders stale via the revision mismatch.
    setRevision(gate.noteInput())
    locateRef.current = null
    setSourceLabel('')
    setLocateNote('')
    setIgnored(new Set())
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
    dockEscapeKeyDown(event, { loading: phase === 'loading', close: closePanel })
  }

  const onInputKeyDown = (event: KeyboardEvent) => {
    proofreadInputKeyDown(event, { disabled: checkDisabled, runCheck: () => { void runCheck() } })
  }

  const inner = [
    e('header', { key: 'header', className: 'dsh-proofread-panel-header' },
      e('h2', { className: 'dsh-proofread-panel-title' }, '文本校对'),
      e('button', { type: 'button', className: 'dsh-proofread-panel-close', disabled: phase === 'loading', onClick: closePanel }, '关闭'),
    ),
    e('div', { key: 'body', className: 'dsh-proofread-panel-body' },
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
      phase === 'idle' && !text.trim() ? e('div', { className: 'dsh-proofread-status', role: 'status' }, '粘贴文本后开始校对。') : null,
      phase === 'loading' ? e('div', { className: 'dsh-proofread-status', role: 'status' }, '正在校对…') : null,
      phase === 'error' ? e('div', { className: 'dsh-proofread-error', role: 'alert' }, `校对失败：${error}`) : null,
      phase === 'done' && result ? e(ProofreadResult, {
        result,
        stale,
        scopeLabel: checkScope || undefined,
        locateNote,
        ignored,
        canLocate: Boolean(locateRef.current) && !stale,
        onLocate: (finding) => {
          const locate = locateRef.current
          if (!locate) {
            setLocateNote('这段文本已手动改过，无法再回到原稿位置。')
            return
          }
          const located = locate(finding.start, finding.end)
          if (located) pendingLocateFocus.current = () => locate(finding.start, finding.end)
          applyProofreadLocateResult(located, closePanel, setLocateNote)
        },
        onIgnore: (finding) => {
          setIgnored((current) => {
            const next = new Set(current)
            next.add(findingKey(finding))
            return next
          })
        },
      }) : null,
    ),
  ]

  // The toggle stays mounted as the launcher anchor whether the panel is open
  // or not: a host launcher rail lays out the dock wrapper inline, and the
  // open panel positions itself against that wrapper. Host Dialog stays mounted
  // while closed so CSS exit can run; standalone unmounts the dock panel.
  return e('div', { className: 'dsh-proofread-dock' },
    e('button', {
      type: 'button',
      ref: toggleRef,
      className: 'dsh-proofread-toggle',
      'data-testid': 'proofread-open',
      onClick: () => {
        locateRef.current = null
        setSourceLabel('')
        setLocateNote('')
        setOpen(true)
      },
    }, '校对'),
    Dialog
      ? e(Dialog, {
        open,
        onOpenChange: (next: boolean) => { if (!next) closePanel(); else setOpen(true) },
        title: '文本校对',
        className: 'file-dialog dsh-proofread-panel',
        overlayClassName: 'file-dialog-overlay',
        dismissible: phase !== 'loading',
        initialFocusRef: inputRef,
        onCloseAutoFocus: (event: Event) => {
          const restore = pendingLocateFocus.current
          pendingLocateFocus.current = null
          // Revalidate and focus after the modal focus trap has been removed.
          if (restore?.()) event.preventDefault()
        },
      }, e('div', { 'data-testid': 'proofread-panel', className: 'dsh-proofread-panel-inner' }, inner))
      : open
        ? e('section', {
          className: 'dsh-proofread-panel',
          'data-testid': 'proofread-panel',
          'aria-label': '文本校对',
          onKeyDown: onPanelKeyDown,
        }, inner)
        : null,
  )
}

export function apply(ctx: Context): void {
  // Styles live and die with the plugin fiber: unload retracts the node, and
  // a reload injects a fresh one instead of trusting a stale global flag.
  if (typeof document !== 'undefined') {
    ctx.effect(() => injectProofreadStyles(), 'dsh-proofread-client.styles')
  }
  const client = ctx as ProofreadClientContext
  const render = (props: unknown) => {
    const { Dialog } = hostComponentsFromRenderProps(props)
    return e(ProofreadDock, { rpc: client.connection.rpc, Dialog })
  }
  // Official Web declares shell.overlay. Desktop composition currently omits
  // the proofread panel and quick service, so this client does not register
  // dsh-editor.extensions. inject() still waits for the overlay seat, and the
  // caller fiber's unload retracts both the wait and the contribution.
  client.slots.inject('shell.overlay', () =>
    client.slots.register({ name: 'shell.overlay', id: SLOT_ID, order: SLOT_ORDER, label: SLOT_LABEL }, render))
}
