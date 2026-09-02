import {
  createElement as e,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import type {
  ConversationSnapshot,
  PendingInteraction,
  SessionFace,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  SessionId,
  SessionModels,
  WorkspaceId,
} from '@deepseek-ai/dsh-client-connection/client'
import {
  WORKBENCH_RPC_CHANNEL,
  type ProjectContextReceiptBundle,
} from 'dsh-editor-workbench/contracts'
import type { ProposalMarker } from 'dsh-editor-novel-kernel/contracts'
import {
  answerApproval,
  answerQuestions,
  chatRows,
  internalIndexTurnActive,
  loadOlder,
  partialText,
  readModels,
  selectModel,
  sendProjectContext,
  stop,
  visibleRunningCalls,
  type QuestionAnswerItem,
} from '../adapter.ts'
import { ConversationRenameQueue, conversationRows, nextAutomaticConversationTitle, shouldConfirmConversationSwitch } from '../conversation-lifecycle.ts'
import { DeepSeekWhaleMark, useObservable } from './components.ts'
import { ConfirmDialog, TextPromptDialog } from './dialogs.ts'
import { Select } from './select.tsx'
import {
  canSubmitComposer,
  safeRpcCall,
  shouldSubmitComposer,
  type RpcResult,
  type ShellContext,
} from './shared.ts'

const conversationRenameQueue = new ConversationRenameQueue()

export function ModelIndicator({ ctx, session, onConfigure }: { ctx: ShellContext; session: SessionFace; onConfigure(): void }) {
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
      e('span', null, note || (models ? '暂无可用模型' : '读取中…')),
      e('button', { type: 'button', onClick: () => void refresh() }, '重试'),
      e('button', { type: 'button', onClick: onConfigure }, '设置接口'),
    )
  }
  return e('div', { className: 'compact-control' },
    e('span', { className: 'model-indicator', title: '本次对话使用的模型' }, current ? `${current.providerName} · ${current.model.name}` : models.current.model),
  )
}

export function NewConversationPicker(props: {
  ctx: ShellContext
  session: SessionFace
  workspaceId?: WorkspaceId
  canStart(): Promise<boolean>
  onOpen(sessionId: SessionId): void
  onClose(): void
  onConfigure(): void
}) {
  const { ctx, session, workspaceId, canStart, onOpen, onClose, onConfigure } = props
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
    if (!(await canStart())) { setBusy(false); return }
    try {
      const sessionId = await ctx.workspaces.connectWorkspace(workspaceId)
      const selected = await selectModel(ctx.connection, sessionId, provider, model)
      if (!selected.ok) throw new Error(selected.error.message)
      onOpen(sessionId)
      onClose()
    } catch {
      setNote('新对话未能建立，请重试。')
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
      e('button', { className: 'primary-action', type: 'submit', disabled: busy || !workspaceId || !value }, busy ? '创建中…' : '开始'),
    ),
  )
}

export function PendingCard({ item }: { item: PendingInteraction }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  if (item.kind === 'approval') {
    const decide = (outcome: 'allowed-once' | 'rejected') => {
      setBusy(true)
      void answerApproval(item, outcome).then((receipt) => {
        if (!receipt.accepted) setNote('这项操作状态已变化，请重新发起。')
      }).catch(() => setNote('提交未能完成，请重试。')).finally(() => setBusy(false))
    }
    return e('article', { className: 'pending-card', 'aria-label': '工具审批' },
      e('strong', null, '需要授权'),
      e('p', null, '允许搭档执行这一步操作？'),
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
    }).catch(() => setNote('提交未能完成，请重试。')).finally(() => setBusy(false))
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

export function ProposalCard(props: { ctx: ShellContext; sessionId: string; proposal: ProposalMarker; onApplied(path: string): void }) {
  const [prepared, setPrepared] = useState<{ version?: string; before?: string; after?: string; text?: string } | null>(null)
  const [appliedVersion, setAppliedVersion] = useState('')
  const [undoText, setUndoText] = useState('')
  const [state, setState] = useState<'checking' | 'ready' | 'applying' | 'applied' | 'deferred' | 'ignored' | 'undoing' | 'undone' | 'expired'>('checking')
  const [note, setNote] = useState('正在核对文件…')
  const requestGeneration = useRef(0)

  const check = async () => {
    const generation = ++requestGeneration.current
    setAppliedVersion('')
    setUndoText('')
    setState('checking'); setNote('正在核对文件…')
    const raw = await props.ctx.connection.rpc.call('/manuscript', 'proposal.prepare', {
      sessionId: props.sessionId,
      ...props.proposal,
    })
    if (requestGeneration.current !== generation) return
    const result = raw as RpcResult<{ version?: string; before?: string; after?: string; text?: string }>
    if (!result.ok) { setState('expired'); setNote('文件已变化，未写入任何内容；请让写作助手重新生成建议。'); return }
    setPrepared(result.value); setState('ready'); setNote('可以安全应用')
  }

  useEffect(() => {
    void check()
    return () => { requestGeneration.current += 1 }
  }, [props.sessionId, props.proposal.path, props.proposal.summary, props.proposal.oldText, props.proposal.newText, props.proposal.text])

  const apply = async () => {
    if (!prepared) return
    const generation = ++requestGeneration.current
    setState('applying'); setNote('正在应用…')
    let beforeApplyText = ''
    if (props.proposal.kind === 'edit') {
      const read = await props.ctx.connection.rpc.call('/manuscript', 'file.read', {
        sessionId: props.sessionId,
        path: props.proposal.path,
      }) as RpcResult<{ text: string; version: string }>
      if (requestGeneration.current !== generation) return
      if (!read.ok || !prepared.version || read.value.version !== prepared.version) {
        setState('expired'); setNote('文件已变化，未写入任何内容；请让写作助手重新生成建议。')
        return
      }
      beforeApplyText = read.value.text
    }
    const result = await props.ctx.connection.rpc.call('/manuscript', 'proposal.apply', {
      sessionId: props.sessionId,
      ...props.proposal,
      expectedVersion: prepared.version ?? '',
    }) as RpcResult<{ path: string; version: string }>
    if (requestGeneration.current !== generation) return
    if (!result.ok) { setState('expired'); setNote('文件已变化，未写入任何内容；请让写作助手重新生成建议。'); return }
    setAppliedVersion(result.value.version)
    setUndoText(beforeApplyText)
    setState('applied'); setNote('已应用到作品')
    props.onApplied(result.value.path)
  }

  const undo = async () => {
    if (props.proposal.kind !== 'edit' || !appliedVersion || !undoText) return
    const generation = ++requestGeneration.current
    setState('undoing'); setNote('正在撤销…')
    const result = await props.ctx.connection.rpc.call('/manuscript', 'file.write', {
      sessionId: props.sessionId,
      path: props.proposal.path,
      text: undoText,
      version: appliedVersion,
    }) as RpcResult<{ version: string }>
    if (requestGeneration.current !== generation) return
    if (!result.ok) {
      setState('expired')
      setNote('文件此后又有变化，无法自动撤销；未写入任何内容。')
      return
    }
    setAppliedVersion(result.value.version)
    setState('undone'); setNote('已撤销，作品已恢复到应用前的内容')
    props.onApplied(props.proposal.path)
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
      state === 'ready' ? e('button', { type: 'button', onClick: () => { setState('deferred'); setNote('已留待稍后处理') } }, '稍后处理') : null,
      state === 'ready' ? e('button', { type: 'button', onClick: () => { setState('ignored'); setNote('已忽略，未修改作品') } }, '忽略') : null,
      state === 'deferred' ? e('button', { type: 'button', onClick: () => void check() }, '重新核对') : null,
      state === 'applied' && props.proposal.kind === 'edit' ? e('button', { type: 'button', onClick: () => void undo() }, '撤销此次修改') : null,
    ),
    state === 'ready' ? e('small', { className: 'proposal-help' }, '应用后才会写入作品。') : null,
  )
}

export function ProjectContextReceiptView({ receipt }: { receipt: ProjectContextReceiptBundle }) {
  const fixed = receipt.sources.filter((item) => item.kind !== 'worldbook')
  const includedFixed = fixed.filter((item) => item.status === 'included' && item.includedChars > 0).length
  const worldbook = receipt.sources.filter((item) => item.kind === 'worldbook')
  const matchedByText = (value: string | undefined) => value === 'both' ? '请求与当前文档' : value === 'saved-document' ? '当前文档' : '本次请求'
  return e('details', { className: 'project-context-receipt' },
    e('summary', null, `项目上下文：固定 ${includedFixed}/${fixed.length}，触发世界书 ${worldbook.length}${receipt.authorPreferencesChars ? `，作者约定 ${receipt.authorPreferencesChars} 字` : ''}`),
    e('ul', null, receipt.sources.map((item) => e('li', { key: item.path },
      e('code', null, item.path),
      ` · ${item.status === 'included'
        ? item.includedChars > 0 ? `纳入 ${item.includedChars} 字符` : item.truncated ? '未纳入（已达总量上限）' : '空文件'
        : item.status === 'missing' ? '未找到' : '读取失败'}`,
      item.truncated ? '（已截断）' : '',
      item.kind === 'worldbook' ? ` · 优先级 ${item.priority ?? 0} · 匹配：${matchedByText(item.matchedBy)}${item.matchedTriggers?.length ? `（${item.matchedTriggers.join('、')}）` : ''}` : '',
      item.version ? ` · ${item.version}` : '',
    ))),
    receipt.scan ? e('p', { className: 'muted' }, `世界书扫描 ${receipt.scan.scanned} 份：未匹配 ${receipt.scan.unmatched}，已停用 ${receipt.scan.disabled}，格式无效 ${receipt.scan.invalid}，超过限制 ${receipt.scan.limits}，读取失败 ${receipt.scan.readErrors}`) : null,
  )
}

export function Chat({ ctx, session, workspaceId, activePath, authorPreferences, hidden, onClose, onConfigure, onApplied, onDraftDirtyChange }: { ctx: ShellContext; session: SessionFace; workspaceId?: WorkspaceId; activePath?: string; authorPreferences: string; hidden: boolean; onClose(): void; onConfigure(): void; onApplied(path: string): void; onDraftDirtyChange(dirty: boolean): void }) {
  const snapshot = useObservable<ConversationSnapshot>(session)
  const sessionList = useObservable(ctx.sessions.list)
  const workspaceList = useObservable(ctx.workspaces.list)
  const connected = useObservable(ctx.connection.hostDescription)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const [outgoing, setOutgoing] = useState<{ text: string; state: 'sending' | 'accepted' | 'failed'; afterRows: number; projectContextReceipt?: ProjectContextReceiptBundle } | null>(null)
  const [creatingConversation, setCreatingConversation] = useState(false)
  const [renamingConversation, setRenamingConversation] = useState(false)
  const [draftConfirm, setDraftConfirm] = useState<{ resolve(value: boolean): void } | null>(null)
  const [modelRevision, setModelRevision] = useState(0)
  const titleAttempted = useRef(new Set<string>())
  const internalIndexActive = internalIndexTurnActive(snapshot)
  const partial = internalIndexActive ? '' : partialText(snapshot)
  const rows = chatRows(snapshot)
  const hasTurnError = rows.some((row) => row.id.startsWith('turn-error:'))
  const workspace = workspaceList.items.find((item) => item.workspaceId === workspaceId)
  const sessionIds = sessionList.ids.filter((id) => workspace?.sessionIds.includes(id))
  const conversations = conversationRows({
    workspaceSessionIds: sessionIds.length ? sessionIds : [session.sessionId],
    archivedIds: workspaceList.archivedSessionIds,
    reusableBlankIds: Object.values(sessionList.byId ?? {}).filter((item) => item.blank).map((item) => item.id),
    currentId: session.sessionId,
    titles: Object.fromEntries(Object.entries(sessionList.byId ?? {}).map(([id, value]) => [id, value.displayTitle])),
  })
  const queueConversationRename = (title: string, failureNote: string) => {
    void conversationRenameQueue.enqueue(session.sessionId, async () => {
      try {
        const result = await session.rename(title)
        if (!result.ok) setNote(failureNote)
      } catch {
        setNote(failureNote)
      }
    })
  }
  useEffect(() => {
    const currentTitle = sessionList.byId?.[session.sessionId]?.title?.trim()
    const title = nextAutomaticConversationTitle({
      durableTitle: currentTitle,
      assistantReplies: rows.filter((row) => row.role === 'assistant').map((row) => row.text),
      attempted: titleAttempted.current.has(session.sessionId),
    })
    if (!title) return
    titleAttempted.current.add(session.sessionId)
    queueConversationRename(title, '对话名称未能自动保存，可手动重命名。')
  }, [rows, session.sessionId, sessionList.byId])
  useEffect(() => { onDraftDirtyChange(Boolean(draft.trim())) }, [draft, onDraftDirtyChange])
  useEffect(() => () => draftConfirm?.resolve(false), [draftConfirm])
  const canDiscardDraft = async (nextId: string): Promise<boolean> => {
    if (!shouldConfirmConversationSwitch(draft, nextId, session.sessionId)) return true
    return await new Promise<boolean>((resolve) => setDraftConfirm({ resolve }))
  }
  const resolveDraftConfirm = (value: boolean) => {
    draftConfirm?.resolve(value)
    setDraftConfirm(null)
  }
  const openConversation = (nextId: SessionId) => {
    setDraft(''); setNote(''); setOutgoing(null); onDraftDirtyChange(false); ctx.sessions.open(nextId)
    setModelRevision((value) => value + 1)
  }
  const switchConversation = async (nextId: string) => {
    if (!(await canDiscardDraft(nextId))) return
    openConversation(nextId as SessionId)
  }
  const renameConversation = (title: string) => {
    setRenamingConversation(false)
    titleAttempted.current.add(session.sessionId)
    setNote('')
    queueConversationRename(title, '对话名称未能保存，请重试。')
  }
  const outgoingIsCanonical = Boolean(outgoing && rows.slice(outgoing.afterRows)
    .some((row) => row.role === 'user' && row.text.trim() === outgoing.text))
  const composerCanSubmit = canSubmitComposer({
    draft,
    connected: Boolean(connected),
    removed: snapshot.removed,
    outgoingState: outgoing?.state,
  })
  const showGuide = rows.length === 0 && !outgoing && (!snapshot.running || internalIndexActive) && !partial && snapshot.pending.length === 0
  useEffect(() => {
    if (outgoingIsCanonical) setOutgoing(null)
  }, [outgoingIsCanonical])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!composerCanSubmit) return
    const value = draft.trim()
    setOutgoing({ text: value, state: 'sending', afterRows: rows.length })
    setDraft('')
    setNote('')
    let contextCompileFailed = false
    void sendProjectContext(session, value, async () => {
      const compiled = await safeRpcCall<{ serialized: string; receipt: ProjectContextReceiptBundle }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'context.compile', { sessionId: session.sessionId, userRequest: value, activePath, authorPreferences }))
      if (!compiled.ok) { contextCompileFailed = true; throw new Error('context unavailable') }
      return { serialized: compiled.value.serialized, receipt: compiled.value.receipt }
    }).then((outcome) => {
      const result = outcome?.result
      if (outcome) setOutgoing((current) => current?.text === value ? { ...current, projectContextReceipt: outcome.receipt } : current)
      if (!result || !result.ok) {
        setOutgoing((current) => current?.text === value ? { ...current, state: 'failed' } : current)
        setNote('消息未发送成功，请重试。')
        return
      }
      setOutgoing((current) => current?.text === value ? { ...current, state: 'accepted' } : current)
    }).catch(() => {
      setOutgoing((current) => current?.text === value ? { ...current, state: 'failed' } : current)
      if (contextCompileFailed) {
        setDraft((current) => current || value)
        setNote('项目资料暂时无法整理，消息未发送。内容已保留，请重试。')
      } else setNote('消息未发送成功，请重试。')
    })
  }
  return e('aside', { className: 'chat', 'aria-label': '写作助手', hidden },
    e('header', { className: 'chat-header' },
      e('strong', { className: 'chat-brand' }, e(DeepSeekWhaleMark), connected ? '搭档' : '重连中'),
      e('label', { className: 'conversation-select' }, e('span', null, '会话'), e(Select, { value: session.sessionId, 'aria-label': '切换对话', options: conversations.map((item) => ({ value: item.id, label: item.title })), onChange: (next) => void switchConversation(next) })),
      e('div', { className: 'chat-controls' }, e(ModelIndicator, { key: `${session.sessionId}:${modelRevision}`, ctx, session, onConfigure })),
      e('div', { className: 'chat-header-actions' },
        e('button', { className: 'icon-button', type: 'button', title: '新对话', 'aria-label': '新对话', onClick: () => setCreatingConversation(true) }, '＋'),
        e('button', { className: 'icon-button', type: 'button', title: '重命名对话', 'aria-label': '重命名对话', onClick: () => setRenamingConversation(true) }, '✎'),
        e('button', { className: 'icon-button', type: 'button', title: '收起搭档', 'aria-label': '收起搭档', onClick: onClose }, '×'),
      ),
    ),
    creatingConversation ? e(NewConversationPicker, {
      ctx,
      session,
      workspaceId,
      canStart: () => canDiscardDraft('__new-conversation__'),
      onOpen: openConversation,
      onClose: () => setCreatingConversation(false),
      onConfigure,
    }) : null,
    e('div', { className: 'chat-history' },
      showGuide ? e('section', { className: 'chat-guide', 'aria-label': '写作搭档功能说明' },
        e('header', null,
          e('strong', null, '从构思到正文'),
          e('small', null, '搭档会读取项目总览、总纲、人物卡与世界书；所有文件修改都会先成为提案。'),
        ),
      ) : null,
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
      (internalIndexActive ? [] : visibleRunningCalls(snapshot.runningCalls)).map((call) => e('article', { className: 'chat-row tool', key: `running:${call.callId}` }, e('strong', null,
        call.name === 'glob' || call.name === 'grep' ? '正在查找作品资料…' : call.name === 'read' ? '正在阅读作品资料…' : call.name === 'novel_propose' ? '正在准备修改建议…' : '正在处理…'
      ))),
      (internalIndexActive ? [] : snapshot.queue).map((item) => e('article', { className: 'chat-row notice', key: `queue:${item.id}` }, e('p', null, item.preview), e('small', null, item.placement === 'queued' ? '已排队' : '正在转向'))),
      partial ? e('article', { className: 'chat-row assistant', 'aria-live': 'polite' }, e('p', null, partial)) : snapshot.partial ? e('article', { className: 'chat-row assistant', 'aria-live': 'polite' }, '正在回复…') : null,
      snapshot.pending.map((item) => e(PendingCard, { key: item.key, item })),
      snapshot.openState === 'error' ? e('p', { className: 'warning' }, '连接暂时中断，正在恢复…') : null,
      snapshot.promptError && !internalIndexActive && !hasTurnError ? e('p', { className: 'warning' }, '写作助手未能完成这次请求，请重试。') : null,
    ),
    e('form', { className: 'composer', onSubmit: submit },
      e('textarea', {
        value: draft,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value),
        onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (!shouldSubmitComposer({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) return
          event.preventDefault()
          event.currentTarget.form?.requestSubmit()
        },
        placeholder: '问剧情、审一段、对质人物……',
        'aria-label': '输入消息',
      }),
      note ? e('small', { className: 'warning' }, note) : null,
      e('div', null,
        snapshot.running ? e('button', { type: 'button', onClick: () => void stop(session) }, '停止') : null,
        e('button', {
          type: 'submit',
          disabled: !composerCanSubmit,
        }, '发送'),
      ),
    ),
    renamingConversation ? e(TextPromptDialog, {
      id: 'rename-conversation',
      title: '重命名对话',
      label: '对话名称',
      initialValue: sessionList.byId?.[session.sessionId]?.title ?? '',
      confirmLabel: '保存名称',
      onCancel: () => setRenamingConversation(false),
      onConfirm: renameConversation,
    }) : null,
    draftConfirm ? e(ConfirmDialog, {
      id: 'discard-message-draft',
      title: '放弃未发送的消息？',
      message: '这段文字不会带到另一个对话，也不会自动保存。',
      confirmLabel: '放弃并继续',
      onCancel: () => resolveDraftConfirm(false),
      onConfirm: () => resolveDraftConfirm(true),
    }) : null,
  )
}
