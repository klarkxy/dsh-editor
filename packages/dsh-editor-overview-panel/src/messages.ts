import type { ShellLocale } from 'dsh-editor-seats'

export type MessageKey = keyof typeof zh
export type MessageParams = Record<string, string | number>

export const zh = {
  'common.emDash': '—',
  'overview.title': '作品概览',
  'overview.intro': '章节状态、字数分布与近一个月的写作曲线。',
  'overview.close': '关闭概览',
  'overview.loading': '正在读取作品概览…',
  'overview.totals': '合计',
  'overview.chapterCount': '章节数',
  'overview.totalChars': '总字数',
  'overview.statusDist': '状态分布',
  'overview.truncated': '目录较大，概览已截断',
  'overview.chapterList': '章节列表',
  'overview.chapter': '章节',
  'overview.noChapters': '还没有正文章节。',
  'overview.charDist': '字数分布',
  'overview.noChart': '没有可绘制的章节。',
  'overview.barTitle': '{title} · {chars} 字',
  'overview.empty': '空',
  'overview.curve': '写作曲线',
  'overview.curveHint': '近 30 日每日增量，与近 12 周合计。',
  'overview.last30': '近 30 日',
  'overview.todayMark': '今',
  'overview.noDaily': '还没有每日写作记录。保存正文后会开始记曲线。',
  'overview.last12w': '近 12 周',
  'overview.weekDelta': '{key} 起 · {delta}',
  'overview.recentEdits': '最近编辑',
  'overview.noRecent': '还没有最近编辑的章节。',
  'overview.chapterMeta': '{chars} 字 · {status} · {modified}',
  'overview.charsOnly': '{chars} 字',
  'overview.chapterStatusAria': '{title} 章节状态',
  'overview.bucketEmpty': '空章',
  'overview.skipped': '跳过 {count} 项',
  'status.draft': '草稿',
  'status.revising': '修订中',
  'status.final': '已定稿',
  'chapterMeta.hasBeats': '纲',
  'chapterMeta.hasState': '态',
  'command.overview': '作品概览',
  'command.overviewHint': 'Ctrl+Shift+O · 章节状态与写作曲线',
  'error.diskChanged': '磁盘上的文件已变化，请重新读取后再试。',
  'error.notFound': '未找到该文件。',
  'error.sessionMissing': '会话已失效，请重新打开作品。',
  'error.generic': '操作未能完成，请重试。',
} as const

export const en: Record<MessageKey, string> = {
  'common.emDash': '—',
  'overview.title': 'Work overview',
  'overview.intro': 'Chapter status, character distribution, and the last month of writing.',
  'overview.close': 'Close overview',
  'overview.loading': 'Loading work overview…',
  'overview.totals': 'Totals',
  'overview.chapterCount': 'Chapters',
  'overview.totalChars': 'Total characters',
  'overview.statusDist': 'Status',
  'overview.truncated': 'The folder is large, so the overview was truncated',
  'overview.chapterList': 'Chapters',
  'overview.chapter': 'Chapter',
  'overview.noChapters': 'No manuscript chapters yet.',
  'overview.charDist': 'Character distribution',
  'overview.noChart': 'No chapters to chart.',
  'overview.barTitle': '{title} · {chars} chars',
  'overview.empty': 'Empty',
  'overview.curve': 'Writing curve',
  'overview.curveHint': 'Daily delta for 30 days, plus the last 12 weeks.',
  'overview.last30': 'Last 30 days',
  'overview.todayMark': 'Now',
  'overview.noDaily': 'No daily writing record yet. Saving manuscript chapters starts the curve.',
  'overview.last12w': 'Last 12 weeks',
  'overview.weekDelta': 'From {key} · {delta}',
  'overview.recentEdits': 'Recent edits',
  'overview.noRecent': 'No recently edited chapters.',
  'overview.chapterMeta': '{chars} chars · {status} · {modified}',
  'overview.charsOnly': '{chars} chars',
  'overview.chapterStatusAria': '{title} chapter status',
  'overview.bucketEmpty': 'Empty',
  'overview.skipped': 'Skipped {count} items',
  'status.draft': 'Draft',
  'status.revising': 'Revising',
  'status.final': 'Final',
  'chapterMeta.hasBeats': 'Beats',
  'chapterMeta.hasState': 'State',
  'command.overview': 'Work overview',
  'command.overviewHint': 'Ctrl+Shift+O · chapter status and writing curve',
  'error.diskChanged': 'The file on disk changed. Read it again, then retry.',
  'error.notFound': 'That file was not found.',
  'error.sessionMissing': 'The session is gone. Open the work again.',
  'error.generic': 'The action could not finish. Try again.',
}

const dictionaries: Record<ShellLocale, Record<MessageKey, string>> = { zh, en }

let currentLocale: ShellLocale = 'zh'

export function setOverviewLocale(locale: ShellLocale): void {
  currentLocale = locale === 'en' ? 'en' : 'zh'
}

export function getOverviewLocale(): ShellLocale {
  return currentLocale
}

export function intlLocale(locale: ShellLocale = currentLocale): string {
  return locale === 'en' ? 'en' : 'zh-CN'
}

export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}

export function t(key: MessageKey, params?: MessageParams): string {
  const text = dictionaries[currentLocale][key] || zh[key] || String(key)
  return interpolate(text, params)
}

export function message(locale: ShellLocale, key: MessageKey, params?: MessageParams): string {
  const text = dictionaries[locale][key] || zh[key] || String(key)
  return interpolate(text, params)
}

export function formatNumber(value: number, locale: ShellLocale = currentLocale): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value)
}
