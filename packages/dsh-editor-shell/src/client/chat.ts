import {
  createElement as e,
  useEffect,
  useMemo,
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
  type ProjectInspectionResponse,
} from 'dsh-editor-workbench/contracts'
import type { AuthorMemoryMarker, ProposalMarker } from 'dsh-editor-novel-kernel/contracts'
import {
  buildInterviewPrompt,
  decodeInitSettings,
  INIT_SETTINGS_NAMESPACE,
  initGuideState,
  shouldAutoIndexAfterInterview,
  startExploreInit,
} from '../init-guide.ts'
import {
  answerApproval,
  answerQuestions,
  chatRows,
  internalIndexTurnActive,
  loadOlder,
  partialView,
  readModels,
  selectModel,
  send,
  sendProjectContext,
  stop,
  visibleRunningCalls,
  type QuestionAnswerItem,
} from '../adapter.ts'
import { ConversationRenameQueue, conversationRows, nextAutomaticConversationTitle, shouldConfirmConversationSwitch } from '../conversation-lifecycle.ts'
import { useObservable } from './components.ts'
import { Markdown } from './markdown.tsx'
import { ConfirmDialog, TextPromptDialog } from './dialogs.ts'
import { Select } from './select.tsx'
import {
  canSubmitComposer,
  partialApplyDetails,
  safeRpcCall,
  shouldSubmitComposer,
  type RpcResult,
  type ShellContext,
} from './shared.ts'
import { STANDARD_REASONING_EFFORTS } from './settings-models-store.ts'

const conversationRenameQueue = new ConversationRenameQueue()

/*
 * 约定俗成的思考强度档位展示名。自定义提供方(llm-pi-ai 手工声明)的模型
 * 在目录里不带推理元数据时,强度下拉先用这套档位渲染;首次选择时把同一套
 * 档位补写进该模型的 settings 声明,之后目录自己提供档位。host 在派发前
 * 校验档位,不声明直接传会被拒,所以必须先补声明。
 */
const FALLBACK_EFFORT_OPTIONS = Object.keys(STANDARD_REASONING_EFFORTS).map((id) => ({
  value: id,
  label: id === 'xhigh' ? 'Xhigh' : id[0].toUpperCase() + id.slice(1),
}))

/* 自定义模型未显式选过强度时的默认档:写真实的选择,而不是只显示一个值。 */
const DEFAULT_FALLBACK_EFFORT = 'medium'

/** Read the hand-declared pi-ai provider profile for `provider`, when the route is one. */
function piAiCustomProfile(ctx: ShellContext, provider: string): { profile: Record<string, unknown>; revision: number } | undefined {
  const ns = ctx.settingsScope.describe().getSnapshot().view?.namespaces.find((entry) => entry.ns === 'llm-pi-ai')
  const user = ns?.user
  const providers = typeof user === 'object' && user !== null && !Array.isArray(user)
    ? (user as Record<string, unknown>)['providers'] : undefined
  const profile = typeof providers === 'object' && providers !== null && !Array.isArray(providers)
    ? (providers as Record<string, unknown>)[provider] : undefined
  return typeof profile === 'object' && profile !== null && !Array.isArray(profile) && ns
    ? { profile: profile as Record<string, unknown>, revision: ns.revision }
    : undefined
}

export function ModelPicker({ ctx, session, onConfigure }: { ctx: ShellContext; session: SessionFace; onConfigure(): void }) {
  const [models, setModels] = useState<SessionModels | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [customRoute, setCustomRoute] = useState(false)
  const refresh = async () => {
    const result = await readModels(ctx.connection, session.sessionId)
    if (!result.ok) { setNote('接口不可用'); return }
    await ctx.settingsScope.describe().ensure()
    setModels(result.value)
    setCustomRoute(piAiCustomProfile(ctx, result.value.current.provider) !== undefined)
    setNote('')
  }
  useEffect(() => { setModels(null); void refresh() }, [session.sessionId])
  /* 首次给无元数据的自定义模型选强度:把约定六档写进它的模型声明。 */
  const declareEfforts = async (): Promise<boolean> => {
    if (!models) return false
    const found = piAiCustomProfile(ctx, models.current.provider)
    if (!found) return false
    const list = found.profile['models']
    if (!Array.isArray(list)) return false
    const index = list.findIndex((entry) =>
      typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>)['id'] === models.current.model)
    if (index < 0) return false
    const entry = list[index] as Record<string, unknown>
    if (typeof entry['reasoningEfforts'] === 'object' && entry['reasoningEfforts'] !== null) return true
    const nextModels = list.map((item, at) => at === index ? { ...(item as Record<string, unknown>), reasoningEfforts: { ...STANDARD_REASONING_EFFORTS } } : item)
    const response = await ctx.connection.api.settings.mutate({
      ns: 'llm-pi-ai',
      ops: [{ op: 'set', path: ['providers', models.current.provider, 'models'], value: nextModels }],
      expectedRevision: found.revision,
    })
    return (response.result as RpcResult<unknown>).ok
  }
  const choose = async (provider: string, model: string, reasoningEffort?: string) => {
    if (!models || busy) return
    setBusy(true); setNote('')
    if (reasoningEffort !== undefined) {
      const declared = (models.groups.find((group) => group.id === provider)?.models
        .find((item) => item.id === model)?.reasoning?.efforts.length ?? 0) > 0
      if (!declared && !(await declareEfforts())) {
        setNote('未能为该模型启用思考强度，请重试。')
        setBusy(false)
        return
      }
    }
    const result = await selectModel(ctx.connection, session.sessionId, provider, model, reasoningEffort)
    if (!result.ok) setNote('模型切换未能完成，请重试。')
    await refresh()
    setBusy(false)
  }
  /*
   * 自定义模型还没选过强度时,自动落一个真实的中档默认:先补声明(幂等),
   * 再选 medium。只显示占位符会让"当前强度"无答案,也不符合端点默认即
   * medium 的常识。每个会话+模型只尝试一次,失败就只留提示不纠缠。
   */
  const autoDefaultAttempted = useRef('')
  useEffect(() => {
    if (!models || !customRoute || busy || models.current.reasoningEffort) return
    const catalogModel = models.groups.find((group) => group.id === models.current.provider)?.models
      .find((item) => item.id === models.current.model)
    if ((catalogModel?.reasoning?.efforts.length ?? 0) > 0) return
    const key = `${session.sessionId}:${models.current.provider}:${models.current.model}`
    if (autoDefaultAttempted.current === key) return
    autoDefaultAttempted.current = key
    void (async () => {
      if (!(await declareEfforts())) return
      await selectModel(ctx.connection, session.sessionId, models.current.provider, models.current.model, DEFAULT_FALLBACK_EFFORT)
      await refresh()
    })()
  }, [models, customRoute, busy])
  if (!models || models.groups.length === 0) {
    return e('div', { className: 'compact-control model-empty' },
      e('span', null, note || (models ? '暂无可用模型' : '读取中…')),
      e('button', { type: 'button', onClick: () => void refresh() }, '重试'),
      e('button', { type: 'button', onClick: onConfigure }, '设置接口'),
    )
  }
  const options = models.groups.flatMap((group) => group.models.map((model) => ({
    value: `${group.id} ${model.id}`,
    label: `${group.name} · ${model.name}`,
  })))
  const currentValue = `${models.current.provider} ${models.current.model}`
  const currentCatalogModel = models.groups
    .find((group) => group.id === models.current.provider)?.models
    .find((model) => model.id === models.current.model)
  const efforts = currentCatalogModel?.reasoning?.efforts ?? []
  const effortValue = models.current.reasoningEffort ?? currentCatalogModel?.reasoning?.defaultEffort ?? ''
  const effortOptions = efforts.length > 0
    ? efforts.map((effort) => ({ value: effort.id, label: effort.name }))
    : FALLBACK_EFFORT_OPTIONS
  return e('div', { className: 'compact-control model-picker' },
    e(Select, {
      value: options.some((option) => option.value === currentValue) ? currentValue : '',
      placeholder: models.current.model,
      'aria-label': '选择模型',
      disabled: busy,
      options,
      onChange: (next) => {
        const [provider, model] = next.split(' ')
        if (provider && model) void choose(provider, model)
      },
    }),
    efforts.length > 0 || customRoute ? e(Select, {
      value: effortValue,
      placeholder: '思考强度',
      'aria-label': '思考强度',
      disabled: busy,
      options: effortOptions,
      onChange: (effort) => void choose(models.current.provider, models.current.model, effort),
    }) : null,
    note ? e('small', { className: 'warning', role: 'alert' }, note) : null,
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

/**
 * workbench /dsh-editor-workbench 通道的 proposal.prepare/apply 在不同 kind 下的响应体。
 * 与内核 ProposalMarker 保持对齐:edit/create 走 /manuscript 通道,这里只描述 split/merge/renames。
 */
type WorkbenchProposalPrepared =
  | { kind: 'split'; version: string; before: string; after: string; headChars: number; tailChars: number }
  | { kind: 'merge'; versions: { path: string; sourcePath: string }; pathChars: number; sourceChars: number }
  | { kind: 'renames'; versions: Record<string, string>; entries: Array<{ from: string; to: string }> }

/** 提案 prepare 之后保存下来的所有状态,kind 一一对应。edit/create 保留 /manuscript 旧字段。 */
type ProposalPrepared =
  | { kind: 'edit'; version: string; before: string; after: string }
  | { kind: 'create'; applicable: true }
  | WorkbenchProposalPrepared

type ProposalApplyResult =
  | { kind: 'edit' | 'create'; path: string; version: string }
  | { applied: string[]; failed?: { from: string; reason: string } }

/** 从 prepare 响应里抽取 expectedVersions:apply 阶段原子地校验所有参与文件的版本。key 一律是真实文件路径（workbench 端按路径查找）。 */
export function buildExpectedVersions(proposal: ProposalMarker, prepared: ProposalPrepared): Record<string, string> | undefined {
  if (proposal.kind === 'split' && prepared.kind === 'split') return { [proposal.path]: prepared.version }
  if (proposal.kind === 'merge' && prepared.kind === 'merge') return { [proposal.path]: prepared.versions.path, [proposal.sourcePath]: prepared.versions.sourcePath }
  if (proposal.kind === 'renames' && prepared.kind === 'renames') return { ...prepared.versions }
  return undefined
}

export function ProposalCard(props: { ctx: ShellContext; sessionId: string; proposal: ProposalMarker; onApplied(path: string): void }) {
  const [prepared, setPrepared] = useState<ProposalPrepared | null>(null)
  const [appliedVersion, setAppliedVersion] = useState('')
  const [undoText, setUndoText] = useState('')
  const [state, setState] = useState<'checking' | 'ready' | 'applying' | 'applied' | 'deferred' | 'ignored' | 'undoing' | 'undone' | 'expired'>('checking')
  const [note, setNote] = useState('正在核对文件…')
  const requestGeneration = useRef(0)

  const isWorkbenchProposal = props.proposal.kind === 'split' || props.proposal.kind === 'merge' || props.proposal.kind === 'renames'

  const check = async () => {
    const generation = ++requestGeneration.current
    setAppliedVersion('')
    setUndoText('')
    setState('checking'); setNote('正在核对文件…')
    /* split/merge/renames 走 workbench 通道的 proposal.prepare（嵌套 proposal，响应按 kind 包裹）;edit/create 仍走 /manuscript（平铺字段）。 */
    const channel = isWorkbenchProposal ? WORKBENCH_RPC_CHANNEL : '/manuscript'
    let raw: unknown
    try {
      raw = isWorkbenchProposal
        ? await props.ctx.connection.rpc.call(channel, 'proposal.prepare', {
          sessionId: props.sessionId,
          proposal: props.proposal,
        })
        : await props.ctx.connection.rpc.call(channel, 'proposal.prepare', {
          sessionId: props.sessionId,
          ...props.proposal,
        })
    } catch {
      if (requestGeneration.current !== generation) return
      setState('expired'); setNote('未能完成核对，请检查作品状态后重试。')
      return
    }
    if (requestGeneration.current !== generation) return
    const result = raw as RpcResult<ProposalPrepared | { split?: WorkbenchProposalPrepared; merge?: WorkbenchProposalPrepared; renames?: WorkbenchProposalPrepared }>
    if (!result.ok) { setState('expired'); setNote('文件已变化，未写入任何内容；请让写作助手重新生成建议。'); return }
    let value: ProposalPrepared | undefined
    if (isWorkbenchProposal) {
      const wrapped = result.value as { split?: WorkbenchProposalPrepared; merge?: WorkbenchProposalPrepared; renames?: WorkbenchProposalPrepared }
      value = wrapped.split ?? wrapped.merge ?? wrapped.renames
    } else {
      value = result.value as ProposalPrepared
    }
    if (!value) { setState('expired'); setNote('文件已变化，未写入任何内容；请让写作助手重新生成建议。'); return }
    setPrepared(value); setState('ready'); setNote('可以安全应用')
  }

  /* 把提案压缩成字符串,作为 useEffect 依赖;按 kind narrow 后才访问独有字段,避免类型/越界错误。 */
  const proposalFingerprint = useMemo(() => {
    const p = props.proposal
    const head = `${p.kind}|${p.summary}`
    if (p.kind === 'edit') return `${head}|${p.path}|${p.oldText}|${p.newText}`
    if (p.kind === 'create') return `${head}|${p.path}|${p.text}`
    if (p.kind === 'split') return `${head}|${p.path}|${p.anchor}|${p.newPath}`
    if (p.kind === 'merge') return `${head}|${p.path}|${p.sourcePath}`
    return `${head}|${p.renames.map((rename) => `${rename.from}->${rename.to}`).join(',')}`
  }, [props.proposal])

  useEffect(() => {
    void check()
    return () => { requestGeneration.current += 1 }
  }, [props.sessionId, proposalFingerprint])

  const apply = async () => {
    if (!prepared) return
    const generation = ++requestGeneration.current
    setState('applying'); setNote('正在应用…')
    /* 运输层异常也必须落地到终态，否则会永远卡在 applying。 */
    try {
      let beforeApplyText = ''
      /* edit 路径在应用前再读一次文件,把"撤回到原内容"所需的快照存起来;其它 kind 没有撤销按钮。 */
      if (props.proposal.kind === 'edit' && prepared.kind === 'edit') {
        const read = await props.ctx.connection.rpc.call('/manuscript', 'file.read', {
          sessionId: props.sessionId,
          path: props.proposal.path,
        }) as RpcResult<{ text: string; version: string }>
        if (requestGeneration.current !== generation) return
        if (!read.ok || read.value.version !== prepared.version) {
          setState('expired'); setNote('文件已变化，未写入任何内容；请让写作助手重新生成建议。')
          return
        }
        beforeApplyText = read.value.text
      }
      /* edit/create 走 /manuscript 的 proposal.apply,带 expectedVersion;其它走 workbench,带 expectedVersions。 */
      let result: RpcResult<ProposalApplyResult>
      if (props.proposal.kind === 'edit' || props.proposal.kind === 'create') {
        const expectedVersion = props.proposal.kind === 'edit' && prepared.kind === 'edit' ? prepared.version : ''
        result = await props.ctx.connection.rpc.call('/manuscript', 'proposal.apply', {
          sessionId: props.sessionId,
          ...props.proposal,
          expectedVersion,
        }) as RpcResult<ProposalApplyResult>
      } else {
        const expectedVersions = buildExpectedVersions(props.proposal, prepared) ?? {}
        result = await props.ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'proposal.apply', {
          sessionId: props.sessionId,
          proposal: props.proposal,
          expectedVersions,
        }) as RpcResult<ProposalApplyResult>
      }
      if (requestGeneration.current !== generation) return
      if (!result.ok) {
        /* Host 用 details.partial 报告"写了一半"：刷新已变路径、展示备份位置，
           并停在 expired——既不伪装成功，也不允许立即重复应用。 */
        const partial = partialApplyDetails(result)
        if (partial) {
          setState('expired')
          const wrote = partial.appliedPaths.length ? `涉及 ${partial.appliedPaths.join('、')}，需核对` : '部分路径可能已被触及'
          const backup = partial.recoveryPath ? `；备份在 ${partial.recoveryPath}` : ''
          const snapshot = partial.safetySnapshotId ? `；安全快照 ${partial.safetySnapshotId}` : ''
          setNote(`未能全部完成：${wrote}${backup}${snapshot}。请检查作品状态后再决定是否重试。`)
          for (const appliedPath of partial.appliedPaths) props.onApplied(appliedPath)
          return
        }
        /* 普通失败不断言零写入：Host 可能已落盘部分内容。 */
        setState('expired'); setNote('未能完成，请检查作品状态；必要时请让写作助手重新生成建议。')
        return
      }
      /* /manuscript 通道(edit/create)回 path+version;workbench 通道(split/merge/renames)回 applied+failed。 */
      if (props.proposal.kind === 'edit' || props.proposal.kind === 'create') {
        const applyValue = result.value as Extract<ProposalApplyResult, { kind: 'edit' | 'create' }>
        setAppliedVersion(applyValue.version)
        setUndoText(beforeApplyText)
        setState('applied'); setNote('已应用到作品')
        props.onApplied(applyValue.path)
        return
      }
      const applyValue = result.value as Extract<ProposalApplyResult, { applied: string[] }>
      const applied = applyValue.applied
      if (props.proposal.kind === 'split') {
        setState('applied'); setNote('已拆分并写入作品')
      } else if (props.proposal.kind === 'merge') {
        setState('applied'); setNote('已合并，来源章节已归档（可在归档中恢复）')
      } else {
        const failed = applyValue.failed
        const ok = applied.length
        const total = props.proposal.renames.length
        const tail = failed ? `；失败:${failed.from}（${failed.reason}）` : ''
        setState('applied'); setNote(ok === total ? `已重命名 ${ok} 个文件` : `已重命名 ${ok}/${total} 个文件${tail}`)
      }
      /* 通知树刷新:按 applied 顺序逐个回调,让 onApplied 自然处理导航与展开。 */
      for (const path of applied) props.onApplied(path)
    } catch {
      if (requestGeneration.current !== generation) return
      setState('expired')
      setNote('未能完成，请检查作品状态；必要时请让写作助手重新生成建议。')
    }
  }

  const undo = async () => {
    if (props.proposal.kind !== 'edit' || !appliedVersion || !undoText) return
    const generation = ++requestGeneration.current
    setState('undoing'); setNote('正在撤销…')
    try {
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
    } catch {
      if (requestGeneration.current !== generation) return
      setState('expired')
      setNote('未能完成撤销，请检查作品状态。')
    }
  }

  /* 头部右侧的标识:renames 展示"N 个文件",其它仍展示 path(已经在 kind 上 narrow 过)。 */
  const headerPathLabel = props.proposal.kind === 'renames'
    ? `${props.proposal.renames.length} 个文件`
    : props.proposal.path

  /* 按 kind 决定主区域内容。edit 复用 proposal-diff 块;create 单 pre;split 同 edit 但 before/after 来自 prepared;
     merge 展示两个文件的字符数与归档说明;renames 用 ul/li 列出 from→to。 */
  const renderBody = () => {
    if (props.proposal.kind === 'edit') {
      const editPrepared = prepared?.kind === 'edit' ? prepared : null
      return e('div', { className: 'proposal-diff' },
        e('section', null, e('small', null, '原文'), e('pre', null, editPrepared?.before ?? props.proposal.oldText)),
        e('section', null, e('small', null, '修改后'), e('pre', null, editPrepared?.after ?? props.proposal.newText)),
      )
    }
    if (props.proposal.kind === 'create') {
      return e('section', null, e('small', null, '新文件内容'), e('pre', null, props.proposal.text))
    }
    if (props.proposal.kind === 'split') {
      const splitPrepared = prepared?.kind === 'split' ? prepared : null
      return e('div', { className: 'proposal-diff' },
        e('section', null, e('small', null, '拆分点前'), e('pre', null, splitPrepared?.before ?? '')),
        e('section', null, e('small', null, '拆分点后'), e('pre', null, splitPrepared?.after ?? '')),
        e('section', { className: 'proposal-split-summary' },
          e('small', null, '走向新文件 '),
          e('code', null, props.proposal.newPath),
          splitPrepared
            ? e('small', null, ` · 拆分点前 ${splitPrepared.headChars} 字 / 拆分点后 ${splitPrepared.tailChars} 字`)
            : null,
        ),
      )
    }
    if (props.proposal.kind === 'merge') {
      const mergePrepared = prepared?.kind === 'merge' ? prepared : null
      return e('section', { className: 'proposal-merge-summary' },
        e('p', null, e('code', null, props.proposal.sourcePath), ' → ', e('code', null, props.proposal.path)),
        mergePrepared
          ? e('p', null, `目标文件 ${mergePrepared.pathChars} 字 · 来源文件 ${mergePrepared.sourceChars} 字`)
          : null,
        e('small', null, '应用后来源章节会被归档,可在归档中恢复。'),
      )
    }
    /* renames */
    return e('section', { className: 'proposal-renames' },
      e('ul', null, props.proposal.renames.map((rename) => e('li', { key: `${rename.from}->${rename.to}` },
        e('code', null, rename.from), ' → ', e('code', null, rename.to),
      ))),
    )
  }

  return e('article', { className: `proposal-card ${state}`, 'aria-label': '文件修改建议' },
    e('header', null, e('strong', null, props.proposal.summary), e('code', null, headerPathLabel)),
    renderBody(),
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

/** author_observe 的作者确认卡。确认后由 Shell 把 observation 作为新一行追加进 authorMemory。 */
export function MemoryCard(props: { memory: AuthorMemoryMarker; onAccept(observation: string): Promise<boolean> | boolean }) {
  const [state, setState] = useState<'ready' | 'saving' | 'saved' | 'rejected' | 'failed'>('ready')
  const [note, setNote] = useState('')
  const accept = async () => {
    if (state !== 'ready') return
    setState('saving'); setNote('正在写入作者侧写…')
    let ok = false
    try {
      ok = Boolean(await props.onAccept(props.memory.observation))
    } catch {
      ok = false
    }
    if (ok) { setState('saved'); setNote('已记住这条偏好') }
    else { setState('failed'); setNote('侧写已满，请到设置页整理。') }
  }
  return e('article', { className: `memory-card ${state}`, 'aria-label': '作者侧写建议' },
    e('header', null, e('strong', null, '建议记住这条偏好')),
    e('section', { className: 'memory-observation' },
      e('small', null, '建议记录'),
      e('p', null, props.memory.observation),
    ),
    e('section', { className: 'memory-reason' },
      e('small', null, '为什么'),
      e('p', null, props.memory.reason),
    ),
    e('footer', null,
      e('span', { role: state === 'failed' ? 'alert' : 'status' }, note),
      state === 'ready' ? e('button', { type: 'button', onClick: () => void accept() }, '记住') : null,
      state === 'ready' ? e('button', { type: 'button', onClick: () => { setState('rejected'); setNote('已忽略，未写入作者侧写') } }, '忽略') : null,
    ),
    state === 'ready' ? e('small', { className: 'memory-help' }, '仅在确认后才写入本机作者侧写；项目上下文会用其当前值，不会自动扩张。') : null,
  )
}

export function InitGuideCard(props: { state: 'explore' | 'interview'; busy: boolean; running: boolean; done: boolean; note: string; onStart(): void; onDismiss(): void }) {
  const explore = props.state === 'explore'
  return e('article', { className: 'pending-card init-guide-card', 'aria-label': '项目初始化' },
    e('strong', null, '项目初始化'),
    e('p', null, explore
      ? '这个项目还没有作品索引。让写作助手通读项目内容、建立一份索引？之后讨论剧情和设定会更准确。'
      : '这个项目还是空的。通过问答采访，和写作助手一起把故事构想聊出来，并逐步建立项目文件？'),
    props.done
      ? e('p', { role: 'status' }, '初始化已完成。')
      : e('div', null,
        e('button', { type: 'button', className: 'primary-action', disabled: props.busy || props.running, onClick: props.onStart }, props.running ? '正在初始化…' : '开始初始化'),
        e('button', { type: 'button', disabled: props.busy, onClick: props.onDismiss }, '忽略'),
      ),
    props.note ? e('small', { className: 'warning', role: 'alert' }, props.note) : null,
    props.done ? null : e('small', { className: 'muted' }, '初始化不是必须的——也可以直接在下方开始对话。'),
  )
}

export function ProjectContextReceiptView({ receipt }: { receipt: ProjectContextReceiptBundle }) {
  const fixed = receipt.sources.filter((item) => item.kind !== 'worldbook')
  const includedFixed = fixed.filter((item) => item.status === 'included' && item.includedChars > 0).length
  const worldbook = receipt.sources.filter((item) => item.kind === 'worldbook')
  const matchedByText = (value: string | undefined) => value === 'both' ? '请求与当前文档' : value === 'saved-document' ? '当前文档' : '本次请求'
  return e('details', { className: 'project-context-receipt' },
    e('summary', null, `项目上下文：固定 ${includedFixed}/${fixed.length}，触发世界书 ${worldbook.length}${receipt.authorPreferencesChars ? `，作者约定 ${receipt.authorPreferencesChars} 字` : ''}${receipt.authorMemoryChars ? `，作者侧写 ${receipt.authorMemoryChars} 字` : ''}`),
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

export function Chat({ ctx, session, workspaceId, activePath, authorPreferences, authorMemory, onAcceptMemory, hidden, onClose, onConfigure, onApplied, onDraftDirtyChange }: { ctx: ShellContext; session: SessionFace; workspaceId?: WorkspaceId; activePath?: string; authorPreferences: string; authorMemory: string; onAcceptMemory(observation: string): Promise<boolean> | boolean; hidden: boolean; onClose(): void; onConfigure(): void; onApplied(path: string): void; onDraftDirtyChange(dirty: boolean): void }) {
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
  const historyRef = useRef<HTMLDivElement | null>(null)
  const bottomPinnedRef = useRef(true)
  /* 流式更新跟随到底部；用户主动上翻阅读时松开，回到底部附近再重新跟随。 */
  useEffect(() => {
    const el = historyRef.current
    if (el && bottomPinnedRef.current) el.scrollTop = el.scrollHeight
  }, [snapshot, outgoing])
  const internalIndexActive = internalIndexTurnActive(snapshot)
  /* 初始化回合的思考/流式正文也照常显示,不再强制清空,避免"正在回复…"随流式块一闪一闪。 */
  const partial = partialView(snapshot)
  const rows = chatRows(snapshot)
  const hasTurnError = rows.some((row) => row.id.startsWith('turn-error:'))
  const workspace = workspaceList.items.find((item) => item.workspaceId === workspaceId)
  const initScope = useMemo(() => ctx.settingsScope.bind({ namespace: INIT_SETTINGS_NAMESPACE, decode: decodeInitSettings }), [ctx])
  const initSettings = useObservable(initScope)
  const [inspection, setInspection] = useState<ProjectInspectionResponse | null>(null)
  const [initBusy, setInitBusy] = useState(false)
  const [initNote, setInitNote] = useState('')
  const [initCompleted, setInitCompleted] = useState(false)
  /* 采访期间是否已有提案被应用、是否已自动触发过索引回合、上一次 running 状态(用于检测 running 刚停下)。
   * 切工作区时随 initCompleted 一起重置,避免把上一次的采访状态带到新项目。 */
  const appliedDuringInterviewRef = useRef(false)
  const autoIndexTriggeredRef = useRef(false)
  const prevRunningRef = useRef(false)
  const workspacePath = workspace?.path
  /* 打开项目时检查初始化状态；检查失败就不显示卡片，不打扰正常对话。 */
  useEffect(() => {
    setInspection(null); setInitNote(''); setInitCompleted(false); setInitDismissedLocal(false)
    appliedDuringInterviewRef.current = false
    autoIndexTriggeredRef.current = false
    prevRunningRef.current = false
    if (!workspaceId || !workspacePath) return
    let live = true
    void safeRpcCall<ProjectInspectionResponse>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.inspect', { workspacePath })).then((result) => {
      if (live && result.ok) setInspection(result.value)
    })
    return () => { live = false }
  }, [ctx.connection, workspaceId, workspacePath])
  const initState = inspection ? initGuideState(inspection) : 'done'
  const [initDismissedLocal, setInitDismissedLocal] = useState(false)
  const initDismissed = initDismissedLocal || Boolean(workspaceId && initSettings.value?.dismissedWorkspaceIds.includes(workspaceId))
  /* 探索回合（索引）在 UI 中隐藏，跑完后把卡片标为完成态。 */
  const exploreWasRunning = useRef(false)
  useEffect(() => {
    if (initState !== 'explore') return
    if (internalIndexActive) exploreWasRunning.current = true
    else if (exploreWasRunning.current) { exploreWasRunning.current = false; setInitCompleted(true) }
  }, [internalIndexActive, initState])
  /* 采访式初始化建完核心文件后,等会话从 running 变空闲,自动接上"建立作品索引"。
   * 判定逻辑抽到 init-guide.ts 的 shouldAutoIndexAfterInterview 纯函数;这里只负责
   * 检测 running 刚停下(用 ref 记前值)+ 满足条件时一次性触发。失败静默,避免循环。 */
  useEffect(() => {
    const runningJustStopped = prevRunningRef.current === true && !snapshot.running
    prevRunningRef.current = snapshot.running
    if (!runningJustStopped) return
    if (!shouldAutoIndexAfterInterview({
      initState,
      initCompleted,
      appliedDuringInterview: appliedDuringInterviewRef.current,
      running: snapshot.running,
      alreadyTriggered: autoIndexTriggeredRef.current,
    })) return
    autoIndexTriggeredRef.current = true
    void startExploreInit(ctx, session.sessionId)
  }, [snapshot.running, initState, initCompleted, ctx, session.sessionId])
  const startInitGuide = () => {
    if (initBusy || initState === 'done') return
    setInitBusy(true); setInitNote('')
    void (async () => {
      const ok = initState === 'explore'
        ? await startExploreInit(ctx, session.sessionId)
        : Boolean((await send(session, buildInterviewPrompt()))?.ok)
      if (!ok) setInitNote('初始化未能开始，请重试。')
      else if (initState === 'interview') setInitCompleted(true)
      setInitBusy(false)
    })()
  }
  const dismissInitGuide = () => {
    if (!workspaceId) return
    setInitDismissedLocal(true)
    const current = initScope.getSnapshot().value?.dismissedWorkspaceIds ?? []
    if (current.includes(workspaceId)) return
    void initScope.set('dismissedWorkspaceIds', [...current, workspaceId]).catch(() => setInitNote('忽略状态未能保存，下次打开可能会再次显示。'))
  }
  /* 采访式初始化已开始时,记录"采访期间有提案被应用",供上面的 effect 在
   * 会话空闲时自动接上"建立作品索引"。非采访态或还没开始就只是透传。 */
  const handleApplied = (path: string) => {
    if (initState === 'interview' && initCompleted) {
      appliedDuringInterviewRef.current = true
      /* 典型场景是回合已结束、作者才点"应用"：此时 running 不会再有 true→false 跳变，
       * 上面的 effect 等不到它，在这里空闲即触发，否则自动索引永远不会启动。 */
      if (shouldAutoIndexAfterInterview({
        initState,
        initCompleted,
        appliedDuringInterview: appliedDuringInterviewRef.current,
        running: snapshot.running,
        alreadyTriggered: autoIndexTriggeredRef.current,
      })) {
        autoIndexTriggeredRef.current = true
        void startExploreInit(ctx, session.sessionId)
      }
    }
    onApplied(path)
  }
  /* 项目里任何对话已有内容，就视为作者选择了直接聊天，不再展示引导；
   * 除非初始化正在跑或刚跑完，保留进行/完成反馈。 */
  const workspaceHasConversation = sessionList.ids.some((id) => {
    const item = sessionList.byId?.[id]
    return Boolean(item && workspace?.sessionIds.includes(id) && !item.blank)
  })
  const initEngaged = initBusy || initCompleted || (initState === 'explore' && internalIndexActive)
  const showInitGuide = Boolean(
    workspace && inspection && initState !== 'done' && !initDismissed
    && !(initState === 'interview' && initCompleted)
    && (initEngaged || !workspaceHasConversation),
  )
  const sessionIds = sessionList.ids.filter((id) => workspace?.sessionIds.includes(id))
  const conversations = conversationRows({
    workspaceSessionIds: sessionIds.length ? sessionIds : [session.sessionId],
    archivedIds: workspaceList.archivedSessionIds,
    reusableBlankIds: Object.values(sessionList.byId ?? {}).filter((item) => item.blank).map((item) => item.id),
    currentId: session.sessionId,
    titles: Object.fromEntries(Object.entries(sessionList.byId ?? {}).map(([id, value]) => [id, value.title])),
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
    const summary = sessionList.byId?.[session.sessionId]
    const title = nextAutomaticConversationTitle({
      durableTitle: summary?.title?.trim(),
      assistantReplies: rows.filter((row) => row.role === 'assistant').map((row) => row.text),
      attempted: titleAttempted.current.has(session.sessionId),
      date: typeof summary?.updatedAt === 'number' ? summary.updatedAt : Date.now(),
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
  useEffect(() => {
    if (outgoingIsCanonical) setOutgoing(null)
  }, [outgoingIsCanonical])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!composerCanSubmit) return
    const value = draft.trim()
    bottomPinnedRef.current = true
    setOutgoing({ text: value, state: 'sending', afterRows: rows.length })
    setDraft('')
    setNote('')
    let contextCompileFailed = false
    void sendProjectContext(session, value, async () => {
      const compiled = await safeRpcCall<{ serialized: string; receipt: ProjectContextReceiptBundle }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'context.compile', { sessionId: session.sessionId, userRequest: value, activePath, authorPreferences, authorMemory }))
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
      e('div', { className: 'conversation-select' },
        e(Select, { value: session.sessionId, 'aria-label': '切换对话', options: conversations.map((item) => ({ value: item.id, label: item.title })), onChange: (next) => void switchConversation(next) }),
      ),
      e('div', { className: 'chat-header-actions' },
        connected ? null : e('span', { className: 'chat-status', role: 'status' }, '重连中'),
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
    e('div', { className: 'chat-history', ref: historyRef, onScroll: (event: { currentTarget: HTMLDivElement }) => {
      const el = event.currentTarget
      bottomPinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    } },
      showInitGuide ? e(InitGuideCard, {
        state: initState as 'explore' | 'interview',
        busy: initBusy,
        running: initState === 'explore' ? internalIndexActive : snapshot.running,
        done: initCompleted,
        note: initNote,
        onStart: startInitGuide,
        onDismiss: dismissInitGuide,
      }) : null,
      snapshot.hasMore ? e('button', { type: 'button', onClick: () => void loadOlder(session), disabled: snapshot.loadingOlder }, snapshot.loadingOlder ? '加载中…' : '加载更早消息') : null,
      rows.map((row) => row.proposal
        ? e(ProposalCard, { key: row.id, ctx, sessionId: session.sessionId, proposal: row.proposal, onApplied: handleApplied })
        : row.memory
          ? e(MemoryCard, { key: row.id, memory: row.memory, onAccept: (observation) => onAcceptMemory(observation) })
          : row.role === 'thinking'
          ? e('details', { className: 'chat-row thinking', key: row.id },
            e('summary', null, '思考过程'),
            e('p', null, row.text),
          )
          : row.role === 'tool' && row.error
            ? e('details', { className: 'chat-row tool error', key: row.id, open: true, role: 'alert' },
              e('summary', null, `⚠ ${row.text}`),
              row.reason ? e('p', { className: 'tool-error-reason' }, row.reason) : null,
              row.content ? e('pre', null, row.content) : null,
              row.detail ? e('small', null, row.detail) : null,
            )
          : row.role === 'tool' && row.content
            ? e('details', { className: 'chat-row tool', key: row.id },
              e('summary', null, row.text),
              e('pre', null, row.content),
              row.detail ? e('small', null, row.detail) : null,
            )
            : e('article', { className: `chat-row ${row.role}`, key: row.id },
              row.role === 'assistant' && row.text
                ? e('div', { className: 'md' }, e(Markdown, { text: row.text }))
                : e('p', null, row.text || '（无文字内容）'),
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
      partial.thinking ? e('details', { className: 'chat-row thinking', open: true, 'aria-live': 'polite' },
        e('summary', null, '正在思考…'),
        e('p', null, partial.thinking),
      ) : null,
      partial.text ? e('article', { className: 'chat-row assistant', 'aria-live': 'polite' }, e('div', { className: 'md' }, e(Markdown, { text: partial.text }))) : snapshot.partial && !partial.thinking ? e('article', { className: 'chat-row assistant', 'aria-live': 'polite' }, '正在回复…') : null,
      snapshot.pending.map((item) => e(PendingCard, { key: item.key, item })),
      snapshot.openState === 'error' ? e('p', { className: 'warning' }, '连接暂时中断，正在恢复…') : null,
      snapshot.promptError && !hasTurnError ? e('p', { className: 'warning' }, '写作助手未能完成这次请求，请重试。') : null,
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
      e('div', { className: 'composer-toolbar' },
        e('div', { className: 'composer-model' },
          e(ModelPicker, { key: `${session.sessionId}:${modelRevision}`, ctx, session, onConfigure }),
        ),
        e('div', { className: 'composer-actions' },
          snapshot.running ? e('button', { type: 'button', onClick: () => void stop(session) }, '停止') : null,
          e('button', {
            className: 'send',
            type: 'submit',
            disabled: !composerCanSubmit,
            title: '发送',
            'aria-label': '发送',
          }, e('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' },
            e('path', { d: 'm22 2-7 20-4-9-9-4Z' }),
            e('path', { d: 'M22 2 11 13' }),
          )),
        ),
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
