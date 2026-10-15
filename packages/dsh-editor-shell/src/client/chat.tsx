import { OfficialInputActivity } from './official-surfaces.tsx'
import type { OfficialInputActions } from '../model/official-surfaces.ts'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  chatRows,
  internalIndexTurnActive,
  partialView,
  send,
  sendProjectContext,
  stop,
  visibleRunningCalls,
} from '../adapter.ts'
import type {
  SessionFace,
  SessionId,
  WorkspaceId,
} from '../dsh-compat.ts'
import {
  WORKBENCH_RPC_CHANNEL,
  type ProjectContextReceiptBundle,
  type ProjectInspectionResponse,
} from 'dsh-editor-workbench/contracts'
import {
  buildInterviewPrompt,
  decodeInitSettings,
  INIT_SETTINGS_NAMESPACE,
  initGuideState,
  shouldAutoIndexAfterInterview,
  shouldShowInitGuide,
  startExploreInit,
} from '../init-guide.ts'
import { conversationPresetLabel, sessionAgentPreset, shouldRunLegacyNovelPipeline } from '../conversation-presets.ts'
import { shouldShowMigrationBanner } from '../legacy-migration.ts'
import { DEVELOPER_SETTINGS_NAMESPACE, decodeDeveloperSettings } from '../developer-settings.ts'
import { MESSAGE_CARDS_SERVICE, type ShellMessageCardContext, type ShellMessageCardRegistry } from '../seats.ts'
import { useObservable } from './components.tsx'
import { isObservableSource } from '../model/components.ts'
import { ConfirmDialog, TextPromptDialog } from './dialogs.tsx'
import { ActivityDots } from './ui/index.ts'
import { Box, Button as UiButton, Flex, IconButton as UiIconButton, Notice, Text, TextArea } from '../ui/index.ts'
import { takeCreatedChatModelError } from './ui-workspace.ts'
import { t, useLocale } from '../i18n/index.ts'
import {
  canSubmitComposer,
  composerSubmitBlock,
  safeRpcCall,
  shouldSubmitComposer,
  type ShellContext,
} from './shared.ts'
import { CrossIcon, SendIcon, StopIcon } from '../ui/icons.tsx'
import './chat.styles.ts'
import {
  bindOfficialConversation,
  conversationChatSource,
  conversationFace,
  pendingForSession,
  resolveConversationChatTarget,
  DISCONNECTED,
  EMPTY_PENDING,
  EMPTY_TRANSCRIPT,
  type ChatLifecycle,
} from './chat-conversation.ts'
import { chatEmptyPrompt, partnerSuggestionTitle } from './chat-empty.ts'
import { ConversationListView, PartnerHeader, type PartnerConversationRow } from '../app/assistant/partner-header.tsx'
import { PartnerEmptyState } from '../app/assistant/partner-empty.tsx'
import { useChatConversationControls } from './chat-conversation-controls.ts'
import { ChatHistory } from './chat-history.tsx'
import type { ChatOutgoing } from '../model/chat-history.ts'
import {
  createProposalBoard,
  pendingProposalEntries,
  proposalTurnKeys,
} from '../model/proposal-board.ts'
import { ModelPicker } from './chat-model-picker.tsx'
import type { SettingsRenderSlot } from './settings-plugins.tsx'
import { ProposalCard } from './chat-proposal.tsx'
import {
  buildExpectedVersions,
  proposalBasisItems,
  proposalBasisLine,
  proposalFingerprint,
  proposalTargetBaselines,
  unwrapWorkbenchPrepared,
} from '../model/chat-proposal.ts'
import {
  ChatEntry,
  ChatProcessBlock,
  ChatProcessStack,
  ChatRowView,
  ChatStepFromRow,
  ChatStepHead,
  ChatStepItem,
  InitGuideCard,
  LegacyMigrationBanner,
  PendingCard,
  ProjectContextReceiptView,
} from './chat-cards.tsx'
import { clusterChatRows } from '../model/chat-cards.ts'
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


export function Chat({ ctx, session, workspaceId, activePath, getActiveDocTitle, authorPreferences, authorMemory, renderSlot, hidden, overlay, onConfigure, onApplied, onWritten, onDraftDirtyChange, onHide }: { ctx: ShellContext; session: SessionFace; workspaceId?: WorkspaceId; activePath?: string; getActiveDocTitle?(): string | undefined; authorPreferences: string; authorMemory: string; renderSlot?: SettingsRenderSlot; hidden: boolean; overlay?: boolean; onConfigure(): void; onApplied(path: string): void; onWritten?(path: string): void; onDraftDirtyChange(dirty: boolean): void; onHide?(): void }) {
  const locale = useLocale()
  const messageCards = (ctx as ShellContext & { [MESSAGE_CARDS_SERVICE]?: ShellMessageCardRegistry })[MESSAGE_CARDS_SERVICE]
  const [messageCardTick, setMessageCardTick] = useState(0)
  useEffect(() => messageCards?.subscribe(() => setMessageCardTick((value) => value + 1)), [messageCards])
  const sessionSource = useMemo(() => {
    const sessionId = session.sessionId
    if (isObservableSource(session)) return session
    const fallback: ChatLifecycle = {
      sessionId,
      pendingSubmissions: [],
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
  const queuedSubmissions = useMemo(
    () => snapshot.pendingSubmissions.filter((item) => item.placement === 'queued' || item.placement === 'steering'),
    [snapshot.pendingSubmissions],
  )
  const chatSource = useMemo(() => conversationChatSource(ctx, session.sessionId), [ctx, session.sessionId])
  const chat = useObservable(chatSource)
  const transcript = chat?.legacy ?? EMPTY_TRANSCRIPT
  const chatLegacy = transcript
  const pendingRaw = useObservable(ctx.uiSession?.sessionStatus ?? EMPTY_PENDING)
  const pendingItems = useMemo(
    () => pendingForSession(pendingRaw, session.sessionId),
    [pendingRaw, session.sessionId],
  )
  const sessionList = useObservable(ctx.sessions.list)
  const workspaceList = useObservable(ctx.workspaces.list)
  const agentPreset = sessionAgentPreset(sessionList.byId, session.sessionId)
  const legacyEditor = shouldRunLegacyNovelPipeline(agentPreset)
  const [presetRoster, setPresetRoster] = useState<unknown>()
  useEffect(() => {
    let live = true
    void ctx.remote.agentPresets.list().then((result) => {
      if (live && result.ok) setPresetRoster(result.value)
    }).catch(() => undefined)
    return () => { live = false }
  }, [ctx])
  const currentMode = useMemo(() => conversationPresetLabel(agentPreset, presetRoster), [agentPreset, presetRoster, locale])
  const connectionState = useObservable(isObservableSource(ctx.connection.state) ? ctx.connection.state : DISCONNECTED)
  const connected = connectionState === 'connected'
  const [draft, projectNativeDraft] = useState('')
  const nativeInput = useRef<OfficialInputActions | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [nativeInputReady, setNativeInputReady] = useState(false)
  const [voiceActive, setVoiceActive] = useState(false)
  const bindNativeInput = useCallback((actions: OfficialInputActions | null) => {
    nativeInput.current = actions
    setNativeInputReady(actions !== null)
  }, [])
  const readNativeDraft = useCallback((text: string) => { draftRef.current = text; projectNativeDraft(text) }, [])
  const setDraft = useCallback((value: string | ((current: string) => string)) => {
    const next = typeof value === 'function' ? value(draftRef.current) : value
    nativeInput.current?.setDraft(next)
  }, [])
  const [note, setNote] = useState('')
  const [outgoing, setOutgoing] = useState<ChatOutgoing | null>(null)
  const [modelRevision, setModelRevision] = useState(0)
  /* 迁移横幅的关闭按会话记在内存里，不落盘。 */
  const [dismissedMigrations, setDismissedMigrations] = useState<ReadonlySet<string>>(new Set())
  const historyRef = useRef<HTMLDivElement | null>(null)
  const bottomPinnedRef = useRef(true)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
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
  const historyBlocks = useMemo(() => clusterChatRows(rows, messageCards), [rows, messageCards, messageCardTick])
  const visibleCalls = useMemo(() => visibleRunningCalls(transcript.runningCalls ?? []), [transcript.runningCalls])
  /* 会话内提案板：各提案卡注册自己的状态/元素/apply；
     pill 计数、回合分组与「全部应用」都读这张板。 */
  const proposalBoard = useMemo(() => createProposalBoard(), [])
  const proposalTurnKeyMap = useMemo(() => proposalTurnKeys(rows), [rows])
  /* 流式更新跟随到底部；用户主动上翻阅读时松开，回到底部附近再重新跟随。
     依赖全部是记忆化数据:只有历史内容真的变化才补 scrollTop,draft 输入等
     无关重渲染不再触发;用 layout effect 在绘制前完成,避免跟随时闪一帧。
     回合刚结束且有待处理提案时,跟随目标改为第一张待处理卡——
     不再滚过卡片把提案按钮推出视野;之后该卡不在底部,跟随自然松开。 */
  const prevRunningForScroll = useRef(false)
  useLayoutEffect(() => {
    const el = historyRef.current
    const turnEnded = prevRunningForScroll.current && !snapshot.running
    prevRunningForScroll.current = snapshot.running
    if (!el || !bottomPinnedRef.current) return
    const firstPending = turnEnded
      ? pendingProposalEntries(proposalBoard.entries())
          .map((entry) => entry.element())
          .find((node): node is HTMLElement => node != null)
      : null
    if (firstPending) {
      firstPending.scrollIntoView({ block: 'start' })
      bottomPinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      return
    }
    el.scrollTop = el.scrollHeight
  }, [rows, partial, outgoing, visibleCalls, queuedSubmissions, pendingItems, snapshot.running, proposalBoard])
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
  const initScope = useMemo(() => ctx.configForms.get<NonNullable<ReturnType<typeof decodeInitSettings>>>(INIT_SETTINGS_NAMESPACE), [ctx])
  const initSettings = useObservable(initScope)
  const developerScope = useMemo(() => ctx.configForms.get<NonNullable<ReturnType<typeof decodeDeveloperSettings>>>(DEVELOPER_SETTINGS_NAMESPACE), [ctx])
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
  /* 空白对话:输入框只留占位提示,不贴说明文字。栏头在没有消息时不展开模式徽标和会话菜单。 */
  const showEmptyHistory = rows.length === 0
    && !showInitGuide
    && !outgoing
    && !snapshot.running
    && queuedSubmissions.length === 0
    && visibleCalls.length === 0
    && !partial.text
    && !partial.thinking
    && pendingItems.length === 0
  const composerPlaceholder = useMemo(
    () => chatEmptyPrompt(currentMode?.id),
    [currentMode?.id, locale],
  )
  const openConversation = (nextId: SessionId) => {
    setDraft(''); setNote(''); setOutgoing(null); onDraftDirtyChange(false)
    void ctx.uiWorkspace.openSession(nextId).catch(() => setNote(t('chat.sendFailedRetry')))
    setModelRevision((value) => value + 1)
  }
  const {
    renameTarget, setRenameTarget, conversationListOpen, setConversationListOpen,
    conversationListTrigger, conversationBusy, conversationFilter, setConversationFilter,
    archiveStopConfirm, setArchiveStopConfirm, titleOverrides, draftConfirm,
    presetChoices, conversations, archivedConversations, hostPinnedIds, archivedIds,
    filteredConversations, canMutateConversation,
    queueConversationRename, resolveDraftConfirm, switchConversation, renameConversation,
    newConversation,
    archiveConversation, restoreConversation, toggleConversationPinFor, currentConversationTitle, renameInitialValue
  } = useChatConversationControls({
    ctx, session, workspaceId, workspace, sessionList, workspaceList, developerMode,
    presetRoster, locale, rows, draft, setNote, openConversation,
  })
  useEffect(() => { onDraftDirtyChange(Boolean(draft.trim())) }, [draft, onDraftDirtyChange])
  const outgoingIsCanonical = Boolean(outgoing && rows.slice(outgoing.afterRows)
    .some((row) => row.role === 'user' && row.text.trim() === outgoing.text))
  const composerCanSubmit = canSubmitComposer({
    draft,
    connected: Boolean(connected),
    removed: snapshot.removed === true,
    outgoingState: outgoing?.state,
  })
  /* 禁用原因同判禁条件一一对应，禁用态通过 title 暴露给作者。 */
  const sendBlock = composerSubmitBlock({
    draft,
    connected: Boolean(connected),
    removed: snapshot.removed === true,
    outgoingState: outgoing?.state,
    voiceActive,
    nativeInputReady,
  })
  useEffect(() => {
    if (outgoingIsCanonical) setOutgoing(null)
  }, [outgoingIsCanonical])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!composerCanSubmit || voiceActive || !nativeInputReady) return
    const value = draft.trim()
    bottomPinnedRef.current = true
    setOutgoing({ text: value, state: 'sending', afterRows: rows.length })
    setDraft('')
    setNote('')
    if (!legacyEditor) {
      void send(session, value).then((result) => {
        if (!result || !result.ok) {
          setOutgoing((current) => current?.text === value ? { ...current, state: 'failed' } : current)
          /* 失败时把草稿还给输入框,避免瞬时故障丢掉整段文字。 */
          setDraft((current) => current || value)
          setNote(t('chat.sendFailedRetry'))
          return
        }
        setOutgoing((current) => current?.text === value ? { ...current, state: 'accepted' } : current)
      }).catch(() => {
        setOutgoing((current) => current?.text === value ? { ...current, state: 'failed' } : current)
        setDraft((current) => current || value)
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
        setDraft((current) => current || value)
        setNote(t('chat.sendFailedRetry'))
        return
      }
      setOutgoing((current) => current?.text === value ? { ...current, state: 'accepted' } : current)
    }).catch(() => {
      setOutgoing((current) => current?.text === value ? { ...current, state: 'failed' } : current)
      if (contextCompileFailed) {
        setDraft((current) => current || value)
        setNote(t('chat.contextBlocked'))
      } else {
        setDraft((current) => current || value)
        setNote(t('chat.sendFailedRetry'))
      }
    })
  }
  /* §5 空状态建议：点击只填入草稿并聚焦输入框，绝不发送。 */
  const fillComposerDraft = (text: string) => {
    if (nativeInput.current) nativeInput.current.setDraft(text)
    else projectNativeDraft(text)
    composerRef.current?.focus()
  }
  const conversationListRows: PartnerConversationRow[] = filteredConversations.map((item) => ({
    id: item.id,
    title: item.title,
    pinned: hostPinnedIds.includes(item.id),
    archived: archivedIds.includes(item.id),
    current: item.id === session.sessionId,
  }))
  return (
    <aside
      className={overlay ? 'chat chat-overlay' : 'chat'}
      aria-label={t('chat.assistant')}
      hidden={hidden}
      {...(hidden ? { inert: '' } : {})}
      data-chat-face={conversationFace(ctx) ? 'official' : 'missing'}
      data-chat-nodes={String(transcript.nodes.length)}>
      {titleOverrides[session.sessionId]?.status === 'failed' ? <Notice
        tone="danger"
        title={t('chat.renameFailed')}
        action={<UiButton variant="secondary" size="sm" onClick={() => queueConversationRename(titleOverrides[session.sessionId]!.title, t('chat.renameFailed'))}>{t('common.retry')}</UiButton>} /> : null}
      <PartnerHeader
        title={currentConversationTitle}
        titleRef={(node) => { conversationListTrigger.current = node }}
        busy={conversationBusy}
        listOpen={conversationListOpen}
        onListOpenChange={setConversationListOpen}
        list={<ConversationListView
          filter={conversationFilter}
          onFilterChange={setConversationFilter}
          rows={conversationListRows}
          busy={conversationBusy}
          canArchiveCurrent={canMutateConversation}
          onSelect={(id) => { setConversationListOpen(false); if (id !== session.sessionId) void switchConversation(id) }}
          onRename={(id) => { setConversationListOpen(false); setRenameTarget(id as SessionId) }}
          onTogglePin={(id) => { void toggleConversationPinFor(id) }}
          onArchive={(id) => { void archiveConversation(id) }}
          onRestore={(id) => { void restoreConversation(id) }} />}
        presets={presetChoices ?? []}
        presetsLoading={presetChoices === undefined}
        newDisabled={!workspaceId}
        onNew={(presetId) => void newConversation(presetId)}
        status={connected ? null : <Text size="1" color="gray" className="chat-status" role="status">
          <ActivityDots />
          {t('chat.reconnecting')}
        </Text>}
        /* Overlay drawers cover the dismiss scrim, so the header carries
           an explicit close control (Escape and the topbar toggle still work). */
        trailing={overlay && onHide ? <UiIconButton
          label={t('chat.closeAssistant')}
          onClick={onHide}>
          <CrossIcon size="sm" />
        </UiIconButton> : null} />
      {showMigrationBanner ? <LegacyMigrationBanner
        onMigrate={() => { void newConversation() }}
        onDismiss={() => setDismissedMigrations((current) => new Set(current).add(session.sessionId))} /> : null}
      <ChatHistory
        ctx={ctx} session={session} locale={locale} hidden={hidden} renderSlot={renderSlot}
        snapshot={snapshot} historyRef={historyRef} bottomPinnedRef={bottomPinnedRef}
        historyBlocks={historyBlocks} messageCards={messageCards} messageCardTick={messageCardTick}
        messageCardContext={messageCardContext} handleApplied={handleApplied} isNewMessage={isNewMessage}
        board={proposalBoard} proposalTurnKeys={proposalTurnKeyMap}
        partial={partial} hasPartial={Boolean(chatLegacy.partial)} visibleCalls={visibleCalls}
        queuedSubmissions={queuedSubmissions} pendingItems={pendingItems} outgoing={outgoing}
        outgoingIsCanonical={outgoingIsCanonical} hasTurnError={hasTurnError}
        empty={showEmptyHistory ? <PartnerEmptyState
          title={partnerSuggestionTitle(activePath, workspace?.title, getActiveDocTitle?.())}
          onPick={fillComposerDraft} /> : null}
        initGuide={showInitGuide ? <InitGuideCard
          state={initState as 'explore' | 'interview'} busy={initBusy}
          running={initState === 'explore' ? internalIndexActive : snapshot.running}
          done={initCompleted} note={initNote} onStart={startInitGuide} onDismiss={dismissInitGuide} /> : null} />
      <form className="composer" onSubmit={submit}>
        <TextArea
          ref={composerRef}
          minRows={1}
          maxRows={8}
          value={draft}
          disabled={!nativeInputReady || voiceActive}
          onChange={setDraft}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (!shouldSubmitComposer({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) return
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }}
          placeholder={composerPlaceholder}
          aria-label={t('chat.inputLabel')} />
        {note ? <Notice
          tone="danger"
          className="composer-note"
          title={note}
          action={note === t('chat.defaultModelFailed') ? <UiButton variant="secondary" size="sm" type="button" onClick={onConfigure}>
            {t('chat.fixDefaultModel')}
          </UiButton> : undefined} /> : null}
        <Flex className="composer-toolbar" align="center" justify="between" gap="2" wrap="nowrap" minWidth="0">
          <Box className="composer-model" flexGrow="1" minWidth="0">
            <ModelPicker
              key={`${session.sessionId}:${modelRevision}`}
              ctx={ctx}
              session={session}
              onConfigure={onConfigure} />
          </Box>
          <OfficialInputActivity ctx={ctx} sessionId={session.sessionId} locked={!connected || hidden}
            expanded={voiceActive}
            getSelection={() => ({ start: composerRef.current?.selectionStart ?? draftRef.current.length, end: composerRef.current?.selectionEnd ?? draftRef.current.length, length: draftRef.current.length })}
            onActiveChange={setVoiceActive} onDraft={readNativeDraft} onBind={bindNativeInput} />
          <Flex className="composer-actions" align="center" gap="2" flexShrink="0">
            {snapshot.running ? <UiIconButton
              className="chat-stop"
              variant="secondary"
              label={t('chat.stop')}
              onClick={() => {
                void settleConversationStop({
                  cancel: () => stop(session),
                  releaseOutgoing: () => setOutgoing(null),
                })
              }}>
              <StopIcon size="sm" />
            </UiIconButton> : null}
            <UiIconButton
              className="send"
              variant="primary"
              type="submit"
              label={t('chat.send')}
              title={sendBlock ? t(`chat.sendBlocked.${sendBlock}`) : undefined}
              disabled={sendBlock !== null}>
              <SendIcon size="sm" />
            </UiIconButton>
          </Flex>
        </Flex>
      </form>
      <TextPromptDialog
        open={renameTarget !== null}
        id="rename-conversation"
        title={t('chat.renameConversation')}
        label={t('chat.conversationName')}
        initialValue={renameInitialValue}
        confirmLabel={t('chat.saveName')}
        returnFocusRef={conversationListTrigger}
        onCancel={() => setRenameTarget(null)}
        onConfirm={renameConversation} />
      <ConfirmDialog
        open={Boolean(archiveStopConfirm)}
        id="archive-running-conversation"
        title={t('chat.archiveRunningTitle')}
        message={t('chat.archiveRunningBody')}
        confirmLabel={t('chat.archiveAndStop')}
        busy={conversationBusy}
        returnFocusRef={conversationListTrigger}
        onCancel={() => setArchiveStopConfirm(null)}
        onConfirm={() => {
          if (archiveStopConfirm) void archiveConversation(archiveStopConfirm.id, true, archiveStopConfirm.nextId)
        }} />
      <ConfirmDialog
        open={Boolean(draftConfirm)}
        id="discard-message-draft"
        title={t('chat.discardDraftTitle')}
        message={t('chat.discardDraftBody')}
        confirmLabel={t('chat.discardAndContinue')}
        onCancel={() => resolveDraftConfirm(false)}
        onConfirm={() => resolveDraftConfirm(true)} />
    </aside>
  );
}


/* 拆分后的再导出,保持既有 import 路径不变。 */
export {
  bindOfficialConversation,
  conversationChatSource,
  conversationFace,
  pendingForSession,
  DISCONNECTED,
  ModelPicker,
  ProposalCard,
  buildExpectedVersions,
  proposalBasisItems,
  proposalBasisLine,
  proposalFingerprint,
  proposalTargetBaselines,
  unwrapWorkbenchPrepared,
  ChatEntry,
  ChatProcessBlock,
  ChatProcessStack,
  ChatRowView,
  ChatStepFromRow,
  ChatStepHead,
  ChatStepItem,
  clusterChatRows,
  InitGuideCard,
  LegacyMigrationBanner,
  PendingCard,
  ProjectContextReceiptView,
}
