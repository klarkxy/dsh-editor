import { Fragment, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Box, Button, Callout, Flex, ScrollArea, Text, TextField } from '@radix-ui/themes'
import { Select } from './select.tsx'
import { ActivityDots, isImeEvent } from './ui/index.ts'
import { m, useChromeMotion } from './ui/motion.ts'
import { errorMessage, isStaleFailure, LatestRequestGate, safeRpcCall, searchSkippedText, worldbookPaperProjection, type RevealRequest, type RpcResult, type ShellContext } from './shared.ts'
import {
  planReplace,
  prepareReplaceWrite,
  summarizeReplacePlan,
  type ReplacePlan,
} from '../search-replace.ts'
import { isAuxiliaryAuthorFile } from '../auxiliary-files.ts'
import { documentDirectory, searchPathInDirectory } from '../project-files.ts'
import { t } from '../i18n/index.ts'

export type SearchScope = 'project' | 'directory'

export type SearchHit = {
  path: string
  line: number
  column: number
  start: number
  end: number
  excerpt: string
  version: string
}

export type SearchResponse = {
  results: SearchHit[]
  scannedFiles: number
  scannedBytes: number
  skipped: number
  truncated: boolean
}

export type GroupedSearchHits = { path: string; hits: SearchHit[] }[]

export type ReplaceOutcome = {
  files: number
  occurrences: number
  stale: string[]
  changed: string[]
  failed: string[]
}

export type SearchReplaceReport = { identity: string; outcome: ReplaceOutcome }

export function replaceOutcomeForIdentity(report: SearchReplaceReport | null, identity: string): ReplaceOutcome | null {
  return report?.identity === identity ? report.outcome : null
}

/** Sidebar owns the live query; a blank field must drop the current hit list. */
export function searchQueryClearsResults(query: string): boolean {
  return !query.trim()
}

/** Drop assistant/config files before grouping, counting, or planning replace. */
export function acceptSearchResults(response: SearchResponse): SearchResponse {
  return {
    ...response,
    results: response.results.filter((hit) => !isAuxiliaryAuthorFile(hit.path)),
  }
}

export type SearchTextRequest = {
  sessionId: string
  query: string
  scope: 'project'
  directory?: string
}

/** Host payload: project walk by default; directory scope sends the active document folder. */
export function searchTextRequest(input: {
  sessionId: string
  query: string
  scope: SearchScope
  activePath: string
}): SearchTextRequest {
  const directory = input.scope === 'directory' ? documentDirectory(input.activePath) : ''
  return directory
    ? { sessionId: input.sessionId, query: input.query, scope: 'project', directory }
    : { sessionId: input.sessionId, query: input.query, scope: 'project' }
}

/** Defense-in-depth folder filter after Host results. Never lock the RPC to 正文/. */
export function scopeSearchResults(response: SearchResponse, scope: SearchScope, activePath: string): SearchResponse {
  if (scope !== 'directory') return response
  const directory = documentDirectory(activePath)
  if (!directory) return response
  return {
    ...response,
    results: response.results.filter((hit) => searchPathInDirectory(hit.path, directory)),
  }
}

export function groupSearchHits(hits: readonly SearchHit[]): GroupedSearchHits {
  const groups = new Map<string, SearchHit[]>()
  for (const hit of hits) {
    const list = groups.get(hit.path)
    if (list) list.push(hit)
    else groups.set(hit.path, [hit])
  }
  return [...groups.entries()].map(([path, groupHits]) => ({ path, hits: groupHits }))
}

export function paperRevealRange(path: string, text: string, hit: Pick<SearchHit, 'start' | 'end'>): { from: number; to: number } {
  const offset = worldbookPaperProjection(path, text).offset
  const from = Math.max(0, hit.start - offset)
  const to = Math.max(from, hit.end - offset)
  return { from, to }
}

export function toRevealRequest(hit: SearchHit, nonce = Date.now()): RevealRequest {
  return { ...hit, nonce }
}

export function canReplaceAll(input: { query: string; replacement: string; hits: number }): boolean {
  return input.hits > 0 && input.replacement !== input.query
}

export function replaceBlockedByDirty(input: { activePath: string; activeDirty: boolean; paths: readonly string[] }): boolean {
  return input.activeDirty && Boolean(input.activePath) && input.paths.includes(input.activePath)
}

/** Results and confirmation belong to one exact search context, including the active folder. */
export function searchIdentity(input: { sessionId: string; revision: number; query: string; scope: SearchScope; activePath: string }): string {
  return JSON.stringify([input.sessionId, input.revision, input.query, input.scope,
    input.scope === 'directory' ? documentDirectory(input.activePath) : ''])
}

/** Once confirmed, completed writes are accounted for independently of search reads. */
export async function executeReplacePlan(input: {
  plan: ReplacePlan
  query: string
  read(path: string): Promise<RpcResult<{ text: string; version: string }>>
  write(path: string, text: string, version: string): Promise<RpcResult<{ version: string }>>
}): Promise<{ outcome: ReplaceOutcome; written: string[] }> {
  const stale = [...input.plan.stale]
  const changed: string[] = []
  const failed: string[] = []
  const written: string[] = []
  let occurrences = 0
  for (const file of input.plan.files) {
    const read = await input.read(file.path)
    if (!read.ok) { failed.push(file.path); continue }
    const prepared = prepareReplaceWrite(file, read.value, input.query, input.plan.replacement)
    if (!prepared.ok) {
      if (prepared.reason === 'stale') stale.push(file.path)
      else changed.push(file.path)
      continue
    }
    const result = await input.write(file.path, prepared.text, read.value.version)
    if (!result.ok) {
      if (isStaleFailure(result)) stale.push(file.path)
      else failed.push(file.path)
      continue
    }
    written.push(file.path)
    occurrences += file.spans.length
  }
  return { outcome: { files: written.length, occurrences, stale, changed, failed }, written }
}

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
      <Box className="search-panel-body" px="3" pb="2">
        <Flex direction="column" gap="2">
          <Flex asChild align="center" gap="2" wrap="wrap">
            <form
              role="search"
              onSubmit={(event: FormEvent) => { event.preventDefault(); void search(query, scope) }}>
              {props.onQueryChange ? null : <TextField.Root
                ref={input}
                size="2"
                style={{ flex: 1, minWidth: 0 }}
                value={query}
                disabled={replaceBusy}
                maxLength={120}
                placeholder={t('search.placeholder')}
                aria-label={t('search.aria')}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
                onKeyDown={blockImeEnter} />}
              <Button
                type="submit"
                size="2"
                variant="soft"
                color="gray"
                disabled={busy || !query.trim() || props.composing}
                aria-label={t('search.start')}>
                {searchBusy ? <ActivityDots /> : t('search.go')}
              </Button>
              <Select
                value={scope}
                aria-label={t('search.scope')}
                options={[
                  { value: 'project', label: t('search.wholeWork') },
                  { value: 'directory', label: t('search.manuscriptOnly') },
                ]}
                disabled={replaceBusy}
                onChange={(value: string) => { setScope(value === 'directory' ? 'directory' : 'project'); clearResults() }} />
            </form>
          </Flex>
          <Button type="button" size="2" variant="ghost" color="gray" className="search-replace-toggle" aria-expanded={replaceOpen}
            disabled={replaceBusy}
            onClick={() => { setReplaceOpen((value) => !value); setConfirming(null) }}>
            {replaceOpen ? t('search.hideReplace') : t('search.showReplace')}
          </Button>
          {replaceOpen ? <Flex asChild align="center" gap="2">
            <form
              className="search-replace"
              onSubmit={(event: FormEvent) => { event.preventDefault(); openReplaceConfirm() }}>
              <TextField.Root
                size="2"
                style={{ flex: 1, minWidth: 0 }}
                value={replacement}
                disabled={replaceBusy}
                placeholder={t('search.replacePlaceholder')}
                aria-label={t('search.replaceAria')}
                onChange={(event: ChangeEvent<HTMLInputElement>) => { setReplacement(event.target.value); setConfirming(null) }}
                onKeyDown={blockImeEnter} />
              <Button type="submit" size="2" variant="soft" disabled={busy || !replaceEnabled}>
                {t('search.replaceAll')}
              </Button>
            </form>
          </Flex> : null}
          {currentConfirmation && replacePlan && replaceSummary ? <Box
            className="search-replace-confirm"
            role="region"
            aria-label={t('search.replaceConfirmTitle')}>
            <Text as="p" className="search-summary" size="1" color="gray" role="status">
              {t('search.replaceSummary', { files: replaceSummary.files, count: replaceSummary.occurrences })}
            </Text>
            {replaceSummary.skipped ? <Text as="p" size="1" color="gray">
              {t('search.replaceOverlap', { count: replaceSummary.skipped })}
            </Text> : null}
            {replaceSummary.staleFiles ? <Text as="p" className="warning" size="1" color="red">
              {t('search.replaceStale', { count: replaceSummary.staleFiles })}
            </Text> : null}
            {replaceSummary.perFile.length ? <Box asChild>
              <ul className="search-results">
                {replaceSummary.perFile.map((file) => <li key={file.path} className="search-file">
                  <Text size="1">
                    {t('search.replaceFileHits', { path: file.path, count: file.count })}
                  </Text>
                </li>)}
              </ul>
            </Box> : null}
            <Flex className="search-replace-actions" align="center" gap="2" mt="2">
              <Button
                type="button"
                size="2"
                variant="solid"
                disabled={busy || !replacePlan.files.length}
                onClick={() => void runReplace(replacePlan)}>
                {busy ? <Fragment>
                  <ActivityDots />
                  {t('search.replaceConfirm')}
                </Fragment> : t('search.replaceConfirm')}
              </Button>
              <Button type="button" size="2" variant="soft" color="gray" disabled={busy} onClick={() => setConfirming(null)}>
                {t('common.cancel')}
              </Button>
            </Flex>
          </Box> : null}
          {outcome ? <Box className="search-replace-result" role="status">
            <Text as="p" size="2">
              {t('search.replaceResult', { files: outcome.files, count: outcome.occurrences })}
            </Text>
            {outcome.stale.length ? <Text as="p" className="warning" size="1" color="red">
              {t('search.replaceStale', { count: outcome.stale.length })}
            </Text> : null}
            {outcome.changed.length ? <Text as="p" className="warning" size="1" color="red">
              {t('search.replaceChanged', { count: outcome.changed.length })}
            </Text> : null}
            {outcome.failed.length ? <Text as="p" className="warning" size="1" color="red">
              {t('search.replaceFailed', { count: outcome.failed.length })}
            </Text> : null}
            <Button
              type="button"
              size="2"
              variant="soft"
              disabled={busy}
              onClick={() => void search(query, scope, { keepOutcome: true })}>
              {busy ? <Fragment>
                <ActivityDots />
                {t('search.replaceAgain')}
              </Fragment> : t('search.replaceAgain')}
            </Button>
          </Box> : null}
          {acceptedResult ? <Flex className="search-summary" wrap="wrap" gap="2" role="status">
            <Text size="1" color="gray">
              {t('search.summary', { hits: acceptedResult.results.length, files: acceptedResult.scannedFiles })}
            </Text>
            {acceptedResult.truncated ? <Text size="1" weight="bold">
              {t('search.capped')}
            </Text> : null}
            {acceptedResult.skipped ? <Text size="1" color="gray">
              {searchSkippedText(acceptedResult.skipped)}
            </Text> : null}
          </Flex> : null}
          {props.navigationBlocked && acceptedResult?.results.length ? <Callout.Root className="warning" color="red" size="1" role="alert">
            <Callout.Text>
              {t('search.saveBeforeJump')}
            </Callout.Text>
          </Callout.Root> : null}
          {note ? <Text as="p" size="1" color="gray" role={noteAlert ? 'alert' : 'status'}>
            {note}
          </Text> : null}
          {grouped.length ? <ScrollArea type="auto" scrollbars="vertical" className="search-results-scroll">
            <Box asChild>
              <ol className="search-results">
                {grouped.map((group) => <li key={group.path} className="search-file">
                  <Flex className="search-file-head" justify="between" gap="2">
                    <Text size="1" color="gray" truncate title={group.path}>
                      {group.path}
                    </Text>
                    <Text size="1" color="gray">
                      {group.hits.length}
                    </Text>
                  </Flex>
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
            </Box>
          </ScrollArea> : null}
        </Flex>
      </Box>
    </m.section>
  );
}

export { SearchPanel }
