import {
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
} from 'react';
import {
  authorMemoryObservations,
  chatRows,
  internalIndexTurnActive,
  loadOlder,
  partialView,
  send,
  sendProjectContext,
  stop,
  visibleRunningCalls,
  WRITING_PROPOSE_TOOL_NAME,
  type PendingInteraction,
} from '../adapter.ts'
import type {
  SessionFace,
  SessionId,
  WorkspaceId,
} from '../dsh-compat.ts'
import { emptyTranscript, type ChatTranscript } from '../dsh-compat.ts'
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
import {
  canConfirmConversationPreset,
  cancelNewConversationPresetPicker,
  confirmNewConversationPreset,
  conversationPresetLabel,
  firstAvailableConversationPreset,
  loadNewConversationPresets,
  sessionAgentPreset,
  shouldRunLegacyNovelPipeline,
  startNewConversationPresetFlow,
  type ConversationPresetChoice,
} from '../conversation-presets.ts'
import { shouldShowMigrationBanner } from '../legacy-migration.ts'
import { ConversationRenameQueue, automaticTitleManaged, archiveConversationIds, archivedConversationRows, canArchiveOrDeleteConversation, conversationRows, nextAutomaticConversationTitle, nextVisibleConversationId, restoreConversationIds, shouldConfirmConversationSwitch } from '../conversation-lifecycle.ts'
import { CONVERSATION_SETTINGS_NAMESPACE, conversationWorkRecord, decodeConversationSettings, DEFAULT_CONVERSATION_SETTINGS, putConversationWork } from '../conversation-store.ts'
import { DEVELOPER_SETTINGS_NAMESPACE, decodeDeveloperSettings } from '../developer-settings.ts'
import { MESSAGE_CARDS_SERVICE, type ShellMessageCardContext, type ShellMessageCardRegistry } from '../seats.ts'
import { isObservableSource, useObservable } from './components.tsx'
import { Markdown } from './markdown.tsx'
import { ConfirmDialog, ConversationPresetPicker, TextPromptDialog } from './dialogs.tsx'
import { Select } from './select.tsx'
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  DropdownMenu,
  Flex,
  IconButton,
  ScrollArea,
  Text,
  TextArea,
} from '@radix-ui/themes'
import { ActivityDots, SuccessMark } from './ui/index.ts'
import { applyChatModelDefault, takeCreatedChatModelError } from './ui-workspace.ts'
import { t, useLocale, type Locale, type MessageKey } from '../i18n/index.ts'
import {
  canSubmitComposer,
  safeRpcCall,
  shouldSubmitComposer,
  type ShellContext,
} from './shared.ts'
import { DotsIcon, PlusIcon, StopIcon } from './icons.tsx'
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
import { ModelPicker } from './chat-model-picker.tsx'
import { PluginChatEvents } from './plugin-surfaces.tsx'
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
  processDetailRows,
  InitGuideCard,
  LegacyMigrationBanner,
  PendingCard,
  ProjectContextReceiptView,
} from './chat-cards.tsx'



const conversationRenameQueue = new ConversationRenameQueue()

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


export function Chat({ ctx, session, workspaceId, activePath, authorPreferences, authorMemory, renderSlot, onRememberMemory, hidden, overlay, onConfigure, onApplied, onWritten, onDraftDirtyChange }: { ctx: ShellContext; session: SessionFace; workspaceId?: WorkspaceId; activePath?: string; authorPreferences: string; authorMemory: string; renderSlot?: SettingsRenderSlot; onRememberMemory(observation: string): Promise<boolean> | boolean; hidden: boolean; overlay?: boolean; onConfigure(): void; onApplied(path: string): void; onWritten?(path: string): void; onDraftDirtyChange(dirty: boolean): void }) {
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
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const growComposer = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 64), 132)}px`
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
  /* author_observe 静默落盘:该工具回合不在聊天渲染(同 novel_index_write),
     这里扫描 transcript 把观察结果自动追加进本机作者侧写;写入失败等下个更新重试。 */
  const rememberedObservations = useRef(new Set<string>())
  useEffect(() => {
    const pending = authorMemoryObservations(transcript)
      .filter((item) => !rememberedObservations.current.has(`${session.sessionId}:${item.seq}`))
    if (!pending.length) return
    void (async () => {
      for (const item of pending) {
        if (await onRememberMemory(item.observation)) rememberedObservations.current.add(`${session.sessionId}:${item.seq}`)
      }
    })()
  }, [transcript, onRememberMemory, session.sessionId])
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
  const conversationScope = useMemo(() => ctx.configForms.get<NonNullable<ReturnType<typeof decodeConversationSettings>>>(CONVERSATION_SETTINGS_NAMESPACE), [ctx])
  const conversationSettings = useObservable(conversationScope)
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
  /* 空白列占位:没有任何历史行,且引导卡与在途内容(发送中/排队/运行中/思考/审批)都不在时,
     给一句 muted 提示,避免空对话只剩一列空白。 */
  const showEmptyHistory = rows.length === 0
    && !showInitGuide
    && !outgoing
    && !snapshot.running
    && queuedSubmissions.length === 0
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
  const queueConversationRename = (title: string, failureNote: string, automatic = false) => {
    void conversationRenameQueue.enqueue(session.sessionId, async () => {
      if (automatic && automaticTitleManaged(ctx)) return
      try {
        const result = await session.rename(title)
        if (!result.ok) setNote(failureNote)
      } catch {
        setNote(failureNote)
      }
    })
  }
  useEffect(() => {
    if (automaticTitleManaged(ctx)) return
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
    queueConversationRename(title, t('chat.renameAutoFailed'), true)
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
    setDraft(''); setNote(''); setOutgoing(null); onDraftDirtyChange(false)
    void ctx.uiWorkspace.openSession(nextId).catch(() => setNote(t('chat.sendFailedRetry')))
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

  const applyDefaultChatModel = (sessionId: SessionId) => applyChatModelDefault(ctx, sessionId)
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
    if (await conversationScope.set('works', putConversationWork(current, workspaceId, record).works) === false) throw new Error('Host refused conversation settings write')
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
  const liveOpen = snapshot.running
  const liveSteps = <Fragment>
    {visibleCalls.map((call) => <ChatStepItem
      key={`running:${call.callId}`}
      className="tool"
      busy
      label={call.name === 'glob' || call.name === 'grep' ? t('chat.searchingNotes') : call.name === 'read' ? t('chat.readingNotes') : call.name === 'novel_propose' || call.name === WRITING_PROPOSE_TOOL_NAME ? t('chat.preparingProposal') : t('chat.processing')} />)}
    {partial.thinking ? <ChatStepItem
      key="partial-thinking"
      className="thinking"
      expandable
      live
      busy
      label={t('chat.think')}>
      {partial.thinking}
    </ChatStepItem> : null}
  </Fragment>
  return (
    <aside
      className={overlay ? 'chat chat-overlay' : 'chat'}
      aria-label={t('chat.assistant')}
      hidden={hidden}
      {...(hidden ? { inert: '' } : {})}
      data-chat-face={conversationFace(ctx) ? 'official' : 'missing'}
      data-chat-nodes={String(transcript.nodes.length)}>
      <Flex asChild align="center" gap="2" px="3" py="2" justify="between" width="100%" minWidth="0">
        <header className="chat-header">
          <Box className="conversation-select" flexGrow="1" minWidth="0">
            <Select
              value={session.sessionId}
              aria-label={t('chat.switchConversation')}
              title={currentConversationTitle}
              selectedLabel={currentConversationTitle}
              options={conversations.map((item) => ({ value: item.id, label: item.title }))}
              onChange={(next) => void switchConversation(next)} />
          </Box>
          {currentMode ? <Badge
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
            <Box className="conversation-menu">
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
            </Box>
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
      <Box className="chat-history" data-running={snapshot.running ? 'true' : 'false'} minWidth="0" minHeight="0" height="100%">
        <ScrollArea
          ref={historyRef}
          type="hover"
          scrollbars="vertical"
          size="1"
          style={{ height: '100%' }}
          onScroll={(event: { currentTarget: HTMLDivElement }) => {
            const el = event.currentTarget
            bottomPinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
          }}>
          <Flex direction="column" gap="3" p="3" minWidth="0" width="100%">
            {showInitGuide ? <InitGuideCard
              state={initState as 'explore' | 'interview'}
              busy={initBusy}
              running={initState === 'explore' ? internalIndexActive : snapshot.running}
              done={initCompleted}
              note={initNote}
              onStart={startInitGuide}
              onDismiss={dismissInitGuide} /> : null}
            {snapshot.hasMore ? <Button
              type="button"
              variant="soft"
              color="gray"
              size="1"
              onClick={() => void loadOlder(session)}
              disabled={snapshot.loadingOlder}>
              {snapshot.loadingOlder ? <Fragment>
                <ActivityDots />
                {t('chat.loadingMore')}
              </Fragment> : t('chat.loadOlder')}
            </Button> : null}
            {historyBlocks.map((block, index) => {
              if (block.kind === 'item') return (
                <ChatRowView
                  key={block.row.id}
                  row={block.row}
                  ctx={ctx}
                  sessionId={session.sessionId}
                  locale={locale}
                  cardTick={messageCardTick}
                  enter={isNewMessage(block.row.id)}
                  messageCards={messageCards}
                  messageCardContext={messageCardContext}
                  onApplied={handleApplied} />
              )
              const attachLive = liveOpen && index === historyBlocks.length - 1
              if (attachLive) return (
                <ChatProcessStack
                  key={block.rows[0]!.id}
                  enter={block.rows.some((row) => isNewMessage(row.id)) || visibleCalls.some((call) => isNewMessage(`running:${call.callId}`)) || isNewMessage('partial-thinking')}>
                  {processDetailRows(block.rows).map((row) => <ChatStepFromRow key={row.id} row={row} running />)}
                  {liveSteps}
                </ChatProcessStack>
              )
              return (
                <ChatProcessBlock
                  key={block.rows[0]!.id}
                  rows={block.rows}
                  enter={block.rows.some((row) => isNewMessage(row.id))} />
              )
            })}
            {liveOpen && (visibleCalls.length > 0 || Boolean(partial.thinking)) && historyBlocks.at(-1)?.kind !== 'steps' ? <ChatProcessStack
              enter={visibleCalls.some((call) => isNewMessage(`running:${call.callId}`)) || isNewMessage('partial-thinking')}>
              {liveSteps}
            </ChatProcessStack> : null}
            {showEmptyHistory ? <Text as="p" size="2" color="gray" className="chat-empty">
              {t('chat.emptyHistory')}
            </Text> : null}
            {outgoing && !outgoingIsCanonical ? <ChatEntry
              className="chat-row user"
              key="local-outgoing"
              enter={isNewMessage('local-outgoing')}>
              <Card size="2">
                <Text size="2" as="p">
                  {outgoing.text}
                </Text>
                {outgoing.projectContextReceipt ? <ProjectContextReceiptView receipt={outgoing.projectContextReceipt} /> : null}
                <Text size="1" color="gray" mt="1" role={outgoing.state === 'failed' ? 'alert' : 'status'}>
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
                </Text>
              </Card>
            </ChatEntry> : null}
            {outgoing?.state === 'accepted' && !outgoingIsCanonical
              ? <ChatEntry
              className="chat-row assistant"
              key="local-replying"
              aria-live="polite"
              enter={isNewMessage('local-replying')}>
              <Text size="2">
                <ActivityDots variant="typing" />
                {t('chat.replying')}
              </Text>
            </ChatEntry>
              : null}
            {queuedSubmissions.map((item) => <ChatEntry
              className="chat-row notice"
              key={`queue:${item.requestId}`}
              enter={isNewMessage(`queue:${item.requestId}`)}>
              <Text size="2" as="p">
                {item.text}
              </Text>
              <Text size="1" color="gray">
                {item.placement === 'queued' ? t('chat.queued') : t('chat.steering')}
              </Text>
            </ChatEntry>)}
            {partial.text ? <ChatEntry
              className="chat-row assistant"
              key="partial-text"
              enter={isNewMessage('partial-text')}>
              <Text size="2" as="div">
                <Markdown text={partial.text} />
              </Text>
            </ChatEntry> : chatLegacy.partial && !partial.thinking ? <ChatEntry
              className="chat-row assistant"
              key="partial-replying"
              aria-live="polite"
              enter={isNewMessage('partial-replying')}>
              <Text size="2">
                <ActivityDots variant="typing" />
                {t('chat.replying')}
              </Text>
            </ChatEntry> : null}
            {pendingItems.map((item) => <PendingCard key={item.key} item={item} />)}
            <PluginChatEvents ctx={ctx} renderSlot={renderSlot} sessionId={session.sessionId} locale={locale} hidden={hidden} />
            {snapshot.openState === 'error' ? <Callout.Root color="red" className="warning">
              <Callout.Text>
                {t('chat.connectionInterrupted')}
              </Callout.Text>
            </Callout.Root> : null}
            {snapshot.promptError && !hasTurnError ? <Callout.Root color="red" className="warning">
              <Callout.Text>
                {t('chat.requestFailed')}
              </Callout.Text>
            </Callout.Root> : null}
          </Flex>
        </ScrollArea>
      </Box>
      <Box asChild px="3" py="2">
        <form className="composer" onSubmit={submit}>
          <Flex direction="column" gap="2">
            <TextArea
              ref={composerRef}
              resize="none"
              size="2"
              style={{ width: '100%' }}
              value={draft}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                setDraft(event.target.value)
                growComposer(event.currentTarget)
              }}
              onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                if (!shouldSubmitComposer({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) return
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }}
              placeholder={t('chat.placeholder')}
              aria-label={t('chat.inputLabel')} />
            {note ? <Text size="1" className="warning" color="red" role="alert">
              {note}
            </Text> : null}
            <Flex className="composer-toolbar" align="center" justify="between" gap="2" wrap="wrap" minWidth="0">
              <Box className="composer-model" flexGrow="1" minWidth="0">
                <ModelPicker
                  key={`${session.sessionId}:${modelRevision}`}
                  ctx={ctx}
                  session={session}
                  onConfigure={onConfigure} />
              </Box>
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
                  disabled={!composerCanSubmit}
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
