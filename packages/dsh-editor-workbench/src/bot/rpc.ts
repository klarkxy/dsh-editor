import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { listDir, readTextFile, type WorkspaceFileContext } from 'dsh-manuscript/host-api'
import type { WorkbenchHandlers, WorkbenchRequestContext } from '../rpc/types.ts'
import { str } from '../rpc/types.ts'
import { loadBotState, saveBotState, segmentOf, updateBotState, type BotRecap, type BotSegment, type BotState } from './state.ts'
import { transcriptRows, type SessionEventLike } from './transcript.ts'
import { buildHandoff } from './pipeline.ts'
import { buildInitDigest, buildInitPrompt } from './digest.ts'
import { summarizeSession } from './summary.ts'
import { discardFrozenPrompt, frozenPromptFor } from './freeze.ts'

export type BotRpcDeps = {
  /** Cold-read all events of a session (all surfaces incl. shadowed). Never activates it. */
  readEvents(sessionId: string): Promise<SessionEventLike[]>
  /** Live Session for same-prefix requests and token metering; undefined when unavailable.
   *  Caller must release() when done so the retained reference is not leaked. */
  liveSession(sessionId: string): Promise<{ session: Session; release(): void } | undefined>
  sessionRunning(sessionId: string): Promise<boolean> | boolean
  /** Current fingerprint (preferences + limit-break) vs the frozen snapshot's. */
  promptFingerprint(sessionId: string): { current: string; stored?: string }
  /** Whether the target session already produced turns. */
  hasTurns(sessionId: string): Promise<boolean> | boolean
  /** Usable window (contextWindow − maxOutputTokens) for the session's model; undefined when unknown. */
  usableWindow?(session: Session): Promise<number | undefined>
}

async function listVisiblePaths(files: WorkspaceFileContext): Promise<string[]> {
  const out: string[] = []
  const skip = new Set(['.dsh-editor', '.git', 'node_modules'])
  const walk = async (dir: string, prefix: string): Promise<void> => {
    if (out.length > 400) return
    let entries: Awaited<ReturnType<typeof listDir>>
    try {
      entries = await listDir(files, dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const name = entry.name
      if (skip.has(name) || name.startsWith('.')) continue
      const rel = prefix ? `${prefix}/${name}` : name
      if (entry.type === 'directory' || (entry as { isDirectory?: () => boolean }).isDirectory?.()) await walk(rel, rel)
      else out.push(rel)
    }
  }
  await walk('.', '')
  return out
}

function lastActivityOf(events: readonly SessionEventLike[]): number | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!
    if (event.type === 'user/message' || event.type === 'turn/end') {
      const time = (event as { time?: unknown }).time
      return typeof time === 'number' ? time : undefined
    }
  }
  return undefined
}

async function measureRatio(ctx: Context, deps: BotRpcDeps, session: Session): Promise<number | undefined> {
  try {
    const meter = (ctx as unknown as { tokenMeter?: { measure(session: Session): Promise<{ totalTokens: number }> } }).tokenMeter
    if (!meter || !deps.usableWindow) return undefined
    const window = await deps.usableWindow(session)
    if (!window || window <= 0) return undefined
    return (await meter.measure(session)).totalTokens / window
  } catch {
    return undefined
  }
}

function publicState(state: BotState) {
  return {
    ...state,
    segments: state.segments.map(({ handoffText: _drop, ...rest }) => rest),
    ...(state.handoff ? { handoff: { ...state.handoff, summary: '' } } : {}),
  }
}

export function botHandlers(ctx: Context, deps: BotRpcDeps): WorkbenchHandlers {
  const visible = (files: WorkspaceFileContext) => listVisiblePaths(files)
  return {
    'bot.state': {
      async run({ access, files }) {
        const state = await loadBotState(access.workspace.path)
        const paths = await visible(files)
        const projectEmpty = !paths.some((path) => /\.(md|txt)$/i.test(path) && !/^(?:.+\/)?AGENTS\.md$/i.test(path))
        return { ...publicState(state), projectEmpty }
      },
    },
    'bot.check': {
      async run({ body, access }) {
        const sessionId = str(body, 'sessionId')
        const state = await loadBotState(access.workspace.path)
        const events = await deps.readEvents(sessionId)
        const rows = transcriptRows(events)
        const fingerprint = deps.promptFingerprint(sessionId)
        const held = await deps.liveSession(sessionId)
        let ratio: number | undefined
        try {
          ratio = held ? await measureRatio(ctx, deps, held.session) : undefined
        } finally {
          held?.release()
        }
        return {
          hasMessages: rows.length > 0,
          ...(rows.length ? { lastMessageSeq: rows.at(-1)!.seq } : {}),
          ...(lastActivityOf(events) !== undefined ? { lastActivityAt: lastActivityOf(events)! } : {}),
          ...(ratio !== undefined ? { ratio } : {}),
          promptChanged: fingerprint.stored !== undefined && fingerprint.stored !== fingerprint.current,
          wrapUpRequested: state.wrapUpRequested === sessionId,
        }
      },
    },
    'bot.prepareHandoff': {
      /* Not a workspace mutation: the LLM summary must not hold the work write lock.
       * The short bot-state update re-checks the precondition inside the mutex. */
      async run({ body, access, signal }) {
        const sessionId = str(body, 'sessionId')
        const root = access.workspace.path
        if (await deps.sessionRunning(sessionId)) return { skipped: 'busy' as const }
        const rows = transcriptRows(await deps.readEvents(sessionId))
        const lastSeq = rows.at(-1)?.seq
        const prior = await loadBotState(root)
        if (lastSeq === undefined || (prior.handoff && prior.handoff.sessionId === sessionId && prior.handoff.coversThroughSeq >= lastSeq)) {
          return { skipped: 'no-new-content' as const }
        }
        const held = await deps.liveSession(sessionId)
        if (!held) return { skipped: 'failed' as const }
        let summary: Awaited<ReturnType<typeof summarizeSession>>
        try {
          summary = await summarizeSession(ctx, held.session, signal)
        } finally {
          held.release()
        }
        if (!summary) return { skipped: 'failed' as const }
        const recap: BotRecap = { sessionId, afterSeq: lastSeq, text: summary.recap, createdAt: Date.now() }
        const committed = await updateBotState(root, (state) => {
          if (state.handoff && state.handoff.sessionId === sessionId && state.handoff.coversThroughSeq >= lastSeq) return { skipped: 'no-new-content' as const }
          state.handoff = { sessionId, coversThroughSeq: lastSeq, summary: summary.handoff, createdAt: recap.createdAt, provider: summary.provider, model: summary.model }
          state.recaps = [...state.recaps, recap].slice(-50)
          return { recap }
        })
        return committed
      },
    },
    'bot.attach': {
      /* Not a workspace mutation: the handoff pipeline may call the model. */
      async run({ body, access, signal }) {
        const sessionId = str(body, 'sessionId')
        const fromSessionId = str(body, 'fromSessionId') || undefined
        const reasonRaw = str(body, 'reason')
        const root = access.workspace.path
        const REASONS: ReadonlySet<string> = new Set(['idle-expired', 'model-switch', 'prompt-changed', 'context-full', 'wrap-up', 'tools-changed'])
        if (fromSessionId && !REASONS.has(reasonRaw)) throw new Error(`bot.attach: unknown rollover reason '${reasonRaw}'`)
        if (!fromSessionId) {
          return await updateBotState(root, (state) => {
            if (state.current === sessionId && segmentOf(state, sessionId)) return { handoffMode: undefined }
            if (!segmentOf(state, sessionId)) state.segments.push({ sessionId, startedAt: Date.now(), reason: 'first' })
            state.current = sessionId
            return { handoffMode: undefined }
          })
        }
        const reason = reasonRaw as BotSegment['reason']
        const prior = await loadBotState(root)
        const rows = transcriptRows(await deps.readEvents(fromSessionId))
        const built = await buildHandoff({
          transcript: rows,
          storedHandoff: prior.handoff,
          sourceSessionId: fromSessionId,
          state: prior,
          summarize: async () => {
            const held = await deps.liveSession(fromSessionId)
            if (!held) return undefined
            try {
              return (await summarizeSession(ctx, held.session, signal))?.handoff
            } finally {
              held.release()
            }
          },
        })
        /* A frozen prompt snapshot taken before the attach must not shadow the handoff. */
        if (!(await deps.hasTurns(sessionId))) discardFrozenPrompt(sessionId)
        return await updateBotState(root, (state) => {
          /* Another attach already moved past this source — don't append twice. */
          if (state.current === sessionId && segmentOf(state, sessionId)) {
            return { handoffMode: segmentOf(state, sessionId)?.handoffMode }
          }
          state.segments.push({
            sessionId,
            startedAt: Date.now(),
            reason,
            handoffMode: built.mode,
            ...(built.text ? { handoffText: built.text } : {}),
          })
          state.current = sessionId
          delete state.wrapUpRequested
          if (state.handoff?.sessionId === fromSessionId) delete state.handoff
          return { handoffMode: built.mode }
        })
      },
    },
    'bot.history': {
      async run({ body, access }) {
        const segmentSessionId = str(body, 'segmentSessionId')
        const root = access.workspace.path
        const state = await loadBotState(root)
        if (!segmentOf(state, segmentSessionId)) throw new Error(`bot.history: ${segmentSessionId} is not a segment of this work`)
        const rows = transcriptRows(await deps.readEvents(segmentSessionId))
        return { rows: rows.slice(-400) }
      },
    },
    'bot.initialize': {
      mutation: true,
      async run({ access, files }) {
        const root = access.workspace.path
        const state = await loadBotState(root)
        const paths = await visible(files)
        const docs = paths.filter((path) => /\.(md|txt)$/i.test(path) && !/^(?:.+\/)?AGENTS\.md$/i.test(path))
        if (!docs.length) {
          state.initialized = true
          await saveBotState(root, state)
          return { empty: true }
        }
        const digest = await buildInitDigest({ readText: async (path) => (await readTextFile(files, path)).text }, paths)
        state.initialized = true
        await saveBotState(root, state)
        return { empty: false, prompt: buildInitPrompt(digest) }
      },
    },
  }
}
