import type { Context } from '@deepseek-ai/cordis'
import { createElement as e, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { asClient, type ManuscriptClient, type RpcBag } from '../host.ts'
import {
  documentKey,
  draftStorageKey,
  hasUnsavedChanges,
  isStaleWriteError,
  parseStoredDraft,
  shouldApplyRead,
  shouldRetainDraftAfterSave,
  type DocumentTarget,
  type EditorStatus,
} from './editor-state.ts'
import { activeWorkspaceFromSessionList, type ActiveWorkspace } from './session-cwd.ts'
import { registerManuscriptUi, type SlotHandle } from './slots.ts'

export const name = 'dsh-manuscript-client'
export const inject = ['slots', 'sessions', 'connection'] as const

type Entry = { name: string; type: 'file' | 'directory' | 'other' }

function useWorkspace(ctx: ManuscriptClient): ActiveWorkspace | null {
  const [workspace, setWorkspace] = useState(() => activeWorkspaceFromSessionList(ctx.sessions.list?.getSnapshot?.()))
  useEffect(() => {
    const list = ctx.sessions.list
    const sync = () => setWorkspace(activeWorkspaceFromSessionList(list?.getSnapshot?.()))
    sync()
    return list?.subscribe?.(sync)
  }, [ctx])
  return workspace
}

function parentOf(rel: string): string {
  const index = rel.lastIndexOf('/')
  return index < 0 ? '.' : rel.slice(0, index)
}

function Tree(props: {
  sessionId: string
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
      const result = await props.rpc.call('/manuscript', 'tree.list', { sessionId: props.sessionId, path: rel })
      if (result.ok) {
        const value = result.value as { entries: Entry[] }
        setOpen((cur) => ({ ...cur, [rel]: value.entries }))
      }
    },
    [props.sessionId, props.cwd, props.rpc],
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

const EDITOR_FONT = 'system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif'
const EDITOR_PAD = 16
const EDITOR_SIZE = 16
const EDITOR_LINE = 1.7

function countChars(text: string): number {
  return text.replace(/\s/g, '').length
}

function rewritePrompt(path: string, selection: string): string {
  return `请改写这段。文件：${path}\n请在回复中给出修改稿，不要直接写入文件。\n\n${selection}`
}

async function copySelectionPrompt(path: string, selection: string): Promise<boolean> {
  try {
    const clipboard = globalThis.navigator?.clipboard
    if (!clipboard) return false
    await clipboard.writeText(rewritePrompt(path, selection))
    return true
  } catch {
    return false
  }
}

type LoadedDocument = DocumentTarget & { text: string; version: string }

function readDraft(target: DocumentTarget) {
  try {
    return parseStoredDraft(globalThis.sessionStorage?.getItem(draftStorageKey(target)) ?? null, target)
  } catch {
    return null
  }
}

function persistDraft(document: LoadedDocument, text: string) {
  try {
    globalThis.sessionStorage?.setItem(draftStorageKey(document), JSON.stringify({ ...document, text }))
  } catch {
    // Draft recovery is best effort; the editor buffer remains authoritative.
  }
}

function discardDraft(target: DocumentTarget) {
  try {
    globalThis.sessionStorage?.removeItem(draftStorageKey(target))
  } catch {
    // Storage can be disabled by the host browser.
  }
}

function Editor(props: {
  sessionId: string
  cwd: string
  path: string
  rpc: RpcBag
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [text, setText] = useState('')
  const [document, setDocument] = useState<LoadedDocument | null>(null)
  const [status, setStatus] = useState<EditorStatus>('loading')
  const [pendingTarget, setPendingTarget] = useState<DocumentTarget | null>(null)
  const [ghost, setGhost] = useState('')
  const [ghostAt, setGhostAt] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [hasSelection, setHasSelection] = useState(false)
  const ta = useRef<HTMLTextAreaElement | null>(null)
  const mirror = useRef<HTMLDivElement | null>(null)
  const abort = useRef<AbortController | null>(null)
  const composing = useRef(false)
  const textRef = useRef(text)
  const documentRef = useRef<LoadedDocument | null>(document)
  const readRequest = useRef(0)
  const editGeneration = useRef(0)
  textRef.current = text
  documentRef.current = document
  const target: DocumentTarget = { sessionId: props.sessionId, cwd: props.cwd, path: props.path }
  const targetRef = useRef(target)
  targetRef.current = target
  const dirty = !!document && hasUnsavedChanges(text, document.text)

  const updateText = (next: string) => {
    editGeneration.current += 1
    textRef.current = next
    setText(next)
    const current = documentRef.current
    if (current && hasUnsavedChanges(next, current.text)) {
      persistDraft(current, next)
      setStatus('dirty')
    } else if (current) {
      discardDraft(current)
      setStatus('saved')
    }
  }

  const updateDocument = (next: LoadedDocument | null) => {
    documentRef.current = next
    setDocument(next)
  }

  const syncMirror = () => {
    if (ta.current && mirror.current) {
      mirror.current.scrollTop = ta.current.scrollTop
      mirror.current.scrollLeft = ta.current.scrollLeft
    }
  }

  useEffect(() => {
    props.onDirtyChange?.(dirty)
  }, [dirty, props.onDirtyChange])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    globalThis.addEventListener('beforeunload', warn)
    return () => globalThis.removeEventListener('beforeunload', warn)
  }, [dirty])

  const loadDocument = useCallback(async (nextTarget: DocumentTarget) => {
    const requestId = ++readRequest.current
    setStatus('loading')
    setError('')
    const result = await props.rpc.call('/manuscript', 'file.read', { sessionId: nextTarget.sessionId, path: nextTarget.path })
    if (!shouldApplyRead(requestId, readRequest.current, nextTarget, targetRef.current)) return
    if (!result.ok) {
      setStatus('error')
      setError(result.error.message)
      return
    }
    const value = result.value as { text: string; version: string }
    const loaded = { ...nextTarget, text: value.text, version: value.version }
    const draft = readDraft(nextTarget)
    updateDocument(loaded)
    if (draft) {
      updateText(draft.text)
      setStatus(draft.version === value.version ? 'dirty' : 'conflict')
      setNotice(draft.version === value.version ? '已恢复未保存草稿。' : '已恢复未保存草稿；磁盘版本已变化，请确认后再保存。')
    } else {
      textRef.current = value.text
      setText(value.text)
      setStatus('saved')
    }
    setPendingTarget(null)
    setError('')
    setGhost('')
    setGhostAt(0)
  }, [props.rpc])

  useEffect(() => {
    const current = documentRef.current
    if (current && documentKey(current) === documentKey(target)) return
    if (current && hasUnsavedChanges(textRef.current, current.text)) {
      setPendingTarget(target)
      setStatus('conflict')
      setNotice('当前文件有未保存修改。请保存或明确放弃后再切换。')
      return
    }
    void loadDocument(target)
  }, [props.sessionId, props.cwd, props.path, loadDocument])

  const save = async () => {
    const current = documentRef.current
    if (!current) return
    const draft = textRef.current
    const submittedGeneration = editGeneration.current
    const result = await props.rpc.call('/manuscript', 'file.write', {
      sessionId: current.sessionId,
      path: current.path,
      text: draft,
      version: current.version,
    })
    if (!result.ok) {
      setError(result.error.message)
      setStatus(isStaleWriteError(result.error.message) ? 'conflict' : 'dirty')
      return
    }
    const saved = { ...current, text: draft, version: (result.value as { version: string }).version }
    updateDocument(saved)
    setError('')
    const retainDraft = shouldRetainDraftAfterSave(draft, textRef.current, submittedGeneration, editGeneration.current)
    if (retainDraft) {
      persistDraft(saved, textRef.current)
      setStatus('dirty')
    } else {
      discardDraft(saved)
      setStatus('saved')
    }
    const desired = targetRef.current
    if (documentKey(saved) !== documentKey(desired)) {
      if (retainDraft) setPendingTarget(desired)
      else void loadDocument(desired)
    }
  }

  const requestFim = () => {
    const current = documentRef.current
    if (composing.current || !current?.path) return
    const el = ta.current
    if (!el) return
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    const caret = el.selectionStart
    const currentText = textRef.current
    const prefix = currentText.slice(0, caret)
    const suffix = currentText.slice(caret)
    setGhostAt(caret)
    void (async () => {
      const result = await props.rpc.call(
        '/manuscript',
        'fim.complete',
        { sessionId: current.sessionId, path: current.path, prefix, suffix },
        ac.signal,
      )
      if (ac.signal.aborted || documentKey(documentRef.current ?? current) !== documentKey(current)) return
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
    return textRef.current.slice(el.selectionStart, el.selectionEnd)
  }

  const accept = () => {
    if (!ghost) return
    const caret = ghostAt
    const next = textRef.current.slice(0, caret) + ghost + textRef.current.slice(caret)
    updateText(next)
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
      e('span', { 'data-testid': 'manuscript-path', style: { opacity: 0.7, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, document?.path || props.path || '未打开文件'),
      e('span', { 'data-testid': 'manuscript-wordcount', style: { opacity: 0.55 } }, `${countChars(text)} 字`),
      e('span', { 'data-testid': 'manuscript-save-state', style: { opacity: 0.55 } }, status === 'saved' ? '已保存' : status === 'dirty' ? '未保存' : status === 'conflict' ? '需处理' : status === 'loading' ? '读取中' : '读取失败'),
    ),
    e('div', { style: { padding: '0 8px 6px', display: 'flex', gap: 6, flexWrap: 'wrap' } },
      e('button', {
        type: 'button',
        'data-testid': 'manuscript-rewrite',
        disabled: !hasSelection,
        onClick: () => {
          const selection = selectedText()
          if (!selection) return
          void copySelectionPrompt(document?.path || props.path, selection).then((copied) => {
            setNotice(copied ? '已复制改写请求，请粘贴到官方 Chat。' : '无法访问剪贴板，请手动复制选区后在官方 Chat 请求改写。')
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
          updateText(ev.target.value)
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
    pendingTarget ? e('div', { 'data-testid': 'manuscript-switch-guard', style: { padding: '6px 8px', borderTop: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08))', fontSize: 12 } },
      e('span', null, '目标已变更，当前草稿尚未处理。'),
      e('button', { type: 'button', style: { marginLeft: 8 }, onClick: () => { void save() } }, '保存后切换'),
      e('button', { type: 'button', style: { marginLeft: 6 }, onClick: () => {
        const current = documentRef.current
        if (current) discardDraft(current)
        textRef.current = current?.text || ''
        setText(current?.text || '')
        setPendingTarget(null)
        void loadDocument(pendingTarget)
      } }, '放弃修改并切换'),
    ) : null,
    status === 'conflict' && !pendingTarget ? e('div', { 'data-testid': 'manuscript-conflict-guard', style: { padding: '6px 8px', borderTop: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08))', fontSize: 12 } },
      e('span', null, '当前草稿与磁盘版本不一致，已保留本地内容。'),
      e('button', { type: 'button', style: { marginLeft: 8 }, onClick: () => {
        const current = documentRef.current
        if (current) discardDraft(current)
        void loadDocument(targetRef.current)
      } }, '放弃草稿并重新读取'),
    ) : null,
    notice ? e('div', { 'data-testid': 'manuscript-notice', style: { padding: '4px 8px', fontSize: 12, opacity: 0.7 } }, notice) : null,
    error ? e('div', { style: { padding: 8, color: '#8a3a30', fontSize: 12 } }, error) : null,
  )
}

function ManuscriptFrame(props: { ctx: ManuscriptClient }) {
  const rpc = props.ctx.connection.rpc
  const workspace = useWorkspace(props.ctx)
  const cwd = workspace?.cwd ?? ''
  const sessionId = workspace?.sessionId ?? ''
  const [path, setPath] = useState('')
  const [revision, setRevision] = useState(0)
  const [siblings, setSiblings] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [open, setOpen] = useState(false)
  const mutate = () => setRevision((n) => n + 1)
  const requestPath = (next: string) => { if (next !== path) setPath(next) }
  const requestClose = () => {
    if (dirty && !window.confirm('当前文件有未保存的修改。关闭稿纸后会保留草稿，确定关闭吗？')) return
    setOpen(false)
  }

  useEffect(() => {
    if (!cwd || !path) {
      setSiblings([])
      return
    }
    const dir = parentOf(path)
    void (async () => {
      const result = await rpc.call('/manuscript', 'tree.list', { sessionId, path: dir })
      if (!result.ok) return
      const entries = (result.value as { entries: Entry[] }).entries || []
      setSiblings(
        entries
          .filter((entry) => entry.type === 'file' && !entry.name.startsWith('.'))
          .map((entry) => (dir === '.' ? entry.name : `${dir}/${entry.name}`)),
      )
    })()
  }, [sessionId, cwd, path, rpc, revision])

  const siblingIndex = siblings.indexOf(path)
  const go = (delta: number) => {
    const next = siblings[siblingIndex + delta]
    if (next) requestPath(next)
  }

  const createFile = () => {
    if (!cwd || !sessionId) return
    const raw = window.prompt('新文件名（不含路径）', '未命名')
    if (!raw) return
    const dir = path ? parentOf(path) : '.'
    const name = /\.md$/i.test(raw.trim()) ? raw.trim() : `${raw.trim()}.md`
    const target = dir === '.' ? name : `${dir}/${name}`
    const stem = name.replace(/\.md$/i, '')
    void (async () => {
      const result = await rpc.call('/manuscript', 'file.create', { sessionId, path: target, text: `# ${stem}\n\n` })
      if (!result.ok) {
        window.alert(result.error.message)
        return
      }
      requestPath(target)
      mutate()
    })()
  }

  return e('div', {
    'data-testid': 'manuscript-overlay',
    'data-state': open ? 'open' : 'closed',
    style: {
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
    },
  },
    !open ? e('button', {
      type: 'button',
      'data-testid': 'manuscript-open',
      onClick: () => setOpen(true),
      style: { position: 'absolute', left: 8, top: 8, pointerEvents: 'auto' },
    }, '稿纸') : e('section', {
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
    }, e('header', {
      style: { padding: '8px 8px 6px', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08))' },
    },
      e('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '稿纸'),
      e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        e('button', { type: 'button', 'data-testid': 'manuscript-close', onClick: requestClose }, '关闭'),
        e('button', { type: 'button', 'data-testid': 'manuscript-new', disabled: !cwd, onClick: createFile }, '新建'),
        e('button', { type: 'button', 'data-testid': 'manuscript-prev', disabled: siblingIndex <= 0, onClick: () => go(-1) }, '上一篇'),
        e('button', { type: 'button', 'data-testid': 'manuscript-next', disabled: siblingIndex < 0 || siblingIndex >= siblings.length - 1, onClick: () => go(1) }, '下一篇'),
      ),
    ),
    e('aside', { style: { borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08))', minHeight: 0 } },
      cwd && sessionId ? e(Tree, { sessionId, cwd, rpc, onOpen: requestPath, active: path, revision }) : e('div', { style: { padding: 12 } }, '没有工作区'),
    ),
    e('main', { style: { minHeight: 0 } }, cwd && path
      ? e(Editor, { sessionId, cwd, path, rpc, onDirtyChange: setDirty })
      : e('div', { style: { padding: 24 } }, '从上方打开文本文件')),
    ),
  )
}

export function apply(ctx: Context): void {
  const client = asClient(ctx)
  registerManuscriptUi(client.slots as SlotHandle, () => e(ManuscriptFrame, { ctx: client }))
}
