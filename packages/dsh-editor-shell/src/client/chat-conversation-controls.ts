import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatRow } from '../adapter.ts'
import type { SessionFace, SessionId, SessionListState, WorkspaceId, WorkspaceListState, WorkspaceView } from '../dsh-compat.ts'
import {
  canConfirmConversationPreset, cancelNewConversationPresetPicker, confirmNewConversationPreset,
  loadNewConversationPresets, projectNewConversationPresets,
  type ConversationPresetChoice,
} from '../conversation-presets.ts'
import {
  ConversationRenameQueue, automaticTitleManaged, archivedConversationRows, canArchiveOrDeleteConversation,
  conversationRows, nextAutomaticConversationTitle, nextVisibleConversationId, shouldConfirmConversationSwitch,
} from '../conversation-lifecycle.ts'
import { isActiveSessionArchiveError, orderedConversationIds, type ConversationFilter } from '../native-conversation-state.ts'
import { resolveNewChatMode, writeLastChatMode } from '../model/chat-last-mode.ts'
import { applyChatModelDefault, takeCreatedChatModelError } from './ui-workspace.ts'
import { t } from '../i18n/index.ts'
import type { ShellContext } from './shared.ts'

const conversationRenameQueue = new ConversationRenameQueue()

type ChatConversationControlsInput = {
  ctx: ShellContext
  session: SessionFace
  workspaceId?: WorkspaceId
  workspace?: WorkspaceView
  sessionList: SessionListState
  workspaceList: WorkspaceListState
  developerMode: boolean
  /** Host preset roster snapshot; undefined while the first list() is in flight or failed. */
  presetRoster: unknown
  locale: string
  rows: ChatRow[]
  draft: string
  setNote(note: string): void
  openConversation(sessionId: SessionId): void
}

/** Conversation mutations use the native host; only pending presentation lives here. */
export function useChatConversationControls({
  ctx, session, workspaceId, workspace, sessionList, workspaceList, developerMode,
  presetRoster, locale, rows, draft, setNote, openConversation,
}: ChatConversationControlsInput) {
  const [renameTarget, setRenameTarget] = useState<SessionId | null>(null)
  const [conversationListOpen, setConversationListOpen] = useState(false)
  const conversationListTrigger = useRef<HTMLButtonElement | null>(null)
  const [conversationBusy, setConversationBusy] = useState(false)
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('active')
  const [archiveStopConfirm, setArchiveStopConfirm] = useState<{ id: string; nextId?: string } | null>(null)
  const [titleOverrides, setTitleOverrides] = useState<Record<string, { title: string; status: 'pending' | 'confirmed' | 'failed' }>>({})
  const [draftConfirm, setDraftConfirm] = useState<{ resolve(value: boolean): void } | null>(null)
  const titleAttempted = useRef(new Set<string>())
  const workspaceSessionIds = workspace?.sessionIds.length ? [...workspace.sessionIds] : [session.sessionId]
  const archivedIds = workspaceList.archivedSessionIds ?? []
  const hostPinnedIds = workspaceList.pinnedSessionIds ?? []
  const conversationTitles = {
    ...Object.fromEntries(Object.entries(sessionList.byId ?? {}).map(([id, value]) => [id, value.title])),
    ...Object.fromEntries(Object.entries(titleOverrides).map(([id, value]) => [id, value.title])),
  }
  useEffect(() => {
    for (const [id, summary] of Object.entries(sessionList.byId ?? {})) conversationRenameQueue.observedTitle(id, summary.title)
    setTitleOverrides((current) => {
      const next = { ...current }
      for (const [id, pending] of Object.entries(current)) {
        const native = sessionList.byId?.[id]?.title
        const observed = conversationRenameQueue.observedTitle(id, native)
        if (pending.status === 'confirmed' && observed === native) delete next[id]
      }
      return Object.keys(next).length === Object.keys(current).length ? current : next
    })
  }, [sessionList.byId])
  const conversations = conversationRows({
    workspaceSessionIds,
    archivedIds,
    reusableBlankIds: Object.values(sessionList.byId ?? {}).filter((item) => item.blank).map((item) => item.id),
    currentId: session.sessionId,
    titles: conversationTitles,
  })
  const archivedConversations = archivedConversationRows({
    workspaceSessionIds,
    archivedIds,
    currentId: session.sessionId,
    titles: conversationTitles,
  })
  const visibleConversationIds = orderedConversationIds({
    ids: [...conversations, ...archivedConversations].map((item) => item.id),
    archivedIds,
    pinnedIds: hostPinnedIds,
    filter: conversationFilter,
  })
  const conversationById = new Map([...conversations, ...archivedConversations].map((item) => [item.id, item]))
  const filteredConversations = visibleConversationIds.map((id) => conversationById.get(id)!).filter(Boolean)
  const currentIsArchived = archivedIds.includes(session.sessionId)
  const canMutateConversation = conversations.some((item) => item.id !== session.sessionId) || canArchiveOrDeleteConversation(conversations.length)

  /* 「新对话」SplitButton 的模式投影：roster 一次载入即可复用；roster 还在路上
     或失败时 presetChoices 为 undefined，点击主按钮再懒加载一次（§5）。 */
  const presetChoices = useMemo(
    () => presetRoster === undefined ? undefined : projectNewConversationPresets(presetRoster, { developerMode }),
    [presetRoster, developerMode, locale],
  )

  /* 当前会话直接用 retained face；列表里其它会话经 binding/retain 拿 face。 */
  const renameSessionById = async (id: SessionId, title: string) => {
    if (id === session.sessionId) return session.rename(title)
    const bound = ctx.sessions.binding(id)
    if (bound) return bound.session.rename(title)
    const ref = ctx.sessions.retain(id, { source: 'workspaceOperation' })
    try {
      const { session: face } = await ref.ready
      return await face.rename(title)
    } finally {
      ref.release()
    }
  }
  const queueConversationRename = (title: string, failureNote: string, automatic = false, id: SessionId = session.sessionId) => {
    const pending = { title, status: 'pending' as const }
    setTitleOverrides((current) => ({ ...current, [id]: pending }))
    void conversationRenameQueue.enqueue(id, async () => {
      try {
        if (automatic && !conversationRenameQueue.canAutomaticallyRename(id, ctx.sessions.list.getSnapshot().byId[id]?.title, automaticTitleManaged(ctx))) {
          setTitleOverrides((current) => { const next = { ...current }; if (next[id] === pending) delete next[id]; return next })
          return
        }
        const result = await renameSessionById(id, title)
        if (!result.ok) throw new Error(failureNote)
        conversationRenameQueue.acknowledgeTitle(id, result.value.title, ctx.sessions.list.getSnapshot().byId[id]?.title)
        setTitleOverrides((current) => {
          if (current[id] !== pending) return current
          const next = { ...current }
          const native = ctx.sessions.list.getSnapshot().byId[id]?.title
          if (conversationRenameQueue.observedTitle(id, native) === native) delete next[id]
          else next[id] = { ...pending, title: result.value.title, status: 'confirmed' }
          return next
        })
      } catch {
        setNote(failureNote)
        setTitleOverrides((current) => current[id] === pending ? { ...current, [id]: { ...pending, status: 'failed' } } : current)
      }
    })
  }
  useEffect(() => {
    if (automaticTitleManaged(ctx)) return
    const summary = sessionList.byId?.[session.sessionId]
    const updatedAt = (summary as unknown as { updatedAt?: unknown } | undefined)?.updatedAt
    const title = nextAutomaticConversationTitle({
      durableTitle: titleOverrides[session.sessionId]?.title ?? summary?.title?.trim(),
      assistantReplies: rows.filter((row) => row.role === 'assistant').map((row) => row.text),
      attempted: titleAttempted.current.has(session.sessionId),
      date: typeof updatedAt === 'number' ? updatedAt : Date.now(),
    })
    if (!title) return
    titleAttempted.current.add(session.sessionId)
    queueConversationRename(title, t('chat.renameAutoFailed'), true)
  }, [rows, session.sessionId, sessionList.byId])
  useEffect(() => () => draftConfirm?.resolve(false), [draftConfirm])
  const canDiscardDraft = async (nextId: string): Promise<boolean> => {
    if (!shouldConfirmConversationSwitch(draft, nextId, session.sessionId)) return true
    return await new Promise<boolean>((resolve) => setDraftConfirm({ resolve }))
  }
  const resolveDraftConfirm = (value: boolean) => {
    draftConfirm?.resolve(value)
    setDraftConfirm(null)
  }
  const switchConversation = async (nextId: string) => {
    if (archivedIds.includes(nextId)) {
      await restoreConversation(nextId)
      return
    }
    if (!(await canDiscardDraft(nextId))) return
    openConversation(nextId as SessionId)
  }
  const renameConversation = (title: string) => {
    const target = renameTarget
    setRenameTarget(null)
    if (!target) return
    if (target === session.sessionId) titleAttempted.current.add(session.sessionId)
    setNote('')
    queueConversationRename(title, t('chat.renameFailed'), false, target)
  }

  const applyDefaultChatModel = (sessionId: SessionId) => applyChatModelDefault(ctx, sessionId)
  /* 新对话（§5）：主按钮用上次模式，菜单项按点选的模式；确认草稿在前，
     create→select→默认模型→open 的顺序与旧 picker 相同，成功后记 last-mode。 */
  const newConversation = async (presetId?: string) => {
    if (!workspaceId || conversationBusy) return
    if (!(await canDiscardDraft('__new-conversation__'))) return
    let choices = presetChoices
    if (choices === undefined) {
      setConversationBusy(true)
      setNote('')
      const loaded = await loadNewConversationPresets(() => ctx.remote.agentPresets.list(), { developerMode })
      setConversationBusy(false)
      if (!loaded.ok) { setNote(loaded.error); return }
      choices = loaded.presets
    }
    const resolved = presetId ?? resolveNewChatMode(globalThis.localStorage, choices)
    if (!resolved || !canConfirmConversationPreset(choices, resolved)) {
      setNote(t('chat.presetSelectFailed'))
      return
    }
    setConversationBusy(true)
    setNote('')
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
      }, { workspaceId, presetId: resolved, allowCustomPreset: developerMode, allowedPresetIds: choices.map((preset) => preset.id) })
      if (!result.ok) {
        setNote(result.error)
        /* create 成功但 select 失败会留下一条空白会话：沿用旧 picker 取消路径归档它。 */
        void cancelNewConversationPresetPicker({
          pendingSessionId: result.sessionId,
          archive: (id) => ctx.workspaces.archiveSession(id),
        })
        return
      }
      writeLastChatMode(globalThis.localStorage, resolved)
    } finally {
      setConversationBusy(false)
    }
  }
  const archiveConversation = async (id: string, stopActivity = false, selectedNextId?: string) => {
    const isCurrent = id === session.sessionId
    if (!workspaceId || conversationBusy || (isCurrent && !canMutateConversation)) return
    setConversationListOpen(false)
    const nextId = selectedNextId ?? (isCurrent
      ? nextVisibleConversationId(conversations.map((item) => item.id), id)
      : undefined)
    if (isCurrent) {
      if (!nextId || (!selectedNextId && !(await canDiscardDraft(nextId)))) return
    }
    setConversationBusy(true)
    setNote('')
    try {
      await ctx.workspaces.archiveSession(id as SessionId, stopActivity ? { stopActivity: true } : undefined)
      setArchiveStopConfirm(null)
      if (isCurrent && nextId) openConversation(nextId as SessionId)
    } catch (error) {
      if (!stopActivity && isActiveSessionArchiveError(error)) {
        setArchiveStopConfirm({ id, nextId })
      } else {
        setNote(t('chat.archiveFailed'))
      }
    } finally {
      setConversationBusy(false)
    }
  }
  const restoreConversation = async (id: string) => {
    if (!workspaceId || conversationBusy) return
    setConversationListOpen(false)
    if (!(await canDiscardDraft(id))) return
    setConversationBusy(true)
    setNote('')
    try {
      await ctx.workspaces.unarchiveSession(id as SessionId)
      openConversation(id as SessionId)
    } catch {
      setNote(t('chat.restoreFailed'))
    } finally {
      setConversationBusy(false)
    }
  }
  const toggleConversationPinFor = async (id: string) => {
    if (conversationBusy || archivedIds.includes(id)) return
    const pinned = hostPinnedIds.includes(id)
    setConversationBusy(true)
    setNote('')
    try {
      if (pinned) await ctx.workspaces.unpinSession(id as SessionId)
      else await ctx.workspaces.pinSession(id as SessionId)
    } catch {
      setNote(t(pinned ? 'chat.unpinFailed' : 'chat.pinFailed'))
    } finally {
      setConversationBusy(false)
    }
  }
  const currentConversationTitle = conversations.find((item) => item.id === session.sessionId)?.title
    ?? archivedConversations.find((item) => item.id === session.sessionId)?.title
    ?? t('chat.newConversation')
  const renameTargetTitle = renameTarget
    ? titleOverrides[renameTarget]?.title ?? conversationById.get(renameTarget)?.title ?? ''
    : ''
  const renameInitialValue = renameTargetTitle === t('chat.newConversation') ? '' : renameTargetTitle
  return {
    renameTarget, setRenameTarget, conversationListOpen, setConversationListOpen,
    conversationListTrigger, conversationBusy, conversationFilter, setConversationFilter,
    archiveStopConfirm, setArchiveStopConfirm, titleOverrides, draftConfirm,
    presetChoices, conversations, archivedConversations, hostPinnedIds, archivedIds,
    filteredConversations, currentIsArchived, canMutateConversation,
    queueConversationRename, resolveDraftConfirm, switchConversation, renameConversation,
    newConversation,
    archiveConversation, restoreConversation, toggleConversationPinFor, currentConversationTitle, renameInitialValue
  }
}
