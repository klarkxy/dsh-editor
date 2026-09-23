import type { Context } from '@deepseek-ai/cordis'
import { Button } from '@radix-ui/themes'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { asClient, type ManuscriptClient } from '../host.ts'
import { activeWorkspaceFromSessionList, type ActiveWorkspace } from './session-cwd.ts'
import { registerManuscriptUi, type SlotHandle } from './slots.ts'
import { manuscriptOverlayStyles } from './overlay-styles.ts'
import { ManuscriptTheme, ensureManuscriptThemes } from './themes.tsx'
import {
  EditorCore,
  editorCoreStyles,
  type EditorCoreHandle,
  type EditorCorePaperProjection,
} from './editor-core/index.ts'

export const name = 'dsh-manuscript-client'
export const inject = ['slots', 'sessions', 'uiWorkspace', 'uiSession', 'connection'] as const

type Entry = { name: string; type: 'file' | 'directory' | 'other' }

function useWorkspace(ctx: ManuscriptClient): ActiveWorkspace | null {
  const selectedSessionId = () => ctx.uiWorkspace.current
    ? ctx.uiWorkspace.current.getSnapshot()?.sessionId ?? ''
    : ctx.uiSession.adapter.current.getSnapshot().key ?? ''
  const [workspace, setWorkspace] = useState(() => activeWorkspaceFromSessionList(ctx.sessions.list?.getSnapshot?.(), selectedSessionId()))
  useEffect(() => {
    const list = ctx.sessions.list
    const sync = () => setWorkspace(activeWorkspaceFromSessionList(list?.getSnapshot?.(), selectedSessionId()))
    sync()
    const offList = list?.subscribe?.(sync)
    const offSelection = (ctx.uiWorkspace.current ?? ctx.uiSession.adapter.current).subscribe(sync)
    return () => { offList?.(); offSelection() }
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
// (`:root[data-theme=light|dark]`), which lives in the same document.
let manuscriptStylesInjected = false
function ensureManuscriptStyles(): void {
  ensureManuscriptThemes()
  if (manuscriptStylesInjected) return
  if (typeof document === 'undefined') return
  const style = document.createElement('style')
  style.setAttribute('data-plugin', 'dsh-manuscript')
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
        return (
          <div key={child}>
            <Button
              type="button"
              variant="ghost"
              color="gray"
              className="manuscript-tree-button"
              aria-expanded={expanded ? 'true' : 'false'}
              style={{ paddingLeft: 12 + depth * 12 }}
              onClick={() => {
                if (expanded) setOpen((cur) => { const next = { ...cur }; delete next[child]; return next })
                else void load(child)
              }}>
              <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
              {` ${entry.name}`}
            </Button>
            {expanded ? render(child, depth + 1) : null}
          </div>
        );
      }
      const isActive = props.active === child
      return (
        <Button
          key={child}
          type="button"
          variant="ghost"
          color="gray"
          className={`manuscript-tree-row${isActive ? ' is-active' : ''}`}
          aria-current={isActive ? 'page' : undefined}
          onClick={() => props.onOpen(child)}
          style={{ paddingLeft: 12 + depth * 12 }}>
          {entry.name}
        </Button>
      );
    });
  }
  return (
    <div data-testid="manuscript-tree" className="manuscript-panel-tree-body">
      {render('.', 0)}
    </div>
  );
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
  /* 可选补全能力：查询成功前补全保持关闭；不可用/格式不符是显式错误态
     (带重试),绝不静默当成"已关闭"。卸载/重置/重试都会取消在途请求。 */
  type CapabilityState = { kind: 'loading' } | { kind: 'ready'; completion: boolean } | { kind: 'error' }
  const [capability, setCapability] = useState<CapabilityState>({ kind: 'loading' })
  const capabilityGeneration = useRef(0)
  const capabilityInFlight = useRef<AbortController | null>(null)
  const loadCapability = useCallback(async () => {
    const ticket = ++capabilityGeneration.current
    capabilityInFlight.current?.abort()
    const controller = new AbortController()
    capabilityInFlight.current = controller
    setCapability({ kind: 'loading' })
    const result = await rpc.call('/manuscript', 'capabilities.get', {}, controller.signal).catch(() => null)
    if (capabilityInFlight.current === controller) capabilityInFlight.current = null
    if (ticket !== capabilityGeneration.current) return
    const value = result && result.ok ? result.value as { completion?: unknown } : undefined
    if (!value || typeof value.completion !== 'boolean') {
      setCapability({ kind: 'error' })
      return
    }
    setCapability({ kind: 'ready', completion: value.completion })
  }, [rpc])
  useEffect(() => {
    void loadCapability()
    return () => {
      capabilityGeneration.current += 1
      capabilityInFlight.current?.abort()
      capabilityInFlight.current = null
    }
  }, [loadCapability])
  /* 连接代际重建后能力可能变化；事件 API 可用时重新查询。 */
  useEffect(() => {
    const events = props.ctx as Context & { on?: (event: string, listener: () => void) => unknown }
    if (typeof events.on !== 'function') return
    const dispose = events.on('connection/reset', () => { void loadCapability() })
    return typeof dispose === 'function' ? () => { (dispose as () => void)() } : undefined
  }, [props.ctx, loadCapability])
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

  const [confirmClose, setConfirmClose] = useState(false)
  const confirmCloseTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const resetConfirmClose = useCallback(() => {
    if (confirmCloseTimer.current != null) { globalThis.clearTimeout(confirmCloseTimer.current); confirmCloseTimer.current = null }
    setConfirmClose(false)
  }, [])
  useEffect(() => () => { if (confirmCloseTimer.current != null) globalThis.clearTimeout(confirmCloseTimer.current) }, [])

  const requestClose = () => {
    if (!dirty || confirmClose) { resetConfirmClose(); setOpen(false); return }
    setConfirmClose(true)
    confirmCloseTimer.current = globalThis.setTimeout(() => { confirmCloseTimer.current = null; setConfirmClose(false) }, 4_000)
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

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState('')

  const createFile = () => {
    if (!cwd || !sessionId) return
    setCreateError('')
    setNewName('未命名')
    setCreating(true)
  }

  const submitCreate = () => {
    const raw = newName.trim()
    if (!raw) { setCreating(false); return }
    const dir = path ? parentOf(path) : '.'
    const name = /\.md$/i.test(raw) ? raw : `${raw}.md`
    const target = dir === '.' ? name : `${dir}/${name}`
    const stem = name.replace(/\.md$/i, '')
    void (async () => {
      const result = await rpc.call('/manuscript', 'file.create', { sessionId, path: target, text: `# ${stem}\n\n` })
      if (!result.ok) {
        setCreateError(result.error.message)
        return
      }
      setCreating(false)
      setCreateError('')
      requestPath(target)
      mutate()
    })()
  }

  const cancelCreate = () => { setCreating(false); setCreateError('') }

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
  const [rewriteNotice, setRewriteNotice] = useState('')
  const onRewriteSelection = useCallback(async (selection: string, docPath: string) => {
    const copied = await copySelectionPrompt(docPath, selection)
    setRewriteNotice(copied ? '已复制改写请求，请粘贴到官方 Chat。' : '无法访问剪贴板，请手动复制选区到官方 Chat 请求改写。')
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

  return (
    <ManuscriptTheme>
    <div data-testid="manuscript-overlay" data-state={open ? 'open' : 'closed'}>
      {!open ? <Button
        type="button"
        variant="soft"
        color="gray"
        className="manuscript-toggle"
        data-testid="manuscript-open"
        onClick={() => setOpen(true)}>
        稿纸
      </Button> : <section className="manuscript-panel">
        <header className="manuscript-panel-header">
          <h2 className="manuscript-panel-title">
            稿纸
          </h2>
          <div className="manuscript-panel-actions">
            {confirmClose ? <>
              <Button type="button" variant="soft" color="red" data-testid="manuscript-close" onClick={requestClose}>
                确认关闭？
              </Button>
              <Button type="button" variant="ghost" color="gray" onClick={resetConfirmClose}>
                取消
              </Button>
            </> : <Button type="button" variant="ghost" color="gray" data-testid="manuscript-close" onClick={requestClose}>
              关闭
            </Button>}
            <Button
              type="button"
              variant="solid"
              data-testid="manuscript-new"
              disabled={!cwd}
              onClick={createFile}>
              新建
            </Button>
            <Button
              type="button"
              variant="ghost"
              color="gray"
              data-testid="manuscript-prev"
              disabled={siblingIndex <= 0}
              onClick={() => go(-1)}>
              上一篇
            </Button>
            <Button
              type="button"
              variant="ghost"
              color="gray"
              data-testid="manuscript-next"
              disabled={siblingIndex < 0 || siblingIndex >= siblings.length - 1}
              onClick={() => go(1)}>
              下一篇
            </Button>
          </div>
        </header>
        <aside className="manuscript-panel-tree">
          {creating ? <div
            data-testid="manuscript-create-row"
            style={{ padding: '4px 8px', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              aria-label="新文件名（不含路径）"
              value={newName}
              autoFocus
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitCreate()
                if (event.key === 'Escape') cancelCreate()
              }}
              style={{ flex: 1, minWidth: 0, fontSize: 'var(--font-size-1)', padding: '2px 6px', border: '1px solid var(--gray-6)', borderRadius: 4, background: 'var(--gray-2)', color: 'var(--gray-12)' }} />
            <Button type="button" variant="solid" size="1" onClick={submitCreate}>
              创建
            </Button>
            <Button type="button" variant="soft" color="gray" size="1" onClick={cancelCreate}>
              取消
            </Button>
          </div> : null}
          {createError ? <div
            data-testid="manuscript-create-error"
            role="alert"
            style={{ padding: '4px 12px', fontSize: 'var(--font-size-1)', color: 'var(--red-11)' }}>
            {createError}
          </div> : null}
          {cwd && sessionId ? <Tree
            sessionId={sessionId}
            cwd={cwd}
            rpc={rpc}
            onOpen={requestPath}
            active={path}
            revision={revision} /> : <div className="manuscript-tree-empty">
            没有工作区
          </div>}
        </aside>
        <main className="manuscript-panel-main">
          {cwd && path
            ? <EditorCore
            sessionId={sessionId}
            cwd={cwd}
            path={path}
            rpc={rpc}
            testIdPrefix="manuscript"
            paperClassName="manuscript-paper"
            slotClassName={{
              header: 'manuscript-paper-header',
              textarea: 'manuscript-paper-textarea',
              mirror: 'manuscript-paper-mirror',
              ghost: 'manuscript-paper-ghost',
              ghostTip: 'manuscript-paper-ghost-tip',
              proposal: 'manuscript-paper-proposal',
              conflict: 'manuscript-paper-conflict',
              notice: 'manuscript-paper-notice',
              footer: 'manuscript-paper-footer',
            }}
            draft={{ kind: 'session', cwd }}
            completionPreference="pause"
            completionEnabled={capability.kind === 'ready' && capability.completion}
            showGhostTip={true}
            maxGhostCandidates={1}
            enableRewriteSelection={true}
            onRewriteSelection={onRewriteSelection}
            onDirtyChange={onDirtyChange}
            onHandle={(handle) => { handleRef.current = handle }}
            buildFimPayload={buildFimPayload}
            paperProjection={IDENTITY_PAPER_PROJECTION} />
            : <div className="manuscript-panel-empty">
            从上方打开文本文件
          </div>}
          {rewriteNotice ? <div
            data-testid="manuscript-rewrite-notice"
            role="status"
            style={{ padding: '6px 8px', fontSize: 'var(--font-size-1)' }}>
            {rewriteNotice}
          </div> : null}
          {capability.kind === 'error' ? <div
            data-testid="manuscript-capability-error"
            role="alert"
            style={{ padding: '6px 8px', fontSize: 'var(--font-size-1)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>
              AI 补全能力不可用，补全与选段改写已暂停。
            </span>
            <Button type="button" variant="soft" color="gray" onClick={() => { void loadCapability() }}>
              重试
            </Button>
          </div> : null}
          {pendingTarget ? <div data-testid="manuscript-switch-guard" className="manuscript-switch-guard">
            <span>
              目标已变更，当前草稿尚未处理。
            </span>
            <Button type="button" variant="solid" onClick={() => { void acceptPendingSave() }}>
              保存后切换
            </Button>
            <Button type="button" variant="soft" color="red" onClick={acceptPendingDiscard}>
              放弃修改并切换
            </Button>
          </div> : null}
        </main>
      </section>}
    </div>
    </ManuscriptTheme>
  );
}

export function apply(ctx: Context): void {
  ensureManuscriptStyles()
  const client = asClient(ctx)
  registerManuscriptUi(client.slots as SlotHandle, () => <ManuscriptFrame ctx={client} />)
}
