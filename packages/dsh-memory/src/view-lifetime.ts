import type { MemoryStatus, RpcResult } from './contracts.ts'

export type MemoryGenerationGate = {
  current: () => number
  next: () => number
  isCurrent: (token: number) => boolean
}

export function createMemoryGeneration(start = 0): MemoryGenerationGate {
  let current = start
  return {
    current: () => current,
    next: () => {
      current += 1
      return current
    },
    isCurrent: token => token === current,
  }
}

export function memoryRequestStillCurrent(input: {
  token: number
  gate: Pick<MemoryGenerationGate, 'isCurrent'>
  signal: AbortSignal
  sessionId: string
  viewSessionId: string
}): boolean {
  return input.gate.isCurrent(input.token)
    && !input.signal.aborted
    && input.sessionId === input.viewSessionId
}

export type MemoryViewRequest = {
  sessionId: string
  token: number
  signal: AbortSignal
  controller: AbortController
}

/** Capture session, generation token, and abort lifetime before the first await. */
export function beginMemoryRequest(
  gate: MemoryGenerationGate,
  sessionId: string,
  previous?: AbortController | null,
): MemoryViewRequest {
  previous?.abort()
  const controller = new AbortController()
  const captured = sessionId
  const token = gate.next()
  return { sessionId: captured, token, signal: controller.signal, controller }
}

export function disposeMemoryRequest(gate: MemoryGenerationGate, controller: AbortController): void {
  controller.abort()
  gate.next()
}

export type MemoryRpc = (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>

export function unwrapMemoryResult<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

export function shouldSkipMemoryRefresh(input: { busy: boolean; editing: boolean }): boolean {
  return input.busy || input.editing
}

export async function loadMemoryStatus(input: {
  rpc: MemoryRpc
  sessionId: string
  token: number
  gate: Pick<MemoryGenerationGate, 'isCurrent'>
  signal: AbortSignal
  viewSessionId: () => string
}): Promise<MemoryStatus | undefined> {
  const captured = input.sessionId
  const raw = await input.rpc('status', captured ? { sessionId: captured } : {}, input.signal)
  if (!memoryRequestStillCurrent({
    token: input.token, gate: input.gate, signal: input.signal, sessionId: captured, viewSessionId: input.viewSessionId(),
  })) return undefined
  return unwrapMemoryResult(raw as RpcResult<MemoryStatus>)
}

/** Read-only status peek; uses an independent signal so it cannot abort an in-flight write. */
export async function peekMemoryStatus(input: {
  rpc: MemoryRpc
  sessionId: string
  token: number
  gate: Pick<MemoryGenerationGate, 'isCurrent'>
  viewSessionId: () => string
  busy: () => boolean
  editing?: () => boolean
}): Promise<MemoryStatus | undefined> {
  if (shouldSkipMemoryRefresh({ busy: input.busy(), editing: input.editing?.() === true })) return undefined
  const token = input.token
  if (!input.gate.isCurrent(token) || token === 0) return undefined
  const next = await loadMemoryStatus({
    rpc: input.rpc,
    sessionId: input.sessionId,
    token,
    gate: input.gate,
    signal: new AbortController().signal,
    viewSessionId: input.viewSessionId,
  })
  if (!next) return undefined
  if (shouldSkipMemoryRefresh({ busy: input.busy(), editing: input.editing?.() === true })) return undefined
  return next
}
