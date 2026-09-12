import { createElement as e, useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  WORKBENCH_RPC_CHANNEL,
  type ChapterStatus,
  type ChapterSummary,
  type ProgressHistory,
  type ProjectOverview,
} from 'dsh-editor-workbench/contracts'
import { CENTER_OVERLAY_ATTRIBUTE, type ShellToolSeatContext } from 'dsh-editor-seats'
import {
  CHAPTER_STATUSES,
  applyChapterStatus,
  barHeight,
  chapterCharBars,
  chapterMetaMarks,
  chapterStatusLabel,
  dailyCurveSeries,
  filterChapters,
  formatCount,
  formatModifiedAt,
  localDateKey,
  statusDistributionBars,
  weeklyCurveSeries,
} from './overview-view.ts'
import { renderSelect } from './host-ui.ts'
import { errorMessage, LatestRequestGate, safeRpcCall } from './rpc.ts'
import { setOverviewLocale, t } from './messages.ts'
import { consumeOverviewRequest, pendingOverviewRequest, subscribeOverviewRequest, type OverviewRequest } from './requests.ts'

export type RpcCaller = {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}

export type OverviewSeatProps = ShellToolSeatContext & { rpc: RpcCaller }

const STATUS_BAR_MAX = 28
const CHAR_BAR_MAX = 72
const CURVE_BAR_MAX = 56

function OverviewPanel(props: OverviewSeatProps & { request?: OverviewRequest | null; onClose(): void }) {
  setOverviewLocale(props.locale)
  const [overview, setOverview] = useState<ProjectOverview | null | undefined>(undefined)
  const [note, setNote] = useState('')
  const [statusBusyPath, setStatusBusyPath] = useState<string | null>(null)
  const [history, setHistory] = useState<ProgressHistory | null>(null)
  const [historyNote, setHistoryNote] = useState('')
  const [filter, setFilter] = useState('')
  const overviewGate = useRef(new LatestRequestGate()).current
  const historyGate = useRef(new LatestRequestGate()).current
  const requestScope = `${props.sessionId}\u0000${props.treeRevision}\u0000${props.contentRevision}`
  overviewGate.setScope(requestScope)
  historyGate.setScope(requestScope)
  const today = localDateKey(new Date())

  const loadOverview = async () => {
    if (!props.sessionId) return
    const ticket = overviewGate.begin(requestScope)
    const result = await safeRpcCall<ProjectOverview>(() => props.rpc.call(WORKBENCH_RPC_CHANNEL, 'project.overview', {
      sessionId: props.sessionId,
    }))
    if (!overviewGate.isCurrent(ticket)) return
    if (!result.ok) {
      setOverview(null)
      setNote(errorMessage(result, props.locale))
      return
    }
    setOverview(result.value)
    setNote('')
  }

  const loadHistory = async () => {
    if (!props.sessionId) return
    const ticket = historyGate.begin(requestScope)
    const result = await safeRpcCall<ProgressHistory>(() => props.rpc.call(WORKBENCH_RPC_CHANNEL, 'progress.history', {
      sessionId: props.sessionId,
      days: 84,
    }))
    if (!historyGate.isCurrent(ticket)) return
    if (!result.ok) {
      setHistory(null)
      setHistoryNote(errorMessage(result, props.locale))
      return
    }
    setHistory(result.value)
    setHistoryNote('')
  }

  useEffect(() => {
    setOverview(undefined)
    setNote('')
    setStatusBusyPath(null)
    setHistory(null)
    setHistoryNote('')
    setFilter('')
    void loadOverview()
    void loadHistory()
  }, [props.sessionId, props.treeRevision, props.contentRevision])

  useEffect(() => {
    if (!props.request) return
    consumeOverviewRequest(props.request)
  }, [props.request?.nonce])

  const changeStatus = async (chapterPath: string, status: ChapterStatus) => {
    if (!overview) return
    const previous = overview
    setOverview(applyChapterStatus(overview, chapterPath, status))
    setStatusBusyPath(chapterPath)
    setNote('')
    const result = await safeRpcCall<{ path: string; status: ChapterStatus }>(() => props.rpc.call(WORKBENCH_RPC_CHANNEL, 'chapter.statusSet', {
      sessionId: props.sessionId,
      path: chapterPath,
      status,
    }))
    setStatusBusyPath(null)
    if (!result.ok) {
      setOverview(previous)
      setNote(errorMessage(result, props.locale))
      return
    }
    props.refresh('overview')
    props.refresh('tree')
  }

  const openChapter = (path: string) => {
    props.onClose()
    props.openDocument(path)
  }

  const statusBars = overview ? statusDistributionBars(overview.totals.byStatus) : []
  const visibleChapters = overview ? filterChapters(overview.chapters, filter) : []
  const charBars = overview ? chapterCharBars(overview.chapters) : []
  const daily = history ? dailyCurveSeries(history.days, today, 30) : []
  const weekly = history ? weeklyCurveSeries(history.weeks, 12) : []
  const loading = overview === undefined
  const failed = overview === null

  return e('section', { className: 'overview-panel', [CENTER_OVERLAY_ATTRIBUTE]: '', 'data-testid': 'overview-panel', 'aria-label': t('overview.title') },
    e('header', { className: 'overview-header' },
      e('div', null,
        e('h2', { id: 'overview-panel-title' }, t('overview.title')),
        e('p', { className: 'muted' }, t('overview.intro')),
      ),
      e('button', { className: 'icon-button', type: 'button', 'aria-label': t('overview.close'), onClick: props.onClose }, '×'),
    ),
    loading ? e('p', { className: 'muted', role: 'status' }, t('overview.loading')) : null,
    failed ? e('p', { className: 'warning', role: 'alert' },
      note || t('overview.loadError'),
      e('button', { type: 'button', onClick: () => { void loadOverview(); void loadHistory() } }, t('overview.retry')),
    ) : null,
    overview ? e('div', { className: 'overview-body' },
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
      overview.truncated ? e('p', { className: 'warning', role: 'status' }, `${t('overview.truncated')}${overview.skipped ? ` (${t('overview.skipped', { count: overview.skipped })})` : ''}.`) : null,
      note ? e('p', { className: 'warning', role: 'alert' }, note) : null,
      e('section', { className: 'overview-chapters', 'aria-label': t('overview.chapterList') },
        e('h3', null, t('overview.chapter')),
        e('input', {
          className: 'overview-filter',
          value: filter,
          maxLength: 80,
          placeholder: t('overview.filterPlaceholder'),
          'aria-label': t('overview.filter'),
          onChange: (event: ChangeEvent<HTMLInputElement>) => setFilter(event.target.value),
        }),
        overview.chapters.length === 0
          ? e('p', { className: 'muted' }, t('overview.noChapters'))
          : visibleChapters.length === 0
            ? e('p', { className: 'muted' }, t('overview.noMatch'))
            : e('ol', { className: 'overview-chapter-list' }, visibleChapters.map((chapter) => e(ChapterRow, {
              key: chapter.path,
              chapter,
              busy: statusBusyPath === chapter.path,
              Select: props.Select,
              onOpen: openChapter,
              onStatusChange: (path, status) => { void changeStatus(path, status) },
            }))),
      ),
      e('section', { className: 'overview-chart', 'aria-label': t('overview.charDist') },
        e('h3', null, t('overview.charDist')),
        charBars.length === 0
          ? e('p', { className: 'muted' }, t('overview.noChart'))
          : e('div', { className: 'overview-char-bars' }, charBars.map((bar) => e('div', { key: bar.path, className: `overview-char-col${bar.empty ? ' empty' : ''}`, title: t('overview.barTitle', { title: bar.title, chars: formatCount(bar.chars) }) },
            e('span', { className: 'overview-char-value' }, bar.empty ? t('overview.empty') : formatCount(bar.chars)),
            e('i', { style: { height: `${barHeight(bar.ratio, CHAR_BAR_MAX)}px` }, 'aria-hidden': 'true' }),
            e('button', { type: 'button', className: 'overview-char-label', onClick: () => openChapter(bar.path) }, bar.title),
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
            e('button', { type: 'button', onClick: () => openChapter(chapter.path) }, chapter.title),
            e('small', null, t('overview.chapterMeta', { chars: formatCount(chapter.chars), status: chapterStatusLabel(chapter.status), modified: formatModifiedAt(chapter.modifiedAt) })),
          ))),
      ),
    ) : null,
  )
}

function ChapterRow(props: {
  chapter: ChapterSummary
  busy: boolean
  Select: OverviewSeatProps['Select']
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
    renderSelect(props.Select, {
      'aria-label': t('overview.chapterStatusAria', { title: chapter.title }),
      value: chapter.status,
      disabled: props.busy,
      options: CHAPTER_STATUSES.map((status) => ({ value: status, label: chapterStatusLabel(status) })),
      onChange: (next) => {
        if (next === 'draft' || next === 'revising' || next === 'final') props.onStatusChange(chapter.path, next)
      },
    }),
    e('time', { className: 'overview-chapter-time', dateTime: chapter.modifiedAt ?? undefined }, formatModifiedAt(chapter.modifiedAt)),
  )
}

export function OverviewSeat(props: OverviewSeatProps) {
  const initial = pendingOverviewRequest()
  const [open, setOpen] = useState(() => initial !== null)
  const [request, setRequest] = useState<OverviewRequest | null>(() => initial)
  const pathWhenOpened = useRef(props.activePath)
  useEffect(() => subscribeOverviewRequest((next) => {
    pathWhenOpened.current = props.activePath
    setOpen(true)
    setRequest(next)
  }), [props.activePath])
  const sessionRef = useRef(props.sessionId)
  useEffect(() => {
    if (sessionRef.current === props.sessionId) return
    sessionRef.current = props.sessionId
    setOpen(false)
    setRequest(null)
  }, [props.sessionId])
  useEffect(() => {
    if (!open) return
    if (props.activePath !== pathWhenOpened.current) setOpen(false)
  }, [open, props.activePath])
  if (!open) return null
  return e(OverviewPanel, { ...props, request, onClose: () => setOpen(false) })
}
