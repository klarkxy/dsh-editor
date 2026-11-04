import type { BotCheckResult, BotRolloverReason, BotStateView } from 'dsh-editor-workbench/contracts'
import type { t as Translate } from '../i18n/index.ts'

export type BotGuard = { running: boolean; rolling: boolean; pendingInteractions: boolean; pendingProposals: boolean }

export function rolloverGuardBlocked(guard: BotGuard): boolean {
  return guard.running || guard.rolling || guard.pendingInteractions || guard.pendingProposals
}

/** Reasons a submit should roll over first, in fixed priority order. */
export function rolloverReasonOnSubmit(check: BotCheckResult, cacheTtlMinutes: number, now: number): BotRolloverReason | undefined {
  if (!check.hasMessages) return undefined
  if (cacheTtlMinutes > 0 && check.lastActivityAt !== undefined && now - check.lastActivityAt > cacheTtlMinutes * 60_000) return 'idle-expired'
  if (check.promptChanged) return 'prompt-changed'
  return undefined
}

/** Reasons to roll over after a turn ends. Deferred when the guard blocks. */
export function rolloverReasonAfterTurn(check: BotCheckResult): BotRolloverReason | undefined {
  if (check.ratio !== undefined && check.ratio >= 0.7) return 'context-full'
  if (check.wrapUpRequested) return 'wrap-up'
  return undefined
}

export type IdleRecapInput = {
  guard: BotGuard
  check: BotCheckResult
  idleRecapMinutes: number
  lastPreparedSeq: number | undefined
  lastActivityAt: number | undefined
  now: number
}

/** Idle-tick: prepare a stored handoff once per new message seq after the idle gap. */
export function idleRecapDue(input: IdleRecapInput): boolean {
  if (rolloverGuardBlocked(input.guard)) return false
  if (!input.check.hasMessages) return false
  if (input.lastActivityAt === undefined || input.now - input.lastActivityAt < input.idleRecapMinutes * 60_000) return false
  const seq = input.check.lastMessageSeq
  if (seq === undefined || seq === input.lastPreparedSeq) return false
  return true
}

/** Latest recap that belongs to the given segment and postdates its last author message. */
export function recapForSegment(state: BotStateView, sessionId: string, afterTime?: number): { text: string; createdAt: number } | undefined {
  const recap = [...state.recaps].reverse().find((item) => item.sessionId === sessionId)
  if (!recap) return undefined
  if (afterTime !== undefined && recap.createdAt <= afterTime) return undefined
  return recap
}

export function cacheTtlOptionMinutes(): number[] {
  return [5, 15, 30, 60, 120, 240, 1440, 0]
}

/** TTL option label: hours at 60+, minutes below, 0 = never. */
export function cacheTtlLabel(minutes: number, t: typeof Translate): string {
  if (minutes === 0) return t('settings.botCacheTtlNever')
  if (minutes >= 60) return t('settings.botCacheTtlHours', { hours: minutes / 60 })
  return t('settings.botCacheTtlMinutesShort', { minutes })
}

/** Settings validation: TTL ≠ 0 requires idle < TTL. */
export function botSettingsError(idleRecapMinutes: number, cacheTtlMinutes: number): 'idle-too-long' | undefined {
  if (cacheTtlMinutes !== 0 && idleRecapMinutes >= cacheTtlMinutes) return 'idle-too-long'
  return undefined
}

/** Segment marker time: HH:mm on the same day, month+day+time otherwise, in the active locale. */
export function botSegmentMarkerTime(time: number, locale: 'zh' | 'en', now = new Date()): string {
  const date = new Date(time)
  const tag = locale === 'zh' ? 'zh-CN' : 'en-US'
  const hm = date.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' })
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) return hm
  return `${date.toLocaleDateString(tag, { month: 'short', day: 'numeric' })} ${hm}`
}
