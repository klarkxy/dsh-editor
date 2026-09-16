import type { EditorUiConversation, SessionId, SessionLifecycle } from '../dsh-compat.ts'
import { emptyTranscript, type ChatTranscript } from '../dsh-compat.ts'
import type { PendingInteraction } from '../adapter.ts'
import { isObservableSource } from './components.tsx'
import type { ShellContext } from './shared.ts'

export const EMPTY_PENDING_LIST: PendingInteraction[] = []
export const EMPTY_PENDING = {
  getSnapshot: (): PendingInteraction[] => EMPTY_PENDING_LIST,
  subscribe: () => () => {},
}

export const EMPTY_TRANSCRIPT = emptyTranscript()
export const EMPTY_CHAT_SNAPSHOT: { legacy?: ChatTranscript } = { legacy: EMPTY_TRANSCRIPT }
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

export function conversationFace(ctx: ConversationHost): EditorUiConversation | undefined {
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

export function resolveConversationChatTarget(ctx: ConversationHost, sessionId: SessionId) {
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

export const DISCONNECTED = {
  getSnapshot: () => 'disconnected' as const,
  subscribe: () => () => {},
}

export function pendingForSession(
  raw: ReadonlyMap<SessionId, PendingInteraction> | PendingInteraction[] | undefined,
  sessionId: SessionId,
): PendingInteraction[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter((item) => item.sessionId === sessionId)
  const item = raw.get(sessionId)
  return item ? [item] : []
}

export type ChatLifecycle = SessionLifecycle & { hasMore?: boolean; loadingOlder?: boolean }

/*
 * 约定俗成的思考强度档位展示名。自定义提供方(llm-pi-ai 手工声明)的模型
 * 在目录里不带推理元数据时,强度下拉先用这套档位渲染;首次选择时把同一套
 * 档位补写进该模型的 settings 声明,之后目录自己提供档位。host 在派发前
 * 校验档位,不声明直接传会被拒,所以必须先补声明。
 */
