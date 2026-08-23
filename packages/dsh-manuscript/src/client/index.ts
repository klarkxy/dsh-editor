import type { Context } from '@deepseek-ai/cordis'
import { createElement as e, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { asClient, type ManuscriptClient, type RpcBag } from '../host.ts'
import { cwdFromSessionList } from './session-cwd.ts'
import { registerManuscriptUi, type SlotHandle } from './slots.ts'

export const name = 'dsh-manuscript-client'
export const inject = ['slots', 'sessions', 'connection'] as const

type Entry = { name: string; type: 'file' | 'directory' | 'other' }

function useCwd(ctx: ManuscriptClient): string {
  const [cwd, setCwd] = useState(() => cwdFromSessionList(ctx.sessions.list?.getSnapshot?.()))
  useEffect(() => {
    const list = ctx.sessions.list
    const sync = () => setCwd(cwdFromSessionList(list?.getSnapshot?.()))
    sync()
    return list?.subscribe?.(sync)
  }, [ctx])
  return cwd
}

function parentOf(rel: string): string {
  const index = rel.lastIndexOf('/')
  return index < 0 ? '.' : rel.slice(0, index)
}

function Tree(props: {
  cwd: string
  rpc: RpcBag
  onOpen: (path: string) => void
  active: string
  revision: number
}) {
  const [open, setOpen] = useState<Record<string, Entry[]>>({})
  const openRef = useRef(open)
  openRef.current = open
  const load = useCallback(
    async (rel: string) => {
      const result = await props.rpc.call('/manuscript', 'tree.list', { cwd: props.cwd, path: rel })
      if (result.ok) {
        const value = result.value as { entries: Entry[] }
        setOpen((cur) => ({ ...cur, [rel]: value.entries }))
      }
    },
    [props.cwd, props.rpc],
  )
  useEffect(() => {
    void load('.')
  }, [load])
  useEffect(() => {
    const keys = Object.keys(openRef.current)
    if (!keys.includes('.')) keys.unshift('.')
    for (const rel of keys) void load(rel)
  }, [props.revision, load])

  const render = (rel: string, depth: number): ReactNode[] => {
    const entries = open[rel] ?? []
    return entries.filter((entry) => !entry.name.startsWith('.')).map((entry) => {
      const child = rel === '.' ? entry.name : `${rel}/${entry.name}`
      if (entry.type === 'directory') {
        const expanded = open[child] !== undefined
        return e('div', { key: child },
          e('button', {
            type: 'button',
            style: { display: 'block', width: '100%', textAlign: 'left', paddingLeft: 8 + depth * 12, border: 0, background: 'transparent', cursor: 'pointer' },
            onClick: () => {
              if (expanded) setOpen((cur) => { const next = { ...cur }; delete next[child]; return next })
              else void load(child)
            },
          }, `${expanded ? '▾' : '▸'} ${entry.name}`),
          expanded ? render(child, depth + 1) : null,
        )
      }
      return e('button', {
        key: child,
        type: 'button',
        onClick: () => props.onOpen(child),
        style: {
          display: 'block',
          width: '100%',
          textAlign: 'left',
          paddingLeft: 8 + depth * 12,
          border: 0,
          background: props.active === child ? 'rgba(0,0,0,0.08)' : 'transparent',
          cursor: 'pointer',
        },
      }, entry.name)
    })
  }
  return e('div', { 'data-testid': 'manuscript-tree', style: { overflow: 'auto', fontSize: 13, height: '100%' } }, render('.', 0))
}

const EDITOR_FONT = 'Georgia, "Noto Serif SC", serif'
const EDITOR_PAD = 16
const EDITOR_SIZE = 16
const EDITOR_LINE = 1.7

type ProposalKind = 'patch' | 'replace' | 'append'
type Proposal = {
  id: string
  path: string
  kind: ProposalKind
  segments: { old_text: string; new_text: string }[]
  body?: string
}

function proposalLabel(kind: ProposalKind): string {
  if (kind === 'replace') return '整章替换'
  if (kind === 'append') return '接到文末'
  return '修改稿'
}

function proposalPreview(item: Proposal): string {
  if (item.kind === 'patch') {
    const first = item.segments[0]
    if (!first) return ''
    const next = first.new_text.replace(/\s+/g, ' ').slice(0, 80)
    return item.segments.length > 1 ? `${next} · ${item.segments.length} 段` : next
  }
  return (item.body || '').replace(/\s+/g, ' ').slice(0, 80)
}

function ProposalBar(props: {
  item: Proposal
  busy: boolean
  error: string
  onAccept: () => void
  onReject: () => void
}) {
  const acceptLabel = props.item.kind === 'append' ? '接到文末' : props.item.kind === 'replace' ? '整章替换' : '同意'
  return e('div', {
    'data-testid': 'manuscript-proposal',
    'data-kind': props.item.kind,
    style: { padding: '8px 8px 6px', borderTop: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08))', fontSize: 12 },
  },
    e('div', { style: { fontWeight: 600, marginBottom: 4 } }, proposalLabel(props.item.kind)),
    proposalPreview(props.item) ? e('div', { style: { opacity: 0.7, marginBottom: 6, lineHeight: 1.4 } }, proposalPreview(props.item)) : null,
    e('div', { style: { display: 'flex', gap: 8 } },
      e('button', {
        type: 'button',
        'data-testid': 'manuscript-proposal-accept',
        disabled: props.busy,
        onClick: props.onAccept,
      }, acceptLabel),
      e('button', {
        type: 'button',
        'data-testid': 'manuscript-proposal-reject',
        disabled: props.busy,
        onClick: props.onReject,
      }, '拒绝'),
    ),
    props.error ? e('div', { style: { marginTop: 6, color: '#8a3a30' } }, props.error) : null,
  )
}

function countChars(text: string): number {
  return text.replace(/\s/g, '').length
}

function rewritePrompt(path: string, selection: string): string {
  return `请用 drafting 改这段。文件：${path}\n请对下面选区调用 propose_patch（old_text 必须与选区完全一致），不要直接写盘。\n\n${selection}`
}

type DomArea = {
  closest: (sel: string) => unknown
  getAttribute: (name: string) => string | null
  focus: () => void
  dispatchEvent: (ev: { type: string }) => void
}

async function sendSelectionToChat(path: string, selection: string): Promise<'composer' | 'clipboard' | 'failed'> {
  const text = rewritePrompt(path, selection)
  const g = globalThis as unknown as {
    document?: { querySelectorAll: (sel: string) => ArrayLike<DomArea> }
    HTMLTextAreaElement?: { prototype: object }
    Event?: new (type: string, init?: { bubbles?: boolean }) => { type: string }
    navigator?: { clipboard?: { writeText: (value: string) => Promise<void> } }
  }
  const boxes = g.document ? Array.from(g.document.querySelectorAll('textarea')) : []
  const box = boxes.find((el) => {
    if (el.closest('[data-testid="manuscript-overlay"]')) return false
    const ph = `${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''}`
    return /智能体|Message|Ask|描述你想要|发消息/.test(ph)
  }) || boxes.find((el) => !el.closest('[data-testid="manuscript-overlay"]'))
  if (box) {
    const desc = g.HTMLTextAreaElement ? Object.getOwnPropertyDescriptor(g.HTMLTextAreaElement.prototype, 'value') : undefined
    desc?.set?.call(box, text)
    const Ev = g.Event
    if (Ev) {
      box.dispatchEvent(new Ev('input', { bubbles: true }))
      box.dispatchEvent(new Ev('change', { bubbles: true }))
    }
    box.focus()
    return 'composer'
  }
  try {
    if (!g.navigator?.clipboard?.writeText) return 'failed'
    await g.navigator.clipboard.writeText(text)
    return 'clipboard'
  } catch {
    return 'failed'
  }
}

function Editor(props: {
  cwd: string
  path: string
  rpc: RpcBag
  onTreeMutate?: () => void
}) {
  const [text, setText] = useState('')
  const [version, setVersion] = useState('')
  const [ghost, setGhost] = useState('')
  const [ghostAt, setGhostAt] = useState(0)
  const [error, setError] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [proposalBusy, setProposalBusy] = useState(false)
  const [proposalError, setProposalError] = useState('')
  const [notice, setNotice] = useState('')
  const [hasSelection, setHasSelection] = useState(false)
  const ta = useRef<HTMLTextAreaElement | null>(null)
  const mirror = useRef<HTMLDivElement | null>(null)
  const abort = useRef<AbortController | null>(null)
  const composing = useRef(false)
  const textRef = useRef(text)
  const versionRef = useRef(version)
  textRef.current = text
  versionRef.current = version

  const syncMirror = () => {
    if (ta.current && mirror.current) {
      mirror.current.scrollTop = ta.current.scrollTop
      mirror.current.scrollLeft = ta.current.scrollLeft
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await props.rpc.call('/manuscript', 'file.read', { cwd: props.cwd, path: props.path })
      if (cancelled) return
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      const value = result.value as { text: string; version: string }
      setText(value.text)
      setVersion(value.version)
      setError('')
      setGhost('')
      setGhostAt(0)
    })()
    return () => {
      cancelled = true
    }
  }, [props.cwd, props.path, props.rpc])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const result = await props.rpc.call('/manuscript', 'proposal.list', { cwd: props.cwd, path: props.path })
      if (cancelled) return
      if (!result.ok) return
      const items = (result.value as { proposals?: Proposal[] }).proposals ?? []
      setProposal(items[items.length - 1] ?? null)
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 1500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [props.cwd, props.path, props.rpc])

  const save = async () => {
    const result = await props.rpc.call('/manuscript', 'file.write', {
      cwd: props.cwd,
      path: props.path,
      text,
      version,
    })
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setVersion((result.value as { version: string }).version)
    setError('')
  }

  const requestFim = () => {
    if (composing.current || !props.path) return
    const el = ta.current
    if (!el) return
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    const caret = el.selectionStart
    const prefix = text.slice(0, caret)
    const suffix = text.slice(caret)
    setGhostAt(caret)
    void (async () => {
      const result = await props.rpc.call(
        '/manuscript',
        'fim.complete',
        { cwd: props.cwd, path: props.path, prefix, suffix },
        ac.signal,
      )
      if (ac.signal.aborted) return
      if (!result.ok) {
        setGhost('')
        return
      }
      setGhost((result.value as { text: string }).text ?? '')
      requestAnimationFrame(syncMirror)
    })()
  }

  const selectedText = () => {
    const el = ta.current
    if (!el) return ''
    return text.slice(el.selectionStart, el.selectionEnd)
  }

  const accept = () => {
    if (!ghost) return
    const caret = ghostAt
    const next = text.slice(0, caret) + ghost + text.slice(caret)
    setText(next)
    setGhost('')
    requestAnimationFrame(() => {
      const el = ta.current
      if (!el) return
      const at = caret + ghost.length
      el.focus()
      el.setSelectionRange(at, at)
    })
  }

  const surface: Record<string, string | number> = {
    position: 'absolute',
    inset: 0,
    padding: EDITOR_PAD,
    fontSize: EDITOR_SIZE,
    lineHeight: EDITOR_LINE,
    fontFamily: EDITOR_FONT,
    whiteSpace: 'pre-wrap',
    overflow: 'auto',
    border: 0,
    margin: 0,
  }

  return e('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
    e('div', {
      style: { padding: '4px 8px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
    },
      e('span', { 'data-testid': 'manuscript-path', style: { opacity: 0.7, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, props.path || '未打开文件'),
      e('span', { 'data-testid': 'manuscript-wordcount', style: { opacity: 0.55 } }, `${countChars(text)} 字`),
    ),
    e('div', { style: { padding: '0 8px 6px', display: 'flex', gap: 6, flexWrap: 'wrap' } },
      e('button', {
        type: 'button',
        'data-testid': 'manuscript-rewrite',
        disabled: !hasSelection,
        onClick: () => {
          const selection = selectedText()
          if (!selection) return
          void sendSelectionToChat(props.path, selection).then((how) => {
            if (how === 'composer') setNotice('已填入 Chat')
            else if (how === 'clipboard') setNotice('已复制，粘到 Chat')
            else setNotice('无法送到 Chat')
          })
        },
      }, '改这段'),
      e('button', {
        type: 'button',
        'data-testid': 'manuscript-fim',
        onClick: () => { requestFim() },
      }, '补全'),
    ),
    e('div', { style: { position: 'relative', flex: 1, minHeight: 0 } },
      ghost ? e('div', {
        ref: mirror,
        'aria-hidden': 'true',
        style: { ...surface, pointerEvents: 'none', color: 'inherit' },
      },
        text.slice(0, ghostAt),
        e('span', { 'data-testid': 'manuscript-ghost', style: { opacity: 0.45 } }, ghost),
        text.slice(ghostAt),
      ) : null,
      e('textarea', {
        ref: ta,
        'data-testid': 'manuscript-editor',
        'aria-label': '正文编辑器',
        value: text,
        disabled: !props.path,
        onChange: (ev: { target: { value: string } }) => {
          setText(ev.target.value)
          setGhost('')
          abort.current?.abort()
        },
        onScroll: syncMirror,
        onCompositionStart: () => { composing.current = true },
        onCompositionEnd: () => { composing.current = false },
        onKeyDown: (ev: { key: string; ctrlKey: boolean; metaKey: boolean; preventDefault: () => void }) => {
          if (ev.key === 'Tab' && ghost) {
            ev.preventDefault()
            accept()
            return
          }
          if (ev.key === 'Escape') {
            setGhost('')
            return
          }
          if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
            ev.preventDefault()
            void save()
          }
        },
        onSelect: () => {
          const el = ta.current
          setHasSelection(!!el && el.selectionStart !== el.selectionEnd)
        },
        onKeyUp: () => {
          const el = ta.current
          setHasSelection(!!el && el.selectionStart !== el.selectionEnd)
          window.clearTimeout((requestFim as unknown as { t?: number }).t)
          ;(requestFim as unknown as { t?: number }).t = window.setTimeout(requestFim, 700)
        },
        style: {
          ...surface,
          resize: 'none',
          background: 'transparent',
          color: ghost ? 'transparent' : 'inherit',
          caretColor: 'inherit',
          zIndex: 1,
        },
      }),
    ),
    ghost ? e('div', { style: { padding: '4px 8px', fontSize: 12, opacity: 0.55 } }, '补全 · Tab 采纳 · Esc 关掉') : null,
    proposal ? e(ProposalBar, {
      item: proposal,
      busy: proposalBusy,
      error: proposalError,
      onAccept: () => {
        if (proposalBusy) return
        setProposalBusy(true)
        setProposalError('')
        void (async () => {
          const result = await props.rpc.call('/manuscript', 'proposal.accept', {
            cwd: props.cwd,
            id: proposal.id,
            version: versionRef.current,
            text: textRef.current,
          })
          setProposalBusy(false)
          if (!result.ok) {
            setProposalError(result.error.message)
            return
          }
          const value = result.value as { text: string; version: string }
          setText(value.text)
          setVersion(value.version)
          setProposal(null)
          setGhost('')
          props.onTreeMutate?.()
        })()
      },
      onReject: () => {
        if (proposalBusy) return
        setProposalBusy(true)
        setProposalError('')
        void (async () => {
          const result = await props.rpc.call('/manuscript', 'proposal.reject', { cwd: props.cwd, id: proposal.id })
          setProposalBusy(false)
          if (!result.ok) {
            setProposalError(result.error.message)
            return
          }
          setProposal(null)
        })()
      },
    }) : null,
    notice ? e('div', { 'data-testid': 'manuscript-notice', style: { padding: '4px 8px', fontSize: 12, opacity: 0.7 } }, notice) : null,
    error ? e('div', { style: { padding: 8, color: '#8a3a30', fontSize: 12 } }, error) : null,
  )
}

function ManuscriptFrame(props: { ctx: ManuscriptClient }) {
  const rpc = props.ctx.connection.rpc
  const cwd = useCwd(props.ctx)
  const [path, setPath] = useState('')
  const [revision, setRevision] = useState(0)
  const [siblings, setSiblings] = useState<string[]>([])
  const mutate = () => setRevision((n) => n + 1)

  useEffect(() => {
    if (!cwd || !path) {
      setSiblings([])
      return
    }
    const dir = parentOf(path)
    void (async () => {
      const result = await rpc.call('/manuscript', 'tree.list', { cwd, path: dir })
      if (!result.ok) return
      const entries = (result.value as { entries: Entry[] }).entries || []
      setSiblings(
        entries
          .filter((entry) => entry.type === 'file' && !entry.name.startsWith('.'))
          .map((entry) => (dir === '.' ? entry.name : `${dir}/${entry.name}`)),
      )
    })()
  }, [cwd, path, rpc, revision])

  const siblingIndex = siblings.indexOf(path)
  const go = (delta: number) => {
    const next = siblings[siblingIndex + delta]
    if (next) setPath(next)
  }

  const createFile = () => {
    if (!cwd) return
    const raw = window.prompt('新文件名（不含路径）', '未命名')
    if (!raw) return
    const dir = path ? parentOf(path) : '.'
    const name = /\.md$/i.test(raw.trim()) ? raw.trim() : `${raw.trim()}.md`
    const target = dir === '.' ? name : `${dir}/${name}`
    const stem = name.replace(/\.md$/i, '')
    void (async () => {
      const result = await rpc.call('/manuscript', 'file.create', { cwd, path: target, text: `# ${stem}\n\n` })
      if (!result.ok) {
        window.alert(result.error.message)
        return
      }
      setPath(target)
      mutate()
    })()
  }

  const renameFile = () => {
    if (!cwd || !path) return
    const current = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path
    const raw = window.prompt('新文件名', current.replace(/\.md$/i, ''))
    if (!raw) return
    void (async () => {
      const result = await rpc.call('/manuscript', 'file.rename', { cwd, path, name: raw })
      if (!result.ok) {
        window.alert(result.error.message)
        return
      }
      const value = result.value as { path: string }
      setPath(value.path)
      mutate()
    })()
  }

  return e('div', {
    'data-testid': 'manuscript-overlay',
    style: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 360,
      pointerEvents: 'auto',
      display: 'grid',
      gridTemplateRows: 'auto 40% 1fr',
      background: 'var(--dsw-alias-bg-base, Canvas)',
      color: 'var(--dsw-alias-text-primary, CanvasText)',
      boxShadow: '4px 0 16px rgba(0,0,0,0.12)',
      borderRight: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08))',
    },
  },
    e('header', {
      style: { padding: '8px 8px 6px', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08))' },
    },
      e('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '稿纸'),
      e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        e('button', { type: 'button', 'data-testid': 'manuscript-new', disabled: !cwd, onClick: createFile }, '新建'),
        e('button', { type: 'button', 'data-testid': 'manuscript-rename', disabled: !path, onClick: renameFile }, '改名'),
        e('button', { type: 'button', 'data-testid': 'manuscript-prev', disabled: siblingIndex <= 0, onClick: () => go(-1) }, '上一篇'),
        e('button', { type: 'button', 'data-testid': 'manuscript-next', disabled: siblingIndex < 0 || siblingIndex >= siblings.length - 1, onClick: () => go(1) }, '下一篇'),
      ),
    ),
    e('aside', { style: { borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08))', minHeight: 0 } },
      cwd ? e(Tree, { cwd, rpc, onOpen: setPath, active: path, revision }) : e('div', { style: { padding: 12 } }, '没有工作区'),
    ),
    e('main', { style: { minHeight: 0 } }, cwd && path
      ? e(Editor, { cwd, path, rpc, onTreeMutate: mutate })
      : e('div', { style: { padding: 24 } }, '从上方打开文本文件')),
  )
}

export function apply(ctx: Context): void {
  const client = asClient(ctx)
  registerManuscriptUi(client.slots as SlotHandle, () => e(ManuscriptFrame, { ctx: client }))
}
