import { useEffect, useRef, useState } from 'react'
import type { ChatRow } from '../adapter.ts'
import type { SessionFace, SessionId, SessionListState, WorkspaceId, WorkspaceListState, WorkspaceView } from '../dsh-compat.ts'
import {
  canConfirmConversationPreset, cancelNewConversationPresetPicker, confirmNewConversationPreset,
  firstAvailableConversationPreset, loadNewConversationPresets, startNewConversationPresetFlow,
  type ConversationPresetChoice,
} from '../conversation-presets.ts'
import {
  ConversationRenameQueue, automaticTitleManaged, archivedConversationRows, canArchiveOrDeleteConversation,
  conversationRows, nextAutomaticConversationTitle, nextVisibleConversationId, shouldConfirmConversationSwitch,
} from '../conversation-lifecycle.ts'
import { isActiveSessionArchiveError, orderedConversationIds, type ConversationFilter } from '../native-conversation-state.ts'
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
  rows: ChatRow[]
  draft: string
  setNote(note: string): void
  openConversation(sessionId: SessionId): void
}

/** Conversation mutations use the native host; only pending presentation lives here. */
export function useChatConversationControls({
  ctx, session, workspaceId, workspace, sessionList, workspaceList, developerMode,
  rows, draft, setNote, openConversation,
}: ChatConversationControlsInput) {
  const [renamingConversation, setRenamingConversation] = useState(false)
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false)
  const conversationMenuTrigger = useRef<HTMLButtonElement | null>(null)
  const conversationMenuYields = useRef(false)
  const [conversationBusy, setConversationBusy] = useState(false)
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('active')
  const [archiveStopConfirm, setArchiveStopConfirm] = useState<{ id: string; nextId?: string } | null>(null)
  const [titleOverrides, setTitleOverrides] = useState<Record<string, { title: string; status: 'pending' | 'confirmed' | 'failed' }>>({})
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
  const currentIsPinned = hostPinnedIds.includes(session.sessionId)
  const canMutateConversation = conversations.some((item) => item.id !== session.sessionId) || canArchiveOrDeleteConversation(conversations.length)
  const queueConversationRename = (title: string, failureNote: string, automatic = false) => {
    const id = session.sessionId
    const pending = { title, status: 'pending' as const }
    setTitleOverrides((current) => ({ ...current, [id]: pending }))
    void conversationRenameQueue.enqueue(session.sessionId, async () => {
      try {
        if (automatic && !conversationRenameQueue.canAutomaticallyRename(id, ctx.sessions.list.getSnapshot().byId[id]?.title, automaticTitleManaged(ctx))) {
          setTitleOverrides((current) => { const next = { ...current }; if (next[id] === pending) delete next[id]; return next })
          return
        }
        const result = await session.rename(title)
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
    setRenamingConversation(false)
    titleAttempted.current.add(session.sessionId)
    setNote('')
    queueConversationRename(title, t('chat.renameFailed'))
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
  const archiveConversation = async (id: string, stopActivity = false, selectedNextId?: string) => {
    if (!workspaceId || conversationBusy || !canMutateConversation) return
    setConversationMenuOpen(false)
    const nextId = selectedNextId ?? (id === session.sessionId
      ? nextVisibleConversationId(conversations.map((item) => item.id), id)
      : undefined)
    if (id === session.sessionId) {
      if (!nextId || (!selectedNextId && !(await canDiscardDraft(nextId)))) return
    }
    setConversationBusy(true)
    setNote('')
    try {
      await ctx.workspaces.archiveSession(id as SessionId, stopActivity ? { stopActivity: true } : undefined)
      setArchiveStopConfirm(null)
      if (id === session.sessionId && nextId) openConversation(nextId as SessionId)
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
    setConversationMenuOpen(false)
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
  const toggleConversationPin = async () => {
    if (conversationBusy || currentIsArchived) return
    setConversationMenuOpen(false)
    setConversationBusy(true)
    setNote('')
    try {
      if (currentIsPinned) await ctx.workspaces.unpinSession(session.sessionId)
      else await ctx.workspaces.pinSession(session.sessionId)
    } catch {
      setNote(t(currentIsPinned ? 'chat.unpinFailed' : 'chat.pinFailed'))
    } finally {
      setConversationBusy(false)
    }
  }
  const currentConversationTitle = conversations.find((item) => item.id === session.sessionId)?.title
    ?? archivedConversations.find((item) => item.id === session.sessionId)?.title
    ?? t('chat.newConversation')
  const renameInitialValue = titleOverrides[session.sessionId]?.title
    ?? (currentConversationTitle === t('chat.newConversation') ? '' : currentConversationTitle)
  return {
    renamingConversation, setRenamingConversation, conversationMenuOpen, setConversationMenuOpen,
    conversationMenuTrigger, conversationMenuYields, conversationBusy, conversationFilter, setConversationFilter,
    archiveStopConfirm, setArchiveStopConfirm, titleOverrides, draftConfirm, presetPicker, setPresetPicker,
    newConversationButton, conversations, archivedConversations, hostPinnedIds, archivedIds,
    filteredConversations, currentIsArchived, currentIsPinned, canMutateConversation,
    queueConversationRename, resolveDraftConfirm, switchConversation, renameConversation,
    createConversation, retryPresetList, confirmPresetPicker, cancelPresetPicker,
    archiveConversation, restoreConversation, toggleConversationPin, currentConversationTitle, renameInitialValue
  }
}
