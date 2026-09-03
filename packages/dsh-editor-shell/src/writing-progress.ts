import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * 写作目标与今日进度:每日字数目标(goalChars) + 每个作品每天的总字数基线
 * (baselines[workspaceId] = { date, startChars }),用于计算"今日写了多少字"。
 *
 * 数据通过 settingsScope 持久化,key 命名空间 'dsh-editor-progress';
 * 视图层 (writing-progress chip) 直接读基线,纯函数负责解码/计算/判定。
 */

export const PROGRESS_SETTINGS_NAMESPACE = 'dsh-editor-progress'

export type Baseline = { date: string, startChars: number }

export type WritingProgress = {
  goalChars: number
  baselines: Record<string, Baseline>
}

export const DEFAULT_WRITING_PROGRESS: WritingProgress = {
  goalChars: 0,
  baselines: {},
}

export const MAX_GOAL_CHARS = 1_000_000

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBaseline(value: unknown): value is Baseline {
  if (!isObject(value)) return false
  const { date, startChars } = value
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(startChars) && (startChars as number) >= 0
}

export function decodeWritingProgress(value: unknown): WritingProgress | undefined {
  if (!isObject(value)) return { ...DEFAULT_WRITING_PROGRESS, baselines: {} }
  const goalRaw = value.goalChars
  const goalChars = typeof goalRaw === 'number' && Number.isFinite(goalRaw) && goalRaw >= 0
    ? Math.min(MAX_GOAL_CHARS, Math.floor(goalRaw))
    : 0
  const baselinesRaw = value.baselines
  const baselines: Record<string, Baseline> = {}
  if (isObject(baselinesRaw)) {
    for (const [workspaceId, raw] of Object.entries(baselinesRaw)) {
      if (typeof workspaceId !== 'string' || !workspaceId) continue
      if (isBaseline(raw)) baselines[workspaceId] = { date: raw.date, startChars: raw.startChars }
    }
  }
  return { goalChars, baselines }
}

/** 本地日期 YYYY-MM-DD,而不是 UTC——写作跨日以"我今天几点"为准。 */
export function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 今日已写字数:当前总字数 - 早上基线,负数取 0(防止跨日/回退为负)。 */
export function computeTodayChars(baseline: Baseline | undefined, currentChars: number): number {
  if (!baseline) return 0
  return Math.max(0, Math.floor(currentChars) - Math.floor(baseline.startChars))
}

export function goalReached(todayChars: number, goalChars: number): boolean {
  return goalChars > 0 && todayChars >= goalChars
}

/** 第一次拿到某作品总字数,或上次基线不是今天的,就需要写新基线。 */
export function shouldUpdateBaseline(baseline: Baseline | undefined, today: string): boolean {
  return !baseline || baseline.date !== today
}

export function progressFromSnapshot(snapshot: SettingsScopeSnapshot<WritingProgress> | undefined, fallback: WritingProgress = DEFAULT_WRITING_PROGRESS): WritingProgress {
  if (!snapshot || snapshot.status !== 'ready' || !snapshot.value) return fallback
  return snapshot.value
}

export function writingProgressFor(snapshot: SettingsScopeSnapshot<WritingProgress> | undefined): WritingProgress {
  return progressFromSnapshot(snapshot)
}

export type ProgressSummary = {
  todayChars: number
  goalChars: number
  reached: boolean
  /** 拼好的小字,目标未设时不带 " / 目标"。 */
  text: string
}

const NUM_FORMAT = new Intl.NumberFormat('zh-CN')

export function progressSummary(args: {
  baseline: Baseline | undefined
  currentChars: number
  goalChars: number
  today?: string
}): ProgressSummary {
  const todayChars = computeTodayChars(args.baseline, args.currentChars)
  const reached = goalReached(todayChars, args.goalChars)
  const todayLabel = `今日 +${NUM_FORMAT.format(todayChars)}`
  const text = args.goalChars > 0 ? `${todayLabel} / 目标 ${NUM_FORMAT.format(args.goalChars)}` : todayLabel
  return { todayChars, goalChars: args.goalChars, reached, text }
}

/** 在概览缺失时不渲染(返回 null 即可),目标/基线就绪时返回单行小字。 */
export function progressChipProps(args: {
  overview: { totals: { chars: number } } | null | undefined
  progress: WritingProgress
  workspaceId: string | undefined
  today?: string
}): ProgressSummary | null {
  if (!args.overview || !args.workspaceId) return null
  const today = args.today ?? localDateKey(new Date())
  const baseline = args.progress.baselines[args.workspaceId]
  return progressSummary({
    baseline: baseline && baseline.date === today ? baseline : undefined,
    currentChars: args.overview.totals.chars,
    goalChars: args.progress.goalChars,
    today,
  })
}

/** scope.set('baselines', next) 之前算出来的下一次值;React 端直接写入。 */
export function nextBaselines(
  progress: WritingProgress,
  workspaceId: string,
  today: string,
  startChars: number,
): Record<string, Baseline> {
  if (!workspaceId) return progress.baselines
  const existing = progress.baselines[workspaceId]
  if (existing && existing.date === today && existing.startChars === startChars) return progress.baselines
  return { ...progress.baselines, [workspaceId]: { date: today, startChars } }
}

export type WritingProgressScope = SettingsScope<WritingProgress>
