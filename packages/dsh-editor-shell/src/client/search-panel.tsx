import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ActivityDots, Button, Input, isImeEvent, Notice, Select } from '../ui/index.ts'
import { m, useChromeMotion } from '../ui/motion.ts'
import { errorMessage, LatestRequestGate, safeRpcCall, searchSkippedText, type ShellContext } from './shared.ts'
import {
  planReplace,
  summarizeReplacePlan,
  type ReplacePlan,
} from '../search-replace.ts'
import { t } from '../i18n/index.ts'
import {
  acceptSearchResults,
  canReplaceAll,
  executeReplacePlan,
  groupSearchHits,
  replaceBlockedByDirty,
  scopeSearchResults,
  searchIdentity,
  searchQueryClearsResults,
  searchTextRequest,
  type ReplaceOutcome,
  type SearchHit,
  type SearchResponse,
  type SearchScope,
} from '../model/search-panel.ts'

function SearchPanel(props: {
  ctx: ShellContext
  sessionId: string
  revision: number
  navigationBlocked: boolean
  activePath: string
  activeDirty: boolean
  query?: string
  onQueryChange?(value: string): void
  scope?: SearchScope
  onScopeChange?(value: SearchScope): void
  outcome?: ReplaceOutcome | null
  onOutcomeChange?(identity: string, outcome: ReplaceOutcome | null): void
  submitTick?: number
  composing?: boolean
  onReplaceBusyChange?(busy: boolean): void
  onOpen(hit: SearchHit): void
  onReplaced?(paths: string[]): void
}) {
  const [internalQuery, setInternalQuery] = useState('')
  const query = props.onQueryChange ? props.query ?? '' : internalQuery
  const [replacement, setReplacement] = useState('')
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [internalScope, setInternalScope] = useState<SearchScope>('project')
  const scope = props.onScopeChange ? props.scope ?? 'project' : internalScope
  const setScope = (value: SearchScope) => {
    if (props.onScopeChange) props.onScopeChange(value)
    else setInternalScope(value)
  }
  const [result, setResult] = useState<{ identity: string; response: SearchResponse } | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
  const [replaceBusy, setReplaceBusy] = useState(false)
  const [note, setNote] = useState('')
  const [noteAlert, setNoteAlert] = useState(false)
  const [confirming, setConfirming] = useState<{ identity: string; replacement: string } | null>(null)
  const [internalOutcome, setInternalOutcome] = useState<ReplaceOutcome | null>(null)
  const outcome = props.onOutcomeChange ? props.outcome ?? null : internalOutcome
  const input = useRef<HTMLInputElement | null>(null)
  const requestGate = useRef(new LatestRequestGate()).current
  const replaceBusyRef = useRef(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const identity = searchIdentity({ sessionId: props.sessionId, revision: props.revision, query, scope, activePath: props.activePath })
  const identityRef = useRef(identity)
  identityRef.current = identity
  requestGate.setScope(identity)
  const acceptedResult = result?.identity === identity ? result.response : null
  const setOutcome = (value: ReplaceOutcome | null) => {
    if (props.onOutcomeChange) props.onOutcomeChange(identity, value)
    else setInternalOutcome(value)
  }
  const currentConfirmation = confirming?.identity === identity && confirming.replacement === replacement
  const busy = searchBusy || replaceBusy

  const clearResults = () => {
    setResult(null)
    setOutcome(null)
    setConfirming(null)
    setNote('')
    setNoteAlert(false)
  }
  const setQuery = (value: string) => {
    if (replaceBusyRef.current) return
    if (props.onQueryChange) props.onQueryChange(value)
    else setInternalQuery(value)
    clearResults()
  }
  useEffect(() => {
    if (searchQueryClearsResults(query)) clearResults()
  }, [query])

  const previousSession = useRef(props.sessionId)
  useEffect(() => {
    const sessionChanged = previousSession.current !== props.sessionId
    previousSession.current = props.sessionId
    if (!props.onQueryChange) setInternalQuery('')
    setReplacement('')
    setResult(null)
    setNote('')
    setNoteAlert(false)
    setSearchBusy(false)
    setConfirming(null)
    if (sessionChanged) setOutcome(null)
  }, [props.sessionId])

  useEffect(() => {
    globalThis.setTimeout(() => input.current?.focus(), 0)
  }, [props.sessionId])

  const search = async (raw: string, nextScope: SearchScope, options?: { keepOutcome?: boolean }) => {
    if (debounceTimer.current) { globalThis.clearTimeout(debounceTimer.current); debounceTimer.current = null }
    if (replaceBusyRef.current || props.composing || identityRef.current !== identity) return
    const value = raw.trim()
    if (!value) {
      setResult(null)
      setOutcome(null)
      setConfirming(null)
      setNote(t('search.emptyQuery'))
      setNoteAlert(true)
      return
    }
    if (!options?.keepOutcome) setOutcome(null)
    setConfirming(null)
    setResult(null)
    const ticket = requestGate.begin(identity)
    setSearchBusy(true)
    setNote('')
    setNoteAlert(false)
    const searched = await safeRpcCall<SearchResponse>(() => props.ctx.connection.rpc.call('/manuscript', 'search.text', searchTextRequest({
      sessionId: props.sessionId,
      query: value,
      scope: nextScope,
      activePath: props.activePath,
    })))
    if (!requestGate.isCurrent(ticket)) return
    setSearchBusy(false)
    if (!searched.ok) { setNote(errorMessage(searched)); setNoteAlert(true); return }
    const accepted = scopeSearchResults(acceptSearchResults(searched.value), nextScope, props.activePath)
    setResult({ identity, response: accepted })
    setNote(accepted.results.length ? '' : t('search.noMatch'))
    setNoteAlert(false)
  }

  const latestSearch = useRef({ search, query, scope })
  latestSearch.current = { search, query, scope }

  useEffect(() => {
    if (!query.trim() || props.composing || replaceBusy) {
      setSearchBusy(false)
      return
    }
    const keepOutcome = Boolean(outcome)
    const timer = globalThis.setTimeout(() => { debounceTimer.current = null; void search(query, scope, { keepOutcome }) }, 350)
    debounceTimer.current = timer
    return () => { globalThis.clearTimeout(timer); if (debounceTimer.current === timer) debounceTimer.current = null }
  }, [identity, props.composing])

  useEffect(() => {
    if (props.submitTick) void search(query, scope)
  }, [props.submitTick])

  const replacePlan = acceptedResult ? planReplace(acceptedResult.results, replacement) : null
  const replaceSummary = replacePlan ? summarizeReplacePlan(replacePlan) : null
  const replaceEnabled = canReplaceAll({ query, replacement, hits: acceptedResult?.results.length ?? 0 })

  const openReplaceConfirm = () => {
    if (!replacePlan || !replaceEnabled || busy) return
    if (replaceBlockedByDirty({ activePath: props.activePath, activeDirty: props.activeDirty, paths: replacePlan.files.map((file) => file.path) })) {
      setNote(t('search.replaceSaveFirst'))
      setNoteAlert(true)
      return
    }
    setOutcome(null)
    setConfirming({ identity, replacement })
  }

  const runReplace = async (plan: ReplacePlan) => {
    if (replaceBusyRef.current || !currentConfirmation || !acceptedResult) return
    if (replaceBlockedByDirty({ activePath: props.activePath, activeDirty: props.activeDirty, paths: plan.files.map((file) => file.path) })) {
      setNote(t('search.replaceSaveFirst'))
      setNoteAlert(true)
      setConfirming(null)
      return
    }
    replaceBusyRef.current = true
    props.onReplaceBusyChange?.(true)
    setReplaceBusy(true)
    setNote('')
    setNoteAlert(false)
    setConfirming(null)
    setResult(null)
    const sessionId = props.sessionId
    const onReplaced = props.onReplaced
    try {
      const completed = await executeReplacePlan({
        plan,
        query: query.trim(),
        read: (path) => safeRpcCall(() => props.ctx.connection.rpc.call('/manuscript', 'file.read', { sessionId, path })),
        write: (path, text, version) => safeRpcCall(() => props.ctx.connection.rpc.call('/manuscript', 'file.write', { sessionId, path, text, version })),
      })
      setOutcome(completed.outcome)
      if (completed.written.length) onReplaced?.(completed.written)
    } finally {
      replaceBusyRef.current = false
      props.onReplaceBusyChange?.(false)
      setReplaceBusy(false)
      const latest = latestSearch.current
      void latest.search(latest.query, latest.scope, { keepOutcome: true })
    }
  }

  const grouped = acceptedResult ? groupSearchHits(acceptedResult.results) : []

  const panelMotion = useChromeMotion('panel')
  const blockImeEnter = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && isImeEvent({ isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) {
      event.preventDefault()
    }
  }
  return (
    <m.section className="search-panel" aria-label={t('search.title')} {...panelMotion}>
      <div className="search-panel-body">
        <div className="search-panel-stack">
          <form
            className="search-form"
            role="search"
            onSubmit={(event: FormEvent) => { event.preventDefault(); void search(query, scope) }}>
            {props.onQueryChange ? null : <Input
              ref={input}
              size="sm"
              className="search-query-input"
              value={query}
              disabled={replaceBusy}
              maxLength={120}
              placeholder={t('search.placeholder')}
              aria-label={t('search.aria')}
              onChange={(value: string) => setQuery(value)}
              onKeyDown={blockImeEnter} />}
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={busy || !query.trim() || props.composing}
              aria-label={t('search.start')}>
              {searchBusy ? <ActivityDots /> : t('search.go')}
            </Button>
            <Select
              size="sm"
              value={scope}
              aria-label={t('search.scope')}
              options={[
                { value: 'project', label: t('search.wholeWork') },
                { value: 'directory', label: t('search.manuscriptOnly') },
              ]}
              disabled={replaceBusy}
              onValueChange={(value: string) => { setScope(value === 'directory' ? 'directory' : 'project'); clearResults() }} />
          </form>
          <Button type="button" size="sm" variant="ghost" className="search-replace-toggle" aria-expanded={replaceOpen}
            disabled={replaceBusy}
            onClick={() => { setReplaceOpen((value) => !value); setConfirming(null) }}>
            {replaceOpen ? t('search.hideReplace') : t('search.showReplace')}
          </Button>
          {replaceOpen ? <form
            className="search-replace"
            onSubmit={(event: FormEvent) => { event.preventDefault(); openReplaceConfirm() }}>
            <Input
              size="sm"
              className="search-replace-input"
              value={replacement}
              disabled={replaceBusy}
              placeholder={t('search.replacePlaceholder')}
              aria-label={t('search.replaceAria')}
              onChange={(value: string) => { setReplacement(value); setConfirming(null) }}
              onKeyDown={blockImeEnter} />
            <Button type="submit" size="sm" variant="secondary" disabled={busy || !replaceEnabled}>
              {t('search.replaceAll')}
            </Button>
          </form> : null}
          {currentConfirmation && replacePlan && replaceSummary ? <div
            className="search-replace-confirm"
            role="region"
            aria-label={t('search.replaceConfirmTitle')}>
            <p className="search-summary" role="status">
              {t('search.replaceSummary', { files: replaceSummary.files, count: replaceSummary.occurrences })}
            </p>
            {replaceSummary.skipped ? <p className="search-note">
              {t('search.replaceOverlap', { count: replaceSummary.skipped })}
            </p> : null}
            {replaceSummary.staleFiles ? <Notice tone="danger" className="search-replace-notice">
              {t('search.replaceStale', { count: replaceSummary.staleFiles })}
            </Notice> : null}
            {replaceSummary.perFile.length ?
              <ul className="search-results">
                {replaceSummary.perFile.map((file) => <li key={file.path} className="search-file">
                  <span className="search-note">
                    {t('search.replaceFileHits', { path: file.path, count: file.count })}
                  </span>
                </li>)}
              </ul> : null}
            <div className="search-replace-actions">
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={busy || !replacePlan.files.length}
                onClick={() => void runReplace(replacePlan)}>
                {busy ? <Fragment>
                  <ActivityDots />
                  {t('search.replaceConfirm')}
                </Fragment> : t('search.replaceConfirm')}
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div> : null}
          {outcome ? <div className="search-replace-result" role="status">
            <p className="search-replace-result-text">
              {t('search.replaceResult', { files: outcome.files, count: outcome.occurrences })}
            </p>
            {outcome.stale.length ? <Notice tone="danger" className="search-replace-notice">
              {t('search.replaceStale', { count: outcome.stale.length })}
            </Notice> : null}
            {outcome.changed.length ? <Notice tone="danger" className="search-replace-notice">
              {t('search.replaceChanged', { count: outcome.changed.length })}
            </Notice> : null}
            {outcome.failed.length ? <Notice tone="danger" className="search-replace-notice">
              {t('search.replaceFailed', { count: outcome.failed.length })}
            </Notice> : null}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void search(query, scope, { keepOutcome: true })}>
              {busy ? <Fragment>
                <ActivityDots />
                {t('search.replaceAgain')}
              </Fragment> : t('search.replaceAgain')}
            </Button>
          </div> : null}
          {acceptedResult ? <div className="search-summary" role="status">
            <span>
              {t('search.summary', { hits: acceptedResult.results.length, files: acceptedResult.scannedFiles })}
            </span>
            {acceptedResult.truncated ? <strong>
              {t('search.capped')}
            </strong> : null}
            {acceptedResult.skipped ? <span>
              {searchSkippedText(acceptedResult.skipped)}
            </span> : null}
          </div> : null}
          {props.navigationBlocked && acceptedResult?.results.length ? <Notice tone="danger" className="search-replace-notice">
            {t('search.saveBeforeJump')}
          </Notice> : null}
          {note ? <p className="search-note" role={noteAlert ? 'alert' : 'status'}>
            {note}
          </p> : null}
          {grouped.length ? <div className="search-results-scroll">
            <ol className="search-results">
              {grouped.map((group) => <li key={group.path} className="search-file">
                <div className="search-file-head">
                  <span className="search-file-path" title={group.path}>
                    {group.path}
                  </span>
                  <span className="search-file-count">
                    {group.hits.length}
                  </span>
                </div>
                <ul>
                  {group.hits.map((hit, index) => <li key={`${hit.path}:${hit.start}:${index}`}>
                    <button
                      type="button"
                      className="search-hit"
                      disabled={props.navigationBlocked}
                      onClick={() => props.onOpen(hit)}>
                      <span className="search-hit-line">{t('search.hitLineOnly', { line: hit.line })}</span>
                      <span className="search-hit-excerpt">{hit.excerpt}</span>
                    </button>
                  </li>)}
                </ul>
              </li>)}
            </ol>
          </div> : null}
        </div>
      </div>
    </m.section>
  );
}

export { SearchPanel }
