export const USER_ACTIVITY_KINDS = ['pointer', 'keydown', 'focus', 'visible'] as const
export type UserActivityKind = (typeof USER_ACTIVITY_KINDS)[number]

export function isUserActivity(kind: string): kind is UserActivityKind {
  return (USER_ACTIVITY_KINDS as readonly string[]).includes(kind)
}

export function shouldRequestIdleReturn(input: {
  now: number
  lastUserActivityAt: number
  idleReturnMs: number
  cardsEnabled: boolean
  visible: boolean
  hidden?: boolean
  focused?: boolean
  assistantStreaming?: boolean
}): boolean {
  if (!input.cardsEnabled || input.hidden || !input.visible) return false
  if (input.focused === false) return false
  if (input.assistantStreaming) return false
  return input.now - input.lastUserActivityAt >= input.idleReturnMs
}

export function nextActivityTimestamp(kind: string, previous: number, now: number): number {
  return isUserActivity(kind) ? now : previous
}

export function shouldSkipRecapAutoRefresh(input: {
  busy: boolean
  editing?: boolean
  disposed?: boolean
}): boolean {
  return input.busy || input.editing === true || input.disposed === true
}

export function createRecapClientWork() {
  let generation = 0
  let request = 0
  let disposed = false
  return {
    get disposed() { return disposed },
    beginLoad() {
      generation += 1
      request += 1
      return generation
    },
    beginRequest() {
      request += 1
      return { generation, request }
    },
    snapshot() {
      return { generation, request }
    },
    isLoad(generationToken: number) {
      return !disposed && generation === generationToken
    },
    isRequest(token: { generation: number; request: number }) {
      return !disposed && generation === token.generation && request === token.request
    },
    dispose() {
      disposed = true
      generation += 1
      request += 1
    },
  }
}

export type RecapClientWork = ReturnType<typeof createRecapClientWork>

export function isCurrentRecapRequest(input: {
  mounted: boolean
  disposed?: boolean
  sessionId: string
  viewSessionId: string
  requestId: number
  latestRequestId: number
  generation?: number
  viewGeneration?: number
}): boolean {
  if (!input.mounted || input.disposed) return false
  if (input.sessionId !== input.viewSessionId) return false
  if (input.requestId !== input.latestRequestId) return false
  if (input.generation !== undefined && input.generation !== input.viewGeneration) return false
  return true
}
