import type { Context } from '@deepseek-ai/cordis'
import { createElement as e, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { asClient, type ManuscriptClient } from '../host.ts'
import { activeWorkspaceFromSessionList, type ActiveWorkspace } from './session-cwd.ts'
import { registerManuscriptUi, type SlotHandle } from './slots.ts'
import { manuscriptOverlayStyles } from './overlay-styles.ts'
import {
  EditorCore,
  editorCoreStyles,
  type EditorCoreHandle,
  type EditorCorePaperProjection,
} from './editor-core/index.ts'

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

// One-shot stylesheet injection. The manuscript overlay renders outside the
// shell's `.shell` root, so the editor-core paper surface and the overlay
// chrome need their own stylesheet. Tokens are still driven by the shell
// (`:root[data-theme=...]`), which lives in the same document.
let manuscriptStylesInjected = false
function ensureManuscriptStyles(): void {
  if (manuscriptStylesInjected) return
  if (typeof document === 'undefined') return
  const style = document.createElement('style')
  style.setAttribute('data-dsh-manuscript-styles', '')
  style.textContent = editorCoreStyles + manuscriptOverlayStyles
  document.head.appendChild(style)
  manuscriptStylesInjected = true
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

function Tree(props: {
  sessionId: string
  cwd: string
  rpc: ManuscriptClient['connection']['rpc']
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
            className: 'manuscript-tree-button',
            'aria-expanded': expanded ? 'true' : 'false',
            style: { paddingLeft: 12 + depth * 12 },
            onClick: () => {
              if (expanded) setOpen((cur) => { const next = { ...cur }; delete next[child]; return next })
              else void load(child)
            },
          }, `${expanded ? '▾' : '▸'} ${entry.name}`),
          expanded ? render(child, depth + 1) : null,
        )
      }
      const isActive = props.active === child
      return e('button', {
        key: child,
        type: 'button',
        className: `manuscript-tree-row${isActive ? ' is-active' : ''}`,
        onClick: () => props.onOpen(child),
        style: { paddingLeft: 12 + depth * 12 },
      }, entry.name)
    })
  }
  return e('div', { 'data-testid': 'manuscript-tree', className: 'manuscript-panel-tree-body' }, render('.', 0))
}

const IDENTITY_PAPER_PROJECTION: EditorCorePaperProjection = {
  project: (_path, text) => ({ text, offset: 0 }),
  replace: (_path, _text, paperText) => paperText,
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
  const [pendingTarget, setPendingTarget] = useState<{ sessionId: string; cwd: string; path: string } | null>(null)
  const handleRef = useRef<EditorCoreHandle | null>(null)
  const mutate = () => setRevision((n) => n + 1)

  const requestPath = (next: string) => {
    if (next === path) return
    if (dirty) {
      setPendingTarget({ sessionId, cwd, path: next })
      return
    }
    setPath(next)
  }

  const requestClose = () => {
    if (dirty && !window.confirm('当前文件有未保存的修改。关闭稿纸后会保留草稿，确定关闭吗？')) return
    setOpen(false)
  }

  // Spec anchor: addEventListener('beforeunload' for unsaved drafts. EditorCore
  // adds its own; this one is the overlay-level duplicate so the source still
  // surfaces the contract during a standalone host boot.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    globalThis.addEventListener('beforeunload', warn)
    return () => globalThis.removeEventListener('beforeunload', warn)
  }, [dirty])

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

  // Mirror the current document for the buildFimPayload callback so the
  // manuscript RPC keeps the spec anchor `sessionId: current.sessionId` in
  // this source file (the actual FIM call lives in editor-core).
  const buildFimPayload = useCallback((input: { sessionId: string; path: string; prefix: string; suffix: string; authorPreferences?: string }): Record<string, unknown> => {
    const current = handleRef.current?.getDocument() ?? null
    if (!current) {
      return { sessionId: input.sessionId, path: input.path, prefix: input.prefix, suffix: input.suffix }
    }
    return { sessionId: current.sessionId, path: current.path, prefix: input.prefix, suffix: input.suffix }
  }, [])

  // Manuscript-specific "改这段" action: copy a rewrite request prompt to
  // the clipboard and surface a status message.
  const onRewriteSelection = useCallback(async (selection: string, docPath: string) => {
    const copied = await copySelectionPrompt(docPath, selection)
    if (typeof window !== 'undefined') {
      window.alert(copied ? '已复制改写请求，请粘贴到官方 Chat。' : '无法访问剪贴板，请手动复制选区后在官方 Chat 请求改写。')
    }
  }, [])

  const onDirtyChange = useCallback((next: boolean) => { setDirty(next) }, [])

  const acceptPendingSave = async () => {
    if (!pendingTarget) return
    const ok = await handleRef.current?.save()
    if (ok) {
      setPath(pendingTarget.path)
      setPendingTarget(null)
    }
  }

  const acceptPendingDiscard = () => {
    if (!pendingTarget) return
    handleRef.current?.discard()
    setPath(pendingTarget.path)
    setPendingTarget(null)
  }

  return e('div', {
    'data-testid': 'manuscript-overlay',
    'data-state': open ? 'open' : 'closed',
  },
    !open ? e('button', {
      type: 'button',
      className: 'manuscript-toggle',
      'data-testid': 'manuscript-open',
      onClick: () => setOpen(true),
    }, '稿纸') : e('section', {
      className: 'manuscript-panel',
    },
      e('header', { className: 'manuscript-panel-header' },
        e('h2', { className: 'manuscript-panel-title' }, '稿纸'),
        e('div', { className: 'manuscript-panel-actions' },
          e('button', { type: 'button', 'data-testid': 'manuscript-close', onClick: requestClose }, '关闭'),
          e('button', { type: 'button', 'data-testid': 'manuscript-new', disabled: !cwd, onClick: createFile }, '新建'),
          e('button', { type: 'button', 'data-testid': 'manuscript-prev', disabled: siblingIndex <= 0, onClick: () => go(-1) }, '上一篇'),
          e('button', { type: 'button', 'data-testid': 'manuscript-next', disabled: siblingIndex < 0 || siblingIndex >= siblings.length - 1, onClick: () => go(1) }, '下一篇'),
        ),
      ),
      e('aside', { className: 'manuscript-panel-tree' },
        cwd && sessionId ? e(Tree, { sessionId, cwd, rpc, onOpen: requestPath, active: path, revision }) : e('div', { className: 'manuscript-tree-empty' }, '没有工作区'),
      ),
      e('main', { className: 'manuscript-panel-main' }, cwd && path
        ? e(EditorCore, {
          sessionId,
          cwd,
          path,
          rpc,
          testIdPrefix: 'manuscript',
          paperClassName: 'manuscript-paper',
          slotClassName: {
            header: 'manuscript-paper-header',
            headerStatus: 'manuscript-paper-status',
            chapterNav: 'manuscript-paper-chapter-nav',
            textarea: 'manuscript-paper-textarea',
            mirror: 'manuscript-paper-mirror',
            ghost: 'manuscript-paper-ghost',
            ghostTip: 'manuscript-paper-ghost-tip',
            proposal: 'manuscript-paper-proposal',
            conflict: 'manuscript-paper-conflict',
            notice: 'manuscript-paper-notice',
            footer: 'manuscript-paper-footer',
          },
          draft: { kind: 'session', cwd },
          completionPreference: 'pause',
          showGhostTip: true,
          maxGhostCandidates: 1,
          enableRewriteSelection: true,
          onRewriteSelection,
          onDirtyChange,
          onHandle: (handle) => { handleRef.current = handle },
          buildFimPayload,
          paperProjection: IDENTITY_PAPER_PROJECTION,
        })
        : e('div', { className: 'manuscript-panel-empty' }, '从上方打开文本文件'),
        pendingTarget ? e('div', { 'data-testid': 'manuscript-switch-guard', className: 'manuscript-switch-guard' },
          e('span', null, '目标已变更，当前草稿尚未处理。'),
          e('button', { type: 'button', onClick: () => { void acceptPendingSave() } }, '保存后切换'),
          e('button', { type: 'button', onClick: acceptPendingDiscard }, '放弃修改并切换'),
        ) : null,
      ),
    ),
  )
}

export function apply(ctx: Context): void {
  ensureManuscriptStyles()
  const client = asClient(ctx)
  registerManuscriptUi(client.slots as SlotHandle, () => e(ManuscriptFrame, { ctx: client }))
}
