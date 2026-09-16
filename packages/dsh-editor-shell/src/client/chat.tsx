import React, {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
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
  WRITING_PROPOSE_TOOL_NAME,
  type AuthorProposal,
  type ChatRow,
  type PendingInteraction,
  type QuestionAnswerItem,
} from '../adapter.ts'
import type {
  EditorUiConversation,
  SessionFace,
  SessionId,
  SessionLifecycle,
  SessionModels,
  WorkspaceId,
} from '../dsh-compat.ts'
import { emptyTranscript, type ChatTranscript } from '../dsh-compat.ts'
import {
  WORKBENCH_RPC_CHANNEL,
  type ProjectContextReceiptBundle,
  type ProjectInspectionResponse,
} from 'dsh-editor-workbench/contracts'
import type { AuthorMemoryMarker } from 'dsh-editor-workbench/contracts'
import {
  buildInterviewPrompt,
  decodeInitSettings,
  INIT_SETTINGS_NAMESPACE,
  initGuideState,
  shouldAutoIndexAfterInterview,
  shouldShowInitGuide,
  startExploreInit,
} from '../init-guide.ts'
import {
  canConfirmConversationPreset,
  cancelNewConversationPresetPicker,
  confirmNewConversationPreset,
  firstAvailableConversationPreset,
  loadNewConversationPresets,
  sessionAgentPreset,
  shouldRunLegacyNovelPipeline,
  startNewConversationPresetFlow,
  type ConversationPresetChoice,
} from '../conversation-presets.ts'
import { shouldShowMigrationBanner } from '../legacy-migration.ts'
import { ConversationRenameQueue, archiveConversationIds, archivedConversationRows, canArchiveOrDeleteConversation, conversationRows, nextAutomaticConversationTitle, nextVisibleConversationId, resolveNewConversationModel, restoreConversationIds, shouldConfirmConversationSwitch } from '../conversation-lifecycle.ts'
import { CONVERSATION_SETTINGS_NAMESPACE, conversationWorkRecord, decodeConversationSettings, DEFAULT_CONVERSATION_SETTINGS, putConversationWork } from '../conversation-store.ts'
import { DEVELOPER_SETTINGS_NAMESPACE, decodeDeveloperSettings } from '../developer-settings.ts'
import { MESSAGE_CARDS_SERVICE, type ShellMessageCardContext, type ShellMessageCardRegistry } from '../seats.ts'
import { isObservableSource, useObservable } from './components.tsx'
import { Markdown } from './markdown.tsx'
import { ConfirmDialog, ConversationPresetPicker, TextPromptDialog } from './dialogs.tsx'
import { Select } from './select.tsx'
import { ActivityDots, ActivityText, SuccessMark, Menu, MenuContent, MenuItem, MenuTrigger } from './ui/index.ts'
import type { WritingModelRoute } from '../writing-settings.tsx'
import { discardCreatedChatModelError, rememberCreatedChatModelError, takeCreatedChatModelError } from './ui-workspace.ts'
import { t, useLocale, type Locale, type MessageKey } from '../i18n/index.ts'
import {
  canSubmitComposer,
  errorMessage,
  isStaleFailure,
  partialApplyDetails,
  safeRpcCall,
  shouldSubmitComposer,
  type RpcResult,
  type ShellContext,
} from './shared.ts'
import { STANDARD_REASONING_EFFORTS } from './settings-models-store.ts'
import { StopIcon } from './icons.tsx'


const conversationRenameQueue = new ConversationRenameQueue()

const EMPTY_PENDING_LIST: PendingInteraction[] = []
const EMPTY_PENDING = {
  getSnapshot: (): PendingInteraction[] => EMPTY_PENDING_LIST,
  subscribe: () => () => {},
}

const EMPTY_TRANSCRIPT = emptyTranscript()
const EMPTY_CHAT_SNAPSHOT: { legacy?: ChatTranscript } = { legacy: EMPTY_TRANSCRIPT }
const CHAT_SOURCE_RETRY_MS = 50

type ChatTargetSnapshot = { legacy?: ChatTranscript } | undefined
type ConversationHost = Pick<ShellContext, 'uiConversation'> & { get?(name: string): unknown }

let injectedConversation: EditorUiConversation | undefined

/**
 * Shell cannot inject `uiConversation` at apply time: that service waits for
 * the local `uiWorkspace` face. A child fiber waits after provide().
 */
export function bindOfficialConversation(ctx: {
  inject(deps: readonly string[], apply: (inner: ConversationHost) => (() => void) | void): unknown
}) {
  ctx.inject(['uiConversation'], (inner) => {
    injectedConversation = inner.uiConversation
    return () => {
      if (injectedConversation === inner.uiConversation) injectedConversation = undefined
    }
  })
}

function conversationFace(ctx: ConversationHost): EditorUiConversation | undefined {
  if (injectedConversation) return injectedConversation
  try {
    const fromGet = typeof ctx.get === 'function' ? ctx.get('uiConversation') : undefined
    if (fromGet && typeof fromGet === 'object' && 'binding' in fromGet) return fromGet as EditorUiConversation
  } catch {
    /* A fiber that did not inject uiConversation may refuse ctx.get. */
  }
  return ctx.uiConversation
}

const topLevelChatSnapshots = new WeakMap<object, ChatTargetSnapshot>

function chatSnapshotOf(raw: unknown): ChatTargetSnapshot {
  if (!raw || typeof raw !== 'object') return EMPTY_CHAT_SNAPSHOT
  const value = raw as { legacy?: ChatTranscript; nodes?: unknown; partial?: ChatTranscript['partial']; runningCalls?: ChatTranscript['runningCalls'] }
  if (value.legacy && Array.isArray(value.legacy.nodes)) return value
  if (!Array.isArray(value.nodes)) return EMPTY_CHAT_SNAPSHOT
  const cached = topLevelChatSnapshots.get(value)
  if (cached) return cached
  const wrapped: ChatTargetSnapshot = {
    legacy: {
      nodes: value.nodes as ChatTranscript['nodes'],
      partial: value.partial ?? null,
      runningCalls: value.runningCalls ?? [],
    },
  }
  topLevelChatSnapshots.set(value, wrapped)
  return wrapped
}

function resolveConversationChatTarget(ctx: ConversationHost, sessionId: SessionId) {
  try {
    return conversationFace(ctx)?.binding(sessionId).target('chat')
  } catch {
    return undefined
  }
}

/**
 * Official ui-conversation waits for the local `uiWorkspace` service, so it
 * starts after Shell `apply()` provides that face. Resolve the chat target
 * live: the first Chat mount must not freeze an empty source, and the first
 * subscriber is what activates assembly.
 */
export function conversationChatSource(ctx: ConversationHost, sessionId: SessionId) {
  return {
    getSnapshot(): ChatTargetSnapshot {
      return chatSnapshotOf(resolveConversationChatTarget(ctx, sessionId)?.getSnapshot())
    },
    subscribe(listener: () => void) {
      let unsub = () => {}
      let timer: ReturnType<typeof setInterval> | undefined
      const attach = () => {
        unsub()
        const source = resolveConversationChatTarget(ctx, sessionId)
        if (!source) {
          unsub = () => {}
          return false
        }
        unsub = source.subscribe(listener)
        if (timer !== undefined) {
          clearInterval(timer)
          timer = undefined
        }
        return true
      }
      if (!attach()) {
        timer = setInterval(() => {
          if (attach()) listener()
        }, CHAT_SOURCE_RETRY_MS)
      }
      return () => {
        if (timer !== undefined) clearInterval(timer)
        unsub()
      }
    },
  }
}

const DISCONNECTED = {
  getSnapshot: () => 'disconnected' as const,
  subscribe: () => () => {},
}

function pendingForSession(
  raw: ReadonlyMap<SessionId, PendingInteraction> | PendingInteraction[] | undefined,
  sessionId: SessionId,
): PendingInteraction[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter((item) => item.sessionId === sessionId)
  const item = raw.get(sessionId)
  return item ? [item] : []
}

type ChatLifecycle = SessionLifecycle & { hasMore?: boolean; loadingOlder?: boolean }

/*
 * 约定俗成的思考强度档位展示名。自定义提供方(llm-pi-ai 手工声明)的模型
 * 在目录里不带推理元数据时,强度下拉先用这套档位渲染;首次选择时把同一套
 * 档位补写进该模型的 settings 声明,之后目录自己提供档位。host 在派发前
 * 校验档位,不声明直接传会被拒,所以必须先补声明。
 */
function reasoningLabel(id: string): string {
  if (id === 'off') return t('chat.reasoningOff')
  if (id === 'low') return t('chat.reasoningLow')
  if (id === 'medium') return t('chat.reasoningMedium')
  if (id === 'high') return t('chat.reasoningHigh')
  if (id === 'xhigh') return t('chat.reasoningVeryHigh')
  if (id === 'max') return t('chat.reasoningMax')
  return id
}

function fallbackEffortOptions(): { value: string; label: string }[] {
  return Object.keys(STANDARD_REASONING_EFFORTS).map((id) => ({ value: id, label: reasoningLabel(id) }))
}

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
    const result = await readModels(ctx.remote.session, session)
    if (!result.ok) { setNote(t('chat.apiUnavailable')); return }
    await ctx.settingsScope.describe().ensure()
    setModels(result.value)
    setCustomRoute(piAiCustomProfile(ctx, result.value.current.provider) !== undefined)
    setNote('')
  }
  useEffect(() => { setModels(null); void refresh() }, [session.sessionId])
  useEffect(() => {
    const onCatalog = () => { void refresh() }
    const disposers: Array<unknown> = []
    try { disposers.push(ctx.remote.$on('settings/document-updated', onCatalog)) } catch { /* host may not forward */ }
    try { disposers.push(ctx.remote.$on('credentials/reference-updated', onCatalog)) } catch { /* ignore */ }
    try { disposers.push(ctx.remote.$on('llm/adapters-updated', onCatalog)) } catch { /* ignore */ }
    return () => {
      for (const handle of disposers) {
        if (typeof handle === 'function') {
          try { (handle as () => void)() } catch { /* ignore */ }
        }
      }
    }
  }, [ctx, session.sessionId])
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
    const response = await ctx.remote.settings.mutate(
      'llm-pi-ai',
      [{ op: 'set', path: ['providers', models.current.provider, 'models'], value: nextModels }],
      found.revision,
    )
    return response.ok
  }
  const choose = async (provider: string, model: string, reasoningEffort?: string) => {
    if (!models || busy) return
    setBusy(true); setNote('')
    if (reasoningEffort !== undefined) {
      const declared = (models.groups.find((group) => group.id === provider)?.models
        .find((item) => item.id === model)?.reasoning?.efforts.length ?? 0) > 0
      if (!declared && !(await declareEfforts())) {
        setNote(t('chat.reasoningFailed'))
        setBusy(false)
        return
      }
    }
    const result = await selectModel(ctx.remote.session, session.sessionId, provider, model, reasoningEffort)
    if (!result.ok) setNote(t('chat.modelSwitchFailed'))
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
      await selectModel(ctx.remote.session, session.sessionId, models.current.provider, models.current.model, DEFAULT_FALLBACK_EFFORT)
      await refresh()
    })()
  }, [models, customRoute, busy])
  if (!models || models.groups.length === 0) {
    return (
      <div className="compact-control model-empty">
        <span>
          {note || (models ? t('chat.noModels') : <ActivityText>
            {t('common.loading')}
          </ActivityText>)}
        </span>
        <button type="button" onClick={() => void refresh()}>
          {t('common.retry')}
        </button>
        <button type="button" onClick={onConfigure}>
          {t('chat.setApi')}
        </button>
      </div>
    );
  }
  const options = models.groups.flatMap((group) => group.models.map((model) => ({
    value: `${group.id} ${model.id}`,
    label: `${group.name} · ${model.name || model.id}`,
  })))
  const currentValue = `${models.current.provider} ${models.current.model}`
  const currentCatalogModel = models.groups
    .find((group) => group.id === models.current.provider)?.models
    .find((model) => model.id === models.current.model)
  const currentFull = currentCatalogModel
    ? `${models.groups.find((group) => group.id === models.current.provider)?.name ?? models.current.provider} · ${currentCatalogModel.name || currentCatalogModel.id}`
    : models.current.model
  const efforts = currentCatalogModel?.reasoning?.efforts ?? []
  const effortValue = models.current.reasoningEffort ?? currentCatalogModel?.reasoning?.defaultEffort ?? ''
  const effortOptions = efforts.length > 0
    ? efforts.map((effort) => ({ value: effort.id, label: reasoningLabel(effort.id) !== effort.id ? reasoningLabel(effort.id) : effort.name }))
    : fallbackEffortOptions()
  const showReasoning = efforts.length > 0 || customRoute
  return (
    <div className="compact-control model-picker">
      <Select
        value={options.some((option) => option.value === currentValue) ? currentValue : ''}
        placeholder={currentCatalogModel?.name || models.current.model}
        selectedLabel={currentCatalogModel?.name || models.current.model}
        aria-label={t('chat.chooseModel')}
        title={currentFull}
        disabled={busy}
        options={options}
        onChange={(next) => {
          const [provider, model] = next.split(' ')
          if (provider && model) void choose(provider, model)
        }} />
      {showReasoning ? <Menu>
        <MenuTrigger
          className="icon-button"
          title={t('chat.reasoningMenu')}
          aria-label={t('chat.reasoningMenu')}
          disabled={busy}>
          ⋯
        </MenuTrigger>
        <MenuContent
          className="conversation-menu-pop"
          align="end"
          aria-label={t('chat.reasoningMenu')}>
          {effortOptions.map((effort) => <MenuItem
            key={effort.value}
            disabled={busy}
            onSelect={() => { void choose(models.current.provider, models.current.model, effort.value) }}>
            {effort.value === effortValue ? `✓ ${effort.label}` : effort.label}
          </MenuItem>)}
        </MenuContent>
      </Menu> : null}
      {note ? <small className="warning" role="alert">
        {note}
      </small> : null}
    </div>
  );
}

function ChatEntry(props: {
  as?: 'article' | 'details'
  className: string
  children?: ReactNode
  open?: boolean
  role?: string
  enter?: boolean
  'aria-live'?: 'polite' | 'off'
}) {
  /* 入场判定只在挂载时冻结一次(与原 Motion 变体行为一致):历史行完全不动画,
     之后 enter prop 翻转也不会重播;动画本体是纯 CSS 的 .chat-row-enter,
     reduced-motion 由全局媒体查询接管。 */
  const animate = useRef(props.enter !== false)
  const className = animate.current ? `${props.className} chat-row-enter` : props.className
  return React.createElement(props.as === 'details' ? 'details' : 'article', {
    className,
    ...(props.as === 'details' ? { open: props.open } : {}),
    role: props.role,
    'aria-live': props['aria-live'],
  }, props.children);
}

export function PendingCard({ item }: { item: PendingInteraction }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [tab, setTab] = useState(0)
  if (item.kind === 'approval') {
    const decide = (outcome: 'allowed-once' | 'rejected') => {
      setBusy(true)
      void answerApproval(item, outcome).then((receipt) => {
        if (!receipt.accepted) setNote(t('note.proposalStale'))
      }).catch(() => setNote(t('note.submitFailed'))).finally(() => setBusy(false))
    }
    return (
      <article className="pending-card" aria-label={t('chat.approvalTitle')}>
        <strong>
          {t('chat.needsAuth')}
        </strong>
        <p>
          {t('chat.allowStep')}
        </p>
        <div>
          <button type="button" disabled={busy} onClick={() => decide('allowed-once')}>
            {t('chat.allowOnce')}
          </button>
          <button type="button" disabled={busy} onClick={() => decide('rejected')}>
            {t('chat.refuse')}
          </button>
        </div>
        {note ? <small className="warning">
          {note}
        </small> : null}
      </article>
    );
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
    if (encoded.some((answer) => answer.selected.length === 0 && !answer.custom)) { setNote(t('chat.answerAll')); return }
    setBusy(true)
    void answerQuestions(item, encoded).then((receipt) => {
      if (!receipt.accepted) setNote(t('chat.questionsStale'))
    }).catch(() => setNote(t('note.submitFailed'))).finally(() => setBusy(false))
  }
  const questions = item.payload.questions
  const current = questions.length ? questions[Math.min(tab, questions.length - 1)] : undefined
  const isAnswered = (id: string, source: Record<string, string> = answers) => Boolean(source[id]?.trim())
  const choose = (questionId: string, label: string) => {
    const next = { ...answers, [questionId]: label }
    setAnswers(next)
    setNote('')
    for (let step = 1; step < questions.length; step += 1) {
      const index = (tab + step) % questions.length
      if (!isAnswered(questions[index].id, next)) { setTab(index); return }
    }
  }
  return (
    <form
      className="pending-card"
      aria-label={t('chat.answerQuestions')}
      onSubmit={submit}>
      {questions.length > 1 ? <div className="question-tabs" role="tablist">
        {questions.map((question, index) => <button
          key={question.id}
          type="button"
          role="tab"
          aria-selected={index === tab}
          aria-label={t('chat.questionTab', { index: index + 1 })}
          className={`question-tab${index === tab ? ' is-active' : ''}${isAnswered(question.id) ? ' is-done' : ''}`}
          onClick={() => setTab(index)}>
          {isAnswered(question.id) ? '✓' : String(index + 1)}
        </button>)}
      </div> : null}
      {current ? <section className="question-panel" role="tabpanel">
        <strong>
          {current.header ?? t('chat.needsAnswers')}
        </strong>
        <p>
          {current.question}
        </p>
        {current.detail ? <small>
          {current.detail}
        </small> : null}
        {current.options?.length ? <div className="question-options">
          {current.options.map((option) => <button
            key={option.label}
            type="button"
            className={`question-option${answers[current.id] === option.label ? ' is-selected' : ''}`}
            aria-pressed={answers[current.id] === option.label}
            onClick={() => choose(current.id, option.label)}>
            <strong>
              {option.label}
            </strong>
            {option.description ? <small>
              {option.description}
            </small> : null}
          </button>)}
        </div> : null}
        <input
          className="question-custom"
          placeholder={t('chat.customAnswer')}
          aria-label={t('chat.customAnswerFor', { question: current.question })}
          value={current.options?.some((option) => option.label === answers[current.id]) ? '' : answers[current.id] ?? ''}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const value = event.target.value
            setAnswers((old) => ({ ...old, [current.id]: value }))
            setNote('')
          }} />
      </section> : null}
      <button type="submit" disabled={busy}>
        {busy ? <Fragment>
          <ActivityDots />
          {t('chat.submitting')}
        </Fragment> : t('chat.submitAllAnswers')}
      </button>
      {note ? <small className="warning">
        {note}
      </small> : null}
    </form>
  );
}

/**
 * workbench /dsh-editor-workbench 通道的 proposal.prepare/apply 在不同 kind 下的响应体。
 * 与内核 ProposalMarker 保持对齐：edit 走 /manuscript 通道；create、章纲/章末小结与
 * split/merge/renames 走 workbench，prepare 响应按 kind 包裹。
 */
type WorkbenchProposalPrepared =
  | { kind: 'create'; applicable: true; version: string; missingDirectories: string[] }
  | { kind: 'chapter_plan'; version: string; before: string; after: string }
  | { kind: 'chapter_summary'; version: string; before: string; after: string }
  | { kind: 'split'; version: string; before: string; after: string; headChars: number; tailChars: number }
  | { kind: 'merge'; versions: { path: string; sourcePath: string }; pathChars: number; sourceChars: number }
  | { kind: 'renames'; versions: Record<string, string>; entries: Array<{ from: string; to: string }> }

export type WorkbenchPrepareResponse = {
  create?: Extract<WorkbenchProposalPrepared, { kind: 'create' }>
  chapterMeta?: Extract<WorkbenchProposalPrepared, { kind: 'chapter_plan' | 'chapter_summary' }>
  split?: Extract<WorkbenchProposalPrepared, { kind: 'split' }>
  merge?: Extract<WorkbenchProposalPrepared, { kind: 'merge' }>
  renames?: Extract<WorkbenchProposalPrepared, { kind: 'renames' }>
}

/** 按 kind 拆 workbench prepare 的外层包裹；kind 不匹配时返回 undefined（调用方按核对失败处理）。 */
export function unwrapWorkbenchPrepared(proposal: AuthorProposal, value: unknown): WorkbenchProposalPrepared | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const wrapped = value as WorkbenchPrepareResponse
  if (proposal.kind === 'create') return wrapped.create
  if (proposal.kind === 'chapter_plan' || proposal.kind === 'chapter_summary') {
    const plan = wrapped.chapterMeta
    return plan && plan.kind === proposal.kind ? plan : undefined
  }
  if (proposal.kind === 'split') return wrapped.split
  if (proposal.kind === 'merge') return wrapped.merge
  if (proposal.kind === 'renames') return wrapped.renames
  return undefined
}

/** 提案 prepare 之后保存下来的所有状态，kind 一一对应。edit 保留 /manuscript 旧字段。 */
type ProposalPrepared =
  | { kind: 'edit'; version: string; before: string; after: string }
  | WorkbenchProposalPrepared

/** create / 章纲 / 章末小结 / edit 的单文件回执。 */
export type ProposalFileApplyResult = { path: string; version: string; operation?: 'create' | 'edit' }
type ProposalApplyResult =
  | ProposalFileApplyResult
  | { applied: string[]; failed?: { from: string; reason: string } }

/* 章末小结可读预览的字段顺序与标签（与 workbench 的字段预览一致）。 */
const CHAPTER_STATE_LABEL_ORDER = ['now', 'where', 'knows', 'ended', 'open'] as const
const CHAPTER_STATE_LABEL_KEYS: Record<(typeof CHAPTER_STATE_LABEL_ORDER)[number], MessageKey> = {
  now: 'chapterMeta.stateNow',
  where: 'chapterMeta.stateWhere',
  knows: 'chapterMeta.stateKnows',
  ended: 'chapterMeta.stateEnded',
  open: 'chapterMeta.stateOpen',
}

export type ProposalBasisRef = { path: string; version: string; label?: string }
export type ProposalTargetBaseline = { path: string; version: string }

/** V2 非空 basis 才进入确认卡；legacy V1 与空数组都不展示。 */
export function proposalBasisItems(proposal: AuthorProposal): readonly ProposalBasisRef[] {
  if (proposal.version !== 2 || !proposal.basis?.length) return []
  return proposal.basis
}

/** V2 目标生成基线，与可选 basis[] 分开。create 与 V1 都不展示。 */
export function proposalTargetBaselines(proposal: AuthorProposal): readonly ProposalTargetBaseline[] {
  if (proposal.version !== 2) return []
  if (proposal.kind === 'edit' || proposal.kind === 'split') return [{ path: proposal.path, version: proposal.targetVersion }]
  if (proposal.kind === 'merge') {
    return [
      { path: proposal.path, version: proposal.targetVersion },
      { path: proposal.sourcePath, version: proposal.sourceVersion },
    ]
  }
  if (proposal.kind === 'renames') return proposal.renames.map((rename) => ({ path: rename.from, version: rename.version }))
  return []
}

/** 优先 label，path/version 始终写入可读行；不包含来源正文。 */
export function proposalBasisLine(item: ProposalBasisRef): string {
  const label = item.label?.trim()
  return label
    ? t('chat.proposalBasisNamed', { label, path: item.path, version: item.version })
    : t('chat.proposalBasisPath', { path: item.path, version: item.version })
}

/** 把提案压缩成字符串，作为 prepare 的 useEffect 依赖。V2 生成基线与有序 basis 分别纳入。 */
export function proposalFingerprint(proposal: AuthorProposal): string {
  const p = proposal
  const head = `${p.kind}|${p.summary}`
  const core = p.kind === 'edit' ? `${head}|${p.path}|${p.oldText}|${p.newText}`
    : p.kind === 'create' ? `${head}|${p.path}|${p.text}`
    : p.kind === 'chapter_plan' ? `${head}|${p.path}|${p.sourceVersion}|${p.beats.join('\n')}`
    : p.kind === 'chapter_summary' ? `${head}|${p.path}|${p.sourceVersion}|${JSON.stringify(p.state)}`
    : p.kind === 'split' ? `${head}|${p.path}|${p.anchor}|${p.newPath}`
    : p.kind === 'merge' ? `${head}|${p.path}|${p.sourcePath}`
      : `${head}|${p.renames.map((rename) => `${rename.from}->${rename.to}`).join(',')}`
  const targets = proposalTargetBaselines(p)
  const withTargets = targets.length
    ? `${core}|${targets.map((item) => `target|${item.path}|${item.version}`).join(';')}`
    : core
  const items = proposalBasisItems(p)
  if (!items.length) return withTargets
  return `${withTargets}|${items.map((item) => `${item.path}|${item.version}|${item.label ?? ''}`).join(';')}`
}

/** 从 prepare 响应里抽取 expectedVersions:apply 阶段原子地校验所有参与文件的版本。key 一律是真实文件路径（workbench 端按路径查找）。 */
export function buildExpectedVersions(proposal: AuthorProposal, prepared: ProposalPrepared): Record<string, string> | undefined {
  if (proposal.kind === 'split' && prepared.kind === 'split') return { [proposal.path]: prepared.version }
  if (proposal.kind === 'merge' && prepared.kind === 'merge') return { [proposal.path]: prepared.versions.path, [proposal.sourcePath]: prepared.versions.sourcePath }
  if (proposal.kind === 'renames' && prepared.kind === 'renames') return { ...prepared.versions }
  /* create 与章纲/章末小结按 prepare 观察到的版本校验目标文件；create 的 '' 表示目标尚不存在，照原样传递。 */
  if (proposal.kind === 'create' && prepared.kind === 'create') return { [proposal.path]: prepared.version }
  if ((proposal.kind === 'chapter_plan' || proposal.kind === 'chapter_summary') && prepared.kind === proposal.kind) return { [proposal.path]: prepared.version }
  return undefined
}

export function ProposalCard(props: { ctx: ShellContext; sessionId: string; proposal: AuthorProposal; onApplied(path: string): void }) {
  const [prepared, setPrepared] = useState<ProposalPrepared | null>(null)
  const [appliedVersion, setAppliedVersion] = useState('')
  const [undoText, setUndoText] = useState('')
  const [state, setState] = useState<'checking' | 'ready' | 'applying' | 'applied' | 'deferred' | 'ignored' | 'undoing' | 'undone' | 'expired'>('checking')
  /* 可恢复失败（传输中断、一般核对/应用失败、部分写入后的谨慎回读）允许重新核对，不需要新的模型请求；
     stale（含章纲/章末小结 sourceVersion 过期）必须重新生成提案，不提供重新核对。 */
  const [canRecheck, setCanRecheck] = useState(false)
  const [note, setNote] = useState(t('chat.checkingFiles'))
  const requestGeneration = useRef(0)

  /* edit 留在 /manuscript；create、章纲/章末小结与 split/merge/renames 一起走 workbench 通道。 */
  const isWorkbenchProposal = props.proposal.kind !== 'edit'

  const check = async () => {
    const generation = ++requestGeneration.current
    setAppliedVersion('')
    setUndoText('')
    setPrepared(null)
    setCanRecheck(false)
    setState('checking'); setNote(t('chat.checkingFiles'))
    /* workbench 通道的 prepare 传嵌套 proposal，响应按 kind 包裹；edit 仍走 /manuscript 平铺字段。 */
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
      setState('expired'); setCanRecheck(true); setNote(t('chat.checkFailed'))
      return
    }
    if (requestGeneration.current !== generation) return
    const result = raw as RpcResult<ProposalPrepared | WorkbenchPrepareResponse>
    if (!result.ok) {
      /* stale：文件/版本已变化（章纲与章末小结即 sourceVersion 过期），要求重新生成而不是反复核对。 */
      const stale = isStaleFailure(result)
      setState('expired'); setCanRecheck(!stale)
      /* 非 stale 的失败给出可操作原因（details.reason：目录缺失/权限/重名等）。 */
      setNote(stale ? t('chat.filesChangedNoWrite') : errorMessage(result))
      return
    }
    const value = isWorkbenchProposal
      ? unwrapWorkbenchPrepared(props.proposal, result.value)
      : result.value as ProposalPrepared
    if (!value) { setState('expired'); setCanRecheck(true); setNote(t('chat.checkFailed')); return }
    setPrepared(value); setState('ready'); setNote(t('chat.safeToApply'))
  }

  /* 指纹含 V2 生成基线与有序依据条目；变更会重跑 prepare。 */
  /* 绝不把当前 file.read 写回目标生成基线。 */
  const fingerprint = useMemo(() => proposalFingerprint(props.proposal), [props.proposal])

  useEffect(() => {
    void check()
    return () => { requestGeneration.current += 1 }
  }, [props.sessionId, fingerprint])

  const apply = async () => {
    if (!prepared) return
    const generation = ++requestGeneration.current
    setState('applying'); setNote(t('chat.applying'))
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
          setState('expired'); setCanRecheck(false); setNote(t('chat.filesChangedNoWrite'))
          return
        }
        beforeApplyText = read.value.text
      }
      /* edit 走 /manuscript 的 proposal.apply,带 expectedVersion;create/章纲/章末小结与 split/merge/renames 走 workbench,带 expectedVersions。 */
      let result: RpcResult<ProposalApplyResult>
      if (props.proposal.kind === 'edit') {
        const expectedVersion = prepared.kind === 'edit' ? prepared.version : ''
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
           并停在 expired——既不伪装成功，也不自动重试；只允许用户手动重新核对（谨慎回读）。 */
        const partial = partialApplyDetails(result)
        if (partial) {
          setState('expired'); setCanRecheck(true)
          const wrote = partial.appliedPaths.length ? t('chat.partialPaths', { paths: partial.appliedPaths.join('、') }) : t('chat.partialTouched')
          const backup = partial.recoveryPath ? t('chat.partialBackup', { path: partial.recoveryPath }) : ''
          const snapshot = partial.safetySnapshotId ? t('chat.partialSnapshot', { id: partial.safetySnapshotId }) : ''
          setNote(t('chat.applyPartial', { wrote, backup, snapshot }))
          for (const appliedPath of partial.appliedPaths) props.onApplied(appliedPath)
          return
        }
        /* stale（含章纲/章末小结 sourceVersion 过期）：提案必须重新生成，前端绝不改写 sourceVersion 蒙混重试。
           其它失败用 details.reason 的可操作消息（目录缺失/权限/重名等）；普通 edit/create 失败后仍可重新核对现状。 */
        const stale = isStaleFailure(result)
        setState('expired'); setCanRecheck(!stale)
        setNote(stale ? t('chat.filesChangedNoWrite') : errorMessage(result))
        return
      }
      /* /manuscript 的 edit 与 workbench 的 create/章纲/章末小结都回单文件回执 {path, version, operation}。 */
      if (props.proposal.kind === 'edit' || props.proposal.kind === 'create' || props.proposal.kind === 'chapter_plan' || props.proposal.kind === 'chapter_summary') {
        const applyValue = result.value as ProposalFileApplyResult
        if (props.proposal.kind === 'edit') {
          setAppliedVersion(applyValue.version)
          setUndoText(beforeApplyText)
        }
        setState('applied'); setNote(t('chat.applied'))
        props.onApplied(applyValue.path)
        return
      }
      const applyValue = result.value as Extract<ProposalApplyResult, { applied: string[] }>
      const applied = applyValue.applied
      if (props.proposal.kind === 'split') {
        setState('applied'); setNote(t('chat.splitApplied'))
      } else if (props.proposal.kind === 'merge') {
        setState('applied'); setNote(t('chat.mergeApplied'))
      } else {
        const failed = applyValue.failed
        const ok = applied.length
        const total = props.proposal.renames.length
        const tail = failed ? t('chat.renameFailedItem', { from: failed.from, reason: failed.reason }) : ''
        setState('applied'); setNote(ok === total ? t('chat.renamedOk', { ok }) : t('chat.renamedPartial', { ok, total, tail }))
      }
      /* 通知树刷新:按 applied 顺序逐个回调,让 onApplied 自然处理导航与展开。 */
      for (const path of applied) props.onApplied(path)
    } catch {
      if (requestGeneration.current !== generation) return
      setState('expired'); setCanRecheck(true)
      setNote(t('chat.applyFailed'))
    }
  }

  const undo = async () => {
    if (props.proposal.kind !== 'edit' || !appliedVersion || !undoText) return
    const generation = ++requestGeneration.current
    setState('undoing'); setNote(t('chat.undoing'))
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
        setNote(t('chat.undoStale'))
        return
      }
      setAppliedVersion(result.value.version)
      setState('undone'); setNote(t('chat.undone'))
      props.onApplied(props.proposal.path)
    } catch {
      if (requestGeneration.current !== generation) return
      setState('expired')
      setNote(t('chat.undoFailed'))
    }
  }

  /* 头部右侧的标识:renames 展示"N 个文件",其它仍展示 path(已经在 kind 上 narrow 过)。 */
  const settled = state === 'applied' || state === 'ignored' || state === 'deferred' || state === 'undone'
  const headerPathLabel = props.proposal.kind === 'renames'
    ? t('chat.fileCount', { count: props.proposal.renames.length })
    : props.proposal.path

  /* 类型徽标:大纲/下的 create/edit 是作品大纲提案;其它 create 标明新文件;章纲与章末小结按类型标明。 */
  const kindBadge = props.proposal.kind === 'chapter_plan' ? t('chat.chapterPlanBadge')
    : props.proposal.kind === 'chapter_summary' ? t('chat.chapterSummaryBadge')
      : (props.proposal.kind === 'create' || props.proposal.kind === 'edit') && props.proposal.path.startsWith('大纲/')
        ? t('chat.outlineProposal')
        : props.proposal.kind === 'create' ? t('chat.createBadge')
          : ''

  /* 按 kind 决定主区域内容。edit 复用 proposal-diff 块;create 单 pre 并在可应用时列出将自动创建的目录;
     章纲/章末小结展示可读的字段前后对照;split 同 edit 但 before/after 来自 prepared;
     merge 展示两个文件的字符数与归档说明;renames 用 ul/li 列出 from→to。
     V2 非空 basis 只展示 label/path/version，不拉取也不渲染来源正文。 */
  const renderTargets = () => {
    const items = proposalTargetBaselines(props.proposal)
    if (!items.length) return null
    return (
      <section className="proposal-target" aria-label={t('chat.proposalTarget')}>
        <small>
          {t('chat.proposalTarget')}
        </small>
        <ul>
          {items.map((item) => <li
            key={`${item.path}|${item.version}`}
            aria-label={t('chat.proposalTargetPath', { path: item.path, version: item.version })}>
            <code className="proposal-path">
              {item.path}
            </code>
            {' · '}
            <code>
              {item.version}
            </code>
          </li>)}
        </ul>
      </section>
    );
  }
  const renderBasis = () => {
    const items = proposalBasisItems(props.proposal)
    if (!items.length) return null
    return (
      <section className="proposal-basis" aria-label={t('chat.proposalBasis')}>
        <small>
          {t('chat.proposalBasis')}
        </small>
        <ul>
          {items.map((item) => {
            const label = item.label?.trim()
            return (
              <li
                key={`${item.path}|${item.version}|${label ?? ''}`}
                aria-label={proposalBasisLine(item)}>
                {label ? <Fragment>
                  <span>
                    {label}
                  </span>
                  {' · '}
                </Fragment> : null}
                <code className="proposal-path">
                  {item.path}
                </code>
                {' · '}
                <code>
                  {item.version}
                </code>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }
  const renderKindBody = () => {
    if (props.proposal.kind === 'edit') {
      const editPrepared = prepared?.kind === 'edit' ? prepared : null
      return (
        <div className="proposal-diff">
          <section>
            <small>
              {t('chat.original')}
            </small>
            <pre>
              {editPrepared?.before ?? props.proposal.oldText}
            </pre>
          </section>
          <section>
            <small>
              {t('chat.revised')}
            </small>
            <pre>
              {editPrepared?.after ?? props.proposal.newText}
            </pre>
          </section>
        </div>
      );
    }
    if (props.proposal.kind === 'create') {
      const createPrepared = prepared?.kind === 'create' ? prepared : null
      return (
        <Fragment>
          {createPrepared && createPrepared.missingDirectories.length
            ? <p className="proposal-missing-dirs">
            {t('chat.missingDirs', { paths: createPrepared.missingDirectories.join('、') })}
          </p>
            : null}
          <section className="proposal-preview">
            <small>
              {t('chat.newFileContent')}
            </small>
            <pre>
              {props.proposal.text}
            </pre>
          </section>
        </Fragment>
      );
    }
    if (props.proposal.kind === 'chapter_plan' || props.proposal.kind === 'chapter_summary') {
      /* 后端 prepare 返回的是可读的字段前后对照（不是 YAML/全文）；核对前先用提案自身内容兜底展示。 */
      const proposal = props.proposal
      const metaPrepared = prepared && (prepared.kind === 'chapter_plan' || prepared.kind === 'chapter_summary') ? prepared : null
      const fallback = proposal.kind === 'chapter_plan'
        ? proposal.beats.map((beat, index) => `${index + 1}. ${beat}`).join('\n')
        : CHAPTER_STATE_LABEL_ORDER.filter((key) => proposal.state[key]?.trim())
            .map((key) => `${t(CHAPTER_STATE_LABEL_KEYS[key])}：${proposal.state[key]}`).join('\n')
      return (
        <div className="proposal-diff">
          <section>
            <small>
              {t('chat.metaBefore')}
            </small>
            <pre>
              {metaPrepared?.before ?? ''}
            </pre>
          </section>
          <section>
            <small>
              {t('chat.metaAfter')}
            </small>
            <pre>
              {metaPrepared?.after ?? fallback}
            </pre>
          </section>
        </div>
      );
    }
    if (props.proposal.kind === 'split') {
      const splitPrepared = prepared?.kind === 'split' ? prepared : null
      return (
        <div className="proposal-diff">
          <section>
            <small>
              {t('chat.splitBefore')}
            </small>
            <pre>
              {splitPrepared?.before ?? ''}
            </pre>
          </section>
          <section>
            <small>
              {t('chat.splitAfter')}
            </small>
            <pre>
              {splitPrepared?.after ?? ''}
            </pre>
          </section>
          <section className="proposal-split-summary">
            <small>
              {t('chat.toNewFile')}
            </small>
            <code>
              {props.proposal.newPath}
            </code>
            {splitPrepared
              ? <small>
              {t('chat.splitChars', { head: splitPrepared.headChars, tail: splitPrepared.tailChars })}
            </small>
              : null}
          </section>
        </div>
      );
    }
    if (props.proposal.kind === 'merge') {
      const mergePrepared = prepared?.kind === 'merge' ? prepared : null
      return (
        <section className="proposal-merge-summary">
          <p>
            <code>
              {props.proposal.sourcePath}
            </code>
            {' → '}
            <code>
              {props.proposal.path}
            </code>
          </p>
          {mergePrepared
            ? <p>
            {t('chat.mergeChars', { pathChars: mergePrepared.pathChars, sourceChars: mergePrepared.sourceChars })}
          </p>
            : null}
          <small>
            {t('chat.mergeArchiveHint')}
          </small>
        </section>
      );
    }
    /* renames */
    return (
      <section className="proposal-renames">
        <ul>
          {props.proposal.renames.map((rename) => <li key={`${rename.from}->${rename.to}`}>
            <code>
              {rename.from}
            </code>
            {' → '}
            <code>
              {rename.to}
            </code>
          </li>)}
        </ul>
      </section>
    );
  }
  const renderBody = () => {
    const targets = renderTargets()
    const basis = renderBasis()
    if (!targets && !basis) return renderKindBody()
    return (
      <Fragment>
        {targets}
        {basis}
        {renderKindBody()}
      </Fragment>
    );
  }

  const canRecheckNow = state === 'deferred' || (state === 'expired' && canRecheck)
  const canUndo = state === 'applied' && props.proposal.kind === 'edit'
  const hasActions = state === 'ready' || canRecheckNow || canUndo
  const footer = <footer>
    <span
      className="proposal-status"
      role={state === 'expired' ? 'alert' : 'status'}>
      {state === 'checking' || state === 'applying' || state === 'undoing'
        ? <ActivityDots />
        : state === 'applied' || state === 'undone'
          ? <SuccessMark />
          : null}
      {note}
    </span>
    {hasActions ? <div className="proposal-actions">
      {state === 'ready' ? <button type="button" className="primary-action" onClick={() => void apply()}>
        {t('common.apply')}
      </button> : null}
      {state === 'ready' ? <button
        type="button"
        onClick={() => { setState('deferred'); setNote(t('chat.deferred')) }}>
        {t('chat.defer')}
      </button> : null}
      {state === 'ready' ? <button
        type="button"
        className="proposal-dismiss"
        onClick={() => { setState('ignored'); setNote(t('chat.ignoredNoChange')) }}>
        {t('common.ignore')}
      </button> : null}
      {canRecheckNow ? <button type="button" className="primary-action" onClick={() => void check()}>
        {t('chat.recheck')}
      </button> : null}
      {canUndo ? <button type="button" onClick={() => void undo()}>
        {t('chat.undoThis')}
      </button> : null}
    </div> : null}
  </footer>
  const titleBlock = <strong className="proposal-heading">
    {props.proposal.summary}
  </strong>
  const metaBlock = <div className="proposal-meta">
    {kindBadge ? <small className="proposal-kind">
      {kindBadge}
    </small> : null}
    <code className="proposal-path">
      {headerPathLabel}
    </code>
  </div>
  if (settled) {
    return (
      <details
        className={`proposal-card ${state} proposal-card-settled`}
        aria-label={t('chat.fileProposal')}>
        <summary>
          {titleBlock}
          {metaBlock}
          <span className="proposal-status" role="status">
            {state === 'applied' || state === 'undone' ? <SuccessMark /> : null}
            {note}
          </span>
        </summary>
        {renderBody()}
        {footer}
      </details>
    );
  }
  return (
    <article className={`proposal-card ${state}`} aria-label={t('chat.fileProposal')}>
      <header>
        {titleBlock}
        {metaBlock}
      </header>
      {renderBody()}
      {footer}
    </article>
  );
}

/** author_observe 的作者确认卡。确认后由 Shell 把 observation 作为新一行追加进 authorMemory。 */
export function MemoryCard(props: { memory: AuthorMemoryMarker; onAccept(observation: string): Promise<boolean> | boolean }) {
  const [state, setState] = useState<'ready' | 'saving' | 'saved' | 'rejected' | 'failed'>('ready')
  const [note, setNote] = useState('')
  const accept = async () => {
    if (state !== 'ready') return
    setState('saving'); setNote(t('chat.writingMemory'))
    let ok = false
    try {
      ok = Boolean(await props.onAccept(props.memory.observation))
    } catch {
      ok = false
    }
    if (ok) { setState('saved'); setNote(t('chat.remembered')) }
    else { setState('failed'); setNote(t('chat.memoryFull')) }
  }
  return (
    <article className={`memory-card ${state}`} aria-label={t('chat.memoryTitle')}>
      <section className="memory-observation">
        <p>
          {props.memory.observation}
        </p>
      </section>
      <section className="memory-reason">
        <small>
          {t('chat.why')}
        </small>
        <p>
          {props.memory.reason}
        </p>
      </section>
      <footer>
        <span role={state === 'failed' ? 'alert' : 'status'}>
          {state === 'saving' ? <ActivityDots /> : state === 'saved' ? <SuccessMark /> : null}
          {note}
        </span>
        {state === 'ready' ? <button type="button" onClick={() => void accept()}>
          {t('chat.remember')}
        </button> : null}
        {state === 'ready' ? <button
          type="button"
          onClick={() => { setState('rejected'); setNote(t('chat.ignoredMemory')) }}>
          {t('common.ignore')}
        </button> : null}
      </footer>
    </article>
  );
}

export function InitGuideCard(props: { state: 'explore' | 'interview'; busy: boolean; running: boolean; done: boolean; note: string; onStart(): void; onDismiss(): void }) {
  const explore = props.state === 'explore'
  return (
    <details className="init-guide-quiet" aria-label={t('chat.initQuietTitle')}>
      <summary>
        {t('chat.initQuietTitle')}
      </summary>
      <p>
        {explore ? t('chat.initExplore') : t('chat.initInterview')}
      </p>
      {props.done
        ? <p role="status">
        <SuccessMark />
        {' '}
        {t('chat.initDone')}
      </p>
        : <div className="init-guide-actions">
        <button
          type="button"
          disabled={props.busy || props.running}
          onClick={props.onStart}>
          {props.running ? <Fragment>
            <ActivityDots />
            {t('chat.initRunning')}
          </Fragment> : t('chat.initStart')}
        </button>
        <button type="button" disabled={props.busy} onClick={props.onDismiss}>
          {t('common.ignore')}
        </button>
      </div>}
      {props.note ? <small className="warning" role="alert">
        {props.note}
      </small> : null}
    </details>
  );
}

/** 旧版会话顶部的迁移横幅：新建写作会话继续作品，旧会话保持可读；关闭仅记忆在内存。 */
export function LegacyMigrationBanner(props: { onMigrate(): void; onDismiss(): void }) {
  return (
    <div
      className="migration-banner"
      role="note"
      aria-label={t('chat.legacyMigrationTitle')}>
      <p>
        {t('chat.legacyMigrationBanner')}
      </p>
      <div className="migration-banner-actions">
        <button type="button" onClick={props.onMigrate}>
          {t('chat.legacyMigrationAction')}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('common.close')}
          onClick={props.onDismiss}>
          ×
        </button>
      </div>
    </div>
  );
}

export function ProjectContextReceiptView({ receipt }: { receipt: ProjectContextReceiptBundle }) {
  /* V3 轻量请求的回执是 {sources:[]}：不展示空注入回执；V1/V2 历史消息照常渲染。 */
  if (!receipt.sources.length) return null
  const fixed = receipt.sources.filter((item) => item.kind !== 'worldbook')
  const includedFixed = fixed.filter((item) => item.status === 'included' && item.includedChars > 0).length
  const worldbook = receipt.sources.filter((item) => item.kind === 'worldbook')
  const matchedByText = (value: string | undefined) => value === 'both' ? t('chat.requestAndDoc') : value === 'saved-document' ? t('chat.currentDoc') : t('chat.thisRequest')
  return (
    <details className="project-context-receipt">
      <summary>
        {`${t('chat.contextSummary', { included: includedFixed, total: fixed.length, worldbook: worldbook.length })}${receipt.authorPreferencesChars ? t('chat.contextAuthorPref', { count: receipt.authorPreferencesChars }) : ''}${receipt.authorMemoryChars ? t('chat.contextAuthorMemory', { count: receipt.authorMemoryChars }) : ''}`}
      </summary>
      <ul>
        {receipt.sources.map((item) => <li key={item.path}>
          <code>
            {item.path}
          </code>
          {` · ${item.status === 'included'
            ? item.includedChars > 0 ? t('chat.includedChars', { count: item.includedChars }) : item.truncated ? t('chat.notIncludedCap') : t('chat.emptyFile')
            : item.status === 'missing' ? t('chat.missingFile') : t('chat.readFailed')}`}
          {item.truncated ? t('chat.truncated') : ''}
          {item.kind === 'worldbook' ? t('chat.worldbookMatch', { priority: item.priority ?? 0, matched: `${matchedByText(item.matchedBy)}${item.matchedTriggers?.length ? ` (${item.matchedTriggers.join('、')})` : ''}` }) : ''}
          {item.version ? ` · ${item.version}` : ''}
        </li>)}
      </ul>
      {receipt.scan ? <p className="muted">
        {t('chat.worldbookScan', { scanned: receipt.scan.scanned, unmatched: receipt.scan.unmatched, disabled: receipt.scan.disabled, invalid: receipt.scan.invalid, limits: receipt.scan.limits, errors: receipt.scan.readErrors })}
      </p> : null}
    </details>
  );
}

type ChatRowViewProps = {
  row: ChatRow
  ctx: ShellContext
  sessionId: string
  locale: Locale
  /* 注册表内容变化用 tick 破坏 memo(对象本身原地可变)。 */
  cardTick: number
  enter: boolean
  messageCards?: ShellMessageCardRegistry
  messageCardContext: ShellMessageCardContext
  onApplied(path: string): void
  onAcceptMemory(observation: string): Promise<boolean> | boolean
}

/* 单行 memo:流式期间 transcript 每个令牌都换新引用,但 rows 按 nodes 引用缓存,
   未变化的行凭稳定的 row/props 引用跳过重渲染(Markdown 也随之跳过 parseBlocks);
   locale/cardTick 变化会破坏 memo,保证 t() 文案与插件卡及时更新。 */
const ChatRowView = memo(function ChatRowView(props: ChatRowViewProps) {
  const { row } = props
  if (row.proposal) return (
    <ProposalCard
      ctx={props.ctx}
      sessionId={props.sessionId}
      proposal={row.proposal}
      onApplied={props.onApplied} />
  );
  if (row.memory) return <MemoryCard memory={row.memory} onAccept={props.onAcceptMemory} />;
  const registered = row.toolName ? props.messageCards?.get(row.toolName) : undefined
  const pluginCard = registered?.render({ result: row.result ?? row.content ?? row.text, context: props.messageCardContext })
  if (pluginCard != null) return (
    <Fragment>
      {pluginCard}
    </Fragment>
  );
  if (row.role === 'thinking') {
    return (
      <ChatEntry as="details" className="chat-row thinking" enter={props.enter}>
        <summary>
          {t('chat.thinkingProcess')}
        </summary>
        <p>
          {row.text}
        </p>
      </ChatEntry>
    );
  }
  if (row.role === 'tool' && row.error) {
    return (
      <ChatEntry
        as="details"
        className={row.recovered ? 'chat-row tool recovered' : 'chat-row tool error'}
        role={row.recovered ? undefined : 'status'}
        enter={props.enter}>
        <summary>
          {row.recovered ? row.text : `⚠ ${row.text}`}
        </summary>
        {row.reason ? <p className="tool-error-reason">
          {row.reason}
        </p> : null}
        {row.content ? <pre>
          {row.content}
        </pre> : null}
        {row.detail ? <small>
          {row.detail}
        </small> : null}
      </ChatEntry>
    );
  }
  if (row.role === 'tool' && row.content) {
    return (
      <ChatEntry as="details" className="chat-row tool" enter={props.enter}>
        <summary>
          {row.text}
        </summary>
        <pre>
          {row.content}
        </pre>
        {row.detail ? <small>
          {row.detail}
        </small> : null}
      </ChatEntry>
    );
  }
  return (
    <ChatEntry className={`chat-row ${row.role}`} enter={props.enter}>
      {row.role === 'assistant' && row.text
        ? <div className="md">
        <Markdown text={row.text} />
      </div>
        : <p>
        {row.text || t('chat.noText')}
      </p>}
      {row.detail ? <small>
        {row.detail}
      </small> : null}
      {row.projectContextReceipt ? <ProjectContextReceiptView receipt={row.projectContextReceipt} /> : null}
    </ChatEntry>
  );
})

/* 停止必须在 cancel 结算后松开 outgoing；拒绝或 RPC 失败也不能把发送闸门永久锁在 accepted。
   与 rows 对齐后的清场仍由 outgoingIsCanonical 负责，这里只覆盖显式停止。 */
export async function settleConversationStop(input: {
  cancel(): Promise<unknown>
  releaseOutgoing(): void
}): Promise<void> {
  try {
    await input.cancel()
  } finally {
    input.releaseOutgoing()
  }
}

export function Chat({ ctx, session, workspaceId, activePath, authorPreferences, authorMemory, chatModel, onAcceptMemory, hidden, overlay, onConfigure, onApplied, onWritten, onDraftDirtyChange }: { ctx: ShellContext; session: SessionFace; workspaceId?: WorkspaceId; activePath?: string; authorPreferences: string; authorMemory: string; chatModel?: WritingModelRoute; onAcceptMemory(observation: string): Promise<boolean> | boolean; hidden: boolean; overlay?: boolean; onConfigure(): void; onApplied(path: string): void; onWritten?(path: string): void; onDraftDirtyChange(dirty: boolean): void }) {
  const locale = useLocale()
  const messageCards = (ctx as ShellContext & { [MESSAGE_CARDS_SERVICE]?: ShellMessageCardRegistry })[MESSAGE_CARDS_SERVICE]
  const [messageCardTick, setMessageCardTick] = useState(0)
  useEffect(() => messageCards?.subscribe(() => setMessageCardTick((value) => value + 1)), [messageCards])
  const sessionSource = useMemo(() => {
    const sessionId = session.sessionId
    if (isObservableSource(session)) return session
    const fallback: ChatLifecycle = {
      sessionId,
      queue: [],
      running: false,
      openState: 'open',
      promptError: null,
    }
    return {
      getSnapshot: (): ChatLifecycle => fallback,
      subscribe: () => () => {},
    }
  }, [session])
  const lifecycle = useObservable(sessionSource) as ChatLifecycle
  const snapshot = lifecycle
  const chatSource = useMemo(() => conversationChatSource(ctx, session.sessionId), [ctx, session.sessionId])
  const chat = useObservable(chatSource)
  const transcript = chat?.legacy ?? EMPTY_TRANSCRIPT
  const chatLegacy = transcript
  const pendingRaw = useObservable(ctx.uiSession?.pendingInteractions ?? EMPTY_PENDING)
  const pendingItems = useMemo(
    () => pendingForSession(pendingRaw as ReadonlyMap<SessionId, PendingInteraction> | PendingInteraction[], session.sessionId),
    [pendingRaw, session.sessionId],
  )
  const sessionList = useObservable(ctx.sessions.list)
  const workspaceList = useObservable(ctx.workspaces.list)
  const legacyEditor = shouldRunLegacyNovelPipeline(sessionAgentPreset(sessionList.byId, session.sessionId))
  const connectionState = useObservable(isObservableSource(ctx.connection.state) ? ctx.connection.state : DISCONNECTED)
  const connected = connectionState === 'connected'
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const [outgoing, setOutgoing] = useState<{ text: string; state: 'sending' | 'accepted' | 'failed'; afterRows: number; projectContextReceipt?: ProjectContextReceiptBundle } | null>(null)
  const [renamingConversation, setRenamingConversation] = useState(false)
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false)
  const conversationMenuTrigger = useRef<HTMLButtonElement | null>(null)
  const conversationMenuYields = useRef(false)
  const [conversationBusy, setConversationBusy] = useState(false)
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({})
  const [draftConfirm, setDraftConfirm] = useState<{ resolve(value: boolean): void } | null>(null)
  const [presetPicker, setPresetPicker] = useState<{
    kind: 'closed' | 'loading' | 'list-error' | 'ready'
    presets: ConversationPresetChoice[]
    selectedId?: string
    pendingSessionId?: SessionId
    error?: string
    busy?: boolean
  }>({ kind: 'closed', presets: [] })
  const newConversationButton = useRef<HTMLButtonElement | null>(null)
  const [modelRevision, setModelRevision] = useState(0)
  const titleAttempted = useRef(new Set<string>())
  /* 迁移横幅的关闭按会话记在内存里，不落盘。 */
  const [dismissedMigrations, setDismissedMigrations] = useState<ReadonlySet<string>>(new Set())
  const historyRef = useRef<HTMLDivElement | null>(null)
  const bottomPinnedRef = useRef(true)
  useEffect(() => {
    const error = takeCreatedChatModelError(session.sessionId)
    if (error) setNote(error)
  }, [session.sessionId])
  const internalIndexActive = useMemo(() => internalIndexTurnActive(transcript), [transcript.nodes])
  /* 初始化回合的思考/流式正文也照常显示,不再强制清空,避免t('chat.replying')随流式块一闪一闪。 */
  const partial = useMemo(() => partialView(transcript), [transcript.partial])
  /* rows 只依赖 nodes 引用:流式期间 partial 每个令牌都换新对象,但 nodes 引用不变,
     历史行得以凭缓存引用跳过重渲染;t() 文案(停止标记/通知行)随 locale 一起失效。 */
  const rows = useMemo(() => chatRows(transcript), [transcript.nodes, locale])
  const visibleCalls = useMemo(() => visibleRunningCalls(transcript.runningCalls ?? []), [transcript.runningCalls])
  /* 流式更新跟随到底部；用户主动上翻阅读时松开，回到底部附近再重新跟随。
     依赖全部是记忆化数据:只有历史内容真的变化才补 scrollTop,draft 输入等
     无关重渲染不再触发;用 layout effect 在绘制前完成,避免跟随时闪一帧。 */
  useLayoutEffect(() => {
    const el = historyRef.current
    if (el && bottomPinnedRef.current) el.scrollTop = el.scrollHeight
  }, [rows, partial, outgoing, visibleCalls, snapshot.queue, pendingItems])
  const historyPrimed = useRef(false)
  const primedEmpty = useRef(false)
  const initialMessageIds = useRef(new Set<string>())
  const chatAttached = Boolean(conversationFace(ctx) && resolveConversationChatTarget(ctx, session.sessionId))
  useLayoutEffect(() => {
    if (!historyPrimed.current) {
      if (!chatAttached && rows.length === 0) return
      for (const row of rows) initialMessageIds.current.add(row.id)
      historyPrimed.current = true
      primedEmpty.current = rows.length === 0
      return
    }
    if (primedEmpty.current && rows.length > 0 && !outgoing) {
      for (const row of rows) initialMessageIds.current.add(row.id)
      primedEmpty.current = false
    }
  }, [chatAttached, rows, outgoing])
  const isNewMessage = (id: string): boolean => historyPrimed.current && !initialMessageIds.current.has(id)
  const hasTurnError = rows.some((row) => row.id.startsWith('turn-error:'))
  const workspace = workspaceList.items.find((item) => item.workspaceId === workspaceId)
  const initScope = useMemo(() => ctx.settingsScope.bind({ namespace: INIT_SETTINGS_NAMESPACE, decode: decodeInitSettings }), [ctx])
  const initSettings = useObservable(initScope)
  const conversationScope = useMemo(() => ctx.settingsScope.bind({ namespace: CONVERSATION_SETTINGS_NAMESPACE, decode: decodeConversationSettings }), [ctx])
  const conversationSettings = useObservable(conversationScope)
  const developerScope = useMemo(() => ctx.settingsScope.bind({ namespace: DEVELOPER_SETTINGS_NAMESPACE, decode: decodeDeveloperSettings }), [ctx])
  const developerSettings = useObservable(developerScope)
  const developerMode = developerSettings.value?.developerMode === true
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
    if (!legacyEditor || !workspaceId || !workspacePath) return
    let live = true
    void safeRpcCall<ProjectInspectionResponse>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.inspect', { workspacePath })).then((result) => {
      if (live && result.ok) setInspection(result.value)
    })
    return () => { live = false }
  }, [ctx.connection, workspaceId, workspacePath, legacyEditor])
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
    if (!legacyEditor || !runningJustStopped) return
    if (!shouldAutoIndexAfterInterview({
      initState,
      initCompleted,
      appliedDuringInterview: appliedDuringInterviewRef.current,
      running: snapshot.running,
      alreadyTriggered: autoIndexTriggeredRef.current,
    })) return
    autoIndexTriggeredRef.current = true
    void startExploreInit(ctx, session.sessionId)
  }, [snapshot.running, initState, initCompleted, ctx, session.sessionId, legacyEditor])
  const startInitGuide = () => {
    if (initBusy || initState === 'done') return
    setInitBusy(true); setInitNote('')
    void (async () => {
      const ok = initState === 'explore'
        ? await startExploreInit(ctx, session.sessionId)
        : Boolean((await send(session, buildInterviewPrompt()))?.ok)
      if (!ok) setInitNote(t('chat.initFailed'))
      else if (initState === 'interview') setInitCompleted(true)
      setInitBusy(false)
    })()
  }
  const dismissInitGuide = () => {
    if (!workspaceId) return
    setInitDismissedLocal(true)
    const current = initScope.getSnapshot().value?.dismissedWorkspaceIds ?? []
    if (current.includes(workspaceId)) return
    void initScope.set('dismissedWorkspaceIds', [...current, workspaceId]).catch(() => setInitNote(t('chat.initIgnoreFailed')))
  }
  /* 采访式初始化已开始时,记录"采访期间有提案被应用",供上面的 effect 在
   * 会话空闲时自动接上"建立作品索引"。非采访态或还没开始就只是透传。
   * useCallback 让已挂载的提案行在流式期间凭稳定引用跳过 memo 重渲染。 */
  const handleApplied = useCallback((path: string) => {
    if (legacyEditor && initState === 'interview' && initCompleted) {
      appliedDuringInterviewRef.current = true
      /* 典型场景是回合已结束、作者才点t('common.apply')：此时 running 不会再有 true→false 跳变，
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
  }, [legacyEditor, initState, initCompleted, snapshot.running, ctx, session.sessionId, onApplied])
  /* 记忆化:整份 context 作为 memo 行的 prop,引用稳定行才跳得过重渲染。 */
  const messageCardContext = useMemo<ShellMessageCardContext>(() => ({
    sessionId: session.sessionId,
    locale,
    onApplied: (path) => onWritten?.(path),
    refresh: (scope) => {
      if (scope === 'overview') return
      if (scope === 'tree') onWritten?.('')
      else onWritten?.(activePath ?? '')
    },
    note: setNote,
  }), [session.sessionId, locale, onWritten, activePath])
  /* 项目里任何对话已有内容，就视为作者选择了直接聊天，不再展示引导；
   * 除非初始化正在跑或刚跑完，保留进行/完成反馈。 */
  const workspaceHasConversation = sessionList.ids.some((id) => {
    const item = sessionList.byId?.[id]
    return Boolean(item && workspace?.sessionIds.includes(id) && !item.blank)
  })
  const initEngaged = initBusy || initCompleted || (initState === 'explore' && internalIndexActive)
  const showInitGuide = legacyEditor && shouldShowInitGuide({
    hasWorkspace: Boolean(workspace),
    inspected: Boolean(inspection),
    initState,
    dismissed: initDismissed,
    interviewCompleted: initState === 'interview' && initCompleted,
    engaged: initEngaged,
    workspaceHasConversation,
  })
  const showMigrationBanner = shouldShowMigrationBanner({
    legacy: legacyEditor,
    dismissed: dismissedMigrations.has(session.sessionId),
  })
  /* 空白列占位:没有任何历史行,且引导卡与在途内容(发送中/排队/运行中/思考/审批)都不在时,
     给一句 muted 提示,避免空对话只剩一列空白。 */
  const showEmptyHistory = rows.length === 0
    && !showInitGuide
    && !outgoing
    && !snapshot.running
    && snapshot.queue.length === 0
    && visibleCalls.length === 0
    && !partial.text
    && !partial.thinking
    && pendingItems.length === 0
  const sessionIds = sessionList.ids.filter((id) => workspace?.sessionIds.includes(id))
  const workspaceSessionIds = sessionIds.length ? sessionIds : [session.sessionId]
  const hostArchivedIds = workspaceList.archivedSessionIds ?? []
  const workRecord = conversationWorkRecord(conversationSettings.value ?? DEFAULT_CONVERSATION_SETTINGS, workspaceId)
  const conversationTitles = {
    ...Object.fromEntries(Object.entries(sessionList.byId ?? {}).map(([id, value]) => [id, value.title])),
    ...workRecord.titles,
    ...titleOverrides,
  }
  const conversations = conversationRows({
    workspaceSessionIds,
    archivedIds: [...workRecord.archivedIds, ...hostArchivedIds],
    forgottenIds: workRecord.tombstoneIds,
    reusableBlankIds: Object.values(sessionList.byId ?? {}).filter((item) => item.blank).map((item) => item.id),
    currentId: session.sessionId,
    titles: conversationTitles,
  })
  const archivedConversations = archivedConversationRows({
    workspaceSessionIds,
    archivedIds: workRecord.archivedIds,
    forgottenIds: [...workRecord.tombstoneIds, ...hostArchivedIds],
    currentId: session.sessionId,
    titles: conversationTitles,
  })
  const currentIsArchived = workRecord.archivedIds.includes(session.sessionId)
  const canMutateConversation = conversations.some((item) => item.id !== session.sessionId) || canArchiveOrDeleteConversation(conversations.length)
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
    const updatedAt = (summary as unknown as { updatedAt?: unknown } | undefined)?.updatedAt
    const title = nextAutomaticConversationTitle({
      durableTitle: workRecord.titles[session.sessionId] ?? titleOverrides[session.sessionId] ?? summary?.title?.trim(),
      assistantReplies: rows.filter((row) => row.role === 'assistant').map((row) => row.text),
      attempted: titleAttempted.current.has(session.sessionId),
      date: typeof updatedAt === 'number' ? updatedAt : Date.now(),
    })
    if (!title) return
    titleAttempted.current.add(session.sessionId)
    queueConversationRename(title, t('chat.renameAutoFailed'))
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
    setTitleOverrides((current) => ({ ...current, [session.sessionId]: title }))
    queueConversationRename(title, t('chat.renameFailed'))
    void persistConversationWork({
      ...workRecord,
      titles: { ...workRecord.titles, [session.sessionId]: title },
    }).catch(() => setNote(t('chat.renameFailed')))
  }

  const applyDefaultChatModel = async (sessionId: SessionId) => {
    let groups: SessionModels['groups'] = []
    const preferred = resolveNewConversationModel({ preferred: chatModel })
    if (!preferred) {
      const catalog = await readModels(ctx.remote.session, session)
      if (catalog.ok) groups = catalog.value.groups
    }
    const route = preferred ?? resolveNewConversationModel({ groups })
    if (!route) return
    const selected = await selectModel(ctx.remote.session, sessionId, route.provider, route.model)
    if (!selected.ok) rememberCreatedChatModelError(sessionId, t('chat.defaultModelFailed'))
    else discardCreatedChatModelError(sessionId)
  }
  const closePresetPicker = () => {
    setPresetPicker({ kind: 'closed', presets: [] })
  }
  const createConversation = async () => {
    if (!workspaceId || conversationBusy || presetPicker.kind !== 'closed') return
    try {
      const started = await startNewConversationPresetFlow({
        canDiscardDraft: () => canDiscardDraft('__new-conversation__'),
        list: () => {
          setConversationBusy(true)
          setNote('')
          return ctx.remote.agentPresets.list()
        },
        projection: { developerMode },
      })
      if (started.kind === 'blocked') return
      if (started.kind === 'list-error') {
        setPresetPicker({ kind: 'list-error', presets: [], error: started.error })
        return
      }
      setPresetPicker({
        kind: 'ready',
        presets: started.presets,
        selectedId: firstAvailableConversationPreset(started.presets),
      })
    } catch {
      setPresetPicker({ kind: 'list-error', presets: [], error: t('chat.presetListFailed') })
    } finally {
      setConversationBusy(false)
    }
  }
  const retryPresetList = async () => {
    if (presetPicker.busy) return
    const pendingSessionId = presetPicker.pendingSessionId
    setPresetPicker((current) => ({ ...current, kind: 'loading', error: undefined }))
    const loaded = await loadNewConversationPresets(() => ctx.remote.agentPresets.list(), { developerMode })
    if (!loaded.ok) {
      setPresetPicker({ kind: 'list-error', presets: [], pendingSessionId, error: loaded.error })
      return
    }
    setPresetPicker({
      kind: 'ready',
      presets: loaded.presets,
      selectedId: firstAvailableConversationPreset(loaded.presets),
      pendingSessionId,
    })
  }
  const confirmPresetPicker = async () => {
    if (!workspaceId || presetPicker.kind !== 'ready' || presetPicker.busy) return
    if (!canConfirmConversationPreset(presetPicker.presets, presetPicker.selectedId)) return
    const presetId = presetPicker.selectedId
    if (!presetId) return
    const pendingSessionId = presetPicker.pendingSessionId
    setPresetPicker((current) => ({ ...current, busy: true, error: undefined }))
    setConversationBusy(true)
    try {
      const result = await confirmNewConversationPreset({
        create: ({ workspaceId }) => ctx.sessions.create({ workspaceId }),
        select: (sessionId, id) => ctx.remote.agentPresets.select(sessionId, id),
        applyDefaultModel: applyDefaultChatModel,
        open: (id) => {
          openConversation(id)
          if (id === session.sessionId) {
            const error = takeCreatedChatModelError(id)
            if (error) setNote(error)
          }
        },
      }, { workspaceId, presetId, pendingSessionId, allowCustomPreset: developerMode, allowedPresetIds: presetPicker.presets.map((preset) => preset.id) })
      if (!result.ok) {
        setPresetPicker((current) => ({
          ...current,
          kind: current.kind === 'closed' ? 'ready' : current.kind,
          pendingSessionId: result.sessionId ?? pendingSessionId,
          error: result.error,
          busy: false,
        }))
        return
      }
      closePresetPicker()
    } finally {
      setConversationBusy(false)
    }
  }
  const cancelPresetPicker = () => {
    if (presetPicker.busy) return
    const pendingSessionId = presetPicker.pendingSessionId
    closePresetPicker()
    void cancelNewConversationPresetPicker({
      pendingSessionId,
      archive: (id) => ctx.workspaces.archiveSession(id),
    })
  }
  const persistConversationWork = async (record: typeof workRecord) => {
    if (!workspaceId) throw new Error('workspace unavailable')
    const current = conversationScope.getSnapshot().value ?? DEFAULT_CONVERSATION_SETTINGS
    await conversationScope.set('works', putConversationWork(current, workspaceId, record).works)
  }
  const leaveIfCurrent = async (id: string) => {
    if (id !== session.sessionId) return true
    const nextId = nextVisibleConversationId(conversations.map((item) => item.id), id)
    if (!nextId) return false
    if (!(await canDiscardDraft(nextId))) return false
    openConversation(nextId as SessionId)
    return true
  }
  const archiveConversation = async (id: string) => {
    if (!workspaceId || conversationBusy || !canMutateConversation) return
    setConversationMenuOpen(false)
    if (!(await leaveIfCurrent(id))) return
    setConversationBusy(true)
    setNote('')
    try {
      await persistConversationWork({
        ...workRecord,
        archivedIds: archiveConversationIds(workRecord.archivedIds, id),
      })
    } catch {
      setNote(t('chat.archiveFailed'))
    } finally {
      setConversationBusy(false)
    }
  }
  const restoreConversation = async (id: string) => {
    if (!workspaceId || conversationBusy) return
    setConversationMenuOpen(false)
    if (!(await canDiscardDraft(id))) return
    setConversationBusy(true)
    setNote('')
    try {
      await persistConversationWork({
        ...workRecord,
        archivedIds: restoreConversationIds(workRecord.archivedIds, id),
      })
      openConversation(id as SessionId)
    } catch {
      setNote(t('chat.restoreFailed'))
    } finally {
      setConversationBusy(false)
    }
  }
  const outgoingIsCanonical = Boolean(outgoing && rows.slice(outgoing.afterRows)
    .some((row) => row.role === 'user' && row.text.trim() === outgoing.text))
  const composerCanSubmit = canSubmitComposer({
    draft,
    connected: Boolean(connected),
    removed: snapshot.removed === true,
    outgoingState: outgoing?.state,
  })
  useEffect(() => {
    if (outgoingIsCanonical) setOutgoing(null)
  }, [outgoingIsCanonical])
  const currentConversationTitle = conversations.find((item) => item.id === session.sessionId)?.title
    ?? archivedConversations.find((item) => item.id === session.sessionId)?.title
    ?? t('chat.newConversation')
  const renameInitialValue = workRecord.titles[session.sessionId]
    ?? titleOverrides[session.sessionId]
    ?? (currentConversationTitle === t('chat.newConversation') ? '' : currentConversationTitle)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!composerCanSubmit) return
    const value = draft.trim()
    bottomPinnedRef.current = true
    setOutgoing({ text: value, state: 'sending', afterRows: rows.length })
    setDraft('')
    setNote('')
    if (!legacyEditor) {
      void send(session, value).then((result) => {
        if (!result || !result.ok) {
          setOutgoing((current) => current?.text === value ? { ...current, state: 'failed' } : current)
          setNote(t('chat.sendFailedRetry'))
          return
        }
        setOutgoing((current) => current?.text === value ? { ...current, state: 'accepted' } : current)
      }).catch(() => {
        setOutgoing((current) => current?.text === value ? { ...current, state: 'failed' } : current)
        setNote(t('chat.sendFailedRetry'))
      })
      return
    }
    let contextCompileFailed = false
    void sendProjectContext(session, value, async () => {
      const compiled = await safeRpcCall<{ serialized: string; receipt: ProjectContextReceiptBundle }>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'context.compile', { sessionId: session.sessionId, userRequest: value, activePath, authorPreferences, authorMemory }))
      if (!compiled.ok) { contextCompileFailed = true; throw new Error('context unavailable') }
      return { serialized: compiled.value.serialized, receipt: compiled.value.receipt }
    }).then((outcome) => {
      const result = outcome?.result
      /* V3 回执 sources 为空时不挂回执，避免渲染空注入清单。 */
      const receipt = outcome && outcome.receipt.sources.length ? outcome.receipt : undefined
      if (receipt) setOutgoing((current) => current?.text === value ? { ...current, projectContextReceipt: receipt } : current)
      if (!result || !result.ok) {
        setOutgoing((current) => current?.text === value ? { ...current, state: 'failed' } : current)
        setNote(t('chat.sendFailedRetry'))
        return
      }
      setOutgoing((current) => current?.text === value ? { ...current, state: 'accepted' } : current)
    }).catch(() => {
      setOutgoing((current) => current?.text === value ? { ...current, state: 'failed' } : current)
      if (contextCompileFailed) {
        setDraft((current) => current || value)
        setNote(t('chat.contextBlocked'))
      } else setNote(t('chat.sendFailedRetry'))
    })
  }
  return (
    <aside
      className={overlay ? 'chat chat-overlay' : 'chat'}
      aria-label={t('chat.assistant')}
      hidden={hidden}
      {...(hidden ? { inert: '' } : {})}
      data-chat-face={conversationFace(ctx) ? 'official' : 'missing'}
      data-chat-nodes={String(transcript.nodes.length)}>
      <header className="chat-header">
        <div className="conversation-select">
          <Select
            value={session.sessionId}
            aria-label={t('chat.switchConversation')}
            title={currentConversationTitle}
            selectedLabel={currentConversationTitle}
            options={conversations.map((item) => ({ value: item.id, label: item.title }))}
            onChange={(next) => void switchConversation(next)} />
        </div>
        <div className="chat-header-actions">
          {connected ? null : <span className="chat-status" role="status">
            <ActivityDots />
            {t('chat.reconnecting')}
          </span>}
          <button
            ref={newConversationButton}
            className="icon-button"
            type="button"
            title={t('chat.newConversation')}
            aria-label={t('chat.newConversation')}
            disabled={conversationBusy || !workspaceId || presetPicker.kind !== 'closed'}
            onClick={() => { void createConversation() }}>
            ＋
          </button>
          <div className="conversation-menu">
            <Menu
              open={conversationMenuOpen}
              onOpenChange={(open: boolean) => { if (open) conversationMenuYields.current = false; setConversationMenuOpen(open) }}>
              <MenuTrigger
                ref={conversationMenuTrigger}
                className="icon-button"
                title={t('chat.conversationActions')}
                aria-label={t('chat.conversationActions')}
                disabled={conversationBusy}>
                ⋯
              </MenuTrigger>
              <MenuContent
                className="conversation-menu-pop"
                align="end"
                aria-label={t('chat.conversationActions')}
                onCloseAutoFocus={(event: Event) => {
                  if (conversationMenuYields.current) event.preventDefault()
                }}>
                <MenuItem
                  disabled={conversationBusy}
                  onSelect={() => { conversationMenuYields.current = true; setRenamingConversation(true) }}>
                  {t('chat.renameConversation')}
                </MenuItem>
                <MenuItem
                  disabled={conversationBusy || currentIsArchived || !canMutateConversation}
                  title={!canMutateConversation ? t('chat.archiveNeedAnother') : undefined}
                  onSelect={() => { void archiveConversation(session.sessionId) }}>
                  {t('common.archive')}
                </MenuItem>
                <MenuItem
                  disabled={conversationBusy || !currentIsArchived}
                  onSelect={() => { void restoreConversation(session.sessionId) }}>
                  {t('common.restore')}
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
      </header>
      {archivedConversations.length ? <details className="archived-conversations">
        <summary>
          {t('chat.archivedConversations')}
        </summary>
        <ul>
          {archivedConversations.map((item) => <li key={item.id}>
            <span>
              {item.title}
            </span>
            <button
              type="button"
              disabled={conversationBusy}
              onClick={() => void restoreConversation(item.id)}>
              {t('common.restore')}
            </button>
          </li>)}
        </ul>
      </details> : null}
      {showMigrationBanner ? <LegacyMigrationBanner
        onMigrate={() => { void createConversation() }}
        onDismiss={() => setDismissedMigrations((current) => new Set(current).add(session.sessionId))} /> : null}
      <div
        className="chat-history"
        ref={historyRef}
        data-running={snapshot.running ? 'true' : 'false'}
        onScroll={(event: { currentTarget: HTMLDivElement }) => {
          const el = event.currentTarget
          bottomPinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}>
        {showInitGuide ? <InitGuideCard
          state={initState as 'explore' | 'interview'}
          busy={initBusy}
          running={initState === 'explore' ? internalIndexActive : snapshot.running}
          done={initCompleted}
          note={initNote}
          onStart={startInitGuide}
          onDismiss={dismissInitGuide} /> : null}
        {snapshot.hasMore ? <button
          type="button"
          onClick={() => void loadOlder(session)}
          disabled={snapshot.loadingOlder}>
          {snapshot.loadingOlder ? <Fragment>
            <ActivityDots />
            {t('chat.loadingMore')}
          </Fragment> : t('chat.loadOlder')}
        </button> : null}
        {rows.map((row) => <ChatRowView
          key={row.id}
          row={row}
          ctx={ctx}
          sessionId={session.sessionId}
          locale={locale}
          cardTick={messageCardTick}
          enter={isNewMessage(row.id)}
          messageCards={messageCards}
          messageCardContext={messageCardContext}
          onApplied={handleApplied}
          onAcceptMemory={onAcceptMemory} />)}
        {showEmptyHistory ? <p className="chat-empty">
          {t('chat.emptyHistory')}
        </p> : null}
        {outgoing && !outgoingIsCanonical ? <ChatEntry
          className="chat-row user"
          key="local-outgoing"
          enter={isNewMessage('local-outgoing')}>
          <p>
            {outgoing.text}
          </p>
          {outgoing.projectContextReceipt ? <ProjectContextReceiptView receipt={outgoing.projectContextReceipt} /> : null}
          <small role={outgoing.state === 'failed' ? 'alert' : 'status'}>
            {outgoing.state === 'sending'
              ? <Fragment>
              <ActivityDots />
              {t('chat.sending')}
            </Fragment>
              : outgoing.state === 'accepted'
                ? <Fragment>
              <SuccessMark />
              {' '}
              {t('chat.sent')}
            </Fragment>
                : t('chat.sendFailed')}
          </small>
        </ChatEntry> : null}
        {outgoing?.state === 'accepted' && !outgoingIsCanonical
          ? <ChatEntry
          className="chat-row assistant"
          key="local-replying"
          aria-live="polite"
          enter={isNewMessage('local-replying')}>
          <ActivityDots variant="typing" />
          {t('chat.replying')}
        </ChatEntry>
          : null}
        {visibleCalls.map((call) => <ChatEntry
          className="chat-row tool"
          key={`running:${call.callId}`}
          enter={isNewMessage(`running:${call.callId}`)}>
          <strong>
            <ActivityDots variant="typing" />
            {call.name === 'glob' || call.name === 'grep' ? t('chat.searchingNotes') : call.name === 'read' ? t('chat.readingNotes') : call.name === 'novel_propose' || call.name === WRITING_PROPOSE_TOOL_NAME ? t('chat.preparingProposal') : t('chat.processing')}
          </strong>
        </ChatEntry>)}
        {snapshot.queue.map((item) => <ChatEntry
          className="chat-row notice"
          key={`queue:${item.id}`}
          enter={isNewMessage(`queue:${item.id}`)}>
          <p>
            {item.preview}
          </p>
          <small>
            {item.placement === 'queued' ? t('chat.queued') : t('chat.steering')}
          </small>
        </ChatEntry>)}
        {partial.thinking ? <ChatEntry
          as="details"
          className="chat-row thinking"
          key="partial-thinking"
          enter={isNewMessage('partial-thinking')}>
          <summary aria-live="polite">
            <ActivityDots variant="typing" />
            {t('chat.thinking')}
          </summary>
          <p>
            {partial.thinking}
          </p>
        </ChatEntry> : null}
        {partial.text ? <ChatEntry
          className="chat-row assistant"
          key="partial-text"
          aria-live="polite"
          enter={isNewMessage('partial-text')}>
          <div className="md">
            <Markdown text={partial.text} />
          </div>
        </ChatEntry> : chatLegacy.partial && !partial.thinking ? <ChatEntry
          className="chat-row assistant"
          key="partial-replying"
          aria-live="polite"
          enter={isNewMessage('partial-replying')}>
          <ActivityDots variant="typing" />
          {t('chat.replying')}
        </ChatEntry> : null}
        {pendingItems.map((item) => <PendingCard key={item.key} item={item} />)}
        {snapshot.openState === 'error' ? <p className="warning">
          {t('chat.connectionInterrupted')}
        </p> : null}
        {snapshot.promptError && !hasTurnError ? <p className="warning">
          {t('chat.requestFailed')}
        </p> : null}
      </div>
      <form className="composer" onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (!shouldSubmitComposer({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) return
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }}
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.inputLabel')} />
        {note ? <small className="warning">
          {note}
        </small> : null}
        <div className="composer-toolbar">
          <div className="composer-model">
            <ModelPicker
              key={`${session.sessionId}:${modelRevision}`}
              ctx={ctx}
              session={session}
              onConfigure={onConfigure} />
          </div>
          <div className="composer-actions">
            {snapshot.running ? <button
              type="button"
              className="icon-button chat-stop"
              title={t('chat.stop')}
              aria-label={t('chat.stop')}
              onClick={() => {
                void settleConversationStop({
                  cancel: () => stop(session),
                  releaseOutgoing: () => setOutgoing(null),
                })
              }}>
              <StopIcon size={14} />
            </button> : null}
            <button
              className="send"
              type="submit"
              disabled={!composerCanSubmit}
              title={t('chat.send')}
              aria-label={t('chat.send')}>
              <svg
                viewBox="0 0 24 24"
                width={16}
                height={16}
                fill="none"
                stroke="currentColor"
                stroke-width={2}
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
                focusable="false">
                <path d="m22 2-7 20-4-9-9-4Z" />
                <path d="M22 2 11 13" />
              </svg>
            </button>
          </div>
        </div>
      </form>
      <TextPromptDialog
        open={Boolean(renamingConversation)}
        id="rename-conversation"
        title={t('chat.renameConversation')}
        label={t('chat.conversationName')}
        initialValue={renameInitialValue}
        confirmLabel={t('chat.saveName')}
        returnFocusRef={conversationMenuTrigger}
        onCancel={() => setRenamingConversation(false)}
        onConfirm={renameConversation} />
      <ConfirmDialog
        open={Boolean(draftConfirm)}
        id="discard-message-draft"
        title={t('chat.discardDraftTitle')}
        message={t('chat.discardDraftBody')}
        confirmLabel={t('chat.discardAndContinue')}
        onCancel={() => resolveDraftConfirm(false)}
        onConfirm={() => resolveDraftConfirm(true)} />
      <ConversationPresetPicker
        open={presetPicker.kind !== 'closed'}
        phase={presetPicker.kind === 'closed' ? 'ready' : presetPicker.kind}
        presets={presetPicker.presets}
        selectedId={presetPicker.selectedId}
        error={presetPicker.error}
        busy={presetPicker.busy}
        returnFocusRef={newConversationButton}
        onSelect={(id: string) => setPresetPicker((current) => ({ ...current, selectedId: id }))}
        onRetry={() => { void retryPresetList() }}
        onCancel={cancelPresetPicker}
        onConfirm={() => { void confirmPresetPicker() }} />
    </aside>
  );
}
