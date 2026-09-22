import type { ReviewSnapshot, RpcResult, SkillRecord } from './contracts.ts'
import { unwrap } from './rpc-result.ts'
import { downloadMarkdown } from './skills.ts'

export type ReviewGenerationGate = {
  current: () => number
  next: () => number
  isCurrent: (token: number) => boolean
}

export function createReviewGeneration(start = 0): ReviewGenerationGate {
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

export function reviewRequestStillCurrent(input: {
  token: number
  gate: Pick<ReviewGenerationGate, 'isCurrent'>
  signal: AbortSignal
  sessionId: string
  viewSessionId: string
}): boolean {
  return input.gate.isCurrent(input.token)
    && !input.signal.aborted
    && input.sessionId === input.viewSessionId
}

export type ReviewRequest = {
  sessionId: string
  token: number
  signal: AbortSignal
  controller: AbortController
}

/** Capture session, generation token, and abort lifetime before the first await. */
export function beginReviewRequest(
  gate: ReviewGenerationGate,
  sessionId: string,
  previous?: AbortController | null,
): ReviewRequest {
  previous?.abort()
  const controller = new AbortController()
  const captured = sessionId
  const token = gate.next()
  return { sessionId: captured, token, signal: controller.signal, controller }
}

export function disposeReviewRequest(gate: ReviewGenerationGate, controller: AbortController): void {
  controller.abort()
  gate.next()
}

export type ReviewRpc = (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>

export function shouldSkipReviewRefresh(input: { busy: boolean; editing?: boolean }): boolean {
  return input.busy || input.editing === true
}

export async function loadReviewSnapshot(input: {
  rpc: ReviewRpc
  sessionId: string
  token: number
  gate: Pick<ReviewGenerationGate, 'isCurrent'>
  signal: AbortSignal
  viewSessionId: () => string
}): Promise<ReviewSnapshot | undefined> {
  const captured = input.sessionId
  const raw = await input.rpc('status', { sessionId: captured }, input.signal)
  if (!reviewRequestStillCurrent({
    token: input.token, gate: input.gate, signal: input.signal, sessionId: captured, viewSessionId: input.viewSessionId(),
  })) return undefined
  return unwrap(raw as RpcResult<ReviewSnapshot>)
}

/** Read-only status peek; uses an independent signal so it cannot abort an in-flight write. */
export async function peekReviewSnapshot(input: {
  rpc: ReviewRpc
  sessionId: string
  token: number
  gate: Pick<ReviewGenerationGate, 'isCurrent'>
  viewSessionId: () => string
  busy: () => boolean
  editing?: () => boolean
}): Promise<ReviewSnapshot | undefined> {
  if (shouldSkipReviewRefresh({ busy: input.busy(), editing: input.editing?.() === true })) return undefined
  const token = input.token
  if (!input.gate.isCurrent(token) || token === 0) return undefined
  const next = await loadReviewSnapshot({
    rpc: input.rpc,
    sessionId: input.sessionId,
    token,
    gate: input.gate,
    signal: new AbortController().signal,
    viewSessionId: input.viewSessionId,
  })
  if (!next) return undefined
  if (shouldSkipReviewRefresh({ busy: input.busy(), editing: input.editing?.() === true })) return undefined
  return next
}

export async function exportSkillIfCurrent(input: {
  rpc: ReviewRpc
  sessionId: string
  token: number
  gate: Pick<ReviewGenerationGate, 'isCurrent'>
  signal: AbortSignal
  viewSessionId: () => string
  record: Pick<SkillRecord, 'id' | 'revision'>
  download?: typeof downloadMarkdown
}): Promise<'recorded' | 'stale'> {
  const captured = input.sessionId
  const still = () => reviewRequestStillCurrent({
    token: input.token, gate: input.gate, signal: input.signal, sessionId: captured, viewSessionId: input.viewSessionId(),
  })
  const prepared = unwrap(await input.rpc('skill.export', {
    id: input.record.id, expectedRevision: input.record.revision, sessionId: captured,
  }, input.signal) as RpcResult<{ filename: string; markdown: string; skill: SkillRecord }>)
  if (!still()) return 'stale'
  const download = input.download ?? downloadMarkdown
  const started = download(prepared.filename, prepared.markdown)
  if (!still()) return 'stale'
  if (!started) throw new Error('未能开始下载。')
  unwrap(await input.rpc('skill.exported', {
    id: prepared.skill.id, expectedRevision: prepared.skill.revision, filename: prepared.filename, sessionId: captured,
  }, input.signal) as RpcResult<SkillRecord>)
  if (!still()) return 'stale'
  return 'recorded'
}
