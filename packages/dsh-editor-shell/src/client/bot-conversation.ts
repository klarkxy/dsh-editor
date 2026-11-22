import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { WORKBENCH_RPC_CHANNEL, type BotCheckResult, type BotHistoryRow, type BotRolloverReason, type BotStateView } from 'dsh-editor-workbench/contracts'
import { safeRpcCall } from './shared.ts'
import { readModels, selectModel, send } from '../adapter.ts'
import type { SessionFace, SessionId } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'
import { BOT_SETTINGS_DEFAULTS, decodeBotSettings, type BotSettings } from '../bot-settings.ts'
import { idleRecapDue, rolloverGuardBlocked, rolloverReasonAfterTurn, rolloverReasonOnSubmit, type BotGuard } from '../model/bot-conversation.ts'

/** ui-bot namespace values via the client settings scope; defaults when unavailable. */
export function useBotSettings(ctx: ShellContext): BotSettings {
  const scope = (ctx as { configForms?: { get<T>(ns: string): { getSnapshot(): { value?: T }; subscribe(listener: () => void): () => void } } }).configForms?.get<Record<string, unknown>>('ui-bot')
  /* getSnapshot must return a stable reference — decodeBotSettings allocates a
     fresh object every call, which makes useSyncExternalStore loop forever
     (React #185). Cache the decoded value per input. */
  const cache = useRef<{ raw: unknown; decoded: BotSettings }>({ raw: undefined, decoded: BOT_SETTINGS_DEFAULTS })
  const snapshot = () => {
    const raw = scope?.getSnapshot().value
    if (raw === cache.current.raw) return cache.current.decoded
    const decoded = decodeBotSettings(raw)
    const same = decoded.idleRecapMinutes === cache.current.decoded.idleRecapMinutes && decoded.cacheTtlMinutes === cache.current.decoded.cacheTtlMinutes
    if (!same) cache.current = { raw, decoded }
    else cache.current.raw = raw
    return cache.current.decoded
  }
  return useSyncExternalStore(
    scope ? scope.subscribe.bind(scope) : () => () => {},
    snapshot,
    () => BOT_SETTINGS_DEFAULTS,
  )
}

export function botRpc<T>(ctx: ShellContext, endpoint: string, body: Record<string, unknown>) {
  return safeRpcCall<T>(() => ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, endpoint, body))
}

export type SegmentTimeline = {
  sessionId: string
  rows?: BotHistoryRow[]
  failed?: boolean
  /** The segment's session log is gone — skip rendering it entirely. */
  missing?: boolean
  markerAt?: number
  recapText?: string
}

export type BotConversationState = {
  state?: BotStateView
  history: SegmentTimeline[]
  rolling: boolean
  rollingFailed: boolean
  /** Segments hidden by the load-earlier cap, oldest first. */
  hiddenSegments: number
  showEarlier(count: number): void
  refresh(): Promise<void>
  rollover(reason: BotRolloverReason, targetModel?: { provider: string; model: string; reasoningEffort?: string }): Promise<boolean>
  onSubmit(): Promise<{ rolled: boolean; sessionId?: SessionId }>
  onTurnEnded(): void
  markActivity(): void
}

const EARLIER_CHUNK = 2

export function useBotConversation({
  ctx,
  workspaceId,
  session,
  workspaceIdFor,
  running,
  pendingCount,
  botSettings,
}: {
  ctx: ShellContext
  workspaceId?: string
  session?: SessionFace
  workspaceIdFor(sessionId: SessionId): string | undefined
  running: boolean
  pendingCount: number
  botSettings: { idleRecapMinutes: number; cacheTtlMinutes: number }
}): BotConversationState {
  const sessionId = session?.sessionId as SessionId | undefined
  const [state, setState] = useState<BotStateView>()
  const [history, setHistory] = useState<SegmentTimeline[]>([])
  const [earlier, setEarlier] = useState(0)
  const [rolling, setRolling] = useState(false)
  const [rollingFailed, setRollingFailed] = useState(false)
  const rollingRef = useRef(false)
  const rolledTo = useRef<SessionId | undefined>()
  const deferredReason = useRef<BotRolloverReason | undefined>()
  const lastPreparedSeq = useRef<number | undefined>()
  const lastActivity = useRef<number | undefined>()
  const lastKnownSeq = useRef<number | undefined>()
  const wasRunning = useRef(false)
  const guardRef = useRef({ running, pendingCount })
  guardRef.current = { running, pendingCount }
  const loadedSegments = useRef(new Set<string>())

  const refresh = useCallback(async () => {
    if (!sessionId) return
    const result = await botRpc<BotStateView>(ctx, 'bot.state', { sessionId })
    if (result.ok) setState(result.value)
  }, [ctx, sessionId])

  useEffect(() => {
    void refresh()
    deferredReason.current = undefined
    lastPreparedSeq.current = undefined
    lastActivity.current = undefined
    lastKnownSeq.current = undefined
    wasRunning.current = false
    loadedSegments.current.clear()
    setEarlier(0)
  }, [refresh])

  /* Previous segments stitched newest-last, capped by the load-earlier chunk. */
  useEffect(() => {
    const segments = (state?.segments ?? []).filter((segment) => segment.sessionId !== state?.current)
    if (!segments.length) { setHistory((current) => current.length ? [] : current); return }
    const wanted = segments.slice(-Math.max(1, EARLIER_CHUNK + earlier))
    setHistory((current) => {
      const next = wanted.map((segment) => {
        const recap = [...(state?.recaps ?? [])].reverse().find((item) => item.sessionId === segment.sessionId)
        const index = segments.indexOf(segment)
        const markerAt = segments[index + 1]?.startedAt ?? (state?.current ? state.segments.find((item) => item.sessionId === state.current)?.startedAt : undefined)
        const existing = current.find((item) => item.sessionId === segment.sessionId)
        return existing
          ? { ...existing, recapText: recap?.text, markerAt }
          : { sessionId: segment.sessionId, markerAt, recapText: recap?.text }
      })
      const same = next.length === current.length && next.every((item, i) => item === current[i]
        || (item.sessionId === current[i]?.sessionId && item.rows === current[i]?.rows && item.failed === current[i]?.failed && item.recapText === current[i]?.recapText && item.markerAt === current[i]?.markerAt))
      return same ? current : next
    })
    const missing = wanted.filter((segment) =>
      !history.find((item) => item.sessionId === segment.sessionId && (item.rows || item.failed))
      && !loadedSegments.current.has(segment.sessionId))
    for (const segment of missing) {
      loadedSegments.current.add(segment.sessionId)
      void botRpc<{ rows: BotHistoryRow[]; missing?: boolean }>(ctx, 'bot.history', { sessionId, segmentSessionId: segment.sessionId }).then((result) => {
        setHistory((current) => current.map((item) => item.sessionId === segment.sessionId
          ? result.ok ? { ...item, rows: result.value.rows, missing: result.value.missing } : { ...item, failed: true }
          : item))
      })
    }
  }, [state, earlier, history, ctx, sessionId])

  const guard = (): BotGuard => {
    const inputs = guardRef.current
    return { running: inputs.running, rolling: rollingRef.current, pendingInteractions: inputs.pendingCount > 0 }
  }

  const checkNow = useCallback(async (): Promise<BotCheckResult | undefined> => {
    if (!sessionId) return undefined
    const result = await botRpc<BotCheckResult>(ctx, 'bot.check', { sessionId })
    return result.ok ? result.value : undefined
  }, [ctx, sessionId])

  const rollover = useCallback(async (reason: BotRolloverReason, targetModel?: { provider: string; model: string; reasoningEffort?: string }): Promise<boolean> => {
    if (!sessionId || !workspaceId || rollingRef.current) return false
    rollingRef.current = true
    setRolling(true)
    setRollingFailed(false)
    let newId: SessionId | undefined
    try {
      newId = await ctx.uiWorkspace.createSession(workspaceId as never)
      if (targetModel) {
        const result = await selectModel(ctx.remote.session, newId, targetModel.provider as string, targetModel.model as string, targetModel.reasoningEffort)
        if (!result.ok) throw new Error('model selection failed')
      } else {
        /* Copy the current selection when the read succeeds; keep defaults otherwise. */
        const models = await readModels(ctx.remote.session, { sessionId } as SessionFace)
        const current = models.ok ? models.value.current : undefined
        if (current?.provider && current.model) await selectModel(ctx.remote.session, newId, current.provider as string, current.model as string, current.reasoningEffort ?? undefined)
      }
      const attach = await botRpc<{ handoffMode?: string }>(ctx, 'bot.attach', { sessionId: newId, fromSessionId: sessionId, reason })
      if (!attach.ok) throw new Error('attach failed')
      await ctx.uiWorkspace.openSession(newId)
      rolledTo.current = newId
      await refresh()
      return true
    } catch {
      setRollingFailed(true)
      if (newId) {
        try { await ctx.workspaces.archiveSession(newId) } catch { /* best effort */ }
      }
      return false
    } finally {
      rollingRef.current = false
      setRolling(false)
    }
  }, [ctx, sessionId, workspaceId, refresh])

  const onSubmit = useCallback(async (): Promise<{ rolled: boolean; sessionId?: SessionId }> => {
    const check = await checkNow()
    const reason = check ? rolloverReasonOnSubmit(check, botSettings.cacheTtlMinutes, Date.now()) : undefined
    /* The guard reads live inputs through the ref: the check above may have
       taken seconds, and pending items can appear while it is in flight. */
    if (reason && !rolloverGuardBlocked(guard()) && await rollover(reason)) {
      return { rolled: true, sessionId: rolledTo.current }
    }
    return { rolled: false }
  }, [checkNow, botSettings.cacheTtlMinutes, rollover])

  const onTurnEnded = useCallback(() => {
    void (async () => {
      const check = await checkNow()
      const reason = check ? rolloverReasonAfterTurn(check) : undefined
      if (!reason) return
      if (rolloverGuardBlocked(guard())) { deferredReason.current = reason; return }
      deferredReason.current = undefined
      await rollover(reason)
    })()
  }, [checkNow, rollover])

  useEffect(() => {
    if (wasRunning.current && !running) onTurnEnded()
    /* Pending items can clear without a running change; re-evaluate the
       deferred rollover whenever the guard inputs settle. */
    if (!running && deferredReason.current && !rolloverGuardBlocked(guard())) {
      const reason = deferredReason.current
      deferredReason.current = undefined
      void rollover(reason)
    }
    wasRunning.current = running
  }, [running, pendingCount, onTurnEnded, rollover])

  /* Idle recap tick (60 s): bot.check reads the whole session log and meters
     tokens, so the tick skips the RPC unless the activity baseline still needs
     seeding (once after open) or the author has been idle past the setting. */
  useEffect(() => {
    const tick = setInterval(() => {
      void (async () => {
        const baseline = lastActivity.current
        const idleEnough = baseline !== undefined && Date.now() - baseline >= botSettings.idleRecapMinutes * 60_000
        if (baseline !== undefined && !idleEnough) return
        const check = await checkNow()
        if (!check) return
        const activity = Math.max(baseline ?? 0, check.lastActivityAt ?? 0)
        lastActivity.current = Math.max(lastActivity.current ?? 0, activity)
        if (baseline !== undefined && check.lastMessageSeq === lastKnownSeq.current) return
        lastKnownSeq.current = check.lastMessageSeq
        const due = idleRecapDue({
          guard: guard(), check, idleRecapMinutes: botSettings.idleRecapMinutes,
          lastPreparedSeq: lastPreparedSeq.current, lastActivityAt: activity || undefined, now: Date.now(),
        })
        if (!due) return
        lastPreparedSeq.current = check.lastMessageSeq
        const prepared = await botRpc<{ recap?: unknown } | { skipped: string }>(ctx, 'bot.prepareHandoff', { sessionId })
        if (prepared.ok && 'recap' in prepared.value) await refresh()
      })()
    }, 60_000)
    return () => clearInterval(tick)
  }, [checkNow, ctx, sessionId, botSettings.idleRecapMinutes, refresh])

  const markActivity = useCallback(() => { lastActivity.current = Date.now() }, [])
  const showEarlier = useCallback((count: number) => setEarlier((value) => value + count), [])

  return {
    state,
    history,
    rolling,
    rollingFailed,
    hiddenSegments: Math.max(0, (state?.segments ?? []).filter((s) => s.sessionId !== state?.current).length - history.length),
    showEarlier,
    refresh,
    rollover,
    onSubmit,
    onTurnEnded,
    markActivity,
  }
}

export { decodeBotSettings, send }
