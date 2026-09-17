import { t } from './i18n/index.ts'

/** Copy the home stage interpolates. Keep in sync with HomeScreen. */
export function homeStageCopy(): {
  intro: string
  openWork: string
  openWorkDesc: string
  newWork: string
  newWorkDesc: string
} {
  return {
    intro: t('home.intro'),
    openWork: t('home.openWork'),
    openWorkDesc: t('home.openWorkDesc'),
    newWork: t('home.new'),
    newWorkDesc: t('home.newDesc'),
  }
}

/** Short recent-work path: last two segments, so the disk root stays off the card. */
export function recentWorkPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 2) return normalized
  return parts.slice(-2).join('/')
}

/* 把 WorkspaceView.updatedAt(ISO-8601)格式化为首页最近作品区使用的简短时间标签:
   60 秒内=刚刚,1 小时内=分钟前,今天=小时前,昨天,7 天内=天数前,
   更早用 M月D日(同年)或 YYYY/MM/DD(跨年)。失败时退回到空串。 */
export function formatRecentTime(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const stamp = Date.parse(iso)
  if (!Number.isFinite(stamp)) return ''
  const diff = Math.max(0, now.getTime() - stamp)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return t('time.justNow')
  if (diff < hour) return t('time.minutesAgo', { count: Math.floor(diff / minute) })
  if (diff < day && now.getDate() === new Date(stamp).getDate()) return t('time.hoursAgo', { count: Math.floor(diff / hour) })
  const stampDate = new Date(stamp)
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (stampDate.getFullYear() === yesterday.getFullYear() && stampDate.getMonth() === yesterday.getMonth() && stampDate.getDate() === yesterday.getDate()) return t('time.yesterday')
  if (diff < 7 * day) return t('time.daysAgo', { count: Math.floor(diff / day) })
  const yyyy = stampDate.getFullYear()
  const mm = String(stampDate.getMonth() + 1).padStart(2, '0')
  const dd = String(stampDate.getDate()).padStart(2, '0')
  if (yyyy === now.getFullYear()) return t('time.monthDay', { month: stampDate.getMonth() + 1, day: stampDate.getDate() })
  return `${yyyy}/${mm}/${dd}`
}
