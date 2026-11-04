import { join } from 'node:path'
import { rename } from 'node:fs/promises'
import { ensureMetadataDirectory, readMetadataText, writeMetadataTextAtomic } from '../io/metadata-io.ts'

export type BotRolloverReason = 'idle-expired' | 'model-switch' | 'prompt-changed' | 'context-full' | 'wrap-up' | 'tools-changed'
export type BotHandoffMode = 'verbatim' | 'stored' | 'summarized' | 'tail'

export type BotSegment = {
  sessionId: string
  startedAt: number
  reason: BotRolloverReason | 'first'
  handoffMode?: BotHandoffMode
  handoffText?: string
}

export type BotHandoff = { sessionId: string; coversThroughSeq: number; summary: string; createdAt: number; provider: string; model: string }
export type BotRecap = { sessionId: string; afterSeq: number; text: string; createdAt: number }

export type BotState = {
  schema: 1
  initialized: boolean
  current?: string
  segments: BotSegment[]
  handoff?: BotHandoff
  recaps: BotRecap[]
  wrapUpRequested?: string
}

export const BOT_STATE_FILE = '.dsh-editor/bot.json'
const MAX_SEGMENTS = 200
const MAX_RECAPS = 50

export function emptyBotState(): BotState {
  return { schema: 1, initialized: false, segments: [], recaps: [] }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeSegment(row: unknown): BotSegment | undefined {
  if (!isObject(row) || typeof row.sessionId !== 'string' || !row.sessionId) return undefined
  const startedAt = typeof row.startedAt === 'number' && Number.isFinite(row.startedAt) ? row.startedAt : 0
  return {
    sessionId: row.sessionId,
    startedAt,
    reason: (typeof row.reason === 'string' ? row.reason : 'first') as BotSegment['reason'],
    ...(typeof row.handoffMode === 'string' ? { handoffMode: row.handoffMode as BotHandoffMode } : {}),
    ...(typeof row.handoffText === 'string' && row.handoffText ? { handoffText: row.handoffText } : {}),
  }
}

function normalizeHandoff(row: unknown): BotHandoff | undefined {
  if (!isObject(row) || typeof row.sessionId !== 'string' || typeof row.summary !== 'string' || !row.summary) return undefined
  return {
    sessionId: row.sessionId,
    coversThroughSeq: typeof row.coversThroughSeq === 'number' ? row.coversThroughSeq : 0,
    summary: row.summary,
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
    provider: typeof row.provider === 'string' ? row.provider : '',
    model: typeof row.model === 'string' ? row.model : '',
  }
}

function normalizeRecap(row: unknown): BotRecap | undefined {
  if (!isObject(row) || typeof row.sessionId !== 'string' || typeof row.text !== 'string' || !row.text) return undefined
  return {
    sessionId: row.sessionId,
    afterSeq: typeof row.afterSeq === 'number' ? row.afterSeq : 0,
    text: row.text,
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
  }
}

export function parseBotState(text: string): BotState {
  const raw: unknown = JSON.parse(text)
  if (!isObject(raw) || raw.schema !== 1 || typeof raw.initialized !== 'boolean'
    || !Array.isArray(raw.segments) || !Array.isArray(raw.recaps)) {
    throw new Error('invalid bot state')
  }
  const segments = raw.segments.map(normalizeSegment).filter((item): item is BotSegment => Boolean(item)).slice(-MAX_SEGMENTS)
  const recaps = raw.recaps.map(normalizeRecap).filter((item): item is BotRecap => Boolean(item)).slice(-MAX_RECAPS)
  return {
    schema: 1,
    initialized: raw.initialized,
    ...(typeof raw.current === 'string' && raw.current ? { current: raw.current } : {}),
    segments,
    ...(normalizeHandoff(raw.handoff) ? { handoff: normalizeHandoff(raw.handoff) } : {}),
    recaps,
    ...(typeof raw.wrapUpRequested === 'string' && raw.wrapUpRequested ? { wrapUpRequested: raw.wrapUpRequested } : {}),
  }
}

/** Missing file → empty state; unparseable file → renamed aside, never thrown at the author. */
export async function loadBotState(root: string): Promise<BotState> {
  const text = await readMetadataText(root, BOT_STATE_FILE)
  if (text === null) return emptyBotState()
  try {
    return parseBotState(text)
  } catch {
    try {
      await rename(join(root, BOT_STATE_FILE), join(root, '.dsh-editor', `bot.json.corrupt-${Date.now()}`))
    } catch { /* rename best-effort */ }
    return emptyBotState()
  }
}

export async function saveBotState(root: string, state: BotState): Promise<void> {
  const capped: BotState = { ...state, segments: state.segments.slice(-MAX_SEGMENTS), recaps: state.recaps.slice(-MAX_RECAPS) }
  await ensureMetadataDirectory(root)
  await writeMetadataTextAtomic(root, BOT_STATE_FILE, JSON.stringify(capped, null, 2) + '\n')
}

export function segmentOf(state: BotState, sessionId: string): BotSegment | undefined {
  return state.segments.find((item) => item.sessionId === sessionId)
}

/** Per-work serialization of read-modify-write on bot.json; callers hold no other lock. */
const stateLocks = new Map<string, Promise<unknown>>()

export async function updateBotState(root: string, fn: (state: BotState) => Promise<unknown> | unknown): Promise<unknown> {
  const tail = stateLocks.get(root) ?? Promise.resolve()
  const next = tail.then(async () => {
    const state = await loadBotState(root)
    const result = await fn(state)
    await saveBotState(root, state)
    return result
  })
  stateLocks.set(root, next.catch(() => undefined))
  return next
}
