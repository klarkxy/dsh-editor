import { createPortal } from 'react-dom'
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
  partialView,
  send,
  stop,
  visibleRunningCalls,
  readModels,
  selectModel } from '../adapter.ts'
import type {
  SessionFace,
  SessionId,
  WorkspaceId,
} from '../dsh-compat.ts'
import { MESSAGE_CARDS_SERVICE, type ShellMessageCardContext, type ShellMessageCardRegistry } from '../seats.ts'
import { useObservable } from './components.tsx'
import { isObservableSource } from '../model/components.ts'
import { ActivityDots } from './ui/index.ts'
import { Box, Button as UiButton, Flex, IconButton as UiIconButton, Notice, TextArea } from '../ui/index.ts'
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
import { chatEmptyPrompt, partnerSuggestionKind, partnerSuggestionTitle } from './chat-empty.ts'
import { PartnerHeader } from '../app/assistant/partner-header.tsx'
import { BOT_INIT_SENTINEL } from 'dsh-editor-workbench/contracts'
import { blocksText } from '../adapter.ts'
import { botSegmentMarkerTime, recapForSegment } from '../model/bot-conversation.ts'
import { PartnerEmptyState, PartnerSetupState } from '../app/assistant/partner-empty.tsx'
import { useAuxRailActionsHost } from '../app/shell/aux-rail.tsx'
import { ChatHistory } from './chat-history.tsx'
import type { ChatOutgoing } from '../model/chat-history.ts'
import { ModelPicker, type ModelPickerState } from './chat-model-picker.tsx'
import { useBotConversation, useBotSettings } from './bot-conversation.ts'
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


export function Chat({ ctx, session, workspaceId, activePath, getActiveDocTitle, renderSlot, hidden, overlay, onConfigure, onApplied, onWritten, onMoved, onLocate, onDraftDirtyChange, onHide, rewriteRequest, onRewriteConsumed }: { ctx: ShellContext; session: SessionFace; workspaceId?: WorkspaceId; activePath?: string; getActiveDocTitle?(): string | undefined; renderSlot?: SettingsRenderSlot; hidden: boolean; overlay?: boolean; onConfigure(): void; onApplied(path: string): void; onWritten?(path: string): void; onMoved?(from: string, to: string): void; onLocate?(path: string, excerpt: string, start?: number): void; onDraftDirtyChange(dirty: boolean): void; onHide?(): void; rewriteRequest?: { id: number; text: string; workspaceId: WorkspaceId }; onRewriteConsumed?(id: number): void }) {
  const locale = useLocale()
  /* 搭档页头并入辅助栏页签行右端动作位；非栏内挂载（overlay/隐藏）退回内联页头。 */
  const actionsHost = useAuxRailActionsHost()
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
  const pendingRaw = useObservable(ctx.uiSession?.sessionStatus ?? EMPTY_PENDING)
  const pendingItems = useMemo(
    () => pendingForSession(pendingRaw, session.sessionId),
    [pendingRaw, session.sessionId],
  )
  const botSettings = useBotSettings(ctx)
  const sessionList = useObservable(ctx.sessions.list)
  const workspaceList = useObservable(ctx.workspaces.list)
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
  /* ModelPicker 自报状态：空/不可用时由空态或 composer 提示条主导，
     工具栏的内联设置行让位（inlineSetup=false）。 */
  const [modelState, setModelState] = useState<ModelPickerState>('loading')
  const modelBlocked = modelState === 'empty' || modelState === 'unavailable'
  const retryModels = () => setModelRevision((value) => value + 1)
  const historyRef = useRef<HTMLDivElement | null>(null)
  const bottomPinnedRef = useRef(true)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const error = takeCreatedChatModelError(session.sessionId)
    if (error) setNote(error)
  }, [session.sessionId])
  /* 初始化回合的思考/流式正文也照常显示,不再强制清空,避免t('chat.replying')随流式块一闪一闪。 */
  const partial = useMemo(() => partialView(transcript), [transcript.partial])
  /* rows 只依赖 nodes 引用:流式期间 partial 每个令牌都换新对象,但 nodes 引用不变,
     历史行得以凭缓存引用跳过重渲染;t() 文案(停止标记/通知行)随 locale 一起失效。 */
  const rows = useMemo(() => chatRows(transcript), [transcript.nodes, locale])
  const historyBlocks = useMemo(() => clusterChatRows(rows, messageCards), [rows, messageCards, messageCardTick])
  const visibleCalls = useMemo(() => visibleRunningCalls(transcript.runningCalls ?? []), [transcript.runningCalls])
  /* 流式更新跟随到底部；用户主动上翻阅读时松开，回到底部附近再重新跟随。
     依赖全部是记忆化数据:只有历史内容真的变化才补 scrollTop,draft 输入等
     无关重渲染不再触发;用 layout effect 在绘制前完成,避免跟随时闪一帧。
     回合结束后历史底部保持跟随。 */
  const prevRunningForScroll = useRef(false)
  useLayoutEffect(() => {
    const el = historyRef.current
    prevRunningForScroll.current = snapshot.running
    if (!el || !bottomPinnedRef.current) return
    el.scrollTop = el.scrollHeight
  }, [rows, partial, outgoing, visibleCalls, queuedSubmissions, pendingItems, snapshot.running])
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
  const handleApplied = useCallback((path: string) => {
    onApplied(path)
  }, [onApplied])
  /* 记忆化:整份 context 作为 memo 行的 prop,引用稳定行才跳得过重渲染。 */
  const bot = useBotConversation({
    ctx, workspaceId, session,
    workspaceIdFor: () => workspaceId,
    running: snapshot.running,
    pendingCount: pendingItems.length,
    botSettings,
  })
  const lastUserAt = transcript.nodes.reduce((max, node) => (node.kind === 'user' || node.kind === 'steering') && (node as { time?: number }).time ? Math.max(max, (node as { time?: number }).time ?? 0) : max, 0)
  const initTurnActive = snapshot.running
    && transcript.nodes.some((node) => node.kind === 'user' && blocksText(((node as { content?: readonly unknown[] }).content ?? []) as readonly unknown[]).startsWith(BOT_INIT_SENTINEL))
    && !rows.some((row) => row.role === 'assistant')
  const currentRecap = bot.state?.current ? recapForSegment(bot.state, bot.state.current, lastUserAt || undefined)?.text : undefined
  const messageCardContext = useMemo<ShellMessageCardContext>(() => ({
    sessionId: session.sessionId,
    locale,
    onApplied: (path) => onWritten?.(path),
    onMoved: (from, to) => onMoved?.(from, to),
    onLocate: (path, excerpt, start) => onLocate?.(path, excerpt, start),
    refresh: (scope) => {
      if (scope === 'overview') return
      if (scope === 'tree') onWritten?.('')
      else onWritten?.(activePath ?? '')
    },
    note: setNote,
  }), [session.sessionId, locale, onWritten, onMoved, onLocate, activePath])
  /* 空白对话:输入框只留占位提示,不贴说明文字。 */
  const showEmptyHistory = rows.length === 0
    && !outgoing
    && !snapshot.running
    && queuedSubmissions.length === 0
    && visibleCalls.length === 0
    && !partial.text
    && !partial.thinking
    && pendingItems.length === 0
  const composerPlaceholder = useMemo(
    () => chatEmptyPrompt(),
    [locale],
  )
  useEffect(() => { onDraftDirtyChange(Boolean(draft.trim())) }, [draft, onDraftDirtyChange])
  const stagedRewrite = useRef<{ text: string; sessionId: SessionId }>()
  useEffect(() => {
    const staged = stagedRewrite.current
    if (staged && staged.sessionId !== session.sessionId) {
      stagedRewrite.current = undefined
      return
    }
    if (hidden || !connected || !nativeInputReady || voiceActive || bot.rolling || snapshot.running || snapshot.removed || outgoing?.state === 'sending' || outgoing?.state === 'accepted') return
    if (staged) {
      if (!draft) return
      // Wait for the native input to echo the draft before submitting it.
      // If the author edits it first, keep their text for manual submission.
      stagedRewrite.current = undefined
      if (draft === staged.text) composerRef.current?.form?.requestSubmit()
      return
    }
    if (!rewriteRequest || rewriteRequest.workspaceId !== workspaceId || draft.trim()) return
    stagedRewrite.current = { text: rewriteRequest.text, sessionId: session.sessionId }
    fillComposerDraft(rewriteRequest.text)
    onRewriteConsumed?.(rewriteRequest.id)
  }, [rewriteRequest, workspaceId, session.sessionId, onRewriteConsumed, hidden, connected, nativeInputReady, voiceActive, bot.rolling, draft, snapshot.running, snapshot.removed, outgoing?.state])
  useEffect(() => { if (bot.rollingFailed) setNote(t('chat.botRolloverFailed')) }, [bot.rollingFailed])
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
    bot.markActivity()
    void (async () => {
      const { rolled, sessionId: rolledId } = await bot.onSubmit()
      if (rolled && rolledId) {
        const ref = ctx.sessions.retain(rolledId, { source: 'workspaceOperation' })
        try {
          const { session: face } = await ref.ready
          return await send(face, value)
        } finally {
          ref.release()
        }
      }
      return await send(session, value)
    })().then((result) => {
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
  }
  /* §5 空状态建议：点击只填入草稿并聚焦输入框，绝不发送。 */
  const fillComposerDraft = (text: string) => {
    if (nativeInput.current) nativeInput.current.setDraft(text)
    else projectNativeDraft(text)
    composerRef.current?.focus()
  }
  const stitched = <>
    {initTurnActive ? <div className="chat-bot-init"><ActivityDots /> {t('chat.botInitializing')}</div> : null}
    {bot.hiddenSegments > 0 ? <UiButton
      type="button" variant="secondary" size="sm"
      className="chat-bot-earlier"
      onClick={() => bot.showEarlier(2)}>{t('chat.botLoadEarlier')}</UiButton> : null}
    {bot.history.filter((segment) => !segment.missing).map((segment) => <div key={segment.sessionId} className="chat-bot-segment">
      {segment.failed ? <div className="chat-bot-failed">{t('chat.botHistoryFailed')}</div>
        : (segment.rows ?? []).map((row) => <ChatRowView
            key={row.seq}
            row={{ id: `bot-segment:${row.seq}`, role: row.role, text: row.text, writingChange: row.writingChange }}
            ctx={ctx}
            sessionId={session.sessionId}
            locale={locale}
            cardTick={messageCardTick}
            enter={false}
            messageCards={messageCards}
            messageCardContext={messageCardContext}
            onApplied={handleApplied} />)}
      <div className="chat-bot-marker">
        <span>{t('chat.botSegmentMarker', { time: botSegmentMarkerTime(segment.markerAt ?? 0, locale) })}</span>
        {segment.recapText ? <details className="chat-bot-recap"><summary>{t('chat.botRecapShow')}</summary>{segment.recapText}</details> : null}
      </div>
    </div>)}
    {currentRecap ? <div className="chat-bot-current-recap">
      <div className="chat-bot-recap-title">{t('chat.botRecapTitle')}</div>
      <div className="chat-bot-text">{currentRecap}</div>
    </div> : null}
  </>
  const suggestionKind = partnerSuggestionKind(activePath)
  const partnerHeader = <PartnerHeader
    trailing={overlay && onHide ? <UiIconButton
      label={t('chat.closeAssistant')}
      onClick={onHide}>
      <CrossIcon size="sm" />
    </UiIconButton> : null} />
  return (
    <aside
      className={overlay ? 'chat chat-overlay' : 'chat'}
      aria-label={t('chat.assistant')}
      hidden={hidden}
      {...(hidden ? { inert: '' } : {})}
      data-chat-face={conversationFace(ctx) ? 'official' : 'missing'}
      data-chat-nodes={String(transcript.nodes.length)}>
      {actionsHost && !hidden
        ? createPortal(partnerHeader, actionsHost)
        : <header className="chat-header">{partnerHeader}</header>}
      <ChatHistory
        ctx={ctx} session={session} locale={locale} hidden={hidden} renderSlot={renderSlot}
        snapshot={snapshot} historyRef={historyRef} bottomPinnedRef={bottomPinnedRef} stitched={stitched}
        historyBlocks={historyBlocks} messageCards={messageCards} messageCardTick={messageCardTick}
        messageCardContext={messageCardContext} handleApplied={handleApplied} isNewMessage={isNewMessage}
        partial={partial} hasPartial={Boolean(transcript.partial)} visibleCalls={visibleCalls}
        queuedSubmissions={queuedSubmissions} pendingItems={pendingItems} outgoing={outgoing}
        outgoingIsCanonical={outgoingIsCanonical} hasTurnError={hasTurnError}
        empty={showEmptyHistory
          ? (modelBlocked
            ? <PartnerSetupState
              unavailable={modelState === 'unavailable'}
              onConfigure={onConfigure}
              onRetry={retryModels} />
            : (bot.state?.projectEmpty
            ? <div className="chat-bot-greeting">{t('chat.botGreeting')}</div>
            : <PartnerEmptyState
              title={partnerSuggestionTitle(activePath, workspace?.title, getActiveDocTitle?.())}
              kind={suggestionKind}
              onPick={fillComposerDraft} />))
          : null}
        />
      <form className="composer" onSubmit={submit}>
        {bot.rolling ? <div className="composer-status" role="status">
          <ActivityDots />
          {t('chat.botRolling')}
        </div> : null}
        {!connected ? <div className="composer-status" role="status">
          <ActivityDots />
          {t('chat.reconnecting')}
        </div> : null}
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
        {!showEmptyHistory && modelBlocked ? <Notice
          tone="warning"
          className="composer-note"
          title={modelState === 'unavailable' ? t('chat.apiUnavailable') : t('chat.noModels')}
          action={<Flex gap="2" wrap="nowrap">
            <UiButton variant="secondary" size="sm" type="button" onClick={onConfigure}>{t('chat.setApi')}</UiButton>
            <UiButton variant="secondary" size="sm" type="button" onClick={retryModels}>{t('common.retry')}</UiButton>
          </Flex>} /> : null}
        <Flex className="composer-toolbar" align="center" justify="between" gap="2" wrap="nowrap" minWidth="0">
          <Box className="composer-model" flexGrow="1" minWidth="0">
            <ModelPicker
              key={`${session.sessionId}:${modelRevision}`}
              ctx={ctx}
              session={session}
              onConfigure={onConfigure}
              inlineSetup={false}
              disabled={snapshot.running || bot.rolling}
              onStateChange={setModelState}
              onSelectModel={async (provider, model, reasoningEffort) => {
                const read = await readModels(ctx.remote.session, session)
                const current = read.ok ? read.value.current : undefined
                const differs = !current || current.provider !== provider || current.model !== model
                if (differs && rows.length > 0) { await bot.rollover('model-switch', { provider, model, reasoningEffort }) }
                else await selectModel(ctx.remote.session, session.sessionId, provider, model, reasoningEffort)
              }} />
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
  PendingCard,
  ProjectContextReceiptView,
}
