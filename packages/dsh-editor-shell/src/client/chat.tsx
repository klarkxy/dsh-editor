import { OfficialInputActivity, type OfficialInputActions } from './official-surfaces.tsx'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
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
import type { ConversationFilter } from '../native-conversation-state.ts'
import { DEVELOPER_SETTINGS_NAMESPACE, decodeDeveloperSettings } from '../developer-settings.ts'
import { MESSAGE_CARDS_SERVICE, type ShellMessageCardContext, type ShellMessageCardRegistry } from '../seats.ts'
import { isObservableSource, useObservable } from './components.tsx'
import { ConfirmDialog, ConversationPresetPicker, TextPromptDialog } from './dialogs.tsx'
import { Select } from './select.tsx'
import {
  Badge,
  Box,
  Button,
  Callout,
  DropdownMenu,
  Flex,
  IconButton,
  Text,
  TextArea,
} from '@radix-ui/themes'
import { ActivityDots } from './ui/index.ts'
import { takeCreatedChatModelError } from './ui-workspace.ts'
import { t, useLocale } from '../i18n/index.ts'
import {
  canSubmitComposer,
  safeRpcCall,
  shouldSubmitComposer,
  type ShellContext,
} from './shared.ts'
import { CrossIcon, DotsIcon, PlusIcon, StopIcon } from './icons.tsx'
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
import { chatEmptyPrompt } from './chat-empty.ts'
import { useChatConversationControls } from './chat-conversation-controls.ts'
import { ChatHistory, type ChatOutgoing } from './chat-history.tsx'
import { ModelPicker } from './chat-model-picker.tsx'
import type { SettingsRenderSlot } from './settings-plugins.tsx'
import {
  ProposalCard,
  buildExpectedVersions,
  proposalBasisItems,
  proposalBasisLine,
  proposalFingerprint,
  proposalTargetBaselines,
  unwrapWorkbenchPrepared,
} from './chat-proposal.tsx'
import {
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
} from './chat-cards.tsx'
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


export function Chat({ ctx, session, workspaceId, activePath, authorPreferences, authorMemory, renderSlot, hidden, overlay, onConfigure, onApplied, onWritten, onDraftDirtyChange, onHide }: { ctx: ShellContext; session: SessionFace; workspaceId?: WorkspaceId; activePath?: string; authorPreferences: string; authorMemory: string; renderSlot?: SettingsRenderSlot; hidden: boolean; overlay?: boolean; onConfigure(): void; onApplied(path: string): void; onWritten?(path: string): void; onDraftDirtyChange(dirty: boolean): void; onHide?(): void }) {
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
  const growComposer = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }
  useLayoutEffect(() => { growComposer(composerRef.current) }, [draft])
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
  /* 流式更新跟随到底部；用户主动上翻阅读时松开，回到底部附近再重新跟随。
     依赖全部是记忆化数据:只有历史内容真的变化才补 scrollTop,draft 输入等
     无关重渲染不再触发;用 layout effect 在绘制前完成,避免跟随时闪一帧。 */
  useLayoutEffect(() => {
    const el = historyRef.current
    if (el && bottomPinnedRef.current) el.scrollTop = el.scrollHeight
  }, [rows, partial, outgoing, visibleCalls, queuedSubmissions, pendingItems])
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
    renamingConversation, setRenamingConversation, conversationMenuOpen, setConversationMenuOpen,
    conversationMenuTrigger, conversationMenuYields, conversationBusy, conversationFilter, setConversationFilter,
    archiveStopConfirm, setArchiveStopConfirm, titleOverrides, draftConfirm, presetPicker, setPresetPicker,
    newConversationButton, conversations, archivedConversations, hostPinnedIds, archivedIds,
    filteredConversations, currentIsArchived, currentIsPinned, canMutateConversation,
    queueConversationRename, resolveDraftConfirm, switchConversation, renameConversation,
    createConversation, retryPresetList, confirmPresetPicker, cancelPresetPicker,
    archiveConversation, restoreConversation, toggleConversationPin, currentConversationTitle, renameInitialValue
  } = useChatConversationControls({
    ctx, session, workspaceId, workspace, sessionList, workspaceList, developerMode,
    rows, draft, setNote, openConversation,
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
  return (
    <aside
      className={overlay ? 'chat chat-overlay' : 'chat'}
      aria-label={t('chat.assistant')}
      hidden={hidden}
      {...(hidden ? { inert: '' } : {})}
      data-chat-face={conversationFace(ctx) ? 'official' : 'missing'}
      data-chat-nodes={String(transcript.nodes.length)}>
      {titleOverrides[session.sessionId]?.status === 'failed' ? <Callout.Root color="red" role="alert">
        <Callout.Text>{t('chat.renameFailed')}</Callout.Text>
        <Button onClick={() => queueConversationRename(titleOverrides[session.sessionId]!.title, t('chat.renameFailed'))}>{t('common.retry')}</Button>
      </Callout.Root> : null}
      <Flex asChild align="center" gap="2" px="3" py="2" justify="between" width="100%" minWidth="0">
        <header className="chat-header">
          <Box className="conversation-select" flexGrow="1" minWidth="0">
            {showEmptyHistory && conversations.length <= 1 && archivedConversations.length === 0 ? <Text
              as="p"
              size="2"
              weight="medium"
              truncate
              className="chat-quiet-title"
              title={currentConversationTitle}>
              {currentConversationTitle}
            </Text> : <Select
              value={session.sessionId}
              aria-label={t('chat.switchConversation')}
              title={currentConversationTitle}
              selectedLabel={currentConversationTitle}
              options={filteredConversations.map((item) => ({
                value: item.id,
                label: `${hostPinnedIds.includes(item.id) ? `${t('chat.pinnedConversation')} · ` : ''}${item.title}${archivedIds.includes(item.id) ? ` · ${t('chat.archivedConversations')}` : ''}`,
              }))}
              onChange={(next) => void switchConversation(next)} />}
          </Box>
          {!showEmptyHistory && currentMode ? <Badge
            className="composer-mode"
            variant="soft"
            color="gray"
            size="1"
            data-chat-mode={currentMode.id}
            title={currentMode.description}
            aria-label={`${t('chat.currentMode')}：${currentMode.name}`}>
            {currentMode.name}
          </Badge> : null}
          <Flex className="chat-header-actions" align="center" gap="1" flexShrink="0">
            {connected ? null : <Text size="1" color="gray" className="chat-status" role="status">
              <ActivityDots />
              {t('chat.reconnecting')}
            </Text>}
            <IconButton
              ref={newConversationButton}
              variant="ghost"
              color="gray"
              size="2"
              type="button"
              title={t('chat.newConversation')}
              aria-label={t('chat.newConversation')}
              disabled={conversationBusy || !workspaceId || presetPicker.kind !== 'closed'}
              onClick={() => { void createConversation() }}>
              <PlusIcon size={14} />
            </IconButton>
            {showEmptyHistory && conversations.length <= 1 && archivedConversations.length === 0 ? null : <Box className="conversation-menu">
              <DropdownMenu.Root
                open={conversationMenuOpen}
                onOpenChange={(open: boolean) => { if (open) conversationMenuYields.current = false; setConversationMenuOpen(open) }}>
                <DropdownMenu.Trigger>
                  <IconButton
                    ref={conversationMenuTrigger}
                    variant="ghost"
                    color="gray"
                    size="2"
                    title={t('chat.conversationActions')}
                    aria-label={t('chat.conversationActions')}
                    disabled={conversationBusy}>
                    <DotsIcon size={14} />
                  </IconButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content
                  className="conversation-menu-pop"
                  align="end"
                  aria-label={t('chat.conversationActions')}
                  onCloseAutoFocus={(event: Event) => {
                    if (conversationMenuYields.current) event.preventDefault()
                  }}>
                  <DropdownMenu.Item
                    disabled={conversationBusy}
                    onSelect={() => { conversationMenuYields.current = true; setRenamingConversation(true) }}>
                    {t('chat.renameConversation')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    disabled={conversationBusy || currentIsArchived}
                    onSelect={() => { void toggleConversationPin() }}>
                    {t(currentIsPinned ? 'chat.unpinConversation' : 'chat.pinConversation')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.RadioGroup value={conversationFilter} onValueChange={(value: string) => setConversationFilter(value as ConversationFilter)}>
                    <DropdownMenu.RadioItem value="active">{t('chat.showActiveConversations')}</DropdownMenu.RadioItem>
                    <DropdownMenu.RadioItem value="all">{t('chat.showAllConversations')}</DropdownMenu.RadioItem>
                    <DropdownMenu.RadioItem value="archived">{t('chat.showArchivedConversations')}</DropdownMenu.RadioItem>
                  </DropdownMenu.RadioGroup>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    disabled={conversationBusy || currentIsArchived || !canMutateConversation}
                    title={!canMutateConversation ? t('chat.archiveNeedAnother') : undefined}
                    onSelect={() => { void archiveConversation(session.sessionId) }}>
                    {t('common.archive')}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    disabled={conversationBusy || !currentIsArchived}
                    onSelect={() => { void restoreConversation(session.sessionId) }}>
                    {t('common.restore')}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Box>}
            {/* Overlay drawers cover the dismiss scrim, so the header carries
                an explicit close control (Escape and the topbar toggle still work). */}
            {overlay && onHide ? <IconButton
              variant="ghost"
              color="gray"
              size="2"
              type="button"
              title={t('chat.closeAssistant')}
              aria-label={t('chat.closeAssistant')}
              onClick={onHide}>
              <CrossIcon size={14} />
            </IconButton> : null}
          </Flex>
        </header>
      </Flex>
      {archivedConversations.length ? <Box asChild px="3" py="2">
        <details className="archived-conversations">
          <summary>
            <Text size="1" color="gray">
              {t('chat.archivedConversations')}
            </Text>
          </summary>
          <Box asChild mt="2">
            <ul>
              {archivedConversations.map((item) => <li key={item.id}>
                <Flex align="center" justify="between" gap="2">
                  <Text size="2">
                    {item.title}
                  </Text>
                  <Button
                    type="button"
                    size="1"
                    variant="soft"
                    color="gray"
                    disabled={conversationBusy}
                    onClick={() => void restoreConversation(item.id)}>
                    {t('common.restore')}
                  </Button>
                </Flex>
              </li>)}
            </ul>
          </Box>
        </details>
      </Box> : null}
      {showMigrationBanner ? <LegacyMigrationBanner
        onMigrate={() => { void createConversation() }}
        onDismiss={() => setDismissedMigrations((current) => new Set(current).add(session.sessionId))} /> : null}
      <ChatHistory
        ctx={ctx} session={session} locale={locale} hidden={hidden} renderSlot={renderSlot}
        snapshot={snapshot} historyRef={historyRef} bottomPinnedRef={bottomPinnedRef}
        historyBlocks={historyBlocks} messageCards={messageCards} messageCardTick={messageCardTick}
        messageCardContext={messageCardContext} handleApplied={handleApplied} isNewMessage={isNewMessage}
        partial={partial} hasPartial={Boolean(chatLegacy.partial)} visibleCalls={visibleCalls}
        queuedSubmissions={queuedSubmissions} pendingItems={pendingItems} outgoing={outgoing}
        outgoingIsCanonical={outgoingIsCanonical} hasTurnError={hasTurnError}
        initGuide={showInitGuide ? <InitGuideCard
          state={initState as 'explore' | 'interview'} busy={initBusy}
          running={initState === 'explore' ? internalIndexActive : snapshot.running}
          done={initCompleted} note={initNote} onStart={startInitGuide} onDismiss={dismissInitGuide} /> : null} />
      <Box asChild px="3" py="2">
        <form className="composer" onSubmit={submit}>
          <Flex direction="column" gap="2">
            <TextArea
              ref={composerRef}
              rows={1}
              resize="none"
              size="2"
              style={{ width: '100%' }}
              value={draft}
              disabled={!nativeInputReady || voiceActive}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                setDraft(event.target.value)
                growComposer(event.currentTarget)
              }}
              onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                if (!shouldSubmitComposer({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) return
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }}
              placeholder={composerPlaceholder}
              aria-label={t('chat.inputLabel')} />
            {note ? <Flex direction="column" align="start" gap="2" role="alert">
              <Text size="2" className="warning" color="red">{note}</Text>
              {note === t('chat.defaultModelFailed') ? <Button type="button" size="2" variant="soft" onClick={onConfigure}>
                {t('chat.fixDefaultModel')}
              </Button> : null}
            </Flex> : null}
            <Flex className="composer-toolbar" align="center" justify="between" gap="2" wrap="wrap" minWidth="0">
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
                {snapshot.running ? <IconButton
                  type="button"
                  variant="soft"
                  color="red"
                  size="2"
                  className="chat-stop"
                  title={t('chat.stop')}
                  aria-label={t('chat.stop')}
                  onClick={() => {
                    void settleConversationStop({
                      cancel: () => stop(session),
                      releaseOutgoing: () => setOutgoing(null),
                    })
                  }}>
                  <StopIcon size={14} />
                </IconButton> : null}
                <IconButton
                  className="send"
                  type="submit"
                  variant="ghost"
                  color="gray"
                  size="2"
                  disabled={!composerCanSubmit || voiceActive || !nativeInputReady}
                  title={t('chat.send')}
                  aria-label={t('chat.send')}>
                  <svg
                    viewBox="0 0 24 24"
                    width={16}
                    height={16}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false">
                    <path d="m22 2-7 20-4-9-9-4Z" />
                    <path d="M22 2 11 13" />
                  </svg>
                </IconButton>
              </Flex>
            </Flex>
          </Flex>
        </form>
      </Box>
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
        open={Boolean(archiveStopConfirm)}
        id="archive-running-conversation"
        title={t('chat.archiveRunningTitle')}
        message={t('chat.archiveRunningBody')}
        confirmLabel={t('chat.archiveAndStop')}
        busy={conversationBusy}
        returnFocusRef={conversationMenuTrigger}
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
