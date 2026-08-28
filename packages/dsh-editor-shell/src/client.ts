import type { Context } from '@deepseek-ai/cordis'
import type {
  ClientContext,
  ConversationSnapshot,
  PendingInteraction,
  SessionFace,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConnectionHandle,
  RpcError,
  SessionId,
  SessionModels,
  WorkspaceId,
} from '@deepseek-ai/dsh-client-connection/client'
import {
  createElement as e,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  answerApproval,
  answerQuestions,
  chatRows,
  loadOlder,
  partialText,
  readModels,
  selectModel,
  sendProjectContext,
  stop,
  visibleRunningCalls,
  type QuestionAnswerItem,
} from './adapter.ts'
import type { ProjectContextReceipt } from './project-context.ts'
import type { EditorDraft } from './drafts.ts'
import { DraftSyncQueue } from './drafts.ts'
import {
  applyGhost,
  applySelectionPatch,
  canApplyGhost,
  isDirty,
  isSelectionCurrent,
  saveState,
  selectionTicket,
  type EditorDocument,
  type SelectionTicket,
} from './editor-state.ts'
import { registerRoot } from './root-registration.ts'
import { ModelSetup } from './model-setup.ts'
import { buildNovelIndexPrompt } from './novel-index.ts'
import { buildExport, type ChapterExport, type ExportFormat } from './export.ts'
import { documentTemplate, nextChapterPath, nextDocumentPath, type DocumentKind } from './project-files.ts'
import type { ProposalMarker } from './proposal-tool.ts'
import { idleImportFlow, importReview, recoverImport, importSummary, type ImportFlow, type ImportProbeView } from './import-flow.ts'

export const name = 'dsh-editor-shell-client'
export const inject = ['slots', 'sessions', 'workspaces', 'connection'] as const

type Entry = { name: string; type: 'file' | 'directory' | 'other' }
type RpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: RpcError | { code?: string; message?: string } }
type ShellContext = ClientContext & { connection: ConnectionHandle }

export async function safeRpcCall<T>(request: () => Promise<unknown>): Promise<RpcResult<T>> {
  try {
    return await request() as RpcResult<T>
  } catch (error) {
    return {
      ok: false,
      error: { code: 'internal', message: error instanceof Error ? error.message : 'request failed' },
    }
  }
}

function useObservable<T>(source: { getSnapshot(): T; subscribe(listener: () => void): () => void }): T {
  return useSyncExternalStore(source.subscribe.bind(source), source.getSnapshot.bind(source), source.getSnapshot.bind(source))
}

function currentSession(ctx: ShellContext): SessionFace | undefined {
  const id = ctx.sessions.list.getSnapshot().current
  return id ? ctx.sessions.binding(id)?.session : undefined
}

function rpcFailureText(result: RpcResult): string {
  if (result.ok) return ''
  return `${result.error.code ?? ''} ${result.error.message ?? ''}`
}

export function errorMessage(result: RpcResult): string {
  if (result.ok) return ''
  const blob = rpcFailureText(result)
  if (/stale|changed|version|版本/i.test(blob)) return '磁盘文件已经变化。'
  if (/directory-unreadable|unreadable/i.test(blob)) return '没有读取到作品目录，请重试。'
  if (/not-found|missing/i.test(blob)) return '没有找到所需的文件。'
  if (/read-only|permission|denied/i.test(blob)) return '当前文件无法写入，请检查目录权限。'
  return '操作没有完成，请重试。'
}

export function isStaleFailure(result: RpcResult): boolean {
  return !result.ok && /stale|changed|version|版本/i.test(`${rpcFailureText(result)} ${errorMessage(result)}`)
}

function Tree(props: {
  ctx: ShellContext
  sessionId: string
  active: string
  revision: number
  onOpen(path: string): void
  onOrder(paths: string[]): void
}) {
  const { ctx, sessionId, active, revision, onOpen, onOrder } = props
  const [open, setOpen] = useState<Record<string, Entry[]>>({})
  const [note, setNote] = useState('')

  const load = async (path: string) => {
    const result = await safeRpcCall<{ entries?: Entry[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', {
      sessionId,
      path: path || '.',
    }))
    if (!result.ok) { setNote(errorMessage(result)); return }
    setOpen((old) => ({ ...old, [path]: result.value.entries ?? [] }))
    setNote('')
  }

  useEffect(() => {
    setOpen({})
    void load('')
  }, [sessionId, revision])
  useEffect(() => {
    const files: string[] = []
    const collect = (path: string) => {
      for (const item of open[path] ?? []) {
        const child = path ? `${path}/${item.name}` : item.name
        if (item.type === 'directory') { if (child in open) collect(child) }
        else if (item.type === 'file') files.push(child)
      }
    }
    collect('')
    onOrder(files)
  }, [open])

  const rows = (path: string, level: number): ReactNode[] => (open[path] ?? [])
    .filter((item) => !item.name.startsWith('.'))
    .map((item) => {
      const child = path ? `${path}/${item.name}` : item.name
      if (item.type === 'directory') {
        return e('div', { key: child },
          e('button', {
            className: 'tree-row', type: 'button', style: { paddingLeft: 14 + level * 14 },
            'aria-expanded': child in open,
            onClick: () => child in open
              ? setOpen((old) => { const next = { ...old }; delete next[child]; return next })
              : void load(child),
          }, `${child in open ? '⌄' : '›'} ${item.name}`),
          child in open ? rows(child, level + 1) : null,
        )
      }
      return e('button', {
        key: child,
        className: 'tree-row',
        type: 'button',
        'aria-current': active === child ? 'page' : undefined,
        style: { paddingLeft: 28 + level * 14 },
        onClick: () => onOpen(child),
      }, item.name)
    })

  return e('nav', { className: 'tree', 'aria-label': '稿件目录' }, rows('', 0), note ? e('p', { className: 'warning pad' }, note) : null)
}

function Editor(props: {
  ctx: ShellContext
  session: SessionFace
  path: string
  files: string[]
  onOpen(path: string): void
  create(): void
  externalRevision: number
}) {
  const { ctx, session, path, files, onOpen, create, externalRevision } = props
  const [doc, setDoc] = useState<EditorDocument | null>(null)
  const [text, setTextState] = useState('')
  const [ghost, setGhost] = useState('')
  const [ghostAt, setGhostAt] = useState(0)
  const [loadingFim, setLoadingFim] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [note, setNote] = useState('')
  const [revision, setRevision] = useState(0)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [proposal, setProposal] = useState<{ ticket: SelectionTicket; text: string } | null>(null)
  const [patching, setPatching] = useState(false)
  const ta = useRef<HTMLTextAreaElement | null>(null)
  const patchAbort = useRef<AbortController | null>(null)
  const draftQueue = useRef<DraftSyncQueue | null>(null)
  const saving = useRef(false)
  if (!draftQueue.current) {
    draftQueue.current = new DraftSyncQueue((endpoint, payload) => ctx.connection.rpc.call('/manuscript', endpoint, payload))
  }
  const docRef = useRef<EditorDocument | null>(null)
  const textRef = useRef('')
  const revisionRef = useRef(0)
  docRef.current = doc
  textRef.current = text
  revisionRef.current = revision
  const state = saveState(doc, text, conflict)

  const setText = (value: string) => {
    setTextState(value)
    setRevision((old) => old + 1)
    setGhost('')
    setProposal(null)
  }

  useEffect(() => {
    patchAbort.current?.abort()
    setProposal(null)
    setGhost('')
    setConflict(false)
    if (!path) { setDoc(null); setTextState(''); setNote(''); return }
    let live = true
    void Promise.all([
      safeRpcCall<{ text: string; version: string }>(() => ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId: session.sessionId, path })),
      safeRpcCall<{ draft: EditorDraft | null }>(() => ctx.connection.rpc.call('/manuscript', 'draft.get', { sessionId: session.sessionId, path })),
    ]).then(([result, draftResult]) => {
      if (!live) return
      if (!result.ok) { setDoc(null); setNote(errorMessage(result)); return }
      const disk: EditorDocument = {
        sessionId: session.sessionId,
        path,
        text: result.value.text,
        version: result.value.version,
      }
      const draft = draftResult.ok ? draftResult.value.draft : null
      setDoc(disk)
      setRevision((old) => old + 1)
      if (draft) {
        setTextState(draft.text)
        const stale = draft.baseVersion !== disk.version
        setConflict(stale)
        setNote(stale ? '磁盘版本已变化；本地草稿已保留，请另存或手动合并。' : '已恢复未保存草稿')
      } else {
        setTextState(disk.text)
        setNote('')
      }
    })
    return () => { live = false; patchAbort.current?.abort() }
  }, [path, session.sessionId, externalRevision])

  useEffect(() => {
    if (!doc) return
    const timer = globalThis.setTimeout(() => {
      const endpoint = text === doc.text ? 'draft.delete' : 'draft.put'
      const payload = endpoint === 'draft.delete'
        ? { sessionId: doc.sessionId, path: doc.path }
        : { sessionId: doc.sessionId, path: doc.path, text, baseText: doc.text, baseVersion: doc.version }
      void draftQueue.current!.run(endpoint, payload).then((raw: unknown) => {
        const result = raw as RpcResult
        if (!result.ok) setNote(`草稿同步失败：${errorMessage(result)}`)
      })
    }, 250)
    return () => globalThis.clearTimeout(timer)
  }, [ctx.connection.rpc, doc, text])

  const save = async () => {
    if (!doc || saving.current) return
    const savingDoc = doc
    const savingText = text
    saving.current = true
    setNote('正在保存…')
    const result = await safeRpcCall<{ version?: string }>(() => ctx.connection.rpc.call('/manuscript', 'file.write', {
      sessionId: savingDoc.sessionId,
      path: savingDoc.path,
      text: savingText,
      version: savingDoc.version,
    }))
    if (!result.ok) {
      const stale = isStaleFailure(result)
      setConflict(stale)
      setNote(stale ? '磁盘文件已变化；本地草稿未丢失。' : errorMessage(result))
      saving.current = false
      return
    }
    const saved = { ...savingDoc, text: savingText, version: result.value.version ?? savingDoc.version }
    setDoc(saved)
    const deleted = await draftQueue.current!.run('draft.delete', { sessionId: savingDoc.sessionId, path: savingDoc.path }) as RpcResult
    if (!deleted.ok) {
      setNote(`文件已保存，但草稿清理失败：${errorMessage(deleted)}`)
      saving.current = false
      return
    }
    setConflict(false)
    setNote('已保存')
    saving.current = false
  }

  useEffect(() => {
    if (!doc || text === doc.text || conflict) return
    const timer = globalThis.setTimeout(() => void save(), 800)
    return () => globalThis.clearTimeout(timer)
  }, [doc, text, conflict])

  useEffect(() => {
    if (!doc || text === doc.text) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    globalThis.addEventListener('beforeunload', warn)
    return () => globalThis.removeEventListener('beforeunload', warn)
  }, [doc, text])

  const reloadDisk = async () => {
    if (!doc || !globalThis.confirm?.('放弃本地草稿并重新载入磁盘版本？')) return
    const result = await ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId: doc.sessionId, path: doc.path }) as RpcResult<{ text: string; version: string }>
    if (!result.ok) { setNote(errorMessage(result)); return }
    const next = { ...doc, text: result.value.text, version: result.value.version }
    setDoc(next); setTextState(next.text); setConflict(false); setNote('已重新载入磁盘版本')
    await draftQueue.current!.run('draft.delete', { sessionId: doc.sessionId, path: doc.path })
  }

  const saveConflictCopy = async () => {
    if (!doc) return
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
    const copy = doc.path.replace(/\.md$/i, `.冲突-${stamp}.md`)
    const created = await ctx.connection.rpc.call('/manuscript', 'file.create', {
      sessionId: doc.sessionId, path: copy, text,
    }) as RpcResult
    if (!created.ok) { setNote(errorMessage(created)); return }
    setNote(`草稿已另存为 ${copy}`)
    const disk = await ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId: doc.sessionId, path: doc.path }) as RpcResult<{ text: string; version: string }>
    if (!disk.ok) return
    setDoc({ ...doc, ...disk.value }); setTextState(disk.value.text); setConflict(false)
    await draftQueue.current!.run('draft.delete', { sessionId: doc.sessionId, path: doc.path })
  }

  const complete = async () => {
    if (!doc || !ta.current) return
    const requestDoc = doc
    const requestRevision = revision
    const pos = ta.current.selectionStart
    const controller = new AbortController()
    setLoadingFim(true)
    const result = await ctx.connection.rpc.call('/manuscript', 'fim.complete', {
      sessionId: doc.sessionId,
      path: doc.path,
      prefix: text.slice(0, pos),
      suffix: text.slice(pos),
    }, controller.signal) as RpcResult<{ text?: string }>
    setLoadingFim(false)
    if (docRef.current?.sessionId !== requestDoc.sessionId || docRef.current.path !== requestDoc.path || revisionRef.current !== requestRevision) return
    if (!result.ok) { setNote(errorMessage(result)); return }
    setGhost(String(result.value.text ?? ''))
    setGhostAt(pos)
  }

  const requestPatch = async () => {
    if (!doc) return
    const ticket = selectionTicket(doc, text, revision, selection.start, selection.end)
    if (!ticket) { setNote('请先选择需要改写的文字。'); return }
    patchAbort.current?.abort()
    const controller = new AbortController()
    patchAbort.current = controller
    setPatching(true)
    const result = await ctx.connection.rpc.call('/manuscript', 'patch.complete', {
      sessionId: ticket.sessionId,
      path: ticket.path,
      selectedText: ticket.selectedText,
      before: text.slice(Math.max(0, ticket.start - 4000), ticket.start),
      after: text.slice(ticket.end, ticket.end + 4000),
    }, controller.signal) as RpcResult<{ text?: string }>
    setPatching(false)
    if (controller.signal.aborted || !isSelectionCurrent(ticket, docRef.current, textRef.current, revisionRef.current)) return
    if (!result.ok) { setNote(errorMessage(result)); return }
    const replacement = String(result.value.text ?? '').trim()
    if (!replacement) { setNote('模型没有返回可用改写。'); return }
    setProposal({ ticket, text: replacement })
  }

  const acceptGhost = () => {
    if (!canApplyGhost(state, ghost)) return
    setText(applyGhost(text, ghostAt, ghost))
    setGhost('')
    ta.current?.focus()
  }

  const acceptPatch = () => {
    if (!proposal || !isSelectionCurrent(proposal.ticket, doc, text, revision)) {
      setProposal(null)
      setNote('选区已经变化，已丢弃过期建议。')
      return
    }
    setText(applySelectionPatch(text, proposal.ticket, proposal.text))
    setProposal(null)
    ta.current?.focus()
  }

  if (!path) {
    return e('section', { className: 'empty-paper', 'aria-label': '空白章' },
      e('span', { className: 'empty-paper-mark', 'aria-hidden': 'true' }, '〆'),
      e('h1', null, '空白页'),
      e('button', { type: 'button', onClick: create }, '新建一章'),
    )
  }

  const index = files.indexOf(path)
  return e('section', { className: 'editor', 'aria-label': '正文编辑区' },
    e('header', { className: 'editor-header' },
      e('span', null, doc?.path ?? path),
      e('span', null, `${text.replace(/\s/g, '').length} 字 · ${state === 'draft' ? '草稿未保存' : state === 'conflict' ? '版本冲突' : state === 'saved' ? '已保存' : '读取中'}`),
    ),
    e('textarea', {
      ref: ta,
      value: text,
      className: 'paper-input',
      'aria-label': '正文',
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value),
      onSelect: (event: ChangeEvent<HTMLTextAreaElement>) => setSelection({ start: event.target.selectionStart, end: event.target.selectionEnd }),
      onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
        if (event.key === 'Tab' && ghost) { event.preventDefault(); acceptGhost() }
        if (event.key === 'Escape') { patchAbort.current?.abort(); setGhost(''); setProposal(null) }
      },
    }),
    e('footer', { className: 'editor-tools' },
      e('button', { type: 'button', onClick: () => index > 0 && onOpen(files[index - 1]), disabled: index <= 0 }, '上一篇'),
      e('button', { type: 'button', onClick: () => index >= 0 && index < files.length - 1 && onOpen(files[index + 1]), disabled: index < 0 || index >= files.length - 1 }, '下一篇'),
      e('button', { type: 'button', onClick: () => void save(), disabled: !doc || !isDirty(doc, text) || conflict }, '保存'),
      conflict ? e('button', { type: 'button', onClick: () => void reloadDisk() }, '重新载入磁盘版本') : null,
      conflict ? e('button', { type: 'button', onClick: () => void saveConflictCopy() }, '另存冲突副本') : null,
      note ? e('span', { role: conflict ? 'alert' : 'status' }, note) : null,
    ),
  )
}

function ModelIndicator({ ctx, session, onConfigure }: { ctx: ShellContext; session: SessionFace; onConfigure(): void }) {
  const [models, setModels] = useState<SessionModels | null>(null)
  const [note, setNote] = useState('')
  const refresh = async () => {
    const result = await readModels(ctx.connection, session.sessionId)
    if (!result.ok) { setNote('接口不可用'); return }
    setModels(result.value); setNote('')
  }
  useEffect(() => { setModels(null); void refresh() }, [session.sessionId])
  const current = models?.groups
    .flatMap((group) => group.models.map((model) => ({ provider: group.id, providerName: group.name, model })))
    .find((item) => item.provider === models.current.provider && item.model.id === models.current.model)
  if (!models || models.groups.length === 0) {
    return e('div', { className: 'compact-control model-empty' },
      e('span', null, note || (models ? '没有可用模型' : '读取中…')),
      e('button', { type: 'button', onClick: () => void refresh() }, '重试'),
      e('button', { type: 'button', onClick: onConfigure }, '设置接口'),
    )
  }
  return e('div', { className: 'compact-control' },
    e('span', { className: 'model-indicator', title: '本次对话使用的模型' }, current ? `${current.providerName} · ${current.model.name}` : models.current.model),
    e('button', { className: 'icon-button', type: 'button', onClick: onConfigure, 'aria-label': '设置接口', title: '接口设置' }, '⌁'),
  )
}

function NewConversationPicker(props: {
  ctx: ShellContext
  session: SessionFace
  workspaceId?: WorkspaceId
  onClose(): void
  onConfigure(): void
}) {
  const { ctx, session, workspaceId, onClose, onConfigure } = props
  const [models, setModels] = useState<SessionModels | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let live = true
    void readModels(ctx.connection, session.sessionId).then((result) => {
      if (!live) return
      if (!result.ok) { setNote('模型不可用'); return }
      const options = result.value.groups.flatMap((group) => group.models.map((model) => `${group.id}\0${model.id}`))
      const currentValue = `${result.value.current.provider}\0${result.value.current.model}`
      setModels(result.value)
      setValue(options.includes(currentValue) ? currentValue : (options[0] ?? ''))
      setNote('')
    }).catch(() => { if (live) setNote('模型不可用') })
    return () => { live = false }
  }, [ctx.connection, session.sessionId])

  const start = async (event: FormEvent) => {
    event.preventDefault()
    const [provider, model] = value.split('\0')
    if (!workspaceId || !provider || !model) return
    setBusy(true); setNote('')
    try {
      const sessionId = await ctx.workspaces.connectWorkspace(workspaceId)
      const selected = await selectModel(ctx.connection, sessionId, provider, model)
      if (!selected.ok) throw new Error(selected.error.message)
      ctx.sessions.open(sessionId)
      onClose()
    } catch {
      setNote('新对话未建立')
    } finally {
      setBusy(false)
    }
  }

  return e('form', { className: 'conversation-setup', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'new-conversation-title', onKeyDown: (event: KeyboardEvent<HTMLFormElement>) => { if (event.key === 'Escape') onClose() }, onSubmit: (event: FormEvent) => void start(event) },
    e('header', null,
      e('strong', { id: 'new-conversation-title' }, '新对话'),
      e('button', { className: 'icon-button', type: 'button', onClick: onClose, 'aria-label': '关闭' }, '×'),
    ),
    models && value ? e('label', null,
      e('span', { className: 'sr-only' }, '选择模型'),
      e('select', { value, autoFocus: true, 'aria-label': '选择模型', onChange: (event: ChangeEvent<HTMLSelectElement>) => setValue(event.target.value) },
        models.groups.flatMap((group) => group.models.map((model) => e('option', {
          key: `${group.id}/${model.id}`,
          value: `${group.id}\0${model.id}`,
        }, `${group.name} · ${model.name}`))),
      ),
    ) : e('button', { type: 'button', disabled: !note, onClick: onConfigure }, note || '读取中'),
    note && models ? e('small', { className: 'warning', role: 'alert' }, note) : null,
    e('footer', null,
      e('button', { type: 'button', onClick: onClose, disabled: busy }, '取消'),
      e('button', { className: 'primary-action', type: 'submit', disabled: busy || !workspaceId || !value }, busy ? '创建中' : '开始'),
    ),
  )
}

function PendingCard({ item }: { item: PendingInteraction }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  if (item.kind === 'approval') {
    const decide = (outcome: 'allowed-once' | 'rejected') => {
      setBusy(true)
      void answerApproval(item, outcome).then((receipt) => {
        if (!receipt.accepted) setNote('这项操作状态已变化，请重新发起。')
      }).catch(() => setNote('提交没有完成，请重试。')).finally(() => setBusy(false))
    }
    return e('article', { className: 'pending-card', 'aria-label': '工具审批' },
      e('strong', null, '需要授权'),
      e('p', null, '允许 Agent 执行这一步？'),
      e('div', null,
        e('button', { type: 'button', disabled: busy, onClick: () => decide('allowed-once') }, '允许一次'),
        e('button', { type: 'button', disabled: busy, onClick: () => decide('rejected') }, '拒绝'),
      ),
      note ? e('small', { className: 'warning' }, note) : null,
    )
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const encoded: QuestionAnswerItem[] = item.payload.questions.map((question) => {
      const value = answers[question.id]?.trim() ?? ''
      const labels = question.options?.map((option) => option.label) ?? []
      return labels.includes(value)
        ? { id: question.id, selected: [value] }
        : { id: question.id, selected: [], ...(value ? { custom: value } : {}) }
    })
    if (encoded.some((answer) => answer.selected.length === 0 && !answer.custom)) { setNote('请回答全部问题。'); return }
    setBusy(true)
    void answerQuestions(item, encoded).then((receipt) => {
      if (!receipt.accepted) setNote('这些问题的状态已变化，请重新回答。')
    }).catch(() => setNote('提交没有完成，请重试。')).finally(() => setBusy(false))
  }
  return e('form', { className: 'pending-card', 'aria-label': '回答问题', onSubmit: submit },
    item.payload.questions.map((question) => e('fieldset', { key: question.id },
      e('legend', null, question.header ?? '写作助手需要你的回答'),
      e('p', null, question.question),
      question.detail ? e('small', null, question.detail) : null,
      e('input', {
        value: answers[question.id] ?? '',
        list: `question-${item.key}-${question.id}`,
        'aria-label': question.question,
        onChange: (event: ChangeEvent<HTMLInputElement>) => setAnswers((old) => ({ ...old, [question.id]: event.target.value })),
      }),
      question.options ? e('datalist', { id: `question-${item.key}-${question.id}` }, question.options.map((option) => e('option', { key: option.label, value: option.label }, option.description))) : null,
    )),
    e('button', { type: 'submit', disabled: busy }, busy ? '提交中…' : '提交全部回答'),
    note ? e('small', { className: 'warning' }, note) : null,
  )
}

function ProposalCard(props: { ctx: ShellContext; sessionId: string; proposal: ProposalMarker; onApplied(path: string): void }) {
  const [prepared, setPrepared] = useState<{ version?: string; before?: string; after?: string; text?: string } | null>(null)
  const [state, setState] = useState<'checking' | 'ready' | 'applying' | 'applied' | 'ignored' | 'expired'>('checking')
  const [note, setNote] = useState('正在核对文件…')

  useEffect(() => {
    let live = true
    setState('checking'); setNote('正在核对文件…')
    void props.ctx.connection.rpc.call('/manuscript', 'proposal.prepare', {
      sessionId: props.sessionId,
      ...props.proposal,
    }).then((raw: unknown) => {
      if (!live) return
      const result = raw as RpcResult<{ version?: string; before?: string; after?: string; text?: string }>
      if (!result.ok) { setState('expired'); setNote('文件已经变化，这项建议需要重新生成。'); return }
      setPrepared(result.value); setState('ready'); setNote('可以安全应用')
    })
    return () => { live = false }
  }, [props.sessionId, props.proposal.path, props.proposal.summary, props.proposal.oldText, props.proposal.newText, props.proposal.text])

  const apply = async () => {
    if (!prepared) return
    setState('applying'); setNote('正在应用…')
    const result = await props.ctx.connection.rpc.call('/manuscript', 'proposal.apply', {
      sessionId: props.sessionId,
      ...props.proposal,
      expectedVersion: prepared.version ?? '',
    }) as RpcResult<{ path: string }>
    if (!result.ok) { setState('expired'); setNote('文件已经变化，未写入任何内容。请让写作助手重新生成建议。'); return }
    setState('applied'); setNote('已应用到作品')
    props.onApplied(result.value.path)
  }

  return e('article', { className: `proposal-card ${state}`, 'aria-label': '文件修改建议' },
    e('header', null, e('strong', null, props.proposal.summary), e('code', null, props.proposal.path)),
    props.proposal.kind === 'edit' ? e('div', { className: 'proposal-diff' },
      e('section', null, e('small', null, '原文'), e('pre', null, prepared?.before ?? props.proposal.oldText)),
      e('section', null, e('small', null, '修改后'), e('pre', null, prepared?.after ?? props.proposal.newText)),
    ) : e('section', null, e('small', null, '新文件内容'), e('pre', null, props.proposal.text)),
    e('footer', null,
      e('span', { role: state === 'expired' ? 'alert' : 'status' }, note),
      state === 'ready' ? e('button', { type: 'button', onClick: () => void apply() }, '应用') : null,
      state === 'ready' ? e('button', { type: 'button', onClick: () => { setState('ignored'); setNote('已忽略') } }, '忽略') : null,
    ),
  )
}

function ProjectContextReceiptView({ receipt }: { receipt: ProjectContextReceipt[] }) {
  const included = receipt.filter((item) => item.status === 'included' && item.includedChars > 0).length
  return e('details', { className: 'project-context-receipt' },
    e('summary', null, `项目上下文：${included}/${receipt.length} 份资料已纳入`),
    e('ul', null, receipt.map((item) => e('li', { key: item.path },
      e('code', null, item.path),
      ` · ${item.status === 'included'
        ? item.includedChars > 0 ? `纳入 ${item.includedChars} 字符` : item.truncated ? '未纳入（已达总量上限）' : '空文件'
        : item.status === 'missing' ? '未找到' : '读取失败'}`,
      item.truncated ? '（已截断）' : '',
      item.version ? ` · ${item.version}` : '',
    ))),
  )
}

function ImportDialog(props: { flow: ImportFlow; onCancel(): void; onApply(): void; onContinue(): void; onCleanup(): void }) {
  const focus = useRef<HTMLButtonElement | null>(null)
  const dialog = useRef<HTMLElement | null>(null)
  useEffect(() => { if (focus.current) focus.current.focus(); else dialog.current?.focus() }, [props.flow.kind])
  if (props.flow.kind === 'idle') return null
  const working = props.flow.kind === 'working'
  const recover = props.flow.kind === 'recover'
  const cleanup = props.flow.kind === 'cleanup-confirm'
  const probe = props.flow.kind === 'review' || props.flow.kind === 'recover' ? props.flow.probe : undefined
  const cleaning = recover && probe?.message === 'cleaning'
  return e('div', { className: 'import-overlay', onKeyDown: (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !working) props.onCancel()
    if (event.key !== 'Tab' || working || !dialog.current) return
    const buttons = [...dialog.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
    if (!buttons.length) return
    const first = buttons[0]; const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  } },
    e('section', { ref: dialog, className: 'import-dialog', role: 'dialog', tabIndex: -1, 'aria-modal': true, 'aria-labelledby': 'import-dialog-title' },
      e('h2', { id: 'import-dialog-title' }, working ? '正在导入作品' : cleanup ? '清理未完成导入？' : recover ? '发现未完成导入' : '确认导入作品'),
      working ? e('p', { role: 'status', 'aria-live': 'polite' }, props.flow.kind === 'working' ? props.flow.message : '')
        : cleanup ? e('p', null, '只会删除清单拥有且内容未变化的导入文件；不会删除目标文件夹或其他文件。')
          : recover ? e('div', null,
              e('p', null, cleaning ? '上次清理尚未完成。只能继续安全清理。' : `上次导入未完成（${importSummary(probe!)}）。重新选择原源目录后可以继续，或安全清理。`),
              probe?.message && !cleaning ? e('p', { className: 'warning', role: 'alert' }, probe.message) : null,
            )
            : e('div', null,
              e('p', null, `将导入 ${importSummary(probe!)}；源目录不会被修改。`),
              probe!.skipped.length ? e('p', null, `将跳过 ${probe!.skipped.length} 项。`) : null,
              e('ul', null, probe!.preview.map((item: string) => e('li', { key: item }, item))),
              probe!.skipped.length ? e('ul', { 'aria-label': '跳过项目示例' }, probe!.skipped.slice(0, 8).map((item) => e('li', { key: `${item.reason}:${item.path}` }, `${item.path} — ${item.reason}`))) : null,
            ),
      !working ? e('footer', null,
        e('button', { ref: focus, type: 'button', onClick: props.onCancel }, '取消'),
        recover && !cleaning ? e('button', { type: 'button', onClick: props.onContinue }, '继续导入') : null,
        recover ? e('button', { type: 'button', onClick: () => props.onCleanup() }, '清理未完成导入') : null,
        cleanup ? e('button', { type: 'button', onClick: props.onCleanup }, '确认清理') : null,
        props.flow.kind === 'review' ? e('button', { type: 'button', onClick: props.onApply }, '开始导入') : null,
      ) : null,
    ),
  )
}

function Chat({ ctx, session, workspaceId, onClose, onConfigure, onApplied }: { ctx: ShellContext; session: SessionFace; workspaceId?: WorkspaceId; onClose(): void; onConfigure(): void; onApplied(path: string): void }) {
  const snapshot = useObservable<ConversationSnapshot>(session)
  const connected = useObservable(ctx.connection.hostDescription)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const [outgoing, setOutgoing] = useState<{ text: string; state: 'sending' | 'accepted' | 'failed'; afterRows: number; projectContextReceipt?: ProjectContextReceipt[] } | null>(null)
  const [creatingConversation, setCreatingConversation] = useState(false)
  const partial = partialText(snapshot)
  const rows = chatRows(snapshot)
  const outgoingIsCanonical = Boolean(outgoing && rows.slice(outgoing.afterRows)
    .some((row) => row.role === 'user' && row.text.trim() === outgoing.text))
  useEffect(() => {
    if (outgoingIsCanonical) setOutgoing(null)
  }, [outgoingIsCanonical])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = draft.trim()
    if (!value || (outgoing && outgoing.state !== 'failed')) return
    setOutgoing({ text: value, state: 'sending', afterRows: rows.length })
    setDraft('')
    setNote('')
    void sendProjectContext(session, value, async (path) => safeRpcCall<{ text: string; version: string }>(
      () => ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId: session.sessionId, path }),
    )).then((outcome) => {
      const result = outcome?.result
      if (outcome) setOutgoing((current) => current?.text === value ? { ...current, projectContextReceipt: outcome.receipt } : current)
      if (!result || !result.ok) {
        setOutgoing((current) => current?.text === value ? { ...current, state: 'failed' } : current)
        setNote('消息没有发送成功，请重试。')
        return
      }
      setOutgoing((current) => current?.text === value ? { ...current, state: 'accepted' } : current)
    }).catch(() => {
      setOutgoing((current) => current?.text === value ? { ...current, state: 'failed' } : current)
      setNote('消息没有发送成功，请重试。')
    })
  }
  return e('aside', { className: 'chat', 'aria-label': '写作助手' },
    e('header', { className: 'chat-header' },
      e('strong', null, connected ? '搭档' : '重连中'),
      e('div', { className: 'chat-controls' }, e(ModelIndicator, { ctx, session, onConfigure })),
      e('div', { className: 'chat-header-actions' },
        e('button', { className: 'icon-button', type: 'button', title: '新对话', 'aria-label': '新对话', onClick: () => setCreatingConversation(true) }, '＋'),
        e('button', { className: 'icon-button', type: 'button', title: '收起搭档', 'aria-label': '收起搭档', onClick: onClose }, '×'),
      ),
    ),
    creatingConversation ? e(NewConversationPicker, { ctx, session, workspaceId, onClose: () => setCreatingConversation(false), onConfigure }) : null,
    e('div', { className: 'chat-history' },
      snapshot.hasMore ? e('button', { type: 'button', onClick: () => void loadOlder(session), disabled: snapshot.loadingOlder }, snapshot.loadingOlder ? '加载中…' : '加载更早消息') : null,
      rows.map((row) => row.proposal
        ? e(ProposalCard, { key: row.id, ctx, sessionId: session.sessionId, proposal: row.proposal, onApplied })
        : e('article', { className: `chat-row ${row.role}`, key: row.id },
          e('p', null, row.text || '（无文字内容）'),
          row.detail ? e('small', null, row.detail) : null,
          row.projectContextReceipt ? e(ProjectContextReceiptView, { receipt: row.projectContextReceipt }) : null,
        )),
      outgoing && !outgoingIsCanonical ? e('article', { className: 'chat-row user', key: 'local-outgoing' },
        e('p', null, outgoing.text),
        outgoing.projectContextReceipt ? e(ProjectContextReceiptView, { receipt: outgoing.projectContextReceipt }) : null,
        e('small', { role: outgoing.state === 'failed' ? 'alert' : 'status' },
          outgoing.state === 'sending' ? '正在发送…' : outgoing.state === 'accepted' ? '已发送' : '发送失败',
        ),
      ) : null,
      outgoing?.state === 'accepted' && !outgoingIsCanonical
        ? e('article', { className: 'chat-row assistant', 'aria-live': 'polite' }, '正在回复…')
        : null,
      visibleRunningCalls(snapshot.runningCalls).map((call) => e('article', { className: 'chat-row tool', key: `running:${call.callId}` }, e('strong', null,
        call.name === 'glob' || call.name === 'grep' ? '正在查找作品资料…' : call.name === 'read' ? '正在阅读作品资料…' : call.name === 'novel_propose' ? '正在准备修改建议…' : '正在处理…'
      ))),
      snapshot.queue.map((item) => e('article', { className: 'chat-row notice', key: `queue:${item.id}` }, e('p', null, item.preview), e('small', null, item.placement === 'queued' ? '已排队' : '正在转向'))),
      partial ? e('article', { className: 'chat-row assistant', 'aria-live': 'polite' }, e('p', null, partial)) : snapshot.partial ? e('article', { className: 'chat-row assistant', 'aria-live': 'polite' }, '正在回复…') : null,
      snapshot.pending.map((item) => e(PendingCard, { key: item.key, item })),
      snapshot.openState === 'error' ? e('p', { className: 'warning' }, '连接暂时中断，正在恢复…') : null,
      snapshot.promptError ? e('p', { className: 'warning' }, '写作助手未能完成这次请求，请重试。') : null,
    ),
    e('form', { className: 'composer', onSubmit: submit },
      e('textarea', {
        value: draft,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value),
        placeholder: '问剧情、审一段、对质人物……',
        'aria-label': '输入消息',
      }),
      note ? e('small', { className: 'warning' }, note) : null,
      e('div', null,
        snapshot.running ? e('button', { type: 'button', onClick: () => void stop(session) }, '停止') : null,
        e('button', {
          type: 'submit',
          disabled: !draft.trim() || snapshot.removed || !connected || Boolean(outgoing && outgoing.state !== 'failed'),
        }, '发送'),
      ),
    ),
  )
}

async function collectChapters(ctx: ShellContext, sessionId: string): Promise<ChapterExport[]> {
  const queue = ['正文']
  const files: string[] = []
  while (queue.length) {
    const directory = queue.shift()!
    const listed = await ctx.connection.rpc.call('/manuscript', 'tree.list', { sessionId, path: directory }) as RpcResult<{ entries?: Entry[] }>
    if (!listed.ok) throw new Error(errorMessage(listed))
    for (const entry of listed.value.entries ?? []) {
      const child = `${directory}/${entry.name}`
      if (entry.type === 'directory') queue.push(child)
      else if (entry.type === 'file' && /\.md$/i.test(entry.name)) files.push(child)
    }
  }
  return await Promise.all(files.map(async (path) => {
    const read = await ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId, path }) as RpcResult<{ text: string }>
    if (!read.ok) throw new Error(errorMessage(read))
    return { path, text: read.value.text }
  }))
}

async function collectWorkspaceFiles(ctx: ShellContext, sessionId: string): Promise<string[]> {
  const queue = ['']
  const files: string[] = []
  while (queue.length) {
    const directory = queue.shift()!
    const listed = await safeRpcCall<{ entries?: Entry[] }>(() => ctx.connection.rpc.call('/manuscript', 'tree.list', {
      sessionId,
      path: directory || '.',
    }))
    if (!listed.ok) throw new Error(errorMessage(listed))
    for (const entry of listed.value.entries ?? []) {
      if (entry.name.startsWith('.')) continue
      const child = directory ? `${directory}/${entry.name}` : entry.name
      if (entry.type === 'directory') queue.push(child)
      else if (entry.type === 'file') files.push(child)
    }
  }
  return files
}

function downloadExport(filename: string, content: string, format: ExportFormat): void {
  const blob = new Blob([content], { type: format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.click()
  globalThis.setTimeout(() => URL.revokeObjectURL(href), 0)
}

function Root({ ctx }: { ctx: ShellContext }) {
  const sessions = useObservable(ctx.sessions.list)
  const workspaces = useObservable(ctx.workspaces.list)
  const session = currentSession(ctx)
  const [path, setPath] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [treeRevision, setTreeRevision] = useState(0)
  const [contentRevision, setContentRevision] = useState(0)
  const [homeNote, setHomeNote] = useState('')
  const [createNote, setCreateNote] = useState('')
  const [openingWorkspace, setOpeningWorkspace] = useState(false)
  const [manualWorkspaceMode, setManualWorkspaceMode] = useState<'existing' | 'new' | null>(null)
  const [manualWorkspacePath, setManualWorkspacePath] = useState('')
  const [view, setView] = useState<'workspace' | 'settings'>('workspace')
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [setupGate, setSetupGate] = useState<'checking' | 'required' | 'ready'>('checking')
  const [indexStatus, setIndexStatus] = useState<Record<string, 'initializing' | 'queued' | 'failed'>>({})
  const indexedWorkspaces = useRef(new Set<string>())
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState('')
  const [importFlow, setImportFlow] = useState<ImportFlow>(idleImportFlow)
  const importReturnFocus = useRef<HTMLElement | null>(null)
  const probedImportSessions = useRef(new Set<string>())
  const current = sessions.current
  useEffect(() => { document.title = 'DSH Editor' }, [])
  useEffect(() => { setPath(''); setFiles([]) }, [current])
  useEffect(() => {
    let live = true
    void ctx.connection.api.credentials.describe({ refs: ['DEEPSEEK_API_KEY', 'DSH_EDITOR_CUSTOM_API_KEY'] }).then((response) => {
      if (!live) return
      const credentials = response.result.ok ? response.result.value.credentials : undefined
      const configured = Boolean(credentials?.DEEPSEEK_API_KEY?.configured || credentials?.DSH_EDITOR_CUSTOM_API_KEY?.configured)
      setSetupGate(configured ? 'ready' : 'required')
      if (!configured) setView('settings')
    }).catch(() => {
      if (!live) return
      setSetupGate('required')
      setView('settings')
    })
    return () => { live = false }
  }, [ctx.connection])
  const create = async (kind: DocumentKind = 'chapter') => {
    if (!session) return
    setCreateNote('')
    let workspaceFiles: string[]
    try {
      workspaceFiles = await collectWorkspaceFiles(ctx, session.sessionId)
    } catch {
      setCreateNote('没有读取到完整目录，请重试。')
      return
    }
    const chapterPath = kind === 'chapter' ? nextChapterPath(workspaceFiles) : ''
    const chapterNumber = Number(/(\d+)\.md$/.exec(chapterPath)?.[1] ?? 1)
    const title = globalThis.prompt?.(
      kind === 'chapter' ? '章节标题' : kind === 'outline' ? '大纲名称' : kind === 'character' ? '人物名称' : '设定名称',
      kind === 'chapter' ? `第${chapterNumber}章` : '',
    )?.trim()
    if (!title) return
    const file = kind === 'chapter' ? chapterPath : nextDocumentPath(kind, title, workspaceFiles)
    void safeRpcCall(() => ctx.connection.rpc.call('/manuscript', 'file.create', {
      sessionId: session.sessionId,
      path: file,
      text: documentTemplate(kind, title),
    })).then((result) => {
      if (result.ok) { setPath(file); setTreeRevision((old) => old + 1); return }
      setCreateNote(errorMessage(result))
    })
  }
  const exportNovel = async (format: ExportFormat) => {
    if (!session) return
    setExporting(true); setExportNote('正在整理正文…')
    try {
      const chapters = await collectChapters(ctx, session.sessionId)
      const title = currentWorkspace?.title || (current ? sessions.byId[current]?.displayTitle : undefined) || '未命名作品'
      const result = buildExport(chapters, title, format)
      downloadExport(result.filename, result.content, format)
      setExportNote(`已生成 ${result.filename}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setExportNote(/没有可导出|正文为空/.test(message) ? message : '导出没有完成，请重试。')
    } finally {
      setExporting(false)
    }
  }
  const currentCwd = current ? sessions.byId[current]?.cwd : undefined
  const currentWorkspace = workspaces.items.find((workspace) => workspace.path === currentCwd)
  useEffect(() => {
    if (!current || !currentWorkspace || probedImportSessions.current.has(current)) return
    probedImportSessions.current.add(current)
    let live = true
    void safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call('/manuscript', 'project.importProbe', { targetSessionId: current }))
      .then((recovery) => {
        if (!live) return
        if (!recovery.ok) {
          ctx.sessions.clear()
          setHomeNote('作品中的导入状态无法验证，已停止打开。')
          return
        }
        if (recovery.value.state !== 'recoverable') return
        importReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setImportFlow(recoverImport(current, currentWorkspace.workspaceId, recovery.value))
      })
    return () => { live = false }
  }, [ctx.connection.rpc, current, currentWorkspace?.workspaceId])
  const triggerExistingIndex = (workspaceId: WorkspaceId, sessionId: SessionId, force = false) => {
    if (!force && indexedWorkspaces.current.has(workspaceId)) return
    indexedWorkspaces.current.add(workspaceId)
    setIndexStatus((old) => ({ ...old, [workspaceId]: 'initializing' }))
    void Promise.resolve().then(async () => {
      const prepared = await ctx.connection.rpc.call('/manuscript', 'project.prepareIndex', { sessionId }) as RpcResult
      if (!prepared.ok) throw new Error(errorMessage(prepared))
      const indexedSession = ctx.sessions.binding(sessionId)?.session
      if (!indexedSession) throw new Error('session unavailable')
      const result = await indexedSession.prompt([{ type: 'text', text: buildNovelIndexPrompt() }], 'queue')
      if (!result.ok) throw new Error('prompt rejected')
      setIndexStatus((old) => ({ ...old, [workspaceId]: 'queued' }))
    }).catch(() => setIndexStatus((old) => ({ ...old, [workspaceId]: 'failed' })))
  }
  const connectAndInitialize = async (workspaceId: WorkspaceId, newProject: boolean) => {
    const sessionId = await ctx.workspaces.connectWorkspace(workspaceId)
    if (newProject) {
      const initialized = await ctx.connection.rpc.call('/manuscript', 'project.init', { sessionId, newProject: true }) as RpcResult
      if (!initialized.ok) throw new Error(errorMessage(initialized))
    }
    if (!newProject) {
      probedImportSessions.current.add(sessionId)
      const recovery = await safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call('/manuscript', 'project.importProbe', { targetSessionId: sessionId }))
      if (!recovery.ok) {
        setHomeNote('作品中的导入状态无法验证，已停止打开。')
        setExportNote('作品中的导入状态无法验证，未切换工作区。')
        return
      }
      if (recovery.ok && recovery.value.state === 'recoverable') {
        importReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setImportFlow(recoverImport(sessionId, workspaceId, recovery.value)); return
      }
      triggerExistingIndex(workspaceId, sessionId)
    }
    ctx.sessions.open(sessionId)
  }
  const openWorkspacePath = async (path: string, newProject: boolean) => {
    const workspace = await ctx.workspaces.create({ path })
    await connectAndInitialize(workspace.workspaceId, newProject)
  }
  const pickWorkspace = async (newProject: boolean) => {
    setManualWorkspaceMode(newProject ? 'new' : 'existing')
    setHomeNote('也可以直接输入作品路径。')
    try {
      const path = await ctx.workspaces.pickDirectory()
      if (!path) {
        setHomeNote('没有选择目录，也可以在下方输入作品路径。')
        return
      }
      setOpeningWorkspace(true)
      try {
        await openWorkspacePath(path, newProject)
        setManualWorkspaceMode(null)
        setHomeNote('')
      } finally {
        setOpeningWorkspace(false)
      }
    } catch {
      setHomeNote('目录选择器暂时不可用，请在下方输入作品路径。')
    }
  }
  const submitWorkspacePath = async (event: FormEvent) => {
    event.preventDefault()
    const path = manualWorkspacePath.trim()
    if (!path) { setHomeNote('请输入作品文件夹路径。'); return }
    setOpeningWorkspace(true)
    setHomeNote('')
    try {
      await openWorkspacePath(path, manualWorkspaceMode === 'new')
      setManualWorkspaceMode(null)
      setManualWorkspacePath('')
    } catch {
      setHomeNote('工作区没有打开，请检查路径后重试。')
    } finally {
      setOpeningWorkspace(false)
    }
  }
  const closeImportFlow = (restoreFocus = true) => {
    const target = importReturnFocus.current
    importReturnFocus.current = null
    setImportFlow(idleImportFlow)
    if (restoreFocus && target) globalThis.setTimeout(() => target.focus(), 0)
  }
  const selectImportSource = async (targetSessionId?: SessionId, targetWorkspaceId?: WorkspaceId) => {
    if (!targetSessionId) importReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const sourcePath = await ctx.workspaces.pickDirectory()
    if (!sourcePath) { closeImportFlow(); return }
    let sourceWorkspace: Awaited<ReturnType<typeof ctx.workspaces.create>> | undefined
    try {
      sourceWorkspace = await ctx.workspaces.create({ path: sourcePath })
      const sourceSessionId = await ctx.workspaces.connectWorkspace(sourceWorkspace.workspaceId)
      let destinationSessionId = targetSessionId
      let destinationWorkspaceId = targetWorkspaceId
      if (!destinationSessionId || !destinationWorkspaceId) {
        const targetPath = await ctx.workspaces.pickDirectory()
        if (!targetPath) { closeImportFlow(); return }
        const targetWorkspace = await ctx.workspaces.create({ path: targetPath })
        destinationWorkspaceId = targetWorkspace.workspaceId
        destinationSessionId = await ctx.workspaces.connectWorkspace(destinationWorkspaceId)
      }
      setImportFlow({ kind: 'working', message: '正在检查可导入的文件…' })
      const probe = await safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call('/manuscript', 'project.importProbe', {
        sourceSessionId, targetSessionId: destinationSessionId,
      }))
      if (!probe.ok || probe.value.state !== 'ready') {
        closeImportFlow(); setHomeNote(probe.ok ? probe.value.message ?? '目录不能导入。' : '导入检查没有完成。'); return
      }
      setImportFlow(importReview(sourceSessionId, destinationSessionId as string, destinationWorkspaceId as string, probe.value))
    } catch (error) {
      throw error
    }
  }
  const applyImportFlow = async () => {
    if (importFlow.kind !== 'review') return
    const flow = importFlow
    setImportFlow({ kind: 'working', message: '正在复制作品文件…' })
    const applied = await safeRpcCall(() => ctx.connection.rpc.call('/manuscript', 'project.importApply', {
      sourceSessionId: flow.sourceSessionId, targetSessionId: flow.targetSessionId, probeToken: flow.probe.token,
    }))
    if (!applied.ok) {
      const recovery = await safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call('/manuscript', 'project.importProbe', { targetSessionId: flow.targetSessionId }))
      if (recovery.ok && recovery.value.state === 'recoverable') setImportFlow(recoverImport(flow.targetSessionId, flow.targetWorkspaceId, recovery.value))
      else { closeImportFlow(false); setHomeNote('导入没有完成，请重试。') }
      return
    }
    const initialized = await safeRpcCall(() => ctx.connection.rpc.call('/manuscript', 'project.init', { sessionId: flow.targetSessionId, newProject: false }))
    if (!initialized.ok) { closeImportFlow(false); setHomeNote('导入已完成，但项目初始化没有完成。'); return }
    ctx.sessions.open(flow.targetSessionId as SessionId)
    triggerExistingIndex(flow.targetWorkspaceId as WorkspaceId, flow.targetSessionId as SessionId)
    closeImportFlow(false)
  }
  const cleanupImportFlow = async () => {
    if (importFlow.kind === 'recover') { setImportFlow({ kind: 'cleanup-confirm', targetSessionId: importFlow.targetSessionId, targetWorkspaceId: importFlow.targetWorkspaceId, receiptId: importFlow.probe.receiptId! }); return }
    if (importFlow.kind !== 'cleanup-confirm') return
    const flow = importFlow
    setImportFlow({ kind: 'working', message: '正在安全清理未完成导入…' })
    const cleaned = await safeRpcCall(() => ctx.connection.rpc.call('/manuscript', 'project.importCleanup', { targetSessionId: flow.targetSessionId, receiptId: flow.receiptId }))
    if (cleaned.ok) {
      if (current === flow.targetSessionId) ctx.sessions.clear()
      closeImportFlow()
      setHomeNote('已清理未完成导入。')
      return
    }
    const recovery = await safeRpcCall<ImportProbeView>(() => ctx.connection.rpc.call('/manuscript', 'project.importProbe', { targetSessionId: flow.targetSessionId }))
    if (recovery.ok && recovery.value.state === 'recoverable') {
      setImportFlow(recoverImport(flow.targetSessionId, flow.targetWorkspaceId, { ...recovery.value, message: recovery.value.message ?? '清理没有完成；文件未被自动删除。' }))
      return
    }
    if (current === flow.targetSessionId) ctx.sessions.clear()
    closeImportFlow()
    setHomeNote('清理没有完成；文件未被自动删除。')
  }
  const renderImportDialog = () => e(ImportDialog, {
    flow: importFlow,
    onCancel: () => {
      const flow = importFlow
      if ((flow.kind === 'recover' || flow.kind === 'cleanup-confirm') && current === flow.targetSessionId) ctx.sessions.clear()
      closeImportFlow()
    },
    onApply: () => void applyImportFlow(),
    onContinue: () => importFlow.kind === 'recover' ? void selectImportSource(importFlow.targetSessionId as SessionId, importFlow.targetWorkspaceId as WorkspaceId).catch(() => closeImportFlow()) : undefined,
    onCleanup: () => void cleanupImportFlow(),
  })

  if (view === 'settings' || setupGate !== 'ready') {
    return e('div', { className: 'settings-shell' },
      e('style', null, redesignedStyles),
      e('style', null, playfulStyles),
      e(ModelSetup, {
        connection: ctx.connection,
        onBack: setupGate === 'ready' ? () => setView('workspace') : undefined,
        onConfigured: () => { setSetupGate('ready'); setView('workspace') },
        onTestFailure: () => { setSetupGate('required'); setView('settings') },
      }),
    )
  }

  if (!session || !current) {
    return e('main', { className: 'shell no-session', style: { minWidth: 0, display: 'grid' } },
      e('style', null, redesignedStyles),
      e('style', null, homeStyles),
      e('style', null, playfulStyles),
      e('style', null, homePlayStyles),
      e('header', { className: 'chrome' },
        e('div', { className: 'brand-lockup' },
          e('span', { className: 'brand-mark', 'aria-hidden': 'true' }, 'D'),
          e('strong', null, 'DSH'),
        ),
        e('span', { className: 'local-state' }, e('i', { 'aria-hidden': 'true' }), '本地'),
        e('button', { className: 'settings-link icon-button', type: 'button', title: '设置', 'aria-label': '设置', onClick: () => setView('settings') }, '⌁'),
      ),
      e('aside', { className: 'sidebar', 'aria-label': '工作区与稿件' },
        e('div', { className: 'side-title' }, e('span', null, '文件')),
        workspaces.items.length ? e('div', { className: 'workspace-caption' }, '最近') : e('div', { className: 'workspace-empty' },
          e('span', { className: 'folder-glyph', 'aria-hidden': 'true' }),
          e('small', null, '未打开'),
        ),
        workspaces.items.map((workspace) => e('button', {
          className: 'tree-row',
          key: workspace.workspaceId,
          type: 'button',
          onClick: () => void connectAndInitialize(workspace.workspaceId, false).catch(() => setHomeNote('工作区没有打开，请重试。')),
        }, workspace.title || workspace.path)),
      ),
      e('section', { className: 'empty-paper home-stage', 'aria-label': '空白稿纸' },
        e('div', { className: 'home-ink', 'aria-hidden': 'true' }, '写'),
        e('div', { className: 'home-card' },
          e('p', { className: 'home-eyebrow' }, 'DSH EDITOR'),
          e('h1', null, '开始写。'),
          e('div', { className: 'home-actions' },
            e('button', { className: 'primary-action', type: 'button', disabled: openingWorkspace, onClick: () => void pickWorkspace(false) }, openingWorkspace ? '打开中' : '打开作品', e('span', { 'aria-hidden': 'true' }, '↗')),
            e('button', { type: 'button', disabled: openingWorkspace, onClick: () => void pickWorkspace(true) }, '新建'),
            e('button', { type: 'button', disabled: openingWorkspace, onClick: () => void selectImportSource().catch(() => { closeImportFlow(); setHomeNote('导入目录没有打开，请重试。') }) }, '导入作品'),
          ),
          manualWorkspaceMode ? e('form', { className: 'path-fallback', onSubmit: submitWorkspacePath },
            e('label', null,
              e('span', null, '作品文件夹路径'),
              e('input', {
                value: manualWorkspacePath,
                onChange: (event: ChangeEvent<HTMLInputElement>) => setManualWorkspacePath(event.target.value),
                placeholder: '例如 D:/小说/作品',
                'aria-label': '作品文件夹路径',
                autoFocus: true,
              }),
            ),
            e('div', null,
              e('button', { className: 'primary-action', type: 'submit', disabled: openingWorkspace },
                openingWorkspace ? '打开中' : manualWorkspaceMode === 'new' ? '在此新建' : '打开此目录',
              ),
              e('button', {
                type: 'button',
                disabled: openingWorkspace,
                onClick: () => { setManualWorkspaceMode(null); setHomeNote('') },
              }, '取消'),
            ),
          ) : null,
          homeNote ? e('p', { className: 'warning', role: 'alert' }, homeNote) : null,
        ),
        e('div', { className: 'paper-motion', 'aria-hidden': 'true' },
          e('i', { className: 'paper-sheet sheet-back' }),
          e('i', { className: 'paper-sheet sheet-mid' }),
          e('div', { className: 'paper-sheet sheet-front' },
            e('span'), e('span'), e('span'), e('b'),
          ),
        ),
      ),
      renderImportDialog(),
    )
  }

  return e('main', { className: 'shell', style: { minWidth: 0 } },
    e('style', null, redesignedStyles),
    e('style', null, playfulStyles),
    e('header', { className: 'chrome' },
      e('strong', null, 'DSH'),
      e('label', { className: 'workspace-select' }, e('span', { className: 'sr-only' }, '工作区'), e('select', {
        'aria-label': '选择工作区',
        value: currentWorkspace?.workspaceId ?? '',
        onChange: (event: ChangeEvent<HTMLSelectElement>) => {
          const id = event.target.value as WorkspaceId
          if (id) void connectAndInitialize(id, false).catch(() => setExportNote('工作区没有打开，请重试。'))
        },
      }, workspaces.items.map((workspace) => e('option', { key: workspace.workspaceId, value: workspace.workspaceId }, workspace.title || workspace.path)))),
      e('div', { className: 'export-actions' },
        e('details', { className: 'export-menu' },
          e('summary', null, exporting ? '导出中' : '导出'),
          e('div', null,
            e('button', { type: 'button', disabled: exporting, onClick: () => void exportNovel('markdown') }, 'Markdown'),
            e('button', { type: 'button', disabled: exporting, onClick: () => void exportNovel('text') }, 'TXT'),
          ),
        ),
        exportNote ? e('span', { role: /无法|失败|为空/.test(exportNote) ? 'alert' : 'status' }, exportNote) : null,
        e('button', { className: 'settings-link icon-button', type: 'button', title: '设置', 'aria-label': '设置', onClick: () => setView('settings') }, '⌁'),
      ),
    ),
    e('aside', { className: 'sidebar' },
      e('div', { className: 'side-title' }, e('span', null, '文件'), e('button', { className: 'icon-button', type: 'button', onClick: () => void create('chapter'), title: '新建章节', 'aria-label': '新建章节' }, '＋')),
      e('details', { className: 'project-actions' },
        e('summary', null, '新建资料'),
        e('div', null,
          e('button', { type: 'button', onClick: () => void create('outline') }, '大纲'),
          e('button', { type: 'button', onClick: () => void create('character') }, '人物'),
          e('button', { type: 'button', onClick: () => void create('world') }, '设定'),
        ),
      ),
      createNote ? e('p', { className: 'warning pad', role: 'alert' }, createNote) : null,
      currentWorkspace && indexStatus[currentWorkspace.workspaceId] ? e('div', { className: 'index-status', role: indexStatus[currentWorkspace.workspaceId] === 'failed' ? 'alert' : 'status' },
        e('span', null, indexStatus[currentWorkspace.workspaceId] === 'initializing' ? '索引中' : indexStatus[currentWorkspace.workspaceId] === 'queued' ? '索引已排队' : indexStatus[currentWorkspace.workspaceId] === 'failed' ? '索引失败' : '未索引'),
        e('button', { type: 'button', onClick: () => triggerExistingIndex(currentWorkspace.workspaceId, session.sessionId, true) }, indexStatus[currentWorkspace.workspaceId] === 'failed' ? '重试' : '重建索引'),
      ) : null,
      e(Tree, { ctx, sessionId: session.sessionId, active: path, onOpen: setPath, revision: treeRevision, onOrder: setFiles }),
    ),
    e(Editor, { ctx, session, path, files, onOpen: setPath, create: () => { void create('chapter') }, externalRevision: contentRevision }),
    assistantOpen ? e(Chat, {
      ctx,
      session,
      workspaceId: currentWorkspace?.workspaceId,
      onClose: () => setAssistantOpen(false),
      onConfigure: () => setView('settings'),
      onApplied: (appliedPath: string) => {
        setTreeRevision((old) => old + 1)
        if (appliedPath === path) setContentRevision((old) => old + 1)
      },
    }) : e('button', {
      className: 'assistant-launcher',
      type: 'button',
      'aria-label': '打开写作搭档',
      'aria-expanded': false,
      onClick: () => setAssistantOpen(true),
    }, e('span', { 'aria-hidden': 'true' }, '⌁'), e('strong', null, '搭档')),
    renderImportDialog(),
  )
}

const styles = `.shell{height:100vh;min-width:1280px;display:grid;grid-template-columns:220px minmax(0,1fr) 360px;grid-template-rows:40px minmax(0,1fr);background:#faf9f5;color:#171714;font:13px "Noto Sans SC","Microsoft YaHei",sans-serif}.chrome{grid-column:1/-1;display:flex;gap:18px;align-items:center;padding:0 14px;border-bottom:1px solid #e3e0d6}.chrome>span{color:#6b6a64;overflow:hidden;text-overflow:ellipsis}.workspace-select,.compact-control{display:flex;align-items:center;gap:6px;color:#6b6a64}.compact-control label{display:flex;align-items:center;gap:5px}.model-empty{align-items:flex-start;flex-wrap:wrap}.model-empty small{flex-basis:100%}.workspace-select select,.compact-control select{max-width:210px;border:0;background:transparent;color:#35342f}.sidebar{grid-column:1;border-right:1px solid #e3e0d6;min-height:0;display:flex;flex-direction:column;background:#f4f2ea}.side-title,.editor-header,.chat-header,.editor-tools{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #e3e0d6}.project-actions{display:flex;gap:3px;padding:6px;border-bottom:1px solid #e3e0d6}.project-actions button,.export-actions button{padding:4px 7px;border:1px solid #d2cec2;border-radius:3px;background:#fffef9;color:inherit;cursor:pointer}.export-actions{margin-left:auto;display:flex;align-items:center;gap:6px;color:#6b6a64}.export-actions span{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.session-list{padding:6px;border-bottom:1px solid #e3e0d6;display:flex;gap:3px;flex-direction:column;max-height:132px;overflow:auto}.session-list button,.tree-row{display:block;width:100%;padding:5px 7px;text-align:left;border:0;border-radius:3px;background:none;color:inherit;cursor:pointer}.session-list .selected,.tree-row[aria-current=page]{background:#e0e9f2;color:#1b365d}.tree{overflow:auto;min-height:0;padding:7px 0}.editor{grid-column:2;min-width:0;min-height:0;display:grid;position:relative;grid-template-rows:auto minmax(0,1fr) auto;background:#faf9f5}.editor-header{font-size:12px;color:#6b6a64}.paper-input{box-sizing:border-box;width:100%;height:100%;padding:42px max(48px,10%);border:0;resize:none;background:transparent;color:#171714;font:18px/1.9 "Noto Serif SC","Songti SC",serif;outline:0}.ghost{position:absolute;left:10%;bottom:52px;max-width:58%;padding:5px 8px;color:#77746c;background:#f2f0e8;border-radius:3px;font:16px/1.8 "Noto Serif SC",serif;pointer-events:none}.proposal{position:absolute;right:18px;bottom:54px;width:min(380px,48%);padding:12px;border:1px solid #d5d1c5;border-radius:5px;background:#fffef9;box-shadow:0 8px 28px #342f251a}.proposal p{margin:4px 0 10px;white-space:pre-wrap}.proposal div,.pending-card div{display:flex;gap:8px}.editor-tools{border-top:1px solid #e3e0d6;border-bottom:0;justify-content:flex-start;gap:9px;color:#6b6a64;overflow:auto}.chat{grid-column:3;min-width:0;min-height:0;border-left:1px solid #e3e0d6;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:#f4f2ea}.chat-header{align-items:flex-start;gap:8px}.chat-controls{display:grid;gap:4px;min-width:0}.chat-history{overflow:auto;padding:12px;display:flex;gap:9px;flex-direction:column}.chat-row,.pending-card{margin:0;padding:9px 10px;border:1px solid #dedbd1;border-radius:5px;background:#fffef9}.chat-row p,.pending-card p{margin:0;white-space:pre-wrap;line-height:1.6}.chat-row.user{margin-left:24px;background:#e0e9f2}.chat-row.tool,.chat-row.notice,.chat-row.unknown{font-size:12px;color:#504e49}.pending-card{display:grid;gap:8px;border-color:#c8a86a;background:#fffaf0}.pending-card fieldset{border:0;padding:0;margin:0;display:grid;gap:5px}.pending-card input{box-sizing:border-box;width:100%;padding:6px}.composer{border-top:1px solid #e3e0d6;padding:9px}.composer textarea{box-sizing:border-box;width:100%;min-height:66px;border:1px solid #d8d4c8;border-radius:4px;padding:7px;background:#fffef9;resize:vertical}.composer div{display:flex;justify-content:flex-end;gap:8px;padding-top:6px}.composer button,.editor-tools button,.proposal button,.pending-card button,.empty-paper button,.model-empty button,.home-actions button,.compact-control button,.model-panel button,.proposal-card button{padding:4px 9px;border:1px solid #d2cec2;border-radius:3px;background:#fffef9;color:inherit;cursor:pointer}.warning{color:#8a3a30}.success{color:#2f6b42}.muted{color:#77746c}.pad{padding:8px}.empty-paper{grid-column:2;display:grid;place-content:center;gap:12px;padding:48px;text-align:center;font:16px/1.8 "Noto Serif SC","Songti SC",serif}.empty-paper h1{font-size:28px;font-weight:500}.home-actions{display:flex;justify-content:center;gap:10px}.no-session{display:block;min-width:0}.no-session .empty-paper{height:100vh}.proposal-card{display:grid;gap:9px;padding:10px;border:1px solid #c8a86a;border-radius:6px;background:#fffaf0}.proposal-card header,.proposal-card footer{display:flex;align-items:center;justify-content:space-between;gap:7px}.proposal-card code{font-size:11px;color:#6b6a64}.proposal-diff{display:grid;gap:7px}.proposal-card pre{max-height:180px;margin:3px 0 0;padding:7px;overflow:auto;white-space:pre-wrap;border-radius:3px;background:#f4f2ea;font:12px/1.55 monospace}.proposal-card footer span{margin-right:auto;font-size:12px;color:#6b6a64}.proposal-card.expired{border-color:#b56a61}.proposal-card.applied{border-color:#6d9a78}.model-overlay{position:fixed;inset:0;z-index:20;display:grid;place-items:center;background:#25231f66}.model-panel{width:min(520px,calc(100vw - 48px));box-sizing:border-box;padding:22px;display:grid;gap:15px;border:1px solid #d4d0c4;border-radius:8px;background:#fffef9;box-shadow:0 24px 80px #17171433}.model-panel header,.model-panel footer{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.model-panel h2,.model-panel p{margin:0}.model-panel header p{margin-top:5px;color:#77746c}.model-panel>label{display:grid;gap:6px}.model-panel input[type=password],.model-panel input:not([type]){box-sizing:border-box;width:100%;padding:9px;border:1px solid #cbc7ba;border-radius:4px;background:white}.provider-tabs{display:flex;gap:16px;border:0;padding:0;margin:0}.provider-tabs legend{margin-bottom:7px}.provider-tabs label{display:flex;gap:5px}.model-panel footer{justify-content:flex-end}button:focus-visible,textarea:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #1b365d;outline-offset:2px}@media(max-width:1320px){.shell{grid-template-columns:210px minmax(0,1fr) 340px}.paper-input{padding-inline:42px}}`

const redesignedStyles = `${styles}
.shell{height:100dvh;min-width:1280px;grid-template-columns:248px minmax(520px,1fr) 384px;grid-template-rows:52px minmax(0,1fr);background:#f5f0e5;color:#253b32;font:14px/1.5 "Noto Sans SC","Microsoft YaHei",sans-serif}.chrome{gap:14px;padding:0 20px;background:#fbf8ef;border-color:#d8d0bf}.chrome strong{font-family:"Noto Serif SC","Songti SC",serif;font-size:17px;letter-spacing:.04em}.chrome>span{color:#6d7468}.sidebar{background:#eee8da;border-color:#d8d0bf}.side-title,.editor-header,.chat-header,.editor-tools{padding:10px 14px;border-color:#ddd5c6}.side-title{font-weight:600;letter-spacing:.04em}.project-actions{display:block;padding:8px 12px;border-color:#ddd5c6}.project-actions summary{cursor:pointer;color:#647268}.project-actions div{display:flex;gap:6px;padding-top:7px}.project-actions button,.export-actions button,.settings-link{border-color:#c9c5b4;background:#fbf8ef;color:#304f41}.tree{padding:8px}.tree-row{padding:7px 8px;border-radius:4px;transition:transform 160ms ease,background-color 160ms ease,color 160ms ease}.tree-row:hover{background:#e1eadc;transform:translateX(2px)}.session-list .selected,.tree-row[aria-current=page]{background:#dbe8d7;color:#214838;font-weight:600}.index-status{display:grid;gap:6px;margin:10px 12px;padding:9px 10px;border-left:2px solid #5d806b;background:#f8f4e9;color:#53665a;font-size:12px}.index-status button{justify-self:start;padding:3px 0;border:0;background:transparent;color:#285c45;text-decoration:underline;cursor:pointer}.editor{background:#f8f3e8}.editor-header{color:#697269;background:#f3ecdf;font-variant-numeric:tabular-nums}.paper-input{margin:22px auto;width:min(100% - 48px,880px);height:calc(100% - 44px);padding:58px clamp(34px,7vw,92px);border:1px solid #e2dac9;border-radius:2px;background:#fffdf6;box-shadow:0 8px 26px #5a4d3510;color:#28382f;font:19px/1.95 "Noto Serif SC","Songti SC",serif}.editor-tools{background:#f3ecdf}.chat{border-color:#d8d0bf;background:#f0ebdf}.chat-header{background:#f7f3e9}.chat-row,.pending-card{border-color:#ddd5c6;border-radius:4px;background:#fffdf7}.chat-row.user{background:#dce9dd}.composer{border-color:#d8d0bf;background:#f7f3e9}.composer textarea{border-color:#cbc5b7;border-radius:3px;background:#fffdf7}.composer button,.editor-tools button,.proposal button,.pending-card button,.empty-paper button,.model-empty button,.home-actions button,.compact-control button,.model-panel button,.proposal-card button{border-color:#bfc5b8;border-radius:3px;background:#fffdf7;color:#2c5744;transition:transform 160ms ease,background-color 160ms ease}.composer button:hover,.editor-tools button:hover,.proposal button:hover,.pending-card button:hover,.empty-paper button:hover,.model-empty button:hover,.home-actions button:hover,.compact-control button:hover,.model-panel button:hover,.proposal-card button:hover{background:#e1eadc;transform:translateY(-1px)}.empty-paper{background:#f8f3e8;color:#33483c}.no-session .empty-paper{height:100dvh}.settings-shell{min-height:100dvh;background:#f5f0e5}.settings-view{box-sizing:border-box;min-height:100dvh;display:grid;place-items:center;padding:32px}.model-panel{width:min(620px,100%);padding:34px 36px;border:1px solid #d9d0bd;border-left:4px solid #386a50;border-radius:4px;background:#fffdf6;box-shadow:0 18px 48px #56483314}.settings-brand{margin:0 0 8px!important;color:#557062!important;font-size:12px;letter-spacing:.1em}.model-panel h2{margin:0;font:600 28px/1.25 "Noto Serif SC","Songti SC",serif;color:#294938}.model-panel header p{max-width:36em;line-height:1.7}.provider-tabs{gap:10px}.provider-tabs label{min-width:128px;padding:10px 12px;border:1px solid #d6d2c4;border-radius:4px;background:#fbf8ef;color:#315640;cursor:pointer}.provider-tabs input{accent-color:#386a50}.model-panel>label input{transition:border-color 160ms ease,box-shadow 160ms ease}.model-panel>label input:focus{border-color:#6d8c79;box-shadow:0 0 0 3px #386a5014}.model-panel footer{padding-top:8px}.model-panel .primary-action{border-color:#315e48;background:#315e48;color:#fff}.model-panel .primary-action:hover{background:#284f3c}.settings-link{margin-left:auto;padding:5px 10px;cursor:pointer}.warning{color:#9a4b3b}.success{color:#356446}button:focus-visible,textarea:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #386a50;outline-offset:3px}@media(max-width:1320px){.shell{grid-template-columns:216px minmax(440px,1fr) 330px}.paper-input{width:calc(100% - 32px);padding-inline:42px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:0.01ms!important;animation-duration:0.01ms!important}}
`

const playfulStyles = `
:root{--ink:#173f30;--leaf:#3d755a;--mint:#dcebdd;--paper:#fffdf6;--sand:#f2ecdf;--line:#d8cfbd;--ease:cubic-bezier(.22,1,.36,1)}
.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
button,summary,.tree-row,.provider-tabs label{transition:transform 220ms var(--ease),background-color 220ms ease,border-color 220ms ease,color 220ms ease,box-shadow 220ms ease}button:active,.tree-row:active,summary:active{transform:scale(.96)}
.icon-button{display:grid!important;place-items:center;min-width:30px!important;width:30px;height:30px;padding:0!important;border-radius:50%!important;font-size:17px;line-height:1}.icon-button:hover{transform:rotate(8deg) scale(1.06)!important}
.chrome{animation:bar-drop 520ms var(--ease) both}.shell>.sidebar{animation:panel-left 560ms 70ms var(--ease) both}.shell>.editor,.shell>.empty-paper{animation:panel-rise 560ms 120ms var(--ease) both}.shell>.chat{animation:panel-right 560ms 170ms var(--ease) both}
.local-state{display:flex;align-items:center;gap:7px;border:0!important;padding:0!important;font-size:11px}.local-state i,.live-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#4c8a68;box-shadow:0 0 0 0 #4c8a6866;animation:signal 2.2s ease-out infinite}
.tree-row:hover{transform:translateX(4px)!important}.tree-row[aria-current=page]{box-shadow:inset 3px 0 #3d755a}.tree-row[aria-expanded=true]{color:var(--ink);font-weight:600}
.paper-input{transition:transform 360ms var(--ease),box-shadow 360ms ease,border-color 360ms ease}.paper-input:focus{transform:translateY(-2px);border-color:#b9c9ba;box-shadow:0 18px 44px #4b67471c,0 0 0 4px #5c8a6820}
.composer{transition:background-color 240ms ease,box-shadow 240ms ease}.composer:focus-within{background:#fffaf0;box-shadow:0 -12px 34px #5a4d3210}.composer textarea:focus{border-color:#73917d;box-shadow:0 0 0 3px #4d7d5d17}
.chat-row,.pending-card{animation:message-in 360ms var(--ease) both}.chat-row.user{transform-origin:right bottom}.chat-row.assistant{transform-origin:left bottom}.chat-row.tool strong::after{content:'···';display:inline-block;width:1.5em;overflow:hidden;vertical-align:bottom;animation:dots 1.2s steps(4,end) infinite}
.index-status{animation:index-breathe 2.4s ease-in-out infinite}.index-status button:hover{transform:translateX(2px)}
.export-actions{position:relative;z-index:12}.export-menu{position:relative}.export-menu summary{padding:5px 10px;border:1px solid #c9c5b4;border-radius:16px;background:#fbf8ef;color:#304f41;cursor:pointer;list-style:none}.export-menu summary::-webkit-details-marker{display:none}.export-menu[open] summary{background:#dce9dd}.export-menu>div{position:absolute;z-index:13;top:calc(100% + 8px);right:0;display:grid;min-width:130px;padding:6px;border:1px solid #d8cfbd;border-radius:10px 3px 10px 10px;background:#fffdf6;box-shadow:0 16px 40px #4e42261f;animation:menu-pop 180ms var(--ease)}.export-menu>div button{border:0;background:transparent;text-align:left;padding:8px 10px;border-radius:6px}.export-menu>div button:hover{background:#e4eee1}
.chat{position:relative}.conversation-setup{position:absolute;z-index:12;top:58px;right:12px;box-sizing:border-box;width:calc(100% - 24px);display:grid;gap:16px;padding:18px;border:1px solid #d8cfbd;border-radius:18px 5px 18px 18px;background:#fffdf6f5;box-shadow:0 22px 60px #4d41262b;backdrop-filter:blur(16px);animation:conversation-in 240ms var(--ease) both}.conversation-setup header,.conversation-setup footer{display:flex;align-items:center;justify-content:space-between;gap:10px}.conversation-setup header{padding-bottom:4px}.conversation-setup header strong{font:600 22px/1.2 "Noto Serif SC","Songti SC",serif;color:#173f30}.conversation-setup label{display:block}.conversation-setup select{box-sizing:border-box;width:100%;padding:10px 12px;border:0;border-bottom:1px solid #aeb9ad;background:transparent;color:#264838}.conversation-setup footer{justify-content:flex-end}.conversation-setup footer button{padding:7px 13px;border:0;border-radius:14px 4px 14px 14px;background:#ece6d9}.conversation-setup footer .primary-action{min-width:72px;background:#285c45;color:#fff;box-shadow:0 8px 20px #285c4526}.conversation-setup footer .primary-action:hover{transform:translateY(-2px)!important;box-shadow:0 12px 26px #285c4533}
.settings-shell{position:relative;overflow:hidden;background:radial-gradient(circle at 18% 20%,#dfeadc 0 8%,transparent 28%),radial-gradient(circle at 84% 78%,#eadfc8 0 7%,transparent 25%),#f4efe3}.settings-view{position:relative;isolation:isolate}.settings-view::before,.settings-view::after{content:'';position:absolute;z-index:-1;border-radius:50%;pointer-events:none}.settings-view::before{width:280px;height:280px;left:8%;top:12%;border:1px solid #73917d55;box-shadow:inset 0 0 0 34px #dce8db55;animation:orbit-drift 9s ease-in-out infinite}.settings-view::after{width:160px;height:160px;right:10%;bottom:10%;background:#d7e5d6;filter:blur(1px);animation:blob-drift 7s ease-in-out infinite alternate}.model-panel{position:relative;width:min(660px,100%);padding:38px 42px 40px;border:0;border-radius:28px 7px 28px 7px;overflow:hidden;box-shadow:0 30px 80px #4e422621,0 0 0 1px #d8cfbd;background:#fffdf6eF;backdrop-filter:blur(18px);animation:settings-pop 560ms var(--ease) both}.model-panel::after{content:'⌁';position:absolute;right:-24px;top:-38px;color:#dce8da;font:160px/1 Georgia,serif;transform:rotate(18deg);pointer-events:none}.model-panel>*{position:relative;z-index:1}.model-panel>label,.provider-tabs{animation:field-in 420ms var(--ease) both}.model-panel>label:nth-of-type(1){animation-delay:90ms}.model-panel>label:nth-of-type(2){animation-delay:140ms}.model-panel>label:nth-of-type(3){animation-delay:190ms}.model-panel h2{font-size:42px!important;letter-spacing:-.06em!important}.model-panel header p{margin-top:3px!important}.provider-tabs label{border:0!important;border-radius:14px 4px 14px 4px!important;background:#f1ecdf!important}.provider-tabs label:has(input:checked){background:#dce9dd!important;color:#173f30!important;box-shadow:inset 0 0 0 1px #78917f;transform:translateY(-2px)}.model-panel input[type=password],.model-panel input:not([type]){border:0!important;border-bottom:1px solid #bfb8a9!important;border-radius:0!important;padding:11px 2px!important;background:transparent!important}.model-panel input:focus{box-shadow:none!important;border-color:#35684f!important}.model-panel .primary-action{min-width:104px;padding:10px 18px;border-radius:18px 5px 18px 18px!important;box-shadow:0 9px 22px #315e4826}.model-panel .primary-action:hover{transform:translateY(-3px) rotate(-1deg)!important;box-shadow:0 14px 28px #315e4833}
.brand-mark{animation:mark-arrive 620ms 120ms var(--ease) both}.brand-mark:hover{transform:rotate(7deg) scale(1.08)!important}.empty-paper-mark{display:block;color:#72927e;font-size:34px;animation:mark-float 3s ease-in-out infinite}.empty-paper h1{margin:0}.empty-paper>button{margin-inline:auto}
@keyframes bar-drop{from{opacity:0;transform:translateY(-100%)}to{opacity:1;transform:none}}@keyframes panel-left{from{opacity:0;transform:translateX(-18px)}to{opacity:1;transform:none}}@keyframes panel-right{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}@keyframes panel-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}@keyframes message-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}@keyframes menu-pop{from{opacity:0;transform:translateY(-5px) scale(.96)}to{opacity:1;transform:none}}@keyframes conversation-in{from{opacity:0;transform:translateY(-8px) scale(.96);transform-origin:top right}to{opacity:1;transform:none}}@keyframes signal{60%,100%{box-shadow:0 0 0 10px #4c8a6800}}@keyframes dots{0%{width:0}100%{width:1.5em}}@keyframes index-breathe{50%{border-left-color:#9db7a2;background:#f5f2e6}}@keyframes orbit-drift{50%{transform:translate(28px,18px) rotate(35deg)}}@keyframes blob-drift{to{transform:translate(-36px,-22px) scale(1.18);border-radius:38% 62% 54% 46%}}@keyframes settings-pop{from{opacity:0;transform:translateY(24px) rotate(.8deg) scale(.97)}to{opacity:1;transform:none}}@keyframes field-in{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}@keyframes mark-arrive{from{opacity:0;transform:rotate(-18deg) scale(.6)}to{opacity:1;transform:rotate(-2deg) scale(1)}}@keyframes mark-float{50%{transform:translateY(-7px) rotate(5deg)}}
@media(prefers-reduced-motion:reduce){.chrome,.shell>.sidebar,.shell>.editor,.shell>.empty-paper,.shell>.chat,.chat-row,.pending-card,.conversation-setup,.model-panel,.model-panel>label,.provider-tabs,.brand-mark,.empty-paper-mark,.settings-view::before,.settings-view::after,.local-state i,.live-dot,.index-status{animation:none!important}.paper-input:focus,.tree-row:hover,.icon-button:hover,.model-panel .primary-action:hover{transform:none!important}}
.shell:not(.no-session){grid-template-columns:248px minmax(0,1fr)}.chat{position:fixed;z-index:10;inset:52px 0 0 auto;width:min(404px,calc(100vw - 280px));grid-column:auto;border:1px solid #d8d0bf;border-right:0;border-bottom:0;border-radius:22px 0 0 0;box-shadow:-24px 0 64px #4d41261f;overflow:hidden}.chat-header{align-items:center}.chat-header-actions{display:flex;gap:4px}.assistant-launcher{position:fixed;z-index:9;right:24px;bottom:24px;display:flex;align-items:center;gap:9px;padding:10px 15px 10px 10px;border:1px solid #95a89a;border-radius:22px 7px 22px 22px;background:#fffdf6ef;color:#244f3c;box-shadow:0 16px 42px #4d412626;backdrop-filter:blur(14px);cursor:pointer;animation:launcher-in 420ms var(--ease) both}.assistant-launcher span{display:grid;width:28px;height:28px;place-items:center;border-radius:50%;background:#dce9dd;font-size:17px;animation:mark-float 3s ease-in-out infinite}.assistant-launcher strong{font-size:13px}.assistant-launcher:hover{transform:translateY(-5px) rotate(-1deg);box-shadow:0 22px 50px #4d412633}.model-panel>label>span,.provider-tabs legend{color:#42594c!important;font-weight:500}.model-panel input[type=password],.model-panel input:not([type]){color:#2e4438!important}.model-panel input::placeholder{color:#7d857e!important;opacity:1}@keyframes launcher-in{from{opacity:0;transform:translateY(12px) scale(.9)}to{opacity:1;transform:none}}@media(max-width:1320px){.shell:not(.no-session){grid-template-columns:216px minmax(0,1fr)}}@media(prefers-reduced-motion:reduce){.assistant-launcher,.assistant-launcher span{animation:none!important}.assistant-launcher:hover{transform:none!important}}
.model-indicator{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#647268}
.project-context-receipt{margin-top:7px;color:#637269;font-size:11px}.project-context-receipt summary{cursor:pointer}.project-context-receipt ul{display:grid;gap:3px;margin:6px 0 0;padding-left:16px}.project-context-receipt code{font-size:10px;color:#466354}
.import-overlay{position:fixed;z-index:40;inset:0;display:grid;place-items:center;padding:24px;background:#1f2d2570}.import-dialog{box-sizing:border-box;width:min(520px,100%);display:grid;gap:14px;padding:24px;border:1px solid #d8cfbd;border-radius:16px 4px 16px 4px;background:#fffdf6;box-shadow:0 28px 80px #1c28221f}.import-dialog h2,.import-dialog p{margin:0}.import-dialog ul{max-height:170px;margin:0;overflow:auto;padding-left:20px;color:#5c6e62}.import-dialog footer{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px}.import-dialog button{padding:7px 11px;border:1px solid #b9c8ba;border-radius:4px;background:#f5f1e6;color:#2c5744;cursor:pointer}
`

const homeStyles = `
.brand-lockup{display:flex;align-items:center;gap:10px}.brand-lockup>div{display:grid;line-height:1.05}.brand-lockup small{margin-top:4px;color:#728078;font-size:10px;letter-spacing:.12em}.brand-mark{display:grid;width:28px;height:28px;place-content:center;border:1px solid #6c8575;border-radius:8px 3px 8px 3px;background:#e4ecdf;color:#285640;font:600 15px/1 "Noto Serif SC","Songti SC",serif;transform:rotate(-2deg)}.local-state{padding-left:8px!important;border-left:1px solid #d7d0c1}.sidebar .side-title small{color:#889087;font-size:10px;font-weight:400}.workspace-caption{padding:14px 14px 4px;color:#7d857d;font-size:11px;letter-spacing:.08em}.workspace-empty{display:grid;justify-items:start;gap:5px;margin:18px 14px;padding:18px 14px;border:1px dashed #cfc8b8;border-radius:8px;background:#f5f0e4;color:#617066}.workspace-empty>span{color:#3f6a53;font-size:24px}.workspace-empty strong{font-size:13px}.workspace-empty small{line-height:1.6}.home-stage{display:grid;place-items:center;padding:54px;background:#f7f2e7;text-align:left}.home-card{box-sizing:border-box;width:min(650px,88%);padding:58px 62px 54px;border:1px solid #ddd3bf;border-left:4px solid #386a50;border-radius:5px 14px 5px 5px;background:#fffdf6;box-shadow:0 20px 55px #594b3214;animation:home-rise 320ms ease-out}.home-card h1{max-width:12em;margin:0 0 18px;color:#284b3a;font-size:34px;line-height:1.35;letter-spacing:-.03em}.home-card>p:not(.home-eyebrow){max-width:34em;margin:0;color:#657168;font:16px/1.9 "Noto Serif SC","Songti SC",serif}.home-eyebrow{margin:0 0 12px;color:#537263;font-size:12px;letter-spacing:.16em}.home-card>small{display:block;margin-top:22px;color:#7b827b;line-height:1.6}.home-actions{justify-content:flex-start;margin-top:28px;gap:12px}.home-actions button{min-width:116px;padding:9px 16px}.home-actions .primary-action{border-color:#315e48;background:#315e48;color:#fff}.home-actions .primary-action:hover{background:#284f3c}.empty-chat .chat-header>div{display:grid;gap:2px}.empty-chat .chat-header small{color:#7b847d;font-size:10px;letter-spacing:.08em}.chat-empty-body{display:grid;align-content:start;gap:22px;padding:28px 20px;color:#667168}.chat-empty-body p{margin:0;line-height:1.8}.chat-empty-body div{display:flex;flex-wrap:wrap;gap:8px}.chat-empty-body span{padding:5px 9px;border:1px solid #d5cebe;border-radius:3px;background:#faf6ec;color:#52705f;font-size:12px}@keyframes home-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){.home-card{animation:none}}
`

const homePlayStyles = `
.no-session{grid-template-columns:230px minmax(560px,1fr) 300px;grid-template-rows:52px minmax(0,1fr);background:#f3eddf}.no-session .chrome{background:#fffaf0cc;backdrop-filter:blur(14px)}.no-session .empty-paper{height:auto}.brand-lockup{gap:9px}.brand-lockup>strong{font-size:18px;letter-spacing:-.04em}.brand-mark{width:30px;height:30px;border:0;border-radius:50% 50% 50% 12%;background:#234f3b;color:#fff;font:700 13px/1 Georgia,serif;box-shadow:0 7px 18px #234f3b33}.sidebar .side-title{padding:16px 18px 12px;border:0}.workspace-caption{padding:12px 18px 5px}.workspace-empty{justify-items:center;gap:10px;margin:30px 18px;padding:22px 8px;border:0;background:transparent;color:#7e877f}.folder-glyph{position:relative;width:42px;height:30px;border:1px solid #a9b4aa;border-radius:4px 10px 7px 7px;background:#f8f3e8;transform:rotate(-3deg);animation:folder-wiggle 5s ease-in-out infinite}.folder-glyph::before{content:'';position:absolute;left:4px;top:-7px;width:17px;height:8px;border:1px solid #a9b4aa;border-bottom:0;border-radius:5px 5px 0 0;background:#f8f3e8}.home-stage{position:relative;isolation:isolate;display:grid;grid-template-columns:minmax(260px,.85fr) minmax(260px,.72fr);align-items:center;justify-content:center;gap:clamp(32px,6vw,90px);overflow:hidden;padding:clamp(40px,7vw,96px);background:radial-gradient(circle at 65% 46%,#fffaf0 0 16%,transparent 42%),#f7f2e7;text-align:left}.home-ink{position:absolute;z-index:-1;left:4%;bottom:-18%;color:#1f503b;font:700 clamp(360px,40vw,640px)/.8 "Noto Serif SC","Songti SC",serif;opacity:.035;animation:ink-drift 12s ease-in-out infinite alternate}.home-card{width:auto;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;animation:copy-arrive 620ms 180ms var(--ease) both}.home-card h1{max-width:none;margin:2px 0 34px;color:#173f30;font-size:clamp(58px,6vw,86px);line-height:.98;letter-spacing:-.09em;text-wrap:balance}.home-eyebrow{margin:0 0 16px;color:#60806d;font:600 11px/1.2 ui-monospace,"SFMono-Regular",Consolas,monospace;letter-spacing:.24em}.home-actions{justify-content:flex-start;margin:0;gap:12px}.home-actions button{min-width:auto;padding:11px 18px;border:0;border-radius:18px 6px 18px 18px;background:#e5dfd2}.home-actions button:hover{transform:translateY(-4px) rotate(1deg)!important;box-shadow:0 12px 24px #4c3e2517}.home-actions .primary-action{display:flex;align-items:center;gap:18px;padding-left:20px;border:0;background:#244f3c;color:#fff;box-shadow:0 10px 28px #244f3c2b}.home-actions .primary-action span{transition:transform 220ms var(--ease)}.home-actions .primary-action:hover span{transform:translate(3px,-3px)}.paper-motion{position:relative;width:min(30vw,330px);aspect-ratio:.78;justify-self:center;perspective:900px;animation:paper-hover 5.8s ease-in-out infinite}.paper-sheet{position:absolute;inset:0;border:1px solid #ded4bf;background:#fffdf6;box-shadow:0 28px 56px #55472c1b}.sheet-back{transform:translate(25px,17px) rotate(8deg);border-radius:6px 18px 6px 6px;background:#e5eadc}.sheet-mid{transform:translate(10px,8px) rotate(3deg);border-radius:7px 16px 7px 7px;background:#f1e9d7}.sheet-front{display:grid;align-content:start;gap:18px;box-sizing:border-box;padding:27% 17%;border-radius:8px 24px 8px 8px;transform:rotate(-2deg);transition:transform 450ms var(--ease),box-shadow 450ms ease}.paper-motion:hover .sheet-front{transform:translateY(-9px) rotate(-4deg);box-shadow:0 38px 70px #55472c28}.sheet-front span{height:3px;border-radius:3px;background:#86a18f;transform:scaleX(0);transform-origin:left;animation:line-write 4.6s var(--ease) infinite}.sheet-front span:nth-child(2){width:82%;animation-delay:.22s}.sheet-front span:nth-child(3){width:58%;animation-delay:.44s}.sheet-front b{width:2px;height:22px;margin-top:4px;background:#315e48;animation:cursor-blink .9s steps(1) infinite}.home-stage>.warning{position:absolute;left:50%;bottom:34px;transform:translateX(-50%);margin:0}.empty-chat .chat-header{align-items:center}.chat-empty-body{place-items:center;align-content:center;gap:20px;padding:28px}.chat-empty-body>small{color:#809087;font-size:11px;letter-spacing:.14em}.agent-orb{position:relative;display:grid;width:110px;height:110px;place-items:center;border:1px solid #8ca090;border-radius:45% 55% 52% 48%;color:#315e48;font-size:30px;animation:orb-morph 7s ease-in-out infinite}.agent-orb::before,.agent-orb::after{content:'';position:absolute;border-radius:50%}.agent-orb::before{inset:12px;border:1px dashed #9daf9f;animation:orb-spin 12s linear infinite}.agent-orb::after{width:9px;height:9px;right:5px;top:24px;background:#4e8867;box-shadow:0 0 0 6px #4e88671a}.agent-orb span{animation:mark-float 3s ease-in-out infinite}
@keyframes copy-arrive{from{opacity:0;transform:translateX(-22px)}to{opacity:1;transform:none}}@keyframes ink-drift{to{transform:translate(5%,3%) rotate(-3deg)}}@keyframes paper-hover{50%{transform:translateY(-12px) rotate(.8deg)}}@keyframes line-write{0%,10%{transform:scaleX(0);opacity:.3}32%,76%{transform:scaleX(1);opacity:1}94%,100%{transform:scaleX(1);opacity:0}}@keyframes cursor-blink{50%{opacity:0}}@keyframes folder-wiggle{50%{transform:translateY(-4px) rotate(2deg)}}@keyframes orb-spin{to{transform:rotate(360deg)}}@keyframes orb-morph{0%,100%{border-radius:45% 55% 52% 48%;transform:rotate(-2deg)}50%{border-radius:56% 44% 42% 58%;transform:translateY(-8px) rotate(3deg)}}
@media(max-width:1180px){.no-session{grid-template-columns:210px minmax(480px,1fr) 250px}.home-stage{gap:28px;padding:48px}.home-card h1{font-size:58px}.paper-motion{width:250px}}@media(prefers-reduced-motion:reduce){.folder-glyph,.home-ink,.home-card,.paper-motion,.sheet-front span,.sheet-front b,.agent-orb,.agent-orb::before,.agent-orb span{animation:none!important}.sheet-front span{transform:scaleX(1);opacity:1}}
.no-session{grid-template-columns:230px minmax(560px,1fr)}@media(max-width:1180px){.no-session{grid-template-columns:210px minmax(480px,1fr)}}
.path-fallback{display:grid;gap:10px;margin-top:18px}.path-fallback label{display:grid;gap:6px;color:#52695b;font-size:12px}.path-fallback input{box-sizing:border-box;width:min(520px,100%);padding:10px 12px;border:1px solid #b9c3b8;border-radius:4px;background:#fffdf7;color:#253b32}.path-fallback>div{display:flex;gap:8px}.path-fallback button{padding:8px 13px;border:0;border-radius:14px 4px 14px 14px;background:#e5dfd2;color:#2c5744}.path-fallback .primary-action{background:#244f3c;color:#fff}.home-card>.warning{max-width:36em;margin:12px 0 0;font-size:13px}
`

export function apply(ctx: Context): void {
  const client = ctx as ShellContext
  registerRoot(client, () => e(Root, { ctx: client }))
}
