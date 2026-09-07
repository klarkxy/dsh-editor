import { createElement as e, useEffect, useState, type ChangeEvent } from 'react'
import {
  WORKBENCH_RPC_CHANNEL,
  type ChapterStatus,
  type ChapterSummary,
  type ProgressHistory,
  type ProjectOverview,
} from 'dsh-editor-workbench/contracts'
import { localDateKey } from '../writing-progress.ts'
import {
  CHAPTER_STATUSES,
  barHeight,
  chapterCharBars,
  chapterStatusLabel,
  dailyCurveSeries,
  chapterMetaMarks,
  formatCount,
  formatModifiedAt,
  statusDistributionBars,
  weeklyCurveSeries,
} from '../overview-view.ts'
import { errorMessage, safeRpcCall, type ShellContext } from './shared.ts'
import { t } from '../i18n/index.ts'

const STATUS_BAR_MAX = 28
const CHAR_BAR_MAX = 72
const CURVE_BAR_MAX = 56

export function OverviewPanel(props: {
  ctx: ShellContext
  sessionId: string
  overview: ProjectOverview | null | undefined
  revision: number
  note: string
  statusBusyPath: string | null
  onClose(): void
  onOpenChapter(path: string): void
  onStatusChange(path: string, status: ChapterStatus): void
}) {
  const [history, setHistory] = useState<ProgressHistory | null>(null)
  const [historyNote, setHistoryNote] = useState('')
  const today = localDateKey(new Date())

  useEffect(() => {
    let live = true
    void (async () => {
      const result = await safeRpcCall<ProgressHistory>(() => props.ctx.connection.rpc.call(WORKBENCH_RPC_CHANNEL, 'progress.history', {
        sessionId: props.sessionId,
        days: 84,
      }))
      if (!live) return
      if (!result.ok) {
        setHistory(null)
        setHistoryNote(errorMessage(result))
        return
      }
      setHistory(result.value)
      setHistoryNote('')
    })()
    return () => { live = false }
  }, [props.ctx.connection.rpc, props.sessionId, props.revision])

  const overview = props.overview
  const statusBars = overview ? statusDistributionBars(overview.totals.byStatus) : []
  const charBars = overview ? chapterCharBars(overview.chapters) : []
  const daily = history ? dailyCurveSeries(history.days, today, 30) : []
  const weekly = history ? weeklyCurveSeries(history.weeks, 12) : []

  return e('section', { className: 'overview-panel', 'aria-label': t('overview.title') },
    e('header', { className: 'overview-header' },
      e('div', null,
        e('h2', { id: 'overview-panel-title' }, t('overview.title')),
        e('p', { className: 'muted' }, t('overview.intro')),
      ),
      e('button', { className: 'icon-button', type: 'button', 'aria-label': t('overview.close'), onClick: props.onClose }, '×'),
    ),
    !overview ? e('p', { className: 'muted', role: 'status' }, t('overview.loading')) : e('div', { className: 'overview-body' },
      e('section', { className: 'overview-totals', 'aria-label': t('overview.totals') },
        e('article', null, e('span', null, t('overview.chapterCount')), e('strong', null, formatCount(overview.totals.chapters))),
        e('article', null, e('span', null, t('overview.totalChars')), e('strong', null, formatCount(overview.totals.chars))),
        e('article', { className: 'overview-status-card' },
          e('span', null, t('overview.statusDist')),
          e('div', { className: 'overview-status-bars' }, statusBars.map((bar) => e('div', { key: bar.status, className: `overview-status-bar ${bar.status}` },
            e('small', null, `${bar.label} ${formatCount(bar.count)}`),
            e('i', { style: { width: `${Math.round(bar.ratio * 100)}%` }, 'aria-hidden': 'true' }),
          ))),
        ),
      ),
      overview.truncated ? e('p', { className: 'warning', role: 'status' }, `${t('overview.truncated')}${overview.skipped ? ` (${t('proofread.skipped', { count: overview.skipped })})` : ''}.`) : null,
      props.note ? e('p', { className: 'warning', role: 'alert' }, props.note) : null,
      e('section', { className: 'overview-chapters', 'aria-label': t('overview.chapterList') },
        e('h3', null, t('overview.chapter')),
        overview.chapters.length === 0
          ? e('p', { className: 'muted' }, t('overview.noChapters'))
          : e('ol', { className: 'overview-chapter-list' }, overview.chapters.map((chapter) => e(ChapterRow, {
            key: chapter.path,
            chapter,
            busy: props.statusBusyPath === chapter.path,
            onOpen: props.onOpenChapter,
            onStatusChange: props.onStatusChange,
          }))),
      ),
      e('section', { className: 'overview-chart', 'aria-label': t('overview.charDist') },
        e('h3', null, t('overview.charDist')),
        charBars.length === 0
          ? e('p', { className: 'muted' }, t('overview.noChart'))
          : e('div', { className: 'overview-char-bars' }, charBars.map((bar) => e('div', { key: bar.path, className: `overview-char-col${bar.empty ? ' empty' : ''}`, title: t('overview.barTitle', { title: bar.title, chars: formatCount(bar.chars) }) },
            e('span', { className: 'overview-char-value' }, bar.empty ? t('overview.empty') : formatCount(bar.chars)),
            e('i', { style: { height: `${barHeight(bar.ratio, CHAR_BAR_MAX)}px` }, 'aria-hidden': 'true' }),
            e('button', { type: 'button', className: 'overview-char-label', onClick: () => props.onOpenChapter(bar.path) }, bar.title),
          ))),
      ),
      e('section', { className: 'overview-chart', 'aria-label': t('overview.curve') },
        e('h3', null, t('overview.curve')),
        historyNote ? e('p', { className: 'warning', role: 'status' }, historyNote) : null,
        e('p', { className: 'muted' }, t('overview.curveHint')),
        daily.length ? e('div', { className: 'overview-curve', 'aria-label': t('overview.last30') }, daily.map((bar) => e('div', {
          key: bar.key,
          className: `overview-curve-col${bar.today ? ' today' : ''}${bar.delta < 0 ? ' negative' : ''}`,
          title: `${bar.key} · ${bar.delta >= 0 ? '+' : ''}${formatCount(bar.delta)}`,
        },
          e('i', { style: { height: `${barHeight(bar.ratio, CURVE_BAR_MAX)}px` }, 'aria-hidden': 'true' }),
          e('small', null, bar.today ? t('overview.todayMark') : bar.label.slice(3)),
        ))) : e('p', { className: 'muted' }, t('overview.noDaily')),
        weekly.length ? e('div', { className: 'overview-curve weekly', 'aria-label': t('overview.last12w') }, weekly.map((bar) => e('div', {
          key: bar.key,
          className: `overview-curve-col${bar.delta < 0 ? ' negative' : ''}`,
          title: t('overview.weekDelta', { key: bar.key, delta: `${bar.delta >= 0 ? '+' : ''}${formatCount(bar.delta)}` }),
        },
          e('i', { style: { height: `${barHeight(bar.ratio, STATUS_BAR_MAX)}px` }, 'aria-hidden': 'true' }),
          e('small', null, bar.label.slice(3)),
        ))) : null,
      ),
      e('section', { className: 'overview-recent', 'aria-label': t('overview.recentEdits') },
        e('h3', null, t('overview.recentEdits')),
        !overview.recentChapters.length
          ? e('p', { className: 'muted' }, t('overview.noRecent'))
          : e('ul', null, overview.recentChapters.map((chapter) => e('li', { key: chapter.path },
            e('button', { type: 'button', onClick: () => props.onOpenChapter(chapter.path) }, chapter.title),
            e('small', null, t('overview.chapterMeta', { chars: formatCount(chapter.chars), status: chapterStatusLabel(chapter.status), modified: formatModifiedAt(chapter.modifiedAt) })),
          ))),
      ),
    ),
  )
}

function ChapterRow(props: {
  chapter: ChapterSummary
  busy: boolean
  onOpen(path: string): void
  onStatusChange(path: string, status: ChapterStatus): void
}) {
  const { chapter } = props
  const marks = chapterMetaMarks(chapter.meta)
  return e('li', { className: `overview-chapter${chapter.empty ? ' empty' : ''}` },
    e('button', { type: 'button', className: 'overview-chapter-title', onClick: () => props.onOpen(chapter.path) }, chapter.title),
    e('span', { className: 'overview-chapter-chars' }, t('overview.charsOnly', { chars: formatCount(chapter.chars) })),
    e('span', { className: 'overview-chapter-meta', title: marks.firstBeat },
      marks.hasBeats ? e('span', { className: 'overview-meta-pill' }, t('chapterMeta.hasBeats')) : null,
      marks.hasState ? e('span', { className: 'overview-meta-pill' }, t('chapterMeta.hasState')) : null,
    ),
    chapter.empty ? e('span', { className: 'overview-empty-flag' }, t('overview.bucketEmpty')) : null,
    e('select', {
      className: 'overview-status-select',
      'aria-label': t('overview.chapterStatusAria', { title: chapter.title }),
      value: chapter.status,
      disabled: props.busy,
      onChange: (event: ChangeEvent<HTMLSelectElement>) => {
        const next = event.target.value
        if (next === 'draft' || next === 'revising' || next === 'final') props.onStatusChange(chapter.path, next)
      },
    }, CHAPTER_STATUSES.map((status) => e('option', { key: status, value: status }, chapterStatusLabel(status)))),
    e('time', { className: 'overview-chapter-time', dateTime: chapter.modifiedAt ?? undefined }, formatModifiedAt(chapter.modifiedAt)),
  )
}
