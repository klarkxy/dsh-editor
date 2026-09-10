export type ProjectInitResponse = { created: string[]; skipped: string[] }
export type ProjectInspectionResponse = { hasVisibleEntries: boolean; textFiles: string[]; indexReady: boolean }
export type WorkbenchPathResponse = { path: string; version?: string; metadataWarning?: string }
export type ChapterStatus = 'draft' | 'revising' | 'final'
export type ChapterSummary = {
  path: string
  title: string
  chars: number
  empty: boolean
  excerpt: string
  status: ChapterStatus
  modifiedAt: string | null
  meta?: { beats: number; hasState: boolean }
}
export type OutlineSummary = {
  path: string
  title: string
  chars: number
  excerpt: string
  modifiedAt: string | null
}
export type ProjectOverview = {
  chapters: ChapterSummary[]
  outlines: OutlineSummary[]
  totals: {
    chapters: number
    chars: number
    byStatus: Record<ChapterStatus, number>
  }
  recent: ChapterSummary | null
  recentChapters: ChapterSummary[]
  truncated: boolean
  skipped: number
}
export type ChapterStatusSetResponse = { path: string; status: ChapterStatus }
export type WritingLogEntry = { date: string; chars: number; delta?: number }
export type ProgressDay = { date: string; chars: number; delta: number }
export type ProgressWeek = { weekStart: string; chars: number; delta: number }
export type ProgressRecordResult = ProgressDay
export type ProgressHistory = { days: ProgressDay[]; weeks: ProgressWeek[] }
