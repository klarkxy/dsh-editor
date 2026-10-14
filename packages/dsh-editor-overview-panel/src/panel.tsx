import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  WORKBENCH_RPC_CHANNEL,
  type ChapterSummary,
  type ProgressHistory,
  type ProjectOverview,
} from 'dsh-editor-workbench/contracts'
import { CENTER_OVERLAY_ATTRIBUTE, type ShellToolSeatContext } from 'dsh-editor-seats'
import { SeatButton } from 'dsh-editor-seats/seat-button'
import { PanelEmpty, PanelHeader, PanelList, PanelNotice, PanelRow, PanelSection } from 'dsh-editor-panel-base/chrome'
import {
  barHeight,
  chapterCharBars,
  chapterMetaMarks,
  dailyCurveSeries,
  filterChapters,
  formatCount,
  formatSignedCount,
  formatModifiedAt,
  localDateKey,
  sortChapters,
  weeklyCurveSeries,
} from './overview-view.ts'
import { errorMessage, LatestRequestGate, safeRpcCall } from './rpc.ts'
import { setOverviewLocale, t } from './messages.ts'
import { consumeOverviewRequest, pendingOverviewRequest, subscribeOverviewRequest, type OverviewRequest } from './requests.ts'

export type RpcCaller = {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}

export type OverviewSeatProps = ShellToolSeatContext & { rpc: RpcCaller }

const CURVE_BAR_MAX = 56

/* 活动暗示:骨架行(fluid-skeleton),参数改写自
   Amicro(MIT License, Copyright (c) 2026 Syed Subhan Uddin);装饰 aria-hidden,
   关键帧在 styles.ts,reduced-motion 停循环后保留静态可读态。 */
const skeletonRows = (widths: readonly string[]) => <span className="panel-skeleton" aria-hidden="true">
  {widths.map((width, index) => <i key={index} style={{ width }} />)}
</span>

function OverviewPanel(props: OverviewSeatProps & { request?: OverviewRequest | null; onClose(): void }) {
  setOverviewLocale(props.locale)
  const [overview, setOverview] = useState<ProjectOverview | null | undefined>(undefined)
  const [note, setNote] = useState('')
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

  const openChapter = (path: string) => {
    props.onClose()
    props.openDocument(path)
  }

  const chapters = overview ? sortChapters(overview.chapters) : []
  const visibleChapters = filterChapters(chapters, filter)
  const charBars = chapterCharBars(chapters)
  const daily = history ? dailyCurveSeries(history.days, today, 30) : []
  const weekly = history ? weeklyCurveSeries(history.weeks, 12) : []
  const hasDailyActivity = daily.some((bar) => bar.delta !== 0)
  const hasWeeklyActivity = weekly.some((bar) => bar.delta !== 0)
  const loading = overview === undefined
  const failed = overview === null

  return (
    <section
      className="dsh-panel overview-panel"
      {...{ [CENTER_OVERLAY_ATTRIBUTE]: "" }}
      data-testid="overview-panel"
      aria-label={t('overview.title')}>
      <PanelHeader
        className="overview-header"
        titleId="overview-panel-title"
        title={t('overview.title')}
        Button={props.Button}
        closeLabel={t('overview.close')}
        onClose={props.onClose} />
      {loading ? <div className="overview-loading" role="status">
        <span className="overview-loading-cards" aria-hidden="true">
          <i />
          <i />
        </span>
        {skeletonRows(['100%', '88%', '96%', '72%'])}
        <span className="sr-only">
          {t('overview.loading')}
        </span>
      </div> : null}
      {failed ? <PanelNotice tone="danger" role="alert">
        {note || t('overview.loadError')}
        <SeatButton host={props.Button} onClick={() => { void loadOverview(); void loadHistory() }}>
          {t('overview.retry')}
        </SeatButton>
      </PanelNotice> : null}
      {overview ? <div className="overview-body">
        <section className="overview-totals" aria-label={t('overview.totals')}>
          <article>
            <span>
              {t('overview.chapterCount')}
            </span>
            <strong>
              {formatCount(overview.totals.chapters)}
            </strong>
          </article>
          <article>
            <span>
              {t('overview.totalChars')}
            </span>
            <strong>
              {formatCount(overview.totals.chars)}
            </strong>
          </article>
        </section>
        {overview.truncated ? <PanelNotice tone="danger" role="status">
          {`${t('overview.truncated')}${overview.skipped ? `（${t('overview.skipped', { count: overview.skipped })}）` : ''}`}
        </PanelNotice> : null}
        {note ? <PanelNotice tone="danger" role="alert">
          {note}
        </PanelNotice> : null}
        <PanelSection className="overview-chapters" label={t('overview.chapter')} aria-label={t('overview.chapterList')}>
          {props.Input
            ? <props.Input
              className="overview-filter"
              value={filter}
              maxLength={80}
              placeholder={t('overview.filterPlaceholder')}
              aria-label={t('overview.filter')}
              onChange={(value) => setFilter(value)} />
            : <input
              className="overview-filter"
              value={filter}
              maxLength={80}
              placeholder={t('overview.filterPlaceholder')}
              aria-label={t('overview.filter')}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setFilter(event.target.value)} />}
          {overview.chapters.length === 0
            ? <PanelEmpty>{t('overview.noChapters')}</PanelEmpty>
            : visibleChapters.length === 0
              ? <PanelEmpty>{t('overview.noMatch')}</PanelEmpty>
              : <PanelList ordered className="overview-chapter-list">
            {visibleChapters.map((chapter) => <ChapterRow
            hostButton={props.Button} key={chapter.path} chapter={chapter} onOpen={openChapter} />)}
          </PanelList>}
        </PanelSection>
        <PanelSection className="overview-chart" label={t('overview.charDist')} aria-label={t('overview.charDist')}>
          {charBars.length === 0
            ? <PanelEmpty>{t('overview.noChart')}</PanelEmpty>
            : <PanelList ordered className="overview-char-bars">
            {charBars.map((bar) => <li
              key={bar.path}
              className={`overview-char-col${bar.empty ? ' empty' : ''}`}
              title={t('overview.barTitle', { title: bar.title, chars: formatCount(bar.chars) })}>
              <SeatButton
                host={props.Button}
                className="overview-char-label"
                onClick={() => openChapter(bar.path)}>
                {bar.title}
              </SeatButton>
              <span className="overview-char-meter" aria-hidden="true"><i style={{ width: `${bar.ratio * 100}%` }} /></span>
              <span className="overview-char-value">{bar.empty ? t('overview.empty') : t('overview.charsOnly', { chars: formatCount(bar.chars) })}</span>
            </li>)}
          </PanelList>}
        </PanelSection>
        <PanelSection className="overview-chart" label={t('overview.curve')} aria-label={t('overview.curve')}>
          {historyNote ? <PanelNotice tone="danger" role="status">
            {historyNote}
          </PanelNotice> : null}
          {history ? <>
          <h4>{t('overview.dailyTitle')}</h4>
          <p className="overview-chart-summary">{t('overview.dailySummary', { delta: formatSignedCount(daily.at(-1)?.delta ?? 0) })}</p>
          {hasDailyActivity ? <div className="overview-curve daily" aria-label={t('overview.last30')}>
            {daily.map((bar) => <div
              key={bar.key}
              className={`overview-curve-col${bar.today ? ' today' : ''}${bar.delta < 0 ? ' negative' : ''}`}
              title={`${bar.key} · ${formatSignedCount(bar.delta)}`}>
              <i
                style={{ height: `${barHeight(bar.ratio, CURVE_BAR_MAX)}px` }}
                aria-hidden="true" />
              <small>
                {bar.today ? t('overview.todayMark') : Number(bar.key.slice(-2)) % 5 === 0 ? bar.label.slice(3) : ''}
              </small>
            </div>)}
          </div> : <PanelEmpty className="overview-chart-empty">
            {history?.days.length ? t('overview.noDailyChange') : t('overview.noDaily')}
          </PanelEmpty>}
          <h4>{t('overview.weeklyTitle')}</h4>
          {hasWeeklyActivity ? <div className="overview-curve weekly" aria-label={t('overview.last12w')}>
            {weekly.map((bar) => <div
              key={bar.key}
              className={`overview-curve-col${bar.delta < 0 ? ' negative' : ''}`}
              title={t('overview.weekDelta', { key: bar.key, delta: formatSignedCount(bar.delta) })}>
              <i
                style={{ height: `${barHeight(bar.ratio, CURVE_BAR_MAX)}px` }}
                aria-hidden="true" />
              <small>
                {bar.label.slice(3)}
              </small>
            </div>)}
          </div> : <PanelEmpty className="overview-chart-empty">{t('overview.noWeeklyChange')}</PanelEmpty>}
          </> : historyNote ? null : <PanelEmpty>{t('overview.historyLoading')}</PanelEmpty>}
        </PanelSection>
        <PanelSection className="overview-recent" label={t('overview.recentEdits')} aria-label={t('overview.recentEdits')}>
          {!overview.recentChapters.length
            ? <PanelEmpty>{t('overview.noRecent')}</PanelEmpty>
            : <PanelList>
            {overview.recentChapters.map((chapter) => <PanelRow key={chapter.path}>
              <SeatButton host={props.Button} onClick={() => openChapter(chapter.path)}>
                {chapter.title}
              </SeatButton>
              <small>
                {t('overview.chapterMeta', { chars: formatCount(chapter.chars), modified: formatModifiedAt(chapter.modifiedAt) })}
              </small>
            </PanelRow>)}
          </PanelList>}
        </PanelSection>
      </div> : null}
    </section>
  );
}

function ChapterRow(props: {
  chapter: ChapterSummary
  onOpen(path: string): void
  hostButton?: ShellToolSeatContext['Button']
}) {
  const { chapter } = props
  const marks = chapterMetaMarks(chapter.meta)
  return (
    <li className={`overview-chapter${chapter.empty ? ' empty' : ''}`}>
      <SeatButton
        host={props.hostButton}
        className="overview-chapter-title"
        onClick={() => props.onOpen(chapter.path)}>
        {chapter.title}
      </SeatButton>
      <span className="overview-chapter-chars">
        {t('overview.charsOnly', { chars: formatCount(chapter.chars) })}
      </span>
      <span className="overview-chapter-meta" title={marks.firstBeat}>
        {marks.hasBeats ? <span className="overview-meta-pill">
          {t('chapterMeta.hasBeats')}
        </span> : null}
        {marks.hasState ? <span className="overview-meta-pill">
          {t('chapterMeta.hasState')}
        </span> : null}
      </span>
      {chapter.empty ? <span className="overview-empty-flag">
        {t('overview.bucketEmpty')}
      </span> : null}
      <time
        className="overview-chapter-time"
        dateTime={chapter.modifiedAt ?? undefined}>
        {formatModifiedAt(chapter.modifiedAt)}
      </time>
    </li>
  );
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
  return <OverviewPanel {...props} request={request} onClose={() => setOpen(false)} />;
}
